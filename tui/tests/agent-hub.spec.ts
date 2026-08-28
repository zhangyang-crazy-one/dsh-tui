/**
 * RuntimeController Agent Hub: missing-service chrome, empty list, inspect
 * failure, and K2′ refusal while approval is open.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import {
  SessionPersistenceRevision,
  type BorrowedSessionSource,
} from '@deepseek-ai/dsh-session-persistence'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const roots: string[] = []

/** Minimal persisted lifecycle header for one cold Hub child. */
function header(id: SessionId, createdAt = 1): SessionHeader {
  return { version: 0, id, createdAt }
}

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

interface HubBench {
  ctx: Context
  controller: RuntimeController
}

/** Mount core services plus optional Hub backends. */
async function bench(options: {
  listChildren?: (id: SessionId) => Promise<SubagentListEntry[]>
  inspect?: (id: SessionId) => Promise<{ meta: unknown; events: readonly unknown[] }>
  liveChildIds?: readonly SessionId[]
  liveSnapshot?: (session: Session) => ProjectionSnapshot
  listHeaders?: (signal?: AbortSignal) => Promise<SessionHeader[]>
  borrowSession?: (id: SessionId, signal?: AbortSignal) => Promise<BorrowedSessionSource>
  cachedSnapshot?: (meta: SessionHeader, keys?: readonly string[]) => ProjectionSnapshot | undefined
  coldSnapshot?: (meta: SessionHeader, events: readonly SessionEvent[]) => ProjectionSnapshot
} = {}): Promise<HubBench> {
  const root = await mkdtemp(`${tmpdir()}/dsh-tui-agent-hub-`)
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  for (const id of options.liveChildIds ?? []) ctx.sessions.create(id)
  if (options.liveSnapshot !== undefined) {
    ctx.provide('sessionProjections', { snapshot: options.liveSnapshot } as never)
  }
  if (options.cachedSnapshot !== undefined || options.coldSnapshot !== undefined) {
    ctx.provide('sessionProjectionCache', {
      cachedSnapshot: options.cachedSnapshot ?? (() => undefined),
      coldSnapshot: options.coldSnapshot ?? (() => { throw new Error('unexpected cold fold') }),
    } as never)
  }
  if (options.listChildren !== undefined) {
    ctx.provide('subagents', { listChildren: options.listChildren } as never)
  }
  if (options.inspect !== undefined || options.listHeaders !== undefined || options.borrowSession !== undefined) {
    ctx.provide('sessionPersistence', {
      inspect: options.inspect,
      list: options.listHeaders ?? (async () => []),
      borrowSession: options.borrowSession,
    } as never)
  }
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
    resume: () => Promise.reject(new Error('not used')),
  })
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(
    ctx,
    io,
    { task: '', cwd: root },
    () => {},
  )
  return { ctx, controller }
}

