/**
 * --resume integration: a fresh controller rebuilds a persisted session
 * through agents.resume, replays its durable log into the projection, and
 * lands every completed turn in storage through the periodic flush. A resume
 * of a missing id fails loud — error on stderr and exit code 1.
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
import SessionStore, { type Session, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  UserMessage,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  createAssistantMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** One completed turn with a user prompt and a settled assistant reply. */
function round(
  turn: number,
  userText: string,
  assistantText: string,
  base: number,
): SessionEvent[] {
  const seq = (turn - 1) * 4
  return [
    { type: 'turn/start', seq, time: base, data: { turn } },
    {
      type: 'user/message',
      seq: seq + 1,
      time: base + 1,
      data: createUserMessage({
        content: [{ type: 'text', text: userText }],
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
          content: [{ type: 'text', text: assistantText }],
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

/** Append one distinguishable completed turn to a live Session. */
function appendSentinelTurn(
  session: Session,
  turn: number,
  userText: string,
  assistantText: string,
): void {
  session.append('turn/start', { turn })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'assistant/message',
    {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: assistantText }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** Persist two completed turns through a throwaway context. */
async function preCreateSession(root: string): Promise<void> {
  const writer = new Context()
  await writer.plugin(SessionStore)
  await writer.plugin(JsonlSessionPersistence, { root })
  const seeded = writer.sessions.create(SessionId('session-1'), {
    seed: [
      ...round(1, '第一轮问题', '第一轮回答', 100),
      ...round(2, '第二轮问题', '第二轮回答', 200),
    ],
  })
  await writer.sessions.flush(seeded)
  await writer.fiber.dispose()
}

/**
 * Scripted agent whose followup resolves immediately, appends nothing, and
 * records each message's plain text for no-task-resume assertions.
 */
function scriptedAgent(
  ownerCtx: Context,
  session: Session,
  followupTexts: string[],
): Agent {
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
    followup: (message: UserMessage) => {
      followupTexts.push(
        message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join(''),
      )
    },
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
  /** Accumulated stderr writes (fail-loud assertions). */
  errors: { text: string }
  /** Last requested exit code, or undefined before exit is requested. */
  exit: { code: number | undefined }
  /** Plain text of every followup the resumed agent received (no-task resume must stay empty). */
  followupTexts: string[]
}

interface TransitionHandle extends AgentHandle {
  /** The recorded disposer is also a real async disposer so TransitionHandle stays an AgentHandle. */
  dispose: ReturnType<typeof vi.fn> & (() => Promise<void>)
  followupTexts: string[]
}

type CreateOverride = (
  ownerCtx: Context,
  options: CreateAgentOptions,
) => Promise<TransitionHandle>

type ResumeOverride = (
  ownerCtx: Context,
  options: ResumeAgentOptions,
) => Promise<TransitionHandle>

interface TransitionBench {
  ctx: Context
  controller: RuntimeController
  createCalls: ReturnType<typeof vi.fn>
  resumeCalls: ReturnType<typeof vi.fn>
  handles: TransitionHandle[]
  makeHandle(
    ownerCtx: Context,
    id: ReturnType<typeof SessionId>,
    setup: CreateAgentOptions['setup'],
    disposeError?: Error,
  ): Promise<TransitionHandle>
  setCreateOverride(override: CreateOverride): void
  setResumeOverride(override: ResumeOverride): void
  setFlushError(error: Error | undefined): void
  setFlushGate(gate: Promise<void> | undefined): void
}

/** Minimal live controller bench with programmable transition boundaries. */
async function transitionBench(): Promise<TransitionBench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  const createCalls = vi.fn()
  const resumeCalls = vi.fn()
  const handles: TransitionHandle[] = []
  let createOverride: CreateOverride | undefined
  let resumeOverride: ResumeOverride | undefined
  let flushError: Error | undefined
  let flushGate: Promise<void> | undefined

  const makeHandle = async (
    ownerCtx: Context,
    id: ReturnType<typeof SessionId>,
    setup: CreateAgentOptions['setup'],
    disposeError?: Error,
  ): Promise<TransitionHandle> => {
    const session = ctx.sessions.create(id)
    const followupTexts: string[] = []
    const agent = scriptedAgent(ownerCtx, session, followupTexts)
    await setup?.(agent.ctx)
    const dispose = vi.fn(async () => {
      if (disposeError !== undefined) throw disposeError
    })
    const handle: TransitionHandle = { agent, dispose, followupTexts }
    handles.push(handle)
    return handle
  }

  ctx.agents.setFactory({
    async createAgent(ownerCtx, options) {
      createCalls(options.sessionId)
      if (createOverride !== undefined) {
        return createOverride(ownerCtx, options)
      }
      return makeHandle(ownerCtx, options.sessionId, options.setup)
    },
    async resume(ownerCtx, options) {
      resumeCalls(options.resumeSessionId)
      if (resumeOverride !== undefined) {
        return resumeOverride(ownerCtx, options)
      }
      return makeHandle(ownerCtx, options.resumeSessionId, options.setup)
    },
  })
  ctx.on('session/flush', async () => {
    if (flushGate !== undefined) await flushGate
    if (flushError !== undefined) throw flushError
  })
  const controller = new RuntimeController(
    ctx,
    {
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: () => {},
    },
    { task: '' },
    () => {},
  )
  await controller.start()
  return {
    ctx,
    controller,
    createCalls,
    resumeCalls,
    handles,
    makeHandle,
    setCreateOverride: (override) => {
      createOverride = override
    },
    setResumeOverride: (override) => {
      resumeOverride = override
    },
    setFlushError: (error) => {
      flushError = error
    },
    setFlushGate: (gate) => {
      flushGate = gate
    },
  }
}

/** Mount the services and a scripted factory over the given root. */
async function bench(root: string, resume: string): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(JsonlSessionPersistence, { root })
  const resumeCalls = vi.fn()
  const followupTexts: string[] = []
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session, followupTexts)
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    // Rebuild the persisted session through the seed mechanism, then bind an
    // agent to it — the same chain the real agent-loop factory uses.
    async resume(
      ownerCtx: Context,
      options: ResumeAgentOptions,
    ): Promise<AgentHandle> {
      resumeCalls(options.resumeSessionId)
      const loaded = await ctx.sessionPersistence.load(options.resumeSessionId)
      const session = ctx.sessions.create(options.resumeSessionId, {
        seed: loaded.events.map(event => structuredClone(event)),
      })
      const agent = scriptedAgent(ownerCtx, session, followupTexts)
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
  })
  const out: { text: string } = { text: '' }
  const errors: { text: string } = { text: '' }
  const exit: { code: number | undefined } = { code: undefined }
  const io: TuiIo = {
    stdout: {
      write: (chunk: string) => {
        out.text += chunk
        return true
      },
    },
    stderr: {
      write: (chunk: string) => {
        errors.text += chunk
        return true
      },
    },
    exit: (code: number) => {
      exit.code = code
    },
  }
  const controller = new RuntimeController(
    ctx,
    io,
    { task: '', resume },
    () => {},
  )
  return { ctx, resumeCalls, controller, errors, exit, followupTexts }
}

describe('session resume', () => {
  it('keeps the old handle usable when the pre-transition flush fails', async () => {
    const test = await transitionBench()
    const oldId = test.controller.session?.id
    const oldHandle = test.handles[0]
    test.setFlushError(new Error('flush unavailable'))

    test.controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe(
        '✗ 新建会话失败（当前会话保持可用）',
      )
    })
    expect(test.createCalls).toHaveBeenCalledTimes(1)
    expect(test.controller.session?.id).toBe(oldId)
    test.controller.dispatch({ kind: 'send', text: '保留输入' })
    expect(oldHandle?.followupTexts).toEqual(['保留输入'])
    await test.ctx.fiber.dispose()
  })

  it('keeps the old handle when candidate creation fails', async () => {
    const test = await transitionBench()
    const oldId = test.controller.session?.id
    test.setCreateOverride(async () => {
      throw new Error('create unavailable')
    })

    test.controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe(
        '✗ 新建会话失败（当前会话保持可用）',
      )
    })
    expect(test.createCalls).toHaveBeenCalledTimes(2)
    expect(test.controller.session?.id).toBe(oldId)
    expect(test.handles[0]?.dispose).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('keeps the old handle when candidate resume fails', async () => {
    const test = await transitionBench()
    const oldId = test.controller.session?.id
    test.setResumeOverride(async () => {
      throw new Error('resume unavailable')
    })

    test.controller.dispatch({ kind: 'select-session', id: 'target-resume' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe(
        '✗ 切换失败：resume unavailable（当前会话保持可用）',
      )
    })
    expect(test.resumeCalls).toHaveBeenCalledTimes(1)
    expect(test.controller.session?.id).toBe(oldId)
    expect(test.handles[0]?.dispose).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('shows switch progress while a resume candidate is pending', async () => {
    const test = await transitionBench()
    const gate = Promise.withResolvers<TransitionHandle>()
    test.setResumeOverride(() => gate.promise)
    test.controller.dispatch({ kind: 'select-session', id: 'target-pending' })
    await vi.waitFor(() => {
      expect(test.controller.getSessionTransitionStatus()).toBe('正在切换会话…')
    })
    gate.resolve(await test.makeHandle(
      test.ctx,
      SessionId('target-pending'),
      undefined,
    ))
    await vi.waitFor(() => {
      expect(test.controller.getSessionTransitionStatus()).toBeUndefined()
    })
    await test.ctx.fiber.dispose()
  })

  it('disposes a replay-failing candidate once without replacing the primary error', async () => {
    const test = await transitionBench()
    const oldId = test.controller.session?.id
    let candidate: TransitionHandle | undefined
    test.setResumeOverride(async (ownerCtx, options) => {
      candidate = await test.makeHandle(
        ownerCtx,
        options.resumeSessionId,
        options.setup,
        new Error('candidate cleanup failed'),
      )
      Object.defineProperty(candidate.agent.session, 'events', {
        configurable: true,
        get: () => {
          throw new Error('candidate replay failed')
        },
      })
      return candidate
    })

    test.controller.dispatch({ kind: 'select-session', id: 'target-replay' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe(
        '✗ 切换失败：candidate replay failed（当前会话保持可用）',
      )
    })
    expect(candidate?.dispose).toHaveBeenCalledTimes(1)
    expect(test.controller.session?.id).toBe(oldId)
    expect(test.handles[0]?.dispose).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('publishes the candidate before disposing the old handle', async () => {
    const test = await transitionBench()
    const candidateReady = Promise.withResolvers<undefined>()
    const releaseCandidate = Promise.withResolvers<undefined>()
    const oldHandle = test.handles[0]
    let candidate: TransitionHandle | undefined
    let sessionSeenAtOldDispose: string | undefined
    oldHandle?.dispose.mockImplementation(() => {
      sessionSeenAtOldDispose = test.controller.session?.id
    })
    test.setCreateOverride(async (ownerCtx, options) => {
      candidate = await test.makeHandle(
        ownerCtx,
        options.sessionId,
        options.setup,
      )
      candidate.agent.session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text: 'candidate-before-commit' }],
          source: { kind: 'user' },
        }),
        { surfaceOp: 'append' },
      )
      candidateReady.resolve(undefined)
      await releaseCandidate.promise
      return candidate
    })

    test.controller.dispatch({ kind: 'new-session' })
    await candidateReady.promise
    expect(test.controller.getFeedback()).toBe('正在新建会话…')
    expect(test.controller.getModel().history.map(row => row.text)).not.toContain(
      'candidate-before-commit',
    )
    test.controller.dispatch({ kind: 'new-session' })
    expect(test.createCalls).toHaveBeenCalledTimes(2)

    releaseCandidate.resolve(undefined)
    await vi.waitFor(() => {
      expect(test.controller.session?.id).toBe(candidate?.agent.session.id)
      expect(oldHandle?.dispose).toHaveBeenCalledTimes(1)
    })
    expect(sessionSeenAtOldDispose).toBe(candidate?.agent.session.id)
    expect(candidate?.dispose).not.toHaveBeenCalled()
    expect(test.controller.getModel().history.map(row => row.text)).toContain(
      'candidate-before-commit',
    )
    await test.ctx.fiber.dispose()
  })

  it('contains post-commit disposal and old-command cancellation failures', async () => {
    const test = await transitionBench()
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    test.handles[0]?.dispose.mockRejectedValueOnce(new Error('old dispose failed'))
    const controller = test.controller as unknown as {
      commandAbort: { abort(): void }
    }
    controller.commandAbort = {
      abort: () => { throw new Error('old command abort failed') },
    }

    test.controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe('✓ 已新建会话')
    })
    const warnings = warn.mock.calls.flat().join('\n')
    expect(warnings).toContain('previous command cancellation failed: old command abort failed')
    expect(warnings).toContain('old session disposal after create failed: old dispose failed')
    await test.ctx.fiber.dispose()
  })

  it('surfaces ✗ feedback and keeps the loop alive when sessionPersistence.list rejects', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, {
      provider: 'test-provider',
      model: 'test-model',
    })
    ctx.agents.setFactory({
      async createAgent(ownerCtx, options) {
        const session = ctx.sessions.create(options.sessionId)
        const agent = {} as Agent
        Object.assign(agent, {
          id: session.id,
          options: {},
          session,
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
    const listMock = vi.fn(() => Promise.reject(new Error('disk gone')))
    ctx.provide('sessionPersistence', {
      list: listMock,
      load: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
    } as never)
    const controller = new RuntimeController(
      ctx,
      {
        stdout: { write: () => true },
        stderr: { write: () => true },
        exit: () => {},
      },
      { task: '' },
      () => {},
    )
    await controller.start()
    // The startup refreshList sees list() reject and surfaces ✗ through its
    // own catch; the loop is alive because refreshList resolves (no throw).
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 会话列表刷新失败：disk gone')
    })
    expect(listMock).toHaveBeenCalled()
    // A subsequent new-session dispatches performSessionTransition; the
    // post-commit refreshList sees the same rejection and surfaces ✗ again
    // instead of letting the success row mask the persistence failure.
    controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 会话列表刷新失败：disk gone')
    })
    // The controller still binds a session — the transition completed and the
    // refreshList rejection did not break the runtime loop.
    expect(controller.session).toBeDefined()
    // A direct refreshList call resolves cleanly, never throws.
    await expect(
      (controller as unknown as { refreshList(): Promise<void> }).refreshList.call(controller),
    ).resolves.toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('consumes events only from the currently bound main session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-session-isolation-'))
    roots.push(root)
    await preCreateSession(root)
    const { ctx, controller } = await bench(root, 'session-1')
    await controller.start()

    const oldSession = ctx.sessions.create(SessionId('session-old'))
    const concurrentSession = ctx.sessions.create(SessionId('session-concurrent'))
    const subagentSession = ctx.sessions.create(SessionId('session-subagent'), {
      meta: { origin: 'subagent' },
    })
    const flushed: string[] = []
    ctx.on('session/flush', (session) => {
      flushed.push(session.id)
    })

    controller.dispatch({ kind: 'send', text: 'pending-live-input' })
    expect(controller.getModel().status).toBe('generating')
    appendSentinelTurn(oldSession, 1, 'old-sentinel', 'old-reply')
    appendSentinelTurn(
      concurrentSession,
      1,
      'concurrent-sentinel',
      'concurrent-reply',
    )
    appendSentinelTurn(
      subagentSession,
      1,
      'subagent-sentinel',
      'subagent-reply',
    )

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    expect(controller.getModel().status).toBe('generating')
    expect(flushed).toEqual([])

    const liveSession = controller.session
    expect(liveSession?.id).toBe('session-1')
    if (liveSession === undefined) throw new Error('expected bound live session')
    appendSentinelTurn(liveSession, 3, 'live-sentinel', 'live-reply')

    await vi.waitFor(() => {
      expect(controller.getModel().status).toBe('idle')
      expect(flushed).toEqual(['session-1'])
    })
    const transcript = controller.getModel().history.map(message => message.text)
    expect(transcript).toContain('live-sentinel')
    expect(transcript).toContain('live-reply')
    expect(transcript).not.toContain('old-sentinel')
    expect(transcript).not.toContain('concurrent-sentinel')
    expect(transcript).not.toContain('subagent-sentinel')
    await ctx.fiber.dispose()
  })

  it('rebuilds the persisted session, replays its log, and flushes each turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-resume-'))
    roots.push(root)
    await preCreateSession(root)
    const { ctx, resumeCalls, controller, followupTexts } = await bench(
      root,
      'session-1',
    )
    await controller.start()
    // The durable log replays into the projection: both rounds are visible.
    await vi.waitFor(() => {
      expect(controller.getModel().history.map(message => ({
        kind: message.kind,
        text: message.text,
        timestamp: message.timestamp,
      }))).toEqual([
        { kind: 'user', text: '第一轮问题', timestamp: 101 },
        { kind: 'assistant', text: '第一轮回答', timestamp: 103 },
        { kind: 'user', text: '第二轮问题', timestamp: 201 },
        { kind: 'assistant', text: '第二轮回答', timestamp: 203 },
      ])
    })
    expect(resumeCalls).toHaveBeenCalledWith('session-1')
    // No-task --resume loads history idle: nothing is sent after the replay.
    expect(followupTexts).toEqual([])

    // Periodic flush: a third completed turn on the live session lands in
    // storage through the turn/end flush, not only at exit.
    const live = controller.session
    expect(live?.id).toBe('session-1')
    live?.append('turn/start', { turn: 3 })
    live?.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: '第三轮问题' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    live?.append(
      'assistant/message',
      {
        turn: 3,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: '第三轮回答' }],
          source: { provider: 'test-provider', model: 'test-model' },
        }),
      },
      { surfaceOp: 'append' },
    )
    live?.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    await vi.waitFor(() => {
      expect(controller.getModel().history).toHaveLength(6)
    })
    await vi.waitFor(async () => {
      const reader = new Context()
      await reader.plugin(SessionStore)
      await reader.plugin(JsonlSessionPersistence, { root })
      const loaded = await reader.sessionPersistence.load(SessionId('session-1'))
      await reader.fiber.dispose()
      expect(loaded.events.filter(event => event.type === 'user/message')).toHaveLength(3)
    })
    await ctx.fiber.dispose()
  })

  it('fails loud when the resumed session does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-resume-missing-'))
    roots.push(root)
    const { ctx, resumeCalls, controller, errors, exit, followupTexts } =
      await bench(root, 'session-missing')
    await controller.start()
    expect(resumeCalls).toHaveBeenCalledWith('session-missing')
    // fail-loud: the error goes to stderr and the process exit is requested with 1.
    expect(errors.text).toContain('cannot resume session "session-missing"')
    expect(exit.code).toBe(1)
    expect(followupTexts).toEqual([])
    expect(controller.getModel().history).toEqual([])
    await ctx.fiber.dispose()
  })
})
