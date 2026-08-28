/**
 * `/reload` through the mounted runtime: flush, unmount, dispose the live
 * session, spawn a replacement Node with `--resume`, then request exit with
 * the child's code. Tests inject a fake spawn and never start Node.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { apply, internals, RuntimeController } from '../src/index.ts'

const originalInternals = { ...internals }
type EditorOptions = Parameters<typeof internals.editDraftExternally>[2]
const originalSignals: Record<string, NodeJS.SignalsListener[]> = {
  SIGINT: process.listeners('SIGINT'),
  SIGTERM: process.listeners('SIGTERM'),
  SIGHUP: process.listeners('SIGHUP'),
}

afterEach(() => {
  Object.assign(internals, originalInternals)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!(originalSignals[signal] ?? []).includes(listener)) {
        process.off(signal, listener)
      }
    }
  }
})

interface Bench {
  ctx: Context
  controller: RuntimeController
  exited: Promise<{ code: number; order: string[]; spawnArgs: string[][] }>
  handleDispose: ReturnType<typeof vi.fn>
  mountLoop: ReturnType<typeof vi.fn>
  rawMode: ReturnType<typeof vi.fn>
}

async function bench(options: {
  task?: string
  cwd?: string
  frameStats?: string
  inner?: readonly string[]
  processArgv?: readonly string[]
  spawnClose?: { code: number | null; signal: NodeJS.Signals | null }
  spawnError?: Error
}): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  const order: string[] = []
  const spawnArgs: string[][] = []
  ctx.on('session/flush', () => {
    order.push('flush')
  })
  const handleDispose = vi.fn(() => {
    order.push('dispose')
    return Promise.resolve()
  })
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      create: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(create.sessionId, {
        ...(create.meta === undefined ? {} : { meta: create.meta }),
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: create.agentOptions ?? {},
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
      await create.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: handleDispose }
    },
    resume: () => Promise.reject(new Error('not used')),
  })

  internals.environment = { isTTY: true, term: 'xterm-256color' }
  internals.stdout = { write: () => true }
  internals.stderr = { write: () => true }
  const rawMode = vi.fn()
  internals.stdin = { setRawMode: rawMode } as never
  internals.processArgv = options.processArgv ?? [
    'node',
    '/dsh.js',
    '--profile',
    'deepseek-tui',
    'hello',
  ]
  internals.spawn = ((
    _command: string,
    args: readonly string[],
  ) => {
    spawnArgs.push([...args])
    order.push('spawn')
    const child = new EventEmitter()
    queueMicrotask(() => {
      if (options.spawnError !== undefined) {
        child.emit('error', options.spawnError)
        return
      }
      const close = options.spawnClose ?? { code: 0, signal: null }
      child.emit('close', close.code, close.signal)
    })
    return child
  })

  let controller: RuntimeController | undefined
  const mountLoop = vi.fn((next) => {
    controller = next as RuntimeController
    return () => {
      order.push('unmount')
    }
  })
  internals.mountLoop = mountLoop

  if (options.inner !== undefined) {
    ctx.provide('cmdlineArgs', { get: () => options.inner ?? [] })
  }

  const exited = new Promise<{
    code: number
    order: string[]
    spawnArgs: string[][]
  }>((resolve) => {
    ctx.provide('appExit', (code: number) => {
      order.push('exit')
      resolve({ code, order: [...order], spawnArgs: spawnArgs.map(row => [...row]) })
    })
  })

  apply(ctx, {
    task: options.task ?? '',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.frameStats === undefined ? {} : { frameStats: options.frameStats }),
  })
  await vi.waitFor(() => {
    expect(controller?.session).toBeDefined()
  })
  const mounted = controller
  if (mounted === undefined) {
    throw new Error('expected a mounted TUI controller')
  }
  return { ctx, controller: mounted, exited, handleDispose, mountLoop, rawMode }
}

describe('/reload process replacement', () => {
  it('flushes, unmounts, disposes, then respawns with --resume and without the task', async () => {
    const test = await bench({
      inner: ['hello'],
      spawnClose: { code: 3, signal: null },
    })
    const sessionId = test.controller.session?.id
    expect(sessionId).toBeDefined()

    test.controller.dispatch({ kind: 'command', query: 'reload' })
    const result = await test.exited
    expect(result.code).toBe(3)
    expect(result.order).toEqual(['flush', 'unmount', 'dispose', 'spawn', 'exit'])
    expect(test.handleDispose).toHaveBeenCalledOnce()
    const argv = result.spawnArgs[0]
    expect(argv).toBeDefined()
    expect(argv).toContain('/dsh.js')
    expect(argv).toContain('--profile')
    expect(argv).toContain('deepseek-tui')
    expect(argv).toContain('--resume')
    expect(argv).toContain(sessionId)
    expect(argv).not.toContain('hello')
    await test.ctx.fiber.dispose()
  })

  it('forwards --cwd and --frame-stats from the live config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-reload-'))
    const frames = join(dir, 'frames.json')
    try {
      const test = await bench({
        inner: ['--cwd', '/tmp/work', '--frame-stats', frames, 'hello'],
        cwd: '/tmp/work',
        frameStats: frames,
        processArgv: [
          'node',
          '/dsh.js',
          '--profile',
          'deepseek-tui',
          '--cwd',
          '/tmp/work',
          '--frame-stats',
          frames,
          'hello',
        ],
      })
      test.controller.dispatch({ kind: 'command', query: 'reload' })
      const result = await test.exited
      expect(result.spawnArgs[0]).toEqual(expect.arrayContaining([
        '--cwd',
        '/tmp/work',
        '--frame-stats',
        frames,
        '--resume',
      ]))
      expect(result.spawnArgs[0]).not.toContain('hello')
      await test.ctx.fiber.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps launcher flags when the original invocation had no inner args', async () => {
    const test = await bench({
      inner: [],
      processArgv: ['node', '/dsh.js', '--profile', 'deepseek-tui'],
    })
    test.controller.dispatch({ kind: 'command', query: 'reload' })
    const result = await test.exited
    expect(result.spawnArgs[0]).toEqual(expect.arrayContaining([
      '/dsh.js',
      '--profile',
      'deepseek-tui',
      '--resume',
    ]))
    await test.ctx.fiber.dispose()
  })

  it('treats a missing cmdlineArgs service as an empty inner list', async () => {
    const test = await bench({
      processArgv: ['node', '/dsh.js', '--profile', 'deepseek-tui', 'hello'],
    })
    test.controller.dispatch({ kind: 'command', query: 'reload' })
    const result = await test.exited
    // Empty inner keeps the original dsh argv as launcher, including the task.
    expect(result.spawnArgs[0]).toContain('hello')
    expect(result.spawnArgs[0]).toContain('--resume')
    await test.ctx.fiber.dispose()
  })

  it('is single-flight with a second /reload', async () => {
    const test = await bench({ inner: ['hello'] })
    test.controller.dispatch({ kind: 'command', query: 'reload' })
    test.controller.dispatch({ kind: 'command', query: 'reload' })
    const result = await test.exited
    expect(result.spawnArgs).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('requests exit code 1 when spawn fails', async () => {
    const test = await bench({
      inner: ['hello'],
      spawnError: new Error('spawn ENOENT'),
    })
    test.controller.dispatch({ kind: 'command', query: 'reload' })
    const result = await test.exited
    expect(result.code).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('logs a reload flush failure and still replaces the process', async () => {
    const test = await bench({ inner: ['hello'] })
    test.ctx.on('session/flush', () => Promise.reject(new Error('reload flush failed')))
    test.controller.dispatch({ kind: 'command', query: 'reload' })
    const result = await test.exited
    expect(result.code).toBe(0)
    expect(result.order).toContain('spawn')
    await test.ctx.fiber.dispose()
  })

  it('reports an unexpected reload drain failure through the root exit effect', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-tui-reload-failure-'))
    const frames = join(directory, 'frames.json')
    try {
      const test = await bench({ inner: ['hello'], frameStats: frames })
      internals.writeFrameStatsFile = async () => { throw new Error('stats drain failed') }
      test.controller.dispatch({ kind: 'command', query: 'reload' })
      const result = await test.exited
      expect(result.code).toBe(1)
      expect(result.order).not.toContain('spawn')
      await test.ctx.fiber.dispose()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reports an ordinary root-effect cleanup failure', async () => {
    const test = await bench({})
    test.controller.dispose = async () => { throw new Error('controller cleanup failed') }
    const disposal = test.ctx.fiber.dispose()
    const result = await test.exited
    expect(result.code).toBe(1)
    await disposal
  })
})

describe('external editor root lifecycle', () => {
  it('handles missing/invalid config and remounts success, nonzero, and open failure', async () => {
    const test = await bench({})
    internals.editorEnv = {}
    test.controller.dispatch({ kind: 'edit-external', text: 'draft' })
    expect(test.controller.getFeedback()).toBe('未配置编辑器 · 请设置 $VISUAL 或 $EDITOR')
    expect(test.mountLoop).toHaveBeenCalledTimes(1)

    internals.editorEnv = { VISUAL: "fixture 'unterminated" }
    test.controller.dispatch({ kind: 'edit-external', text: 'draft' })
    expect(test.controller.getFeedback()).toContain('✗ 无法打开编辑器：')
    expect(test.mountLoop).toHaveBeenCalledTimes(1)

    internals.editorEnv = { VISUAL: 'fixture-editor' }
    internals.editDraftExternally = vi.fn(async (_command, _draft, options: EditorOptions) => {
      options.suspend()
      return 'edited draft'
    })
    test.controller.dispatch({ kind: 'edit-external', text: 'draft' })
    await vi.waitFor(() => { expect(test.controller.getComposerDraft()).toBe('edited draft') })
    expect(test.rawMode).toHaveBeenCalledWith(false)
    expect(test.mountLoop).toHaveBeenCalledTimes(2)

    internals.editDraftExternally = vi.fn(async (_command, _draft, options: EditorOptions) => {
      options.suspend()
      return null
    })
    test.controller.dispatch({ kind: 'edit-external', text: 'unchanged draft' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe('✗ 编辑器退出非零 · 输入未变')
    })
    expect(test.controller.getComposerDraft()).toBe('unchanged draft')
    expect(test.mountLoop).toHaveBeenCalledTimes(3)

    internals.editDraftExternally = vi.fn(async () => { throw new Error('tty failed') })
    test.controller.dispatch({ kind: 'edit-external', text: 'still unchanged' })
    await vi.waitFor(() => {
      expect(test.controller.getFeedback()).toBe('✗ 无法打开编辑器：tty failed')
    })
    expect(test.mountLoop).toHaveBeenCalledTimes(3)
    await test.ctx.fiber.dispose()
  })

  it('keeps one editor in flight and does not remount during ordinary cleanup', async () => {
    const test = await bench({})
    const gate = Promise.withResolvers<string | null>()
    const started = Promise.withResolvers<undefined>()
    internals.editorEnv = { EDITOR: 'fixture-editor' }
    internals.editDraftExternally = vi.fn(async (_command, _draft, options: EditorOptions) => {
      options.suspend()
      started.resolve(undefined)
      return gate.promise
    })
    test.controller.dispatch({ kind: 'edit-external', text: 'first draft' })
    await started.promise
    test.controller.dispatch({ kind: 'edit-external', text: 'second draft' })
    expect(test.controller.getComposerDraft()).toBe('first draft')
    const disposal = test.ctx.fiber.dispose()
    gate.resolve('edited during cleanup')
    await disposal
    expect(test.mountLoop).toHaveBeenCalledOnce()
  })

  it('does not remount or accept another editor after process exit starts', async () => {
    const test = await bench({})
    const gate = Promise.withResolvers<string | null>()
    const started = Promise.withResolvers<undefined>()
    internals.editorEnv = { EDITOR: 'fixture-editor' }
    internals.editDraftExternally = vi.fn(async (_command, _draft, options: EditorOptions) => {
      options.suspend()
      started.resolve(undefined)
      return gate.promise
    })
    test.controller.dispatch({ kind: 'edit-external', text: 'exit draft' })
    await started.promise
    test.controller.dispatchExit()
    const exit = await test.exited
    expect(exit.code).toBe(0)
    gate.resolve('edited before exit')
    await vi.waitFor(() => {
      expect(test.controller.getComposerDraft()).toBe('edited before exit')
    })
    test.controller.dispatch({ kind: 'edit-external', text: 'late draft' })
    expect(test.controller.getComposerDraft()).toBe('edited before exit')
    expect(test.mountLoop).toHaveBeenCalledOnce()
    await test.ctx.fiber.dispose()
  })
})
