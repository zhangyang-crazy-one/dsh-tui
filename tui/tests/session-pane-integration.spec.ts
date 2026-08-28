/**
 * Session directory integration: the controller against real JSONL
 * persistence and a scripted agent factory. Covers list refresh, Ctrl+N
 * create, Enter switch through agents.resume, live rename, confirmed
 * delete, the K8 failure-recovery paths, and the K6 delete capability
 * states.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
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
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  UserMessage,
} from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionTitleService, { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { escapeContent } from '@deepseek-ai/dsh-tui-render'
import { logPath } from '../../../session/session-persistence-jsonl/src/format.ts'
import { FEEDBACK_MS, RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const TITLE_CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
} as const

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

type ColdCommit = (
  meta: SessionHeader,
  marker: unknown,
  closers: readonly SessionEvent[],
  events: readonly SessionEvent[],
) => Promise<void>

interface ColdCommitGate {
  readonly entered: Promise<void>
  release(): void
  restore(): void
}

/** Delay one genuine provider cold commit after it owns the same-id reservation. */
function gateColdCommit(persistence: SessionPersistence): ColdCommitGate {
  const backend = persistence as unknown as { appendColdBatch?: ColdCommit }
  const original = backend.appendColdBatch
  if (original === undefined) throw new Error('backend has no cold commit hook')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  backend.appendColdBatch = async (meta, marker, closers, events) => {
    entered.resolve(undefined)
    await release.promise
    return original.call(backend, meta, marker, closers, events)
  }
  return {
    entered: entered.promise,
    release: () => { release.resolve(undefined) },
    restore: () => { backend.appendColdBatch = original },
  }
}

/** Fail the first JSONL fsync after cold-rename physical write work begins. */
async function injectColdRenameFailure(root: string, id: ReturnType<typeof SessionId>): Promise<() => void> {
  const handle = await open(logPath(root, undefined, id, 'none'), 'r')
  const prototype = Object.getPrototypeOf(handle) as { sync(): Promise<void> }
  await handle.close()
  const original = Reflect.get(prototype, 'sync')
  let failed = false
  const spy = vi.spyOn(prototype, 'sync').mockImplementation(async function (this: unknown) {
    if (!failed) {
      failed = true
      throw new Error('simulated \u001B[31mstorage failure')
    }
    return original.call(this)
  })
  return () => { spy.mockRestore() }
}

/** One balanced completed turn with a logged title — the smallest resumable log. */
function seedLog(title: string, base: number): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: base + 1, data: { turn: 1 } },
    {
      type: 'session/title',
      seq: 1,
      time: base + 2,
      data: { title, messageSeqs: [], source: { kind: 'fallback' } },
    },
    {
      type: 'turn/end',
      seq: 2,
      time: base + 3,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

/** Persist three sessions through a throwaway context, leaving live-store space. */
async function preCreateSessions(root: string): Promise<void> {
  const writer = new Context()
  await writer.plugin(SessionStore)
  await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  for (const [index, title] of ['alpha', 'beta', 'gamma'].entries()) {
    const session = writer.sessions.create(SessionId(`session-${index}`), {
      seed: seedLog(title, index),
    })
    await writer.sessions.flush(session)
  }
  await writer.fiber.dispose()
}

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
  createCalls: ReturnType<typeof vi.fn>
  resumeCalls: ReturnType<typeof vi.fn>
  controller: RuntimeController
}

interface BenchOptions {
  /** Replace the real JSONL backend with a scripted stub (delete optional). */
  stubPersistence?: { delete?: () => Promise<void> }
  /** Reject agents.create on the nth call (K8 new-session failure). */
  failCreateOn?: number
}

