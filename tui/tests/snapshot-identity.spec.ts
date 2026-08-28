/**
 * RuntimeController snapshot identity: the model/session-pane/search-pane
 * getters must return referentially stable objects between store emissions —
 * the TUI loop feeds them to useSyncExternalStore, which treats a fresh
 * object as an update and re-renders forever — while staying current after
 * each relevant state change. The panes' nested rows/results arrays are
 * replaced wholesale on mutation, so object identity tracks currency.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** Scripted agent whose followup resolves immediately and appends nothing. */
function scriptedAgent(ownerCtx: Context, session: Session): Agent {
  const agent = {} as Agent
  const agentCtx = ownerCtx.extend({ agent })
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
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: (_message: UserMessage) => {},
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  return agent
}

interface Bench {
  ctx: Context
  controller: RuntimeController
}

/** Mount the services and a scripted factory over the given root. */
async function bench(root: string): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(JsonlSessionPersistence, { root })
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session)
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    async resume(
      ownerCtx: Context,
      options: ResumeAgentOptions,
    ): Promise<AgentHandle> {
      const loaded = await ctx.sessionPersistence.load(options.resumeSessionId)
      const session = ctx.sessions.create(options.resumeSessionId, {
        seed: loaded.events.map(event => structuredClone(event)),
      })
      const agent = scriptedAgent(ownerCtx, session)
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
  })
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
  return { ctx, controller }
}

describe('RuntimeController snapshot identity', () => {
  it('returns the same snapshot references across reads between emissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-snapshot-'))
    roots.push(root)
    const { ctx, controller } = await bench(root)
    expect(controller.getModel()).toBe(controller.getModel())
    expect(controller.getSessionPane()).toBe(controller.getSessionPane())
    expect(controller.getSearchPane()).toBe(controller.getSearchPane())
    await ctx.fiber.dispose()
  })

  it('rebuilds the session-pane snapshot on a relevant mutation with current content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-snapshot-'))
    roots.push(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    const before = controller.getSessionPane()
    controller.dispatch({ kind: 'session-pane' })
    const after = controller.getSessionPane()
    expect(after).not.toBe(before)
    expect(after.open).toBe(true)
    expect(after).toBe(controller.getSessionPane())
    controller.dispatch({ kind: 'session-pane' })
    const closed = controller.getSessionPane()
    expect(closed).not.toBe(after)
    expect(closed.open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('rebuilds the search-pane snapshot on a search mutation with current content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-snapshot-'))
    roots.push(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    controller.dispatch({ kind: 'search-pane' })
    const opened = controller.getSearchPane()
    expect(opened.open).toBe(true)
    // No session-query engine in this bench: the query still lands, the
    // results stay empty, and the snapshot tracks it.
    controller.dispatch({ kind: 'search', query: 'sc4' })
    const searched = controller.getSearchPane()
    expect(searched).not.toBe(opened)
    expect(searched.query).toBe('sc4')
    expect(searched.results).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rebuilds the model snapshot after state changes with current content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-snapshot-'))
    roots.push(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    const idle = controller.getModel()
    expect(idle.status).toBe('idle')
    // The machine enters generating on send; the projector's active turn
    // follows the session event, and both must land in a rebuilt snapshot.
    controller.dispatch({ kind: 'send', text: 'hi' })
    const generating = controller.getModel()
    expect(generating).not.toBe(idle)
    expect(generating.status).toBe('generating')
    controller.session?.append('turn/start', { turn: 1 })
    const active = controller.getModel()
    expect(active).not.toBe(generating)
    expect(active.activeTurn?.turn).toBe(1)
    expect(active).toBe(controller.getModel())
    await ctx.fiber.dispose()
  })
})
