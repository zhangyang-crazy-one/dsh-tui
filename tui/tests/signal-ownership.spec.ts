/**
 * TUI process-signal ownership and durable exit: the runtime installs its
 * signal hooks first and releases the launcher's generic SIGINT/SIGTERM
 * handlers in the same synchronous block (no ownership gap), and its
 * single-flight exit finishes the session flush and the frame-stats JSON
 * while the loop is still mounted, before the terminal restore and the exit
 * request. The bench registers a launcher-shaped generic handler pair before
 * the tree mounts, exactly as a profile boot does, so the claim is observed
 * against the real ownership race.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, internals, RuntimeController } from '../src/index.ts'

const originalInternals = { ...internals }

interface ListenerSnapshot {
  signals: Record<'SIGINT' | 'SIGTERM' | 'SIGHUP', NodeJS.SignalsListener[]>
  exit: NodeJS.ExitListener[]
  uncaughtException: NodeJS.UncaughtExceptionListener[]
}

const originalListeners: ListenerSnapshot = {
  signals: {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
    SIGHUP: process.listeners('SIGHUP'),
  },
  exit: process.listeners('exit'),
  uncaughtException: process.listeners('uncaughtException'),
}

const TRACKED_EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** Remove every listener a test registered, leaving pre-existing ones untouched. */
function restoreListeners(): void {
  for (const signal of TRACKED_EVENTS) {
    for (const listener of process.listeners(signal)) {
      if (!(originalListeners.signals[signal] ?? []).includes(listener)) {
        process.off(signal, listener)
      }
    }
  }
  for (const listener of process.listeners('exit')) {
    if (!originalListeners.exit.includes(listener)) process.off('exit', listener)
  }
  for (const listener of process.listeners('uncaughtException')) {
    if (!originalListeners.uncaughtException.includes(listener)) {
      process.off('uncaughtException', listener)
    }
  }
}

afterEach(async () => {
  Object.assign(internals, originalInternals)
  // The runtime releases the launcher handlers and disposes its own hooks on
  // exit; this sweep removes anything a failed test left behind without
  // touching pre-existing listeners.
  restoreListeners()
})

interface Script {
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
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
  order: string[]
}

interface Bench {
  ctx: Context
  /** The launcher-shaped generic handlers the TUI must release on claim. */
  genericSigint: ReturnType<typeof vi.fn>
  genericSigterm: ReturnType<typeof vi.fn>
  /** The claiming release spy; the runtime calls it once, right after its hooks are installed. */
  releaseSignals: ReturnType<typeof vi.fn>
  /** The synchronous launcher handback returned by releaseSignals. */
  handback: ReturnType<typeof vi.fn>
  /** Whether handback observed the TUI SIGINT hook before it returned ownership. */
  handbackSawTui(): boolean
  /** Agent-handle teardown owned by the root TUI effect. */
  handleDispose: ReturnType<typeof vi.fn>
  /** Settle a deferred handle teardown (a no-op unless requested by the bench). */
  releaseHandleDispose(): void
  /** Terminal restoration returned by the mounted loop. */
  unmount: ReturnType<typeof vi.fn>
  /** Resolves once the scripted first turn has finished (loop mounted and claimed). */
  firstTurnDone: Promise<void>
  /** Resolves when the loop exits (double SIGINT on the idle path). */
  exited: Promise<BenchResult>
  /** The mutable order log; readable before exit. */
  order: string[]
  /** Process SIGINT listener count before the tree mounted. */
  listenerBaseline: number
  /** Process SIGTERM listener count before the tree mounted. */
  sigtermBaseline: number
  /** Exact process listeners before the launcher-shaped pair was installed. */
  listenerSnapshot: ListenerSnapshot
  /** Start the run (mounts the loop and claims the signals). */
  claim(): void
  /** Mounted controller captured before signal ownership is claimed. */
  controller(): RuntimeController
  sigint(): void
  sigterm(): void
}

interface BenchOptions {
  deferHandleDispose?: boolean
  signalDuringClaim?: boolean
}

