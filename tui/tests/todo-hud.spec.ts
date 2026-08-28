/**
 * RuntimeController todo HUD: rows come from the session-projection registry
 * (never from parsing `todo_write` JSON), hide when the registry is absent or
 * the projection is null, and keep a stable snapshot reference between
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
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const ROWS: TodoItem[] = [
  { content: '写测试', status: 'pending' },
  { content: '改界面', status: 'in_progress' },
  { content: '提交', status: 'completed' },
]

interface Bench {
  ctx: Context
  controller: RuntimeController
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
  return { ctx, controller }
}

/** A projection-registry fake whose `todos` cell replays the given value. */
function fakeProjections(todos: TodoItem[] | null): never {
  return {
    snapshot: () => ({ values: { todos } }),
  } as never
}

describe('todo HUD', () => {
  it('returns undefined when the projection registry is not composed', async () => {
    const { ctx, controller } = await bench()
    expect(controller.getTodoHud()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('returns undefined when the todos projection is null', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('sessionProjections', fakeProjections(null))
    expect(controller.getTodoHud()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('returns the projection rows without parsing todo_write payloads', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('sessionProjections', fakeProjections(ROWS))
    expect(controller.getTodoHud()).toBe(ROWS)
    await ctx.fiber.dispose()
  })

  it('returns the empty list so the loop hides the HUD row', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('sessionProjections', fakeProjections([]))
    expect(controller.getTodoHud()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('returns the same snapshot reference between emissions', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('sessionProjections', fakeProjections(ROWS))
    const first = controller.getTodoHud()
    expect(controller.getTodoHud()).toBe(first)
    await ctx.fiber.dispose()
  })
})
