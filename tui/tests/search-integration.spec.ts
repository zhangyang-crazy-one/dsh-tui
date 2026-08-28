/**
 * Search integration: the controller drives the sqlite-backed session-query
 * service — persisted sessions are indexed from their durable logs, Ctrl+K
 * search filters candidates, and Enter resumes the highlighted session
 * through the same switch path as the session directory.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  Session,
  SessionEvent,
  UserMessage,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import {
  createAssistantMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const TITLE_CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 80,
} as const

const KEYWORDS = ['apple', 'banana', 'orange'] as const

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** One completed turn whose user prompt carries a distinct keyword. */
function round(turn: number, keyword: string, base: number): SessionEvent[] {
  const seq = (turn - 1) * 4
  return [
    { type: 'turn/start', seq, time: base, data: { turn } },
    {
      type: 'user/message',
      seq: seq + 1,
      time: base + 1,
      data: createUserMessage({
        content: [{ type: 'text', text: `please buy ${keyword}` }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    },
    {
      type: 'assistant/message',
      seq: seq + 2,
      time: base + 2,
      data: {
        turn,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: `ok, ${keyword} ordered` }],
          source: { provider: 'test-provider', model: 'test-model' },
        }),
      },
      surfaceOp: 'append',
    },
    {
      type: 'turn/end',
      seq: seq + 3,
      time: base + 3,
      data: { turn, reason: { kind: 'completed' } },
    },
  ]
}