describe('Agent Hub controller', () => {
  it('enriches live and cold children without widening their identity entries', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(20_000)
    const liveSnapshot = vi.fn((_session: Session): ProjectionSnapshot => ({
      asOfSeq: 8,
      values: {
        tokenUsage: {
          uncachedInputTokens: 12_000,
          outputTokens: 2_000,
          cacheReadTokens: 4_000,
          cacheWriteTokens: 200,
        },
        contextPressure: { pressureTokens: 4_200, contextWindow: 10_000 },
        subagentTiming: {
          settledMs: 2_000,
          active: { since: 5_000, through: 7_000 },
        },
      },
    }))
    const cachedSnapshot = vi.fn((_meta: SessionHeader): ProjectionSnapshot => ({
      asOfSeq: 12,
      values: {
        tokenUsage: {
          uncachedInputTokens: 3_000,
          outputTokens: 1_000,
          cacheReadTokens: 100,
          cacheWriteTokens: 0,
        },
        contextPressure: { pressureTokens: 1_800, contextWindow: 10_000 },
        subagentTiming: {
          settledMs: 6_000,
          active: { since: 5_000, through: 7_000 },
        },
      },
    }))
    const liveId = SessionId('child-live')
    const coldId = SessionId('child-cold')
    const coldHeader = header(coldId)
    const borrowSession = vi.fn()
    const { ctx, controller } = await bench({
      liveChildIds: [liveId],
      liveSnapshot,
      listHeaders: async () => [coldHeader],
      cachedSnapshot,
      borrowSession,
      listChildren: async () => [
        {
          kind: 'child', id: liveId, mode: 'continuable', label: 'live',
          activity: 'running', hasChildren: false,
        },
        {
          kind: 'child', id: coldId, mode: 'one-shot', label: 'cold',
          activity: 'inactive', hasChildren: false,
        },
      ],
    })
    try {
      await controller.start()
      controller.dispatch({ kind: 'agent-hub' })
      await vi.waitFor(() => {
        expect(controller.getAgentHubPane().rows).toEqual([
          {
            id: liveId,
            label: 'live',
            activity: 'running',
            hasChildren: false,
            contextPercent: 42,
            tokens: 18_200,
            durationMs: 17_000,
          },
          {
            id: coldId,
            label: 'cold',
            activity: 'inactive',
            hasChildren: false,
            contextPercent: 18,
            tokens: 4_100,
            durationMs: 8_000,
          },
        ])
      })
      expect(liveSnapshot).toHaveBeenCalledWith(ctx.sessions.get(liveId))
      expect(cachedSnapshot).toHaveBeenCalledExactlyOnceWith(coldHeader, [
        'tokenUsage',
        'contextPressure',
        'subagentTiming',
      ])
      expect(borrowSession).not.toHaveBeenCalled()
    } finally {
      now.mockRestore()
      await ctx.fiber.dispose()
    }
  })

  it.each(['live', 'prepared'] as const)(
    'borrows one exact %s source on a cache miss and always disposes it',
    async (source) => {
      const childId = SessionId('child-borrowed')
      const childHeader = header(childId, 2)
      const events: SessionEvent[] = []
      const dispose = vi.fn()
      const borrowed: BorrowedSessionSource = source === 'live'
        ? {
          source,
          inspection: { meta: childHeader, events },
          [Symbol.dispose]: dispose,
        }
        : {
          source,
          inspection: { meta: childHeader, events },
          revision: SessionPersistenceRevision('revision-2'),
          preparedSession: {} as Session,
          [Symbol.dispose]: dispose,
        }
      const borrowSession = vi.fn(async (): Promise<BorrowedSessionSource> => borrowed)
      const coldSnapshot = vi.fn((): ProjectionSnapshot => ({
        asOfSeq: 0,
        values: {
          tokenUsage: {
            uncachedInputTokens: 4,
            outputTokens: 3,
            cacheReadTokens: 2,
            cacheWriteTokens: 1,
          },
        },
      }))
      const { ctx, controller } = await bench({
        listHeaders: async () => [childHeader],
        cachedSnapshot: () => undefined,
        borrowSession,
        coldSnapshot,
        listChildren: async () => [{
          kind: 'child', id: childId, mode: 'one-shot',
          activity: 'inactive', hasChildren: false,
        }],
      })
      await controller.start()
      controller.dispatch({ kind: 'agent-hub' })
      await vi.waitFor(() => {
        const pane = controller.getAgentHubPane()
        expect(pane.rows?.at(0)?.tokens).toBe(10)
      })
      expect(borrowSession).toHaveBeenCalledOnce()
      expect(coldSnapshot).toHaveBeenCalledExactlyOnceWith(childHeader, events)
      expect(dispose).toHaveBeenCalledOnce()
      await ctx.fiber.dispose()
    },
  )

  it('keeps identity rows when cold metrics are missing or fail', async () => {
    const childId = SessionId('child-unknown')
    const childHeader = header(childId)
    const dispose = vi.fn()
    const coldSnapshot = vi.fn(() => {
      throw new Error('cold log vanished')
    })
    const { ctx, controller } = await bench({
      listHeaders: async () => [childHeader],
      cachedSnapshot: () => undefined,
      borrowSession: async () => ({
        source: 'live',
        inspection: { meta: childHeader, events: [] },
        [Symbol.dispose]: dispose,
      }),
      coldSnapshot,
      listChildren: async () => [{
        kind: 'child', id: childId, mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      }],
    })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => {
      expect(controller.getAgentHubPane().rows).toEqual([{
        id: childId,
        label: childId,
        activity: 'inactive',
        hasChildren: false,
      }])
    })
    expect(controller.getAgentHubPane().error).toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('drops cold metrics that settle after the Hub closes', async () => {
    const childId = SessionId('child-late-cold')
    const childHeader = header(childId)
    const dispose = vi.fn()
    const gate = Promise.withResolvers<BorrowedSessionSource>()
    const started = Promise.withResolvers<undefined>()
    const coldSnapshot = vi.fn((): ProjectionSnapshot => ({ asOfSeq: 0, values: {} }))
    const { ctx, controller } = await bench({
      listHeaders: async () => [childHeader],
      cachedSnapshot: () => undefined,
      borrowSession: () => {
        started.resolve(undefined)
        return gate.promise
      },
      coldSnapshot,
      listChildren: async () => [{
        kind: 'child', id: childId, mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      }],
    })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await started.promise
    controller.dispatch({ kind: 'agent-hub' })
    gate.resolve({
      source: 'live',
      inspection: { meta: childHeader, events: [] },
      [Symbol.dispose]: dispose,
    })
    await vi.waitFor(() => { expect(dispose).toHaveBeenCalledOnce() })
    expect(controller.getAgentHubPane().open).toBe(false)
    expect(coldSnapshot).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('opens Hub without subagents and paints 未组合 (S19)', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    expect(controller.getAgentHubPane()).toMatchObject({
      open: true,
      missing: true,
    })
    await ctx.fiber.dispose()
  })

  it('lists an empty table when subagents returns no children', async () => {
    const { ctx, controller } = await bench({
      listChildren: async () => [],
    })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => {
      expect(controller.getAgentHubPane()).toMatchObject({
        open: true,
        missing: false,
        rows: [],
        view: 'table',
      })
    })
    controller.dispatch({ kind: 'agent-hub-move', delta: 1 })
    controller.dispatch({ kind: 'agent-hub-enter' })
    controller.dispatch({ kind: 'agent-hub-escape' })
    expect(controller.getAgentHubPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('inspects a running child and paints 无法读取子会话 on inspect failure', async () => {
    const { ctx, controller } = await bench({
      listChildren: async () => [
        {
          kind: 'child',
          id: SessionId('child-1'),
          mode: 'continuable',
          label: 'explorer',
          activity: 'running',
          hasChildren: false,
        },
      ],
      inspect: async () => {
        throw new Error('gone')
      },
    })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => {
      expect(controller.getAgentHubPane().rows).toEqual([
        {
          id: 'child-1',
          label: 'explorer',
          activity: 'running',
          hasChildren: false,
        },
      ])
    })
    controller.dispatch({ kind: 'agent-hub-enter' })
    await vi.waitFor(() => {
      expect(controller.getAgentHubPane()).toMatchObject({
        open: true,
        view: 'transcript',
        error: '无法读取子会话：gone',
      })
    })
    controller.dispatch({ kind: 'agent-hub-escape' })
    expect(controller.getAgentHubPane().view).toBe('table')
    expect(controller.getAgentHubPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('refuses to open Hub while approval is queued (K2′)', async () => {
    const { ctx, controller } = await bench({
      listChildren: async () => [],
    })
    await controller.start()
    const original = controller.getApprovalPane.bind(controller)
    controller.getApprovalPane = () => ({ ...original(), open: true })
    controller.dispatch({ kind: 'agent-hub' })
    expect(controller.getAgentHubPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('renders a successful child transcript with only human-visible text', async () => {
    const events: SessionEvent[] = [
      {
        type: 'user/message', seq: 0, time: 0,
        data: createUserMessage({ content: [{ type: 'text', text: '' }], source: { kind: 'user' } }),
      },
      {
        type: 'user/message', seq: 1, time: 1,
        data: createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
      },
      {
        type: 'user/message', seq: 2, time: 2,
        data: createUserMessage({ content: [{ type: 'text', text: 'hidden' }], source: { kind: 'plugin', plugin: 'x', form: 'instructions' } }),
      },
      {
        type: 'assistant/message', seq: 3, time: 3,
        data: {
          turn: 1, step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'world' }, { type: 'reasoning', text: 'secret' }],
            source: { provider: 'test', model: 'test' },
          }),
        },
      },
      {
        type: 'assistant/message', seq: 4, time: 4,
        data: {
          turn: 1, step: 2,
          message: createAssistantMessage({
            content: [{ type: 'text', text: '' }],
            source: { provider: 'test', model: 'test' },
          }),
        },
      },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const { ctx, controller } = await bench({
      listChildren: async () => [{
        kind: 'child', id: SessionId('child-transcript'), mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      }],
      inspect: async id => ({ meta: { id }, events }),
    })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(controller.getAgentHubPane().rows).toHaveLength(1) })
    controller.dispatch({ kind: 'agent-hub-enter' })
    await vi.waitFor(() => {
      expect(controller.getAgentHubPane().transcript).toBe('> hello\n● world')
    })
    await ctx.fiber.dispose()
  })

  it('expands nested children and filters non-child diagnostics', async () => {
    const listChildren = vi.fn(async (id: SessionId) => id === SessionId('child-parent')
      ? [
        { kind: 'diagnostic', message: 'nested ignored' } as never,
        { kind: 'child', id: SessionId('child-leaf'), mode: 'one-shot', label: 'leaf', activity: 'inactive', hasChildren: false } as const,
      ]
      : [
        { kind: 'diagnostic', message: 'ignored' } as never,
        { kind: 'child', id: SessionId('child-parent'), mode: 'continuable', label: 'parent', activity: 'running', hasChildren: true } as const,
      ])
    const { ctx, controller } = await bench({ listChildren })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(controller.getAgentHubPane().rows?.[0]?.id).toBe('child-parent') })
    controller.dispatch({ kind: 'agent-hub-enter' })
    await vi.waitFor(() => { expect(controller.getAgentHubPane().rows?.[0]?.id).toBe('child-leaf') })
    expect(listChildren).toHaveBeenCalledWith(
      SessionId('child-parent'),
      expect.any(AbortSignal),
    )
    await ctx.fiber.dispose()
  })

  it('reports list failure and missing persistence for inspect', async () => {
    const failed = await bench({ listChildren: async () => { throw new Error('list gone') } })
    await failed.controller.start()
    failed.controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(failed.controller.getAgentHubPane().error).toContain('list gone') })
    await failed.ctx.fiber.dispose()

    const missing = await bench({
      listChildren: async () => [{
        kind: 'child', id: SessionId('child-no-store'), mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      }],
    })
    await missing.controller.start()
    missing.controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(missing.controller.getAgentHubPane().rows).toHaveLength(1) })
    missing.controller.dispatch({ kind: 'agent-hub-enter' })
    await vi.waitFor(() => { expect(missing.controller.getAgentHubPane().error).toContain('持久化未组合') })
    await missing.ctx.fiber.dispose()
  })

  it('reports nested expansion failure', async () => {
    const listChildren = vi.fn(async (id: SessionId) => {
      if (id === SessionId('child-expand-fail')) throw new Error('nested gone')
      return [{
        kind: 'child', id: SessionId('child-expand-fail'), mode: 'continuable',
        label: 'parent', activity: 'running', hasChildren: true,
      } as const]
    })
    const { ctx, controller } = await bench({ listChildren })
    await controller.start()
    controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(controller.getAgentHubPane().rows).toHaveLength(1) })
    controller.dispatch({ kind: 'agent-hub-enter' })
    await vi.waitFor(() => { expect(controller.getAgentHubPane().error).toContain('nested gone') })
    await ctx.fiber.dispose()
  })

  it('moves a non-empty Hub selection and tolerates a missing service during expand', async () => {
    const fixture = await bench({
      listChildren: async () => [
        { kind: 'child', id: SessionId('child-a'), mode: 'one-shot', label: 'a', activity: 'inactive', hasChildren: false },
        { kind: 'child', id: SessionId('child-b'), mode: 'one-shot', label: 'b', activity: 'inactive', hasChildren: false },
      ],
    })
    await fixture.controller.start()
    fixture.controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(fixture.controller.getAgentHubPane().rows).toHaveLength(2) })
    fixture.controller.dispatch({ kind: 'agent-hub-move', delta: 1 })
    expect(fixture.controller.getAgentHubPane().selectedIndex).toBe(1)

    const internals = fixture.controller as unknown as {
      agentHubRows: Array<{ id: SessionId; label: string; activity: string; hasChildren: boolean }>
      agentHubSelectedIndex: number
    }
    internals.agentHubRows = [{ id: SessionId('missing-service'), label: 'x', activity: 'running', hasChildren: true }]
    internals.agentHubSelectedIndex = 0
    // Dispose the provided service through its Cordis effect by replacing the global lookup for this call.
    const get = fixture.ctx.get.bind(fixture.ctx) as (name: string) => unknown
    fixture.ctx.get = ((name: string) => {
      return name === 'subagents' ? undefined : get(name)
    }) as never
    fixture.controller.dispatch({ kind: 'agent-hub-enter' })
    await Promise.resolve()
    fixture.ctx.get = get as never
    expect(fixture.controller.getAgentHubPane().open).toBe(true)
    await fixture.ctx.fiber.dispose()
  })

  it.each(['resolve', 'reject'] as const)('drops a stale nested expansion that will %s', async (mode) => {
    const gate = Promise.withResolvers<SubagentListEntry[]>()
    const started = Promise.withResolvers<undefined>()
    const listChildren = vi.fn(async (id: SessionId) => {
      if (id === SessionId('parent-stale')) {
        started.resolve(undefined)
        return gate.promise
      }
      return [{
        kind: 'child', id: SessionId('parent-stale'), mode: 'continuable', label: 'parent', activity: 'running', hasChildren: true,
      } as const]
    })
    const fixture = await bench({ listChildren })
    await fixture.controller.start()
    fixture.controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(fixture.controller.getAgentHubPane().rows).toHaveLength(1) })
    fixture.controller.dispatch({ kind: 'agent-hub-enter' })
    await started.promise
    fixture.controller.dispatch({ kind: 'agent-hub' })
    if (mode === 'resolve') gate.resolve([])
    else gate.reject(new Error('late nested failure'))
    await Promise.resolve()
    expect(fixture.controller.getAgentHubPane().open).toBe(false)
    await fixture.ctx.fiber.dispose()
  })

  it('keeps closed or empty advanced actions inert', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    for (const action of [
      { kind: 'plan-review-scroll', delta: 1 },
      { kind: 'model-move', delta: 1 },
      { kind: 'help-scroll', delta: 1 },
      { kind: 'approval-detail' },
      { kind: 'ask-user-digit', index: 0 },
      { kind: 'ask-user-move', delta: 1 },
      { kind: 'ask-user-submit' },
      { kind: 'ask-user-cancel' },
      { kind: 'plan-review-approve' },
      { kind: 'plan-review-keep' },
      { kind: 'permission-escape' },
      { kind: 'permission-move', delta: 1 },
      { kind: 'permission-jump', index: 0 },
      { kind: 'permission-apply' },
      { kind: 'settings-escape' },
      { kind: 'settings-move', delta: 1 },
      { kind: 'settings-edit' },
      { kind: 'settings-cancel-edit' },
      { kind: 'agent-hub-escape' },
      { kind: 'agent-hub-move', delta: 1 },
      { kind: 'agent-hub-enter' },
      { kind: 'workspace-escape' },
      { kind: 'workspace-move', delta: 1 },
      { kind: 'workspace-enter' },
      { kind: 'workspace-edit' },
      { kind: 'workspace-apply', value: '/x' },
      { kind: 'workspace-cancel-edit' },
      { kind: 'feedback-escape' },
      { kind: 'feedback-rate', rating: 'positive' },
      { kind: 'feedback-note-edit' },
      { kind: 'feedback-note-apply', value: 'x' },
      { kind: 'feedback-note-cancel' },
      { kind: 'workflow-overlay-escape' },
      { kind: 'workflow-overlay-scroll', delta: 1 },
      { kind: 'plan-directory-escape' },
      { kind: 'plan-directory-move', delta: 1 },
      { kind: 'plan-directory-apply' },
      { kind: 'timeline-scroll', delta: 1 },
      { kind: 'session-pane-move', delta: 1 },
    ] as const) controller.dispatch(action)
    controller.dispatch({ kind: 'toggle-reasoning' })
    expect(controller.getModel().reasoningExpanded).toBe(true)
    controller.dispatch({ kind: 'toggle-timeline' })
    expect(controller.getTimelineOpen()).toBe(true)
    controller.dispatch({ kind: 'toggle-timeline' })
    expect(controller.getTimelineOpen()).toBe(false)
    await ctx.fiber.dispose()
  })

  it('replays actions parked before the first agent binds', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'toggle-reasoning' })
    await controller.start()
    expect(controller.getModel().reasoningExpanded).toBe(true)
    await ctx.fiber.dispose()
  })

  it.each(['resolve', 'reject'] as const)('drops a stale root Hub list that will %s', async (mode) => {
    const gate = Promise.withResolvers<SubagentListEntry[]>()
    const started = Promise.withResolvers<undefined>()
    const fixture = await bench({
      listChildren: () => {
        started.resolve(undefined)
        return gate.promise
      },
    })
    await fixture.controller.start()
    fixture.controller.dispatch({ kind: 'agent-hub' })
    await started.promise
    fixture.controller.dispatch({ kind: 'agent-hub' })
    if (mode === 'resolve') gate.resolve([])
    else gate.reject(new Error('late list failure'))
    await Promise.resolve()
    expect(fixture.controller.getAgentHubPane().open).toBe(false)
    await fixture.ctx.fiber.dispose()
  })

  it.each(['resolve', 'reject'] as const)('drops a stale inspect that will %s after Esc returns to table', async (mode) => {
    const gate = Promise.withResolvers<{ meta: unknown; events: readonly unknown[] }>()
    const started = Promise.withResolvers<undefined>()
    const fixture = await bench({
      listChildren: async () => [{
        kind: 'child', id: SessionId('child-stale-inspect'), mode: 'one-shot',
        activity: 'inactive', hasChildren: false,
      }],
      inspect: () => {
        started.resolve(undefined)
        return gate.promise
      },
    })
    await fixture.controller.start()
    fixture.controller.dispatch({ kind: 'agent-hub' })
    await vi.waitFor(() => { expect(fixture.controller.getAgentHubPane().rows).toHaveLength(1) })
    fixture.controller.dispatch({ kind: 'agent-hub-enter' })
    await started.promise
    fixture.controller.dispatch({ kind: 'agent-hub-escape' })
    if (mode === 'resolve') gate.resolve({ meta: {}, events: [] })
    else gate.reject(new Error('late inspect failure'))
    await Promise.resolve()
    const pane = fixture.controller.getAgentHubPane()
    expect(pane).toMatchObject({ open: true, view: 'table' })
    expect(pane.error).toBeUndefined()
    expect(pane.transcript).toBeUndefined()
    await fixture.ctx.fiber.dispose()
  })
})