/** Mount the real registries around a scripted Agent factory, then claim on demand. */
async function bench(
  extraConfig: Record<string, string> = {},
  options: BenchOptions = {},
): Promise<Bench> {
  const listenerSnapshot: ListenerSnapshot = {
    signals: {
      SIGINT: process.listeners('SIGINT'),
      SIGTERM: process.listeners('SIGTERM'),
      SIGHUP: process.listeners('SIGHUP'),
    },
    exit: process.listeners('exit'),
    uncaughtException: process.listeners('uncaughtException'),
  }
  const listenerBaseline = process.listeners('SIGINT').length
  const sigtermBaseline = process.listeners('SIGTERM').length
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  // The launcher's generic pair, registered before the tree mounts.
  const genericSigint = vi.fn()
  const genericSigterm = vi.fn()
  process.on('SIGINT', genericSigint)
  process.on('SIGTERM', genericSigterm)
  const order: string[] = []
  let genericOwned = true
  let observedTuiAtHandback = false
  const handback = vi.fn(() => {
    if (genericOwned) return
    observedTuiAtHandback = process.listeners('SIGINT').some(listener =>
      !listenerSnapshot.signals.SIGINT.includes(listener)
      && listener !== genericSigint,
    )
    process.on('SIGINT', genericSigint)
    process.on('SIGTERM', genericSigterm)
    genericOwned = true
    order.push('handback')
  })
  const releaseSignals = vi.fn(() => {
    if (!genericOwned) return handback
    process.off('SIGINT', genericSigint)
    process.off('SIGTERM', genericSigterm)
    genericOwned = false
    order.push('claim')
    if (options.signalDuringClaim === true) {
      queueMicrotask(() => { process.emit('SIGTERM') })
    }
    return handback
  })
  let releaseHandleDispose: () => void = () => {}
  const handleDisposeGate = options.deferHandleDispose === true
    ? new Promise<void>((resolve) => { releaseHandleDispose = resolve })
    : Promise.resolve()
  const handleDispose = vi.fn(() => handleDisposeGate)
  const unmount = vi.fn(() => { order.push('terminal-exit') })
  let mountedController: RuntimeController | undefined
  internals.mountLoop = (next) => {
    mountedController = next as RuntimeController
    return unmount
  }
  const writeFrameStats = internals.writeFrameStatsFile
  internals.writeFrameStatsFile = async (path, probe, io) => {
    order.push('stats')
    await writeFrameStats(path, probe, io)
  }
  const script: Script = {
    afterPrompt: (session, message) => {
      appendTurn(session, 1, message, 'answer one', true)
    },
  }
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
        cancel: () => {},
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
      return { agent, dispose: handleDispose }
    },
    resume: () => Promise.reject(new Error('not used')),
  })

  ctx.on('session/flush', () => {
    order.push('flush')
  })
  internals.environment = { isTTY: true, term: 'xterm-256color' }
  internals.stdout = { write: () => true }
  internals.stderr = { write: () => true }
  const exited = new Promise<BenchResult>((resolve) => {
    ctx.provide('appExit', (code: number) => {
      order.push('exit')
      resolve({ code, order })
    })
  })
  ctx.provide('releaseSignals', releaseSignals)
  return {
    ctx,
    genericSigint,
    genericSigterm,
    releaseSignals,
    handback,
    handbackSawTui: () => observedTuiAtHandback,
    handleDispose,
    releaseHandleDispose,
    unmount,
    firstTurnDone,
    exited,
    order,
    listenerBaseline,
    sigtermBaseline,
    listenerSnapshot,
    claim: () => {
      apply(ctx, { task: 'first task', ...extraConfig })
    },
    controller: () => {
      if (mountedController === undefined) throw new Error('expected mounted controller')
      return mountedController
    },
    sigint: () => {
      process.emit('SIGINT')
    },
    sigterm: () => {
      process.emit('SIGTERM')
    },
  }
}

