/**
 * RuntimeController jobs HUD: rows come from the jobs registry scoped to the
 * exact live agent (a caller-less list would leak other sessions), hide when
 * the service or the list is absent, and re-emit on `onJobsChanged`.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const RUNNING: JobSnapshot = {
  id: JobId('bash-1'),
  kind: 'bash',
  label: '跑测试',
  status: 'running',
  startedAt: 1,
  reported: false,
}

interface Bench {
  ctx: Context
  controller: RuntimeController
  liveAgent: Agent
}

/**
 * Mount the minimal registries plus a scripted factory with one live agent.
 * `setup` runs before the controller is constructed, because the controller
 * binds service subscriptions in its constructor.
 */
async function bench(setup?: (ctx: Context) => void): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  let liveAgent: Agent | undefined
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = {} as Agent
      Object.assign(agent, {
        id: session.id,
        options: {},
        session,
        inbox: new Inbox(session, {
          inserted: () => {},
          discarded: () => {},
          claimed: () => {},
        }),
        status: 'idle',
        ctx: ownerCtx.extend({ agent }),
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: () => {},
        steer: () => {},
        inject: () => {},
        whenIdle: () => Promise.resolve(),
      } satisfies Partial<Agent>)
      liveAgent = agent
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  setup?.(ctx)
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
  await controller.start()
  if (liveAgent === undefined) throw new Error('expected a live agent')
  return { ctx, controller, liveAgent }
}

interface JobsFake {
  readonly calls: (Agent | undefined)[]
  readonly fire: () => void
}

/** Provide a jobs fake; return its call log and a change trigger. */
function provideJobs(ctx: Context, rows: JobSnapshot[]): JobsFake {
  const calls: (Agent | undefined)[] = []
  let listener: (() => void) | undefined
  ctx.provide('jobs', {
    list: (caller?: Agent) => {
      calls.push(caller)
      return rows
    },
    onJobsChanged: (next: () => void) => {
      listener = next
      return () => {}
    },
  } as never)
  return {
    calls,
    fire: () => listener?.(),
  }
}

describe('jobs HUD', () => {
  it('returns undefined when the jobs service is not composed', async () => {
    const { ctx, controller } = await bench()
    expect(controller.getJobsHud()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('lists with the exact live agent and maps registry rows', async () => {
    let jobs: JobsFake | undefined
    const { ctx, controller, liveAgent } = await bench((ctx) => {
      jobs = provideJobs(ctx, [RUNNING])
    })
    expect(controller.getJobsHud()).toEqual([
      { id: 'bash-1', status: 'running', label: '跑测试' },
    ])
    expect(jobs?.calls).toEqual([liveAgent])
    await ctx.fiber.dispose()
  })

  it('returns the empty list so the loop hides the HUD row', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideJobs(ctx, [])
    })
    expect(controller.getJobsHud()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('re-emits when the registry reports a change', async () => {
    let jobs: JobsFake | undefined
    const { ctx, controller } = await bench((ctx) => {
      jobs = provideJobs(ctx, [RUNNING])
    })
    let notified = 0
    const unsubscribe = controller.subscribe(() => {
      notified += 1
    })
    jobs?.fire()
    // emit() drops caches synchronously but throttles listener notification.
    await vi.waitFor(() => {
      expect(notified).toBeGreaterThan(0)
    })
    unsubscribe()
    await ctx.fiber.dispose()
  })

  it('drops the cached snapshot on a change so the next read re-lists', async () => {
    let jobs: JobsFake | undefined
    const { ctx, controller } = await bench((ctx) => {
      jobs = provideJobs(ctx, [RUNNING])
    })
    controller.getJobsHud()
    jobs?.fire()
    controller.getJobsHud()
    expect(jobs?.calls.length).toBe(2)
    await ctx.fiber.dispose()
  })
})