/** Persist one session per keyword through a throwaway context. */
async function preCreateSessions(root: string): Promise<void> {
  const writer = new Context()
  await writer.plugin(SessionStore)
  await writer.plugin(JsonlSessionPersistence, { root })
  for (const [index, keyword] of KEYWORDS.entries()) {
    const session = writer.sessions.create(SessionId(`session-${index}`), {
      seed: round(1, keyword, index * 100),
    })
    await writer.sessions.flush(session)
  }
  const internal = writer.sessions.create(SessionId('session-internal'), {
    seed: [{
      type: 'user/message',
      seq: 0,
      time: 1_000,
      data: createUserMessage({
        content: [{
          type: 'text',
          text: 'banana 内部上下文哨兵_%_ from hidden plugin context',
        }],
        source: { kind: 'plugin', plugin: 'search-integration-test' },
      }),
      surfaceOp: 'append',
    }],
  })
  await writer.sessions.flush(internal)
  const unicode = writer.sessions.create(SessionId('session-unicode'), {
    seed: [
      { type: 'turn/start', seq: 0, time: 2_000, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        time: 2_001,
        data: createUserMessage({
          content: [{ type: 'text', text: '中文用户_%_字面内容' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'assistant/message',
        seq: 2,
        time: 2_002,
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [
              { type: 'reasoning', text: '推理哨兵_%_' },
              { type: 'text', text: '中文助手_%_字面内容' },
            ],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        },
        surfaceOp: 'append',
      },
      {
        type: 'turn/end',
        seq: 3,
        time: 2_003,
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ],
  })
  await writer.sessions.flush(unicode)
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
  resumeCalls: ReturnType<typeof vi.fn>
  controller: RuntimeController
}

/** One scripted search hit, folded by the controller through persistence. */
function hit(id: string, snippet: string): {
  header: { id: string }
  bestMatch: { snippet: string }
} {
  return {
    header: { id },
    bestMatch: { snippet },
  }
}

/** Mount the services, the search engine, and a scripted factory. */
async function bench(
  root: string,
  options: {
    /** Replace the sqlite engine with a scripted one (query → items). */
    scriptedEngine?: (
      input: {
        query: string
        matchMode?: string
        eventFilters?: readonly [{ kind: string; values: readonly string[] }]
      },
    ) => Promise<{ items: ReturnType<typeof hit>[] }>
  } = {},
): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(JsonlSessionPersistence, { root })
  if (options.scriptedEngine === undefined) {
    await ctx.plugin(SessionQuerySqlite, {
      path: ':memory:',
      openAt: 'first-search',
    })
  } else {
    const engine: {
      searchSessions(input: {
        query: string
        matchMode?: string
        eventFilters?: readonly [{ kind: string; values: readonly string[] }]
        limit: number
      }): Promise<{
        items: Array<ReturnType<typeof hit>>
      }>
    } = {
      searchSessions: async input => options.scriptedEngine!(input),
    }
    ctx.provide('sessionQuery', engine as never)
  }
  await ctx.plugin(SessionTitleService, TITLE_CONFIG)
  const resumeCalls = vi.fn()
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
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
  return { ctx, resumeCalls, controller }
}

describe('session search', () => {
  it('indexes persisted logs and resumes the matched session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, resumeCalls, controller } = await bench(root)
    await controller.start()

    // One keyword matches exactly one persisted session.
    controller.dispatch({ kind: 'search-pane' })
    controller.dispatch({ kind: 'search', query: 'banana' })
    await vi.waitFor(() => {
      expect(controller.getSearchPane().results).toHaveLength(1)
    })
    const results = controller.getSearchPane().results
    expect(results[0]?.id).toBe('session-1')
    expect(results[0]?.title.length).toBeGreaterThan(0)
    expect(results[0]?.snippet).toContain('banana')
    controller.dispatch({ kind: 'session-pane-move', delta: 1 })
    expect(controller.getSearchPane().selectedIndex).toBe(0)

    // Enter on the highlighted candidate resumes it.
    controller.dispatch({ kind: 'select-session', id: results[0]!.id })
    await vi.waitFor(() => {
      expect(resumeCalls).toHaveBeenCalledWith('session-1')
    })
    await vi.waitFor(() => {
      expect(controller.getSearchPane().open).toBe(false)
    })
    expect(controller.session?.id).toBe('session-1')
    await ctx.fiber.dispose()
  })

  it('waits 120ms after the final edit and issues only the final query', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-debounce-'))
    roots.push(root)
    const inputs: string[] = []
    const { ctx, controller } = await bench(root, {
      scriptedEngine: async ({ query }) => {
        inputs.push(query)
        return { items: [] }
      },
    })
    try {
      await controller.start()
      controller.dispatch({ kind: 'search-pane' })
      controller.dispatch({ kind: 'search', query: '回' })
      await vi.advanceTimersByTimeAsync(60)
      controller.dispatch({ kind: 'search', query: '回复' })
      await vi.advanceTimersByTimeAsync(119)
      expect(inputs).toEqual([])
      expect(controller.getSearchPane().status).toBe('searching')
      await vi.advanceTimersByTimeAsync(1)
      expect(inputs).toEqual(['回复'])
      controller.dispatch({ kind: 'session-pane-move', delta: 1 })
      expect(controller.getSearchPane().selectedIndex).toBe(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('uses literal substring mode for Chinese search terms', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-chinese-'))
    roots.push(root)
    const inputs: Array<{
      query: string
      matchMode?: string
      eventFilters?: readonly [{ kind: string; values: readonly string[] }]
    }> = []
    const { ctx, controller } = await bench(root, {
      scriptedEngine: async (input) => {
        inputs.push({
          query: input.query,
          ...(input.matchMode === undefined ? {} : { matchMode: input.matchMode }),
          ...(input.eventFilters === undefined ? {} : { eventFilters: input.eventFilters }),
        })
        return { items: [hit('session-chinese', '只回复 HARNESS_TUI_OK')] }
      },
    })
    await controller.start()
    controller.dispatch({ kind: 'search-pane' })
    controller.dispatch({ kind: 'search', query: '回复' })
    await vi.waitFor(() => {
      expect(controller.getSearchPane().results).toHaveLength(1)
    })
    expect(inputs).toEqual([{
      query: '回复',
      matchMode: 'literal-substring',
      eventFilters: [{ kind: 'transcript-role', values: ['user', 'assistant'] }],
    }])
    await ctx.fiber.dispose()
  })

  it('matches Unicode and SQL wildcard characters only in human transcript text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-visible-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    controller.dispatch({ kind: 'search-pane' })

    const searchIds = async (query: string): Promise<string[]> => {
      controller.dispatch({ kind: 'search', query })
      await vi.waitFor(() => {
        expect(controller.getSearchPane().status).toBe('idle')
      })
      return controller.getSearchPane().results.map(row => row.id)
    }

    expect(await searchIds('中文用户_%_')).toEqual(['session-unicode'])
    expect(await searchIds('中文助手_%_')).toEqual(['session-unicode'])
    expect(await searchIds('%')).toEqual(['session-unicode'])
    expect(await searchIds('_')).toEqual(['session-unicode'])
    expect(await searchIds('内部上下文哨兵_%_')).toEqual([])
    expect(await searchIds('推理哨兵_%_')).toEqual([])
    await ctx.fiber.dispose()
  })

  it('returns no candidates for an unmatched term', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-miss-'))
    roots.push(root)
    await preCreateSessions(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    controller.dispatch({ kind: 'search-pane' })
    controller.dispatch({ kind: 'search', query: 'watermelon' })
    await vi.waitFor(() => {
      expect(controller.getSearchPane().results).toEqual([])
    })
    await ctx.fiber.dispose()
  })

  it('invalidates an in-flight response as soon as a newer edit arrives', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-race-'))
    roots.push(root)
    const older = deferred<{ items: ReturnType<typeof hit>[] }>()
    const newer = deferred<{ items: ReturnType<typeof hit>[] }>()
    const inputs: string[] = []
    const { ctx, controller } = await bench(root, {
      scriptedEngine: ({ query }) => {
        inputs.push(query)
        return query === 'apple' ? older.promise : newer.promise
      },
    })
    try {
      await controller.start()
      controller.dispatch({ kind: 'search-pane' })
      controller.dispatch({ kind: 'search', query: 'apple' })
      await vi.advanceTimersByTimeAsync(120)
      expect(inputs).toEqual(['apple'])

      controller.dispatch({ kind: 'search', query: 'banana' })
      expect(controller.getSearchPane()).toMatchObject({
        query: 'banana',
        results: [],
        status: 'searching',
      })
      await vi.advanceTimersByTimeAsync(120)
      expect(inputs).toEqual(['apple', 'banana'])

      newer.resolve({ items: [hit('session-fresh', 'banana new')] })
      await vi.waitFor(() => {
        expect(controller.getSearchPane()).toMatchObject({
          results: [expect.objectContaining({ id: 'session-fresh' })],
          status: 'idle',
        })
      })
      const settled = controller.getSearchPane()
      older.resolve({ items: [] })
      await older.promise
      await Promise.resolve()
      expect(controller.getSearchPane()).toEqual(settled)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps loading, empty, and error states distinct', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-loading-'))
    roots.push(root)
    const empty = deferred<{ items: ReturnType<typeof hit>[] }>()
    const inputs: string[] = []
    const { ctx, controller } = await bench(root, {
      scriptedEngine: ({ query }) => {
        inputs.push(query)
        if (query === 'failure') return Promise.reject(new Error('search unavailable'))
        return empty.promise
      },
    })
    try {
      await controller.start()
      controller.dispatch({ kind: 'search-pane' })
      controller.dispatch({ kind: 'search', query: 'waiting' })
      expect(controller.getSearchPane().status).toBe('searching')
      await vi.advanceTimersByTimeAsync(119)
      expect(inputs).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(inputs).toEqual(['waiting'])
      empty.resolve({ items: [] })
      await empty.promise
      await Promise.resolve()
      expect(controller.getSearchPane().status).toBe('idle')
      expect(controller.getSearchPane().results).toEqual([])

      controller.dispatch({ kind: 'search', query: 'failure' })
      expect(controller.getSearchPane().status).toBe('searching')
      await vi.advanceTimersByTimeAsync(120)
      await vi.waitFor(() => {
        expect(controller.getSearchPane().status).toBe('error')
      })
      expect(controller.getSearchPane().results).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels a delayed query when the query empties or the pane closes', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-cancel-'))
    roots.push(root)
    const inputs: string[] = []
    const { ctx, controller } = await bench(root, {
      scriptedEngine: async ({ query }) => {
        inputs.push(query)
        return { items: [] }
      },
    })
    try {
      await controller.start()
      controller.dispatch({ kind: 'search-pane' })
      controller.dispatch({ kind: 'search', query: 'first' })
      controller.dispatch({ kind: 'search', query: '' })
      await vi.advanceTimersByTimeAsync(120)
      expect(inputs).toEqual([])
      expect(controller.getSearchPane()).toMatchObject({
        query: '',
        results: [],
        status: 'idle',
      })

      controller.dispatch({ kind: 'search', query: 'second' })
      controller.dispatch({ kind: 'search-pane' })
      await vi.advanceTimersByTimeAsync(120)
      expect(inputs).toEqual([])
      expect(controller.getSearchPane().open).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels a delayed query when a session switch commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-switch-'))
    roots.push(root)
    await preCreateSessions(root)
    const inputs: string[] = []
    const { ctx, controller, resumeCalls } = await bench(root, {
      scriptedEngine: async ({ query }) => {
        inputs.push(query)
        return { items: [] }
      },
    })
    await controller.start()
    controller.dispatch({ kind: 'search-pane' })
    controller.dispatch({ kind: 'search', query: 'cancelled by switch' })
    controller.dispatch({ kind: 'select-session', id: 'session-0' })
    await vi.waitFor(() => {
      expect(resumeCalls).toHaveBeenCalledWith('session-0')
      expect(controller.getSearchPane().open).toBe(false)
    })
    await new Promise<void>(resolve => setTimeout(resolve, 150))
    expect(inputs).toEqual([])
    await ctx.fiber.dispose()
  })

  it('cancels a delayed query when the controller context disposes', async () => {
    vi.useFakeTimers()
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-search-dispose-'))
    roots.push(root)
    const inputs: string[] = []
    const { ctx, controller } = await bench(root, {
      scriptedEngine: async ({ query }) => {
        inputs.push(query)
        return { items: [] }
      },
    })
    await controller.start()
    controller.dispatch({ kind: 'search-pane' })
    controller.dispatch({ kind: 'search', query: 'cancelled by disposal' })
    await ctx.fiber.dispose()
    await vi.advanceTimersByTimeAsync(120)
    expect(inputs).toEqual([])
  })
})
