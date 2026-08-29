/** Interactive loop over a scripted Agent factory: cancel, continue, exit, and zero-arg idle boot. */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { Projector } from '@deepseek-ai/dsh-tui-render'
import { apply, internals, RuntimeController } from '../src/index.ts'

const originalInternals = { ...internals }
const originalSignals: Record<string, NodeJS.SignalsListener[]> = {
  SIGINT: process.listeners('SIGINT'),
  SIGTERM: process.listeners('SIGTERM'),
  SIGHUP: process.listeners('SIGHUP'),
}

/** A TTY-shaped stdin Ink's input hooks can attach to (the real process.stdin under vitest is not a TTY). */
function fakeStdin(): NodeJS.ReadStream {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream
  ;(stream as unknown as { isTTY: boolean }).isTTY = true
  ;(stream as unknown as { setRawMode(mode: boolean): void }).setRawMode = () => {}
  ;(stream as unknown as { ref(): void }).ref = () => {}
  ;(stream as unknown as { unref(): void }).unref = () => {}
  return stream
}

afterEach(() => {
  Object.assign(internals, originalInternals)
  // The runtime keeps its signal hooks installed through the exit request
  // (no no-handler window before process exit), so each bench's hooks remain
  // after its exit; sweep them so tests stay independent. Retained hooks are
  // already inert (the exitStarted single-flight guard), but they must not
  // accumulate.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!(originalSignals[signal] ?? []).includes(listener)) {
        process.off(signal, listener)
      }
    }
  }
})

interface Script {
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

interface FactoryHooks {
  beforeCreate?(call: number): Promise<void> | void
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append(
      'assistant/message',
      {
        turn,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text }],
          source: { provider: 'test-provider', model: 'test-model' },
        }),
      },
      { surfaceOp: 'append' },
    )
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

interface BenchResult {
  code: number
  out: string
  err: string
  order: string[]
}

interface Bench {
  ctx: Context
  /** Resolves when the loop mount receives its runtime controller. */
  controller: Promise<RuntimeController>
  cancel: ReturnType<typeof vi.fn>
  createCalls: ReturnType<typeof vi.fn>
  handles: { id: string; dispose: ReturnType<typeof vi.fn> }[]
  maxConcurrentCreates(): number
  /** Resolves when the loop exits (double SIGINT on the idle path). */
  exited: Promise<BenchResult>
  /** Resolves once the scripted first turn has finished. */
  firstTurnDone: Promise<void>
  /** The mutable order log; readable before exit. */
  order: string[]
  sigint(): void
  input(chunk: string): void
}

/** Mount the real registries around a scripted Agent factory and launch. */
async function bench(
  script: Script,
  extraConfig: Record<string, string> = {},
  hooks: FactoryHooks = {},
): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  const cancel = vi.fn()
  const createCalls = vi.fn()
  const handles: { id: string; dispose: ReturnType<typeof vi.fn> }[] = []
  const controllerReady = Promise.withResolvers<RuntimeController>()
  let concurrentCreates = 0
  let maxConcurrentCreates = 0
  let releaseFirstTurn: () => void = () => {}
  const firstTurnDone = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve
  })
  let firstPromptSeen = false
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      createCalls(options.sessionId)
      concurrentCreates += 1
      maxConcurrentCreates = Math.max(maxConcurrentCreates, concurrentCreates)
      try {
        await hooks.beforeCreate?.(createCalls.mock.calls.length)
      } finally {
        concurrentCreates -= 1
      }
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      let idle = Promise.resolve()
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, {
          inserted: () => {},
          discarded: () => {},
          claimed: () => {},
        }),
        status: 'idle',
        ctx: agentCtx,
        cancel: () => {
          cancel()
        },
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
          idle = Promise.resolve().then(async () => {
            await script.afterPrompt(session, message)
            if (!firstPromptSeen) {
              firstPromptSeen = true
              releaseFirstTurn()
            }
          })
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      const dispose = vi.fn(() => Promise.resolve())
      handles.push({ id: session.id, dispose })
      return { agent, dispose }
    },
    resume: () => Promise.reject(new Error('not used')),
  })

  let out = ''
  let err = ''
  const order: string[] = []
  ctx.on('session/flush', () => {
    order.push('flush')
  })
  internals.environment = { isTTY: true, term: 'xterm-256color' }
  const stdin = fakeStdin()
  internals.stdin = stdin
  internals.stdout = {
    write: (chunk: string) => {
      out += chunk
      return true
    },
  }
  internals.stderr = {
    write: (chunk: string) => {
      err += chunk
      return true
    },
  }
  const mountLoop = internals.mountLoop
  internals.mountLoop = (controller, options) => {
    controllerReady.resolve(controller as RuntimeController)
    return mountLoop(controller, options)
  }
  const exited = new Promise<BenchResult>((resolve) => {
    ctx.provide('appExit', (code: number) => {
      order.push('exit')
      resolve({ code, out, err, order })
    })
  })
  apply(ctx, { task: 'first task', ...extraConfig })
  return {
    ctx,
    controller: controllerReady.promise,
    cancel,
    createCalls,
    handles,
    maxConcurrentCreates: () => maxConcurrentCreates,
    exited,
    firstTurnDone,
    order,
    sigint: () => {
      process.emit('SIGINT')
    },
    input: (chunk: string) => {
      ;(stdin as unknown as PassThrough).push(chunk)
    },
  }
}