/** A scripted persistence stub: list/inspect only, delete optional (K6). */
function persistenceStub(
  deleteImpl?: () => Promise<void>,
): { list: () => Promise<unknown[]>; inspect: () => Promise<unknown>; delete?: () => Promise<void> } {
  return {
    list: async () => [{ id: 'session-stub' }],
    inspect: async () => ({ events: [], meta: { createdAt: 0 } }),
    ...(deleteImpl === undefined ? {} : { delete: deleteImpl }),
  }
}

/** Mount the services and a scripted factory over the pre-created root. */
async function bench(root: string, options: BenchOptions = {}): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  if (options.stubPersistence === undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  } else {
    ctx.provide(
      'sessionPersistence',
      persistenceStub(options.stubPersistence.delete) as never,
    )
  }
  await ctx.plugin(SessionTitleService, TITLE_CONFIG)
  const createCalls = vi.fn()
  const resumeCalls = vi.fn()
  const failCreateOn = options.failCreateOn
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      factoryOptions: CreateAgentOptions,
    ): Promise<AgentHandle> {
      createCalls(factoryOptions.sessionId)
      if (createCalls.mock.calls.length === failCreateOn) {
        throw new Error('create boom')
      }
      const session = ctx.sessions.create(factoryOptions.sessionId, {
        ...(factoryOptions.meta === undefined ? {} : { meta: factoryOptions.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session)
      await factoryOptions.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    // The controller only asserts the resume call; replay the durable log into
    // a fresh live session so the resumed agent is fully usable.
    async resume(
      ownerCtx: Context,
      options: ResumeAgentOptions,
    ): Promise<AgentHandle> {
      resumeCalls(options.resumeSessionId)
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
  if (options.stubPersistence === undefined) {
    expect((await ctx.sessionPersistence.list()).length).toBe(3)
  }
  const out: { text: string } = { text: '' }
  const io: TuiIo = {
    stdout: {
      write: (chunk: string) => {
        out.text += chunk
        return true
      },
    },
    stderr: {
      write: (chunk: string) => {
        out.text += chunk
        return true
      },
    },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
  return { ctx, createCalls, resumeCalls, controller }
}

/** Highlight a row by id without activating it. */
function highlightRow(controller: RuntimeController, id: string): void {
  const index = controller.getSessionPane().rows.findIndex(row => row.id === id)
  if (index < 0) throw new Error(`row "${id}" not listed`)
  const current = controller.getSessionPane().selectedIndex
  controller.dispatch({ kind: 'session-pane-move', delta: index - current })
}

/** Select a row by id through the pane actions. */
function selectRow(controller: RuntimeController, id: string): void {
  highlightRow(controller, id)
  controller.dispatch({ kind: 'select-session', id })
}

describe('session directory controller', () => {
  it('lists persisted sessions, creates on Ctrl+N, switches via resume, renames live, deletes confirmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, createCalls, resumeCalls, controller } = await bench(root)
    await controller.start()
    // The fresh live session remains visible before it has a durable event.
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    const rows = controller.getSessionPane().rows
    const liveId = controller.session?.id
    expect(liveId).toBeDefined()
    expect(rows.map(row => row.id)).toEqual([
      liveId,
      'session-2',
      'session-1',
      'session-0',
    ])
    const beta = rows.find(row => row.id === 'session-1')
    expect(beta?.title).toBe('beta')

    // Ctrl+N creates a second live agent.
    controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(createCalls).toHaveBeenCalledTimes(2)
    })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 已新建会话')
    })

    // Open the list and switch to the second row.
    controller.dispatch({ kind: 'session-pane' })
    selectRow(controller, 'session-1')
    await vi.waitFor(() => {
      expect(resumeCalls).toHaveBeenCalledWith('session-1')
      expect(controller.session?.id).toBe('session-1')
      expect(controller.getSessionPane().rows).toHaveLength(3)
    })
    await vi.waitFor(() => {
      expect(controller.getSessionPane().open).toBe(false)
    })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 已切换会话')
    })

    // The resumed session is the live one: rename applies and re-folds.
    controller.dispatch({ kind: 'session-pane' })
    controller.dispatch({ kind: 'rename-session', title: '重命名后' })
    await vi.waitFor(() => {
      const renamed = controller
        .getSessionPane()
        .rows.find(row => row.id === 'session-1')
      expect(renamed?.title).toBe('重命名后')
    })

    // d arms the confirmation; the second d deletes the persisted session.
    const victimIndex = controller
      .getSessionPane()
      .rows.findIndex(row => row.id === 'session-0')
    expect(victimIndex).toBeGreaterThanOrEqual(0)
    const current = controller.getSessionPane().selectedIndex
    controller.dispatch({
      kind: 'session-pane-move',
      delta: victimIndex - current,
    })
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(true)
    controller.dispatch({ kind: 'delete-session' })
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(2)
    })
    expect(
      (await ctx.sessionPersistence.list()).map(header => header.id),
    ).not.toContain('session-0')
    await expect(
      ctx.sessionPersistence.load(SessionId('session-0')),
    ).rejects.toThrow('not found')

    await ctx.fiber.dispose()
  })

  it('renames a cold row only after the durable commit without creating or resuming an agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, createCalls, resumeCalls, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-1')
    const bound = controller.session
    const beforeRows = controller.getSessionPane().rows.map(row => ({ ...row }))
    const renamePersisted = vi.spyOn(ctx.sessionTitle, 'renamePersisted')
    const gate = gateColdCommit(ctx.sessionPersistence)
    try {
      controller.dispatch({ kind: 'rename-session', title: 'cold durable title' })
      await vi.waitFor(() => {
        expect(renamePersisted).toHaveBeenCalledWith(
          SessionId('session-1'),
          'cold durable title',
          expect.any(AbortSignal),
        )
      })
      await gate.entered

      expect(controller.getSessionPane().rows).toEqual(beforeRows)
      expect(controller.getSessionPane().rows[controller.getSessionPane().selectedIndex]?.id)
        .toBe('session-1')
      expect(controller.session).toBe(bound)
      expect(createCalls).toHaveBeenCalledTimes(1)
      expect(resumeCalls).not.toHaveBeenCalled()

      gate.release()
      await vi.waitFor(() => {
        expect(controller.getSessionPane().rows.find(row => row.id === 'session-1')?.title)
          .toBe('cold durable title')
      })
      expect(controller.getSessionPane().rows[controller.getSessionPane().selectedIndex]?.id)
        .toBe('session-1')
      expect(controller.session).toBe(bound)
      expect(createCalls).toHaveBeenCalledTimes(1)
      expect(resumeCalls).not.toHaveBeenCalled()
      expect(foldSessionTitle((await ctx.sessionPersistence.inspect(SessionId('session-1'))).events))
        .toMatchObject({ title: 'cold durable title', source: { kind: 'user' } })
    } finally {
      gate.release()
      gate.restore()
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('serializes a cold rename before a same-id resume without allocating an extra handle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, createCalls, resumeCalls, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-1')
    const originalSession = controller.session
    const renamePersisted = vi.spyOn(ctx.sessionTitle, 'renamePersisted')
    const gate = gateColdCommit(ctx.sessionPersistence)
    try {
      controller.dispatch({ kind: 'rename-session', title: 'rename wins race' })
      await vi.waitFor(() => {
        expect(renamePersisted).toHaveBeenCalledTimes(1)
      })
      await gate.entered

      controller.dispatch({ kind: 'select-session', id: 'session-1' })
      await vi.waitFor(() => {
        expect(resumeCalls).toHaveBeenCalledTimes(1)
      })
      expect(controller.session).toBe(originalSession)
      expect(controller.getSessionPane().rows.find(row => row.id === 'session-1')?.title)
        .toBe('beta')

      gate.release()
      await vi.waitFor(() => {
        expect(controller.session?.id).toBe('session-1')
      })
      await vi.waitFor(() => {
        expect(controller.getSessionPane().rows.find(row => row.id === 'session-1')?.title)
          .toBe('rename wins race')
      })
      expect(foldSessionTitle(controller.session?.events ?? [])?.title).toBe('rename wins race')
      expect(createCalls).toHaveBeenCalledTimes(1)
      expect(resumeCalls).toHaveBeenCalledTimes(1)
    } finally {
      gate.release()
      gate.restore()
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps the cold row and selection unchanged after a provider failure and fresh directory reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, createCalls, resumeCalls, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-1')
    const bound = controller.session
    const selectedIndex = controller.getSessionPane().selectedIndex
    const beforeRows = controller.getSessionPane().rows.map(row => ({ ...row }))
    const path = logPath(root, undefined, SessionId('session-1'), 'none')
    const rawBefore = await readFile(path)
    const restoreFailure = await injectColdRenameFailure(root, SessionId('session-1'))
    try {
      controller.dispatch({ kind: 'rename-session', title: 'must roll back' })
      await vi.waitFor(() => {
        expect(controller.getFeedback()).toBe(
          '✗ 重命名失败：simulated \u001B[31mstorage failure',
        )
      })
      const escaped = escapeContent(controller.getFeedback() ?? '')
      expect(escaped).toBe('✗ 重命名失败：simulated \\x1b[31mstorage failure')
      expect(escaped).not.toContain('\u001B')
      expect(controller.getSessionPane().rows).toEqual(beforeRows)
      expect(controller.getSessionPane().selectedIndex).toBe(selectedIndex)
      expect(controller.getSessionPane().rows[selectedIndex]?.id).toBe('session-1')
      expect(controller.getSessionPane().open).toBe(true)
      expect(controller.session).toBe(bound)
      expect(controller.getInteraction()).toBe('idle')
      expect(createCalls).toHaveBeenCalledTimes(1)
      expect(resumeCalls).not.toHaveBeenCalled()
      expect(await readFile(path)).toEqual(rawBefore)
    } finally {
      restoreFailure()
      await controller.dispose()
      await ctx.fiber.dispose()
    }

    const reloaded = await bench(root)
    await reloaded.controller.start()
    await vi.waitFor(() => {
      expect(reloaded.controller.getSessionPane().rows).toHaveLength(4)
    })
    expect(reloaded.controller.getSessionPane().rows.find(row => row.id === 'session-1')?.title)
      .toBe('beta')
    expect(reloaded.createCalls).toHaveBeenCalledTimes(1)
    expect(reloaded.resumeCalls).not.toHaveBeenCalled()
    await reloaded.controller.dispose()
    await reloaded.ctx.fiber.dispose()
  })

  it('refuses to delete the live session row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, resumeCalls, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    // Switch to session-1 so it becomes the live row.
    controller.dispatch({ kind: 'session-pane' })
    selectRow(controller, 'session-1')
    await vi.waitFor(() => {
      expect(resumeCalls).toHaveBeenCalledWith('session-1')
    })
    controller.dispatch({ kind: 'session-pane' })
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(false)
    expect(controller.getSessionPane().rows).toHaveLength(3)
    await ctx.fiber.dispose()
  })

  it('keeps the current session usable when a switch target is missing (K8)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, resumeCalls, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    const originalId = controller.session?.id
    controller.dispatch({ kind: 'select-session', id: 'session-missing' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toContain('✗ 切换失败')
    })
    expect(resumeCalls).toHaveBeenCalledWith('session-missing')
    // The old session stays bound and the handle is alive: a send dispatches
    // instead of parking in the pending queue.
    expect(controller.session?.id).toBe(originalId)
    controller.dispatch({ kind: 'send', text: 'ping' })
    expect(controller.getInteraction()).toBe('generating')
    // The next key clears the feedback row (S4 next-key rule).
    controller.dispatch({ kind: 'scroll', delta: 1 })
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('aborts the switch and keeps the session bound when the flush fails (K8)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, resumeCalls, controller } = await bench(root)
    // A rejecting session/flush listener makes the pre-switch flush fail.
    ctx.on('session/flush', () => {
      throw new Error('flush boom')
    })
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    const originalId = controller.session?.id
    controller.dispatch({ kind: 'select-session', id: 'session-1' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toContain('✗ 切换失败')
    })
    // The resume never ran, so the old session is still the live one.
    expect(resumeCalls).not.toHaveBeenCalled()
    expect(controller.session?.id).toBe(originalId)
    controller.dispatch({ kind: 'send', text: 'ping' })
    expect(controller.getInteraction()).toBe('generating')
    await ctx.fiber.dispose()
  })

  it('keeps the current session usable when new-session creation fails (K8)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root, { failCreateOn: 2 })
    await controller.start()
    const originalId = controller.session?.id
    controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 新建会话失败（当前会话保持可用）')
    })
    expect(controller.session?.id).toBe(originalId)
    controller.dispatch({ kind: 'send', text: 'ping' })
    expect(controller.getInteraction()).toBe('generating')
    await ctx.fiber.dispose()
  })

  it('shows the unavailable state when the delete capability is missing (K6)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    const { ctx, controller } = await bench(root, { stubPersistence: {} })
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(2)
    })
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-stub')
    expect(controller.getSessionPane().deleteUnavailable).toBe(true)
    // d never arms without the capability.
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(false)
    await ctx.fiber.dispose()
  })

  it('shows ✗ feedback when the delete fails (K6)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    const { ctx, controller } = await bench(root, {
      stubPersistence: {
        delete: () => Promise.reject(new Error('disk full')),
      },
    })
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(2)
    })
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-stub')
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(true)
    controller.dispatch({ kind: 'delete-session' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 删除失败')
    })
    await ctx.fiber.dispose()
  })

  it('Esc disarms the delete and closes the list; other keys only disarm (K6)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-0')
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(true)
    // A printable key (routed as session-pane-idle) only disarms.
    controller.dispatch({ kind: 'session-pane-idle' })
    expect(controller.getSessionPane().confirmDelete).toBe(false)
    expect(controller.getSessionPane().open).toBe(true)
    // Escape (routed as the session-pane toggle) disarms and closes.
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(true)
    controller.dispatch({ kind: 'session-pane' })
    expect(controller.getSessionPane().confirmDelete).toBe(false)
    expect(controller.getSessionPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('enforces pane mutual exclusion and resets transients (K2/S2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    // Open the list and arm the delete; opening search must reset it.
    controller.dispatch({ kind: 'session-pane' })
    highlightRow(controller, 'session-0')
    expect(controller.getSessionPane().open).toBe(true)
    controller.dispatch({ kind: 'delete-session' })
    expect(controller.getSessionPane().confirmDelete).toBe(true)
    controller.dispatch({ kind: 'search-pane' })
    expect(controller.getSearchPane().open).toBe(true)
    expect(controller.getSessionPane().open).toBe(false)
    expect(controller.getTimelineOpen()).toBe(false)
    expect(controller.getSessionPane().confirmDelete).toBe(false)
    // Search transients reset when the panel closes (no search engine is
    // mounted in this bench, so the query buffer is the observable state).
    controller.dispatch({ kind: 'search', query: 'banana' })
    expect(controller.getSearchPane().query).toBe('banana')
    controller.dispatch({ kind: 'session-pane' })
    expect(controller.getSessionPane().open).toBe(true)
    expect(controller.getSearchPane().open).toBe(false)
    expect(controller.getSearchPane().query).toBe('')
    expect(controller.getSearchPane().results).toEqual([])
    // Opening the timeline closes the list.
    controller.dispatch({ kind: 'toggle-timeline' })
    expect(controller.getTimelineOpen()).toBe(true)
    expect(controller.getSessionPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('bounds the feedback lifetime at FEEDBACK_MS (S4)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    expect(FEEDBACK_MS).toBeLessThanOrEqual(2000)
    await controller.start()
    // Fake timers from before the dispatch so the feedback timer is fake.
    vi.useFakeTimers()
    controller.dispatch({ kind: 'select-session', id: 'session-missing' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toContain('✗ 切换失败')
    })
    vi.advanceTimersByTime(FEEDBACK_MS + 1)
    expect(controller.getFeedback()).toBeUndefined()
    vi.useRealTimers()
    await ctx.fiber.dispose()
  })

  it('derives the live session title for the top bar and follows rename (getTitle)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    // No session bound yet: no title, the loop shows the fixed app name.
    expect(controller.getTitle()).toBe('')
    await controller.start()
    // A fresh session has no foldable title yet.
    expect(controller.getTitle()).toBe('')
    await vi.waitFor(() => {
      expect(controller.getSessionPane().rows).toHaveLength(4)
    })
    // Switch to the seeded session-1 (folded title 'beta').
    controller.dispatch({ kind: 'session-pane' })
    selectRow(controller, 'session-1')
    await vi.waitFor(() => {
      expect(controller.getSessionPane().open).toBe(false)
    })
    await vi.waitFor(() => {
      expect(controller.session?.id).toBe('session-1')
      expect(controller.getTitle()).toBe('beta')
    })
    // Rename the live session: the top-bar title follows.
    controller.dispatch({ kind: 'session-pane' })
    controller.dispatch({ kind: 'rename-session', title: '重命名后' })
    await vi.waitFor(() => {
      expect(controller.getTitle()).toBe('重命名后')
    })
    const live = controller.session
    if (live === undefined) throw new Error('expected a live session')
    live.append('user/message', {
      id: 'topbar-not-transcript' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    expect(controller.getTitle()).toBe('重命名后')
    await ctx.fiber.dispose()
  })

  it('keeps a first-prompt fallback title out of the top bar (getTitle)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    expect(controller.getTitle()).toBe('')
    const live = controller.session
    if (live === undefined) throw new Error('expected a live session')
    live.append('user/message', {
      id: 'first-prompt-echo' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    await vi.waitFor(() => {
      expect(foldSessionTitle(live.events)?.source).toEqual({ kind: 'fallback' })
    })
    expect(foldSessionTitle(live.events)?.title).toBe('你好')
    expect(controller.getTitle()).toBe('')
    await ctx.fiber.dispose()
  })

  it('closes panes when selecting the already-live row and guards missing selections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => { expect(controller.getSessionPane().rows.length).toBeGreaterThan(0) })
    const liveId = controller.session?.id
    if (liveId === undefined) throw new Error('expected live session')
    controller.dispatch({ kind: 'session-pane' })
    controller.dispatch({ kind: 'search-pane' })
    controller.dispatch({ kind: 'select-session', id: liveId })
    await vi.waitFor(() => {
      expect(controller.getSessionPane().open).toBe(false)
      expect(controller.getSearchPane().open).toBe(false)
    })

    const internals = controller as unknown as { sessionList: unknown[]; selectedIndex: number }
    internals.sessionList = []
    internals.selectedIndex = 0
    controller.dispatch({ kind: 'rename-session', title: 'ignored' })
    controller.dispatch({ kind: 'delete-session' })
    await Promise.resolve()
    await ctx.fiber.dispose()
  })

  it('keeps rename inert when the title service disappears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    await vi.waitFor(() => { expect(controller.getSessionPane().rows.length).toBeGreaterThan(0) })
    const get = ctx.get.bind(ctx) as (name: string) => unknown
    ctx.get = ((name: string) => {
      return name === 'sessionTitle' ? undefined : get(name)
    }) as never
    controller.dispatch({ kind: 'rename-session', title: 'ignored' })
    await Promise.resolve()
    ctx.get = get as never
    await ctx.fiber.dispose()
  })
})