describe('signal ownership', () => {
  it('handles a process exit claimed before the first session binds', async () => {
    const test = await bench({}, { signalDuringClaim: true })
    try {
      test.claim()
      const result = await test.exited
      expect(result.code).toBe(0)
      test.controller().dispatchExit()
    } finally {
      await test.ctx.fiber.dispose()
    }
  })

  it('hands ownership back before removing TUI hooks and awaits handle cleanup on ordinary unload', async () => {
    const test = await bench({}, { deferHandleDispose: true })
    try {
      test.claim()
      await test.firstTurnDone
      expect(test.releaseSignals).toHaveBeenCalledOnce()
      expect(test.handback).not.toHaveBeenCalled()

      let disposed = false
      const disposal = test.ctx.fiber.dispose().then(() => { disposed = true })
      await vi.waitFor(() => {
        expect(test.handleDispose).toHaveBeenCalledOnce()
      })
      expect(disposed).toBe(false)
      expect(test.handback).toHaveBeenCalledOnce()
      expect(test.handbackSawTui()).toBe(true)
      expect(test.unmount).toHaveBeenCalledOnce()

      test.releaseHandleDispose()
      await disposal
      expect(disposed).toBe(true)
      expect(process.listeners('SIGINT')).toEqual([
        ...test.listenerSnapshot.signals.SIGINT,
        test.genericSigint,
      ])
      expect(process.listeners('SIGTERM')).toEqual([
        ...test.listenerSnapshot.signals.SIGTERM,
        test.genericSigterm,
      ])
      expect(process.listeners('SIGHUP')).toEqual(test.listenerSnapshot.signals.SIGHUP)
      expect(process.listeners('exit')).toEqual(test.listenerSnapshot.exit)
      expect(process.listeners('uncaughtException')).toEqual(test.listenerSnapshot.uncaughtException)
      process.emit('SIGINT')
      process.emit('SIGTERM')
      expect(test.genericSigint).toHaveBeenCalledOnce()
      expect(test.genericSigterm).toHaveBeenCalledOnce()
    } finally {
      test.releaseHandleDispose()
    }
  })

  it('claims exclusive ownership: the launcher handler sees pre-claim signals, only the TUI hooks see them after', async () => {
    const test = await bench()
    try {
      // Pre-claim, nothing is mounted yet: the launcher's generic SIGINT owns the signal.
      process.emit('SIGINT')
      expect(test.genericSigint).toHaveBeenCalledOnce()
      expect(test.releaseSignals).not.toHaveBeenCalled()
      test.claim()
      await test.firstTurnDone
      // The claim: hooks installed first, then the launcher handlers released
      // once — no ownership gap where a signal lands on both owners.
      expect(test.releaseSignals).toHaveBeenCalledOnce()
      process.emit('SIGINT')
      process.emit('SIGTERM')
      expect(test.genericSigint).toHaveBeenCalledOnce()
      expect(test.genericSigterm).not.toHaveBeenCalled()
      // Close the loop for a clean teardown (exit already in flight from the SIGTERM).
      test.sigint()
      test.sigint()
      const result = await test.exited
      expect(result.code).toBe(0)
      expect(result.order[result.order.length - 1]).toBe('exit')
    } finally {
      await test.ctx.fiber.dispose()
    }
  })

  it('finishes flush and frame-stats while the loop stays mounted; exit is single-flight', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-ownership-'))
    const target = join(dir, 'frames.json')
    try {
      const test = await bench({ frameStats: target })
      test.claim()
      await test.firstTurnDone
      // Gate the exit flush so the drain can be observed mid-flight. The
      // periodic flush from the completed first turn has already dispatched.
      let openFlush!: () => void
      const flushGate = new Promise<void>((resolve) => {
        openFlush = resolve
      })
      test.ctx.on('session/flush', () => flushGate)
      const flushAtExitStart = test.order.filter(entry => entry === 'flush').length
      test.sigint()
      test.sigint()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      // The exit is in flight, gated on the flush: no exit request yet, no
      // frame-stats write, the loop still mounted with its hooks installed
      // (teardown happens only after the durable writes settle).
      expect(test.order).not.toContain('exit')
      expect(test.order.filter(entry => entry === 'flush').length).toBe(flushAtExitStart + 1)
      expect(existsSync(target)).toBe(false)
      expect(process.listeners('SIGINT').length).toBe(test.listenerBaseline + 1)
      // Late signals during the drain are single-flight: they reach the
      // still-installed hooks but duplicate nothing.
      const flushBeforeLate = test.order.filter(entry => entry === 'flush').length
      test.sigint()
      test.sigterm()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      expect(test.order.filter(entry => entry === 'flush').length).toBe(flushBeforeLate)
      expect(test.order).not.toContain('exit')
      // The flush settles, the JSON lands, the loop unmounts, then exit.
      openFlush()
      const result = await test.exited
      expect(result.code).toBe(0)
      expect(result.order.filter(entry => entry === 'flush').length).toBe(flushAtExitStart + 1)
      expect(result.order[result.order.length - 1]).toBe('exit')
      const payload = JSON.parse(readFileSync(target, 'utf8')) as {
        renderMs: { count: number }
      }
      expect(payload.renderMs.count).toBeGreaterThanOrEqual(0)
      // The exit request has been made and the loop unmounted, but the TUI
      // signal hooks stay installed until the process exits, so a late
      // signal during final disposal cannot fall to the default handler.
      // (The afterEach sweep removes them for the next test.)
      expect(process.listeners('SIGINT').length).toBe(test.listenerBaseline + 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the signal hooks installed through the exit request: no no-handler window before process exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-post-exit-'))
    const target = join(dir, 'frames.json')
    const test = await bench({ frameStats: target })
    try {
      test.claim()
      await test.firstTurnDone
      const flushAtExitStart = test.order.filter(entry => entry === 'flush').length
      test.sigint()
      test.sigint()
      const result = await test.exited
      expect(result.code).toBe(0)
      expect(test.order.filter(entry => entry === 'flush').length - flushAtExitStart).toBe(1)
      expect(test.order.filter(entry => entry === 'stats')).toHaveLength(1)
      expect(test.order.filter(entry => entry === 'terminal-exit')).toHaveLength(1)
      expect(test.order.filter(entry => entry === 'exit')).toHaveLength(1)
      // io.exit(0) has been requested and the loop unmounted, but the hooks
      // remain installed until the process actually exits: a late signal in
      // the final-disposal window reaches the hooks (a single-flight no-op)
      // instead of the default handler.
      expect(process.listeners('SIGINT').length).toBe(test.listenerBaseline + 1)
      expect(process.listeners('SIGTERM').length).toBe(test.sigtermBaseline + 1)
      // A late signal is a single-flight no-op: it reaches the hooks but
      // duplicates no flush or exit work.
      const counts = {
        flush: result.order.filter(entry => entry === 'flush').length,
        stats: result.order.filter(entry => entry === 'stats').length,
        terminalExit: result.order.filter(entry => entry === 'terminal-exit').length,
        exit: result.order.filter(entry => entry === 'exit').length,
      }
      test.sigint()
      test.sigterm()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10)
      })
      expect(test.order.filter(entry => entry === 'flush')).toHaveLength(counts.flush)
      expect(test.order.filter(entry => entry === 'stats')).toHaveLength(counts.stats)
      expect(test.order.filter(entry => entry === 'terminal-exit')).toHaveLength(counts.terminalExit)
      expect(test.order.filter(entry => entry === 'exit')).toHaveLength(counts.exit)
    } finally {
      await test.ctx.fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('logs a failing exit flush and still writes frame stats and exits (durable exit)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-ownership-'))
    const target = join(dir, 'frames.json')
    try {
      const test = await bench({ frameStats: target })
      test.claim()
      await test.firstTurnDone
      // The exit flush fails; a durable exit must not truncate on it.
      test.ctx.on('session/flush', () =>
        Promise.reject(new Error('flush exploded')),
      )
      test.sigint()
      test.sigint()
      const result = await test.exited
      expect(result.code).toBe(0)
      expect(result.order[result.order.length - 1]).toBe('exit')
      expect(existsSync(target)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports an unexpected exit drain failure through the root exit effect', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-exit-failure-'))
    const target = join(dir, 'frames.json')
    try {
      const test = await bench({ frameStats: target })
      test.claim()
      await test.firstTurnDone
      internals.writeFrameStatsFile = async () => { throw new Error('exit stats failed') }
      test.sigint()
      test.sigint()
      const result = await test.exited
      expect(result.code).toBe(1)
      await test.ctx.fiber.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
