/**
 * RuntimeController jobs HUD: rows come from the jobs registry scoped to the
 * exact live agent (a caller-less list would leak other sessions), hide when
 * the service or the list is absent, and re-emit on `onJobsChanged`.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
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
        inbox: createInboxStub(),
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
      await options.setup?.(agent.ctx, agent)
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
    get: (id: JobId) => {
      const row = rows.find(row => row.id === id)
      if (row === undefined) throw new Error(`unknown job ${id}`)
      return { ...row }
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

  describe.each(['completed', 'killed', 'failed'] as const)('%s jobs', (terminal) => {
    it.each([false, true])('withdraws on notification, preserving query records (stopping: %s)', async (stopping) => {
      const rows: JobSnapshot[] = [{ ...RUNNING }]
      let jobs!: JobsFake
      const { ctx, controller, liveAgent } = await bench((ctx) => {
        jobs = provideJobs(ctx, rows)
      })
      const observe = vi.fn(() => controller.getJobsHud())
      const unsubscribe = controller.subscribe(observe)
      try {
        expect(controller.getJobsHud()).toEqual([
          { id: 'bash-1', status: 'running', label: '跑测试' },
        ])
        if (stopping) {
          // A registry kill reports the job before its producer actually settles.
          rows[0] = { ...RUNNING, status: 'stopping', reported: true }
          jobs.fire()
          await vi.waitFor(() => {
            expect(observe).toHaveReturnedWith([
              { id: 'bash-1', status: 'stopping', label: '跑测试' },
            ])
          })
        }

        const activeSnapshot = controller.getJobsHud()
        const terminalRecord: JobSnapshot = {
          ...RUNNING,
          status: terminal,
          detail: terminal === 'completed' ? 'exit code: 3' : 'producer stopped',
          finishedAt: 2,
          reported: stopping,
        }
        rows[0] = { ...terminalRecord }
        expect(controller.getJobsHud()).toBe(activeSnapshot)
        const readsBeforeNotification = jobs.calls.length
        observe.mockClear()
        jobs.fire()

        await vi.waitFor(() => {
          expect(observe).toHaveReturnedWith([])
        })
        expect(jobs.calls.slice(readsBeforeNotification)).toEqual([liveAgent])
        expect(controller.getJobsHud()).toEqual([])
        expect(ctx.jobs.get(RUNNING.id, liveAgent)).toEqual(terminalRecord)
        expect(ctx.jobs.list(liveAgent)).toEqual([terminalRecord])
        expect(rows).toEqual([terminalRecord])
      } finally {
        unsubscribe()
        await controller.dispose()
        await ctx.fiber.dispose()
      }
    })
  })

  it('keeps an active background job after its session turn ends', async () => {
    const rows: JobSnapshot[] = [{ ...RUNNING }]
    const { ctx, controller, liveAgent } = await bench((ctx) => {
      provideJobs(ctx, rows)
    })
    try {
      controller.dispatch({ kind: 'send', text: 'start background work' })
      liveAgent.session.append('turn/start', { turn: 1 })
      expect(controller.getInteraction()).toBe('generating')
      const activeSnapshot = controller.getJobsHud()
      expect(activeSnapshot).toHaveLength(1)
      liveAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(controller.getInteraction()).toBe('idle')
      expect(controller.getJobsHud()).toEqual(activeSnapshot)
      expect(ctx.jobs.get(RUNNING.id, liveAgent)).toEqual(RUNNING)
    } finally {
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('re-lists successive completed batches without accumulating them or hiding ongoing work', async () => {
    const ongoing: JobSnapshot = { ...RUNNING, label: 'ongoing worker' }
    const rows: JobSnapshot[] = [{ ...ongoing }]
    const expectedRecords: JobSnapshot[] = [{ ...ongoing }]
    let jobs!: JobsFake
    const { ctx, controller, liveAgent } = await bench((ctx) => {
      jobs = provideJobs(ctx, rows)
    })
    const activeRow = { id: 'bash-1', status: 'running', label: 'ongoing worker' }
    try {
      expect(controller.getJobsHud()).toEqual([activeRow])
      for (let batch = 0; batch < 3; batch += 1) {
        const start = rows.length
        const added: JobSnapshot[] = Array.from({ length: 4 }, (_, offset) => ({
          ...RUNNING,
          id: JobId(`bash-${start + offset + 1}`),
          label: `batch ${batch} worker ${offset}`,
        }))
        rows.push(...added)
        jobs.fire()
        expect(controller.getJobsHud()).toEqual([
          activeRow,
          ...added.map(({ id, label }) => ({ id, label, status: 'running' })),
        ])
        const settled = added.map(job => ({ ...job, status: 'completed' as const, finishedAt: 2 }))
        rows.splice(start, added.length, ...settled)
        expectedRecords.push(...settled.map(job => ({ ...job })))
        jobs.fire()
        expect(controller.getJobsHud()).toEqual([activeRow])
        expect(ctx.jobs.list(liveAgent)).toEqual(expectedRecords)
      }
      rows[0] = { ...ongoing, status: 'completed', finishedAt: 3 }
      expectedRecords[0] = { ...rows[0] }
      jobs.fire()
      expect(controller.getJobsHud()).toEqual([])
      expect(ctx.jobs.list(liveAgent)).toEqual(expectedRecords)
      expect(expectedRecords).toHaveLength(13)
      expect(jobs.calls.every(caller => caller === liveAgent)).toBe(true)
    } finally {
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  })
})
