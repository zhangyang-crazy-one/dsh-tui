/**
 * RuntimeController goal footer: the status-row fragment reads through the
 * goal service (never the feedback row), hides when no goal is current or the
 * service is absent, and returns a stable snapshot reference between
 * emissions (the useSyncExternalStore contract).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal/types'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const GOAL_VIEW: GoalView = {
  id: GoalId('goal-footer'),
  revision: 1,
  objective: '落地 Phase 6 入口',
  phase: 'active',
  maxGoalRounds: 8,
  roundsStarted: 2,
  createdAt: 1,
  updatedAt: 2,
  activation: 'armed',
}

interface Bench {
  ctx: Context
  controller: RuntimeController
  liveAgent: Agent
}

/** Mount the minimal registries plus a scripted factory with one live agent. */
async function bench(): Promise<Bench> {
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

describe('goal footer', () => {
  it('returns undefined when the goals service is not composed', async () => {
    const { ctx, controller } = await bench()
    expect(controller.getGoalFooter()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('returns the current goal view through the service', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('goals', { get: () => GOAL_VIEW } as never)
    expect(controller.getGoalFooter()).toBe(GOAL_VIEW)
    await ctx.fiber.dispose()
  })

  it('returns undefined when no goal is current', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('goals', { get: () => undefined } as never)
    expect(controller.getGoalFooter()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('queries the goal of the live agent, not a stale one', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const seen: Agent[] = []
    ctx.provide('goals', {
      get: (agent: Agent) => {
        seen.push(agent)
        return undefined
      },
    } as never)
    expect(controller.getGoalFooter()).toBeUndefined()
    expect(seen).toEqual([liveAgent])
    await ctx.fiber.dispose()
  })

  it('returns the same snapshot reference between emissions', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('goals', { get: () => GOAL_VIEW } as never)
    const first = controller.getGoalFooter()
    expect(controller.getGoalFooter()).toBe(first)
    await ctx.fiber.dispose()
  })
})