describe('interactive loop', () => {
  it('admits exact bound-Session events before projection or interaction mutation', async () => {
    const test = await bench({ afterPrompt: () => {} }, { task: '' })
    const controller = await test.controller
    await vi.waitFor(() => {
      expect(controller.session).toBeDefined()
    })
    const liveSession = controller.session
    if (liveSession === undefined) throw new Error('expected a bound live session')
    const foreignSession = test.ctx.sessions.create()

    const delegate = Reflect.get(controller, 'projector') as Projector
    const push = vi.fn((event: SessionEvent) => {
      delegate.push(event)
    })
    Reflect.set(controller, 'projector', {
      push,
      seed: (events: readonly SessionEvent[]) => { delegate.seed(events) },
      snapshot: () => delegate.snapshot(),
    } satisfies Projector)
    const reduce = vi.spyOn(
      controller as unknown as { reduce(event: { kind: string }): void },
      'reduce',
    )
    const flushed: string[] = []
    test.ctx.on('session/flush', (session) => {
      flushed.push(session.id)
    })

    controller.dispatch({ kind: 'send', text: 'pending-live-input' })
    expect(controller.getModel().status).toBe('generating')
    push.mockClear()
    reduce.mockClear()
    appendTurn(foreignSession, 1, {
      id: 'foreign-user-message' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'foreign-sentinel' }],
      source: { kind: 'user' },
    }, 'foreign-reply', true)

    await new Promise<void>(resolve => setTimeout(resolve, 10))
    expect(push).not.toHaveBeenCalled()
    expect(reduce).not.toHaveBeenCalled()
    expect(flushed).toEqual([])
    expect(controller.getModel()).toMatchObject({
      status: 'generating',
      history: [],
    })

    appendTurn(liveSession, 2, {
      id: 'live-user-message' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'live-sentinel' }],
      source: { kind: 'user' },
    }, 'live-reply', true)

    await vi.waitFor(() => {
      expect(controller.getModel().status).toBe('idle')
      expect(flushed).toEqual([liveSession.id])
    })
    expect(push.mock.calls.map(([event]) => event.type)).toEqual([
      'turn/start',
      'step/start',
      'user/message',
      'assistant/message',
      'step/end',
      'turn/end',
    ])
    expect(reduce.mock.calls.map(([event]) => event.kind)).toEqual([
      'turn-started',
      'turn-ended',
    ])
    expect(controller.getModel().history.map(message => message.text)).toEqual([
      'live-sentinel',
      'live-reply',
    ])
    await test.ctx.fiber.dispose()
  })

  it('runs overlapping controller requests through one create transition', async () => {
    const createGate = Promise.withResolvers<undefined>()
    const test = await bench(
      { afterPrompt: () => {} },
      { task: '' },
      {
        beforeCreate: async (call) => {
          if (call > 1) await createGate.promise
        },
      },
    )
    await vi.waitFor(() => {
      expect(test.createCalls).toHaveBeenCalledTimes(1)
    })
    const controller = await test.controller
    await vi.waitFor(() => {
      expect(controller.getSessionTransitionStatus()).toBeUndefined()
    })

    controller.dispatch({ kind: 'new-session' })
    controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(test.createCalls).toHaveBeenCalledTimes(2)
    })
    expect(test.maxConcurrentCreates()).toBe(1)

    createGate.resolve(undefined)
    await vi.waitFor(() => {
      expect(test.handles[0]?.dispose).toHaveBeenCalledTimes(1)
    })
    expect(test.createCalls).toHaveBeenCalledTimes(2)
    test.sigint()
    test.sigint()
    await test.exited
    await test.ctx.fiber.dispose()
  })

  it('boots the loop idle with an empty task: no prompt, stays alive, flush on exit', async () => {
    const test = await bench(
      {
        afterPrompt: (session, message) => {
          appendTurn(session, 1, message, 'should not run', true)
        },
      },
      { task: '' },
    )
    // The empty task sends no first message: give the boot a moment, then
    // confirm nothing ran and the loop is still alive (no auto-exit).
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(test.cancel).not.toHaveBeenCalled()
    test.sigint()
    test.sigint()
    const result = await test.exited
    expect(result.code).toBe(0)
    // The loop's captured stdout carries no raw banner: the full-screen
    // header is the only identity row, and a bare line between Ink frames
    // would leave a stale duplicate header.
    expect(result.out).not.toContain('deepseek-tui — starting')
    expect(result.out).not.toContain('should not run')
    expect(result.order[result.order.length - 1]).toBe('exit')
    expect(result.order).toContain('flush')
    await test.ctx.fiber.dispose()
  })

  it('completes the initial task, flushes, and stays alive without exiting', async () => {
    const test = await bench({
      afterPrompt: (session, message) => {
        appendTurn(session, 1, message, 'answer one', true)
      },
    })
    await test.firstTurnDone
    expect(test.cancel).not.toHaveBeenCalled()
    // The loop must still be alive: no exit entry yet (flush fires on exit).
    // Close the loop for a clean teardown.
    test.sigint()
    test.sigint()
    await test.exited
    await test.ctx.fiber.dispose()
  })

  it('routes SIGINT to agent.cancel during generation and exits on the idle confirm path', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const test = await bench({
      async afterPrompt(session, message) {
        await gate
        appendTurn(session, 1, message, 'partial', false)
      },
    })
    // Wait until the prompt reached the agent (generation is gated), then stop it.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    test.sigint()
    expect(test.cancel).toHaveBeenCalledTimes(1)
    releaseGate()
    await test.firstTurnDone
    // Idle now: first SIGINT arms, second exits (flush before exit).
    test.sigint()
    test.sigint()
    const result = await test.exited
    expect(result.code).toBe(0)
    expect(result.order[result.order.length - 1]).toBe('exit')
    expect(result.order).toContain('flush')
    await test.ctx.fiber.dispose()
  })

  it('writes no raw startup banner beside the Ink frames (single app header)', async () => {
    const test = await bench({
      afterPrompt: (session, message) => {
        appendTurn(session, 1, message, 'done', true)
      },
    })
    await test.firstTurnDone
    test.sigint()
    test.sigint()
    const result = await test.exited
    // The startup banner writer was removed: a direct stdout write between
    // the Ink mount and controller.start left a stale duplicate header in
    // the real-PTY capture, so this pins that ordering is write-free.
    expect(result.out).not.toContain('deepseek-tui — starting')
    await test.ctx.fiber.dispose()
  })

  it('writes the frame-stats JSON on orderly exit without polluting stdout (--frame-stats)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-frame-stats-'))
    const target = join(dir, 'frames.json')
    try {
      const test = await bench(
        {
          afterPrompt: (session, message) => {
            appendTurn(session, 1, message, 'answer one', true)
          },
        },
        { frameStats: target },
      )
      await test.firstTurnDone
      test.sigint()
      test.sigint()
      const result = await test.exited
      expect(result.code).toBe(0)
      const payload = JSON.parse(readFileSync(target, 'utf8')) as {
        renderMs: { count: number; mean: number; max: number; p95: number }
        brandRenderMs: { count: number; mean: number; max: number; p95: number }
        pacing: { commits: number; elapsedMs: number }
        brandRevealTimers: number
        environment: { platform: string; node: string; arch: string }
        path: string
      }
      // count=1 is invalid: the probe records every subtree commit, not just
      // the initial mount (the pre-Profiler channel recorded one sample).
      expect(payload.renderMs.count).toBeGreaterThanOrEqual(2)
      expect(payload.renderMs).toHaveProperty('mean')
      expect(payload.renderMs).toHaveProperty('max')
      expect(payload.renderMs).toHaveProperty('p95')
      expect(payload.brandRenderMs.count).toBeGreaterThanOrEqual(1)
      expect(payload.brandRenderMs).toHaveProperty('mean')
      expect(payload.brandRenderMs).toHaveProperty('max')
      expect(payload.brandRenderMs).toHaveProperty('p95')
      expect(payload.pacing.commits).toBeGreaterThanOrEqual(2)
      expect(payload.pacing.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(payload.brandRevealTimers).toBe(0)
      expect(payload.environment.platform).toBe(process.platform)
      expect(payload.environment.node).toBe(process.version)
      expect(payload.environment.arch).toBe(process.arch)
      expect(payload.path).toBe(target)
      // The stats payload goes to the file only: stdout carries no stats.
      expect(result.out).not.toContain('renderMs')
      expect(result.out).not.toContain('pacing')
      await test.ctx.fiber.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loud at startup when --frame-stats targets an unwritable path', async () => {
    const ctx = new Context()
    let err = ''
    internals.environment = { isTTY: true, term: 'xterm-256color' }
    internals.stderr = {
      write: (chunk: string) => {
        err += chunk
        return true
      },
    }
    const code = await new Promise<number>((resolve) => {
      ctx.provide('appExit', (exitCode: number) => {
        resolve(exitCode)
      })
      apply(ctx, {
        task: 'x',
        frameStats: '/definitely/not/a/real/dir/frames.json',
      })
    })
    expect(code).toBe(1)
    expect(err).toContain('--frame-stats')
    await ctx.fiber.dispose()
  })

  it('fails loud at startup when --frame-stats targets an existing directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-frame-stats-dir-'))
    try {
      const ctx = new Context()
      let err = ''
      internals.environment = { isTTY: true, term: 'xterm-256color' }
      internals.stderr = {
        write: (chunk: string) => {
          err += chunk
          return true
        },
      }
      const code = await new Promise<number>((resolve) => {
        ctx.provide('appExit', (exitCode: number) => {
          resolve(exitCode)
        })
        // An existing directory can never receive the exit JSON.
        apply(ctx, { task: 'x', frameStats: dir })
      })
      expect(code).toBe(1)
      expect(err).toContain('--frame-stats target is a directory')
      await ctx.fiber.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails loud at startup when --frame-stats targets an existing unwritable file',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-frame-stats-file-'))
      const target = join(dir, 'frames.json')
      writeFileSync(target, '{}', 'utf8')
      chmodSync(target, 0o444)
      try {
        const ctx = new Context()
        let err = ''
        internals.environment = { isTTY: true, term: 'xterm-256color' }
        internals.stderr = {
          write: (chunk: string) => {
            err += chunk
            return true
          },
        }
        const code = await new Promise<number>((resolve) => {
          ctx.provide('appExit', (exitCode: number) => {
            resolve(exitCode)
          })
          apply(ctx, { task: 'x', frameStats: target })
        })
        expect(code).toBe(1)
        expect(err).toContain('--frame-stats target is not writable')
        // The startup probe never opens for writing: the file is intact.
        expect(readFileSync(target, 'utf8')).toBe('{}')
        await ctx.fiber.dispose()
      } finally {
        chmodSync(target, 0o644)
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
