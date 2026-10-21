/**
 * RuntimeController workspace overlay: `g t` and `/files` load the lazy tree
 * through ctx.fs (resolve + listDir + readText, never node:fs), directory
 * Enter expands/collapses, file Enter opens an inline preview, `i` inserts the
 * path and closes, the `e` path draft resolves or keeps the previous root with
 * the failure pair, and a missing fs paints the S19 opener error.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import { FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { RuntimeController, internals } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

/** A fake fs target: the key doubles as the lookup handle. */
function target(path: string): FsTarget {
  return { targetKey: FsTargetKey(path), displayPath: path }
}

/** A directory entry under a fake fs tree. */
function entry(path: string, type: 'file' | 'directory'): FsDirEntry {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { name, type, target: target(path) }
}

interface FsFake {
  readonly tree: Map<string, FsDirEntry[]>
  readonly files?: Map<string, string>
  readonly resolved: string[]
  failOn?: string
}

/** Provide an fs fake over the given tree (directory path → children). */
function provideFs(ctx: Context, fake: FsFake): () => void {
  return ctx.provide('fs', {
    resolve: (path: string) => {
      fake.resolved.push(path)
      if (fake.failOn !== undefined && path === fake.failOn) {
        return Promise.reject(new Error('FS_NOT_FOUND'))
      }
      if (!fake.tree.has(path)) return Promise.reject(new Error('FS_NOT_FOUND'))
      return Promise.resolve(target(path))
    },
    listDir: (targetArg: FsTarget) => {
      const children = fake.tree.get(String(targetArg.targetKey))
      if (children === undefined) return Promise.reject(new Error('FS_NOT_FOUND'))
      return Promise.resolve(children)
    },
    readText: (targetArg: FsTarget) => {
      const content = fake.files?.get(String(targetArg.targetKey))
      if (content === undefined) return Promise.reject(new Error('FS_NOT_FOUND'))
      return Promise.resolve(content)
    },
  } as never)
}

interface Bench {
  ctx: Context
  controller: RuntimeController
}

/** Mount the minimal registries plus a scripted factory with one live agent. */
async function bench(setup?: (ctx: Context) => void, cwd: string | null = '/ws'): Promise<Bench> {
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
        inbox: createInboxStub(),
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
      await options.setup?.(agent.ctx, agent)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  setup?.(ctx)
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, {
    task: '',
    ...(cwd === null ? {} : { cwd }),
  }, () => {})
  await controller.start()
  return { ctx, controller }
}

/** The default fake tree: /ws has a directory and a file. */
function defaultTree(): FsFake {
  return {
    tree: new Map([
      ['/ws', [entry('/ws/src', 'directory'), entry('/ws/README.md', 'file')]],
      ['/ws/src', [entry('/ws/src/app.ts', 'file')]],
      ['/elsewhere', [entry('/elsewhere/note.txt', 'file')]],
    ]),
    files: new Map([
      ['/ws/README.md', 'hello\nworld\nthird'],
      ['/ws/src/app.ts', 'export const n = 1\n'],
      ['/elsewhere/note.txt', 'note'],
    ]),
    resolved: [],
  }
}

describe('workspace overlay', () => {
  it('paints the S19 error when fs is not composed', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'workspace-pane' })
    const pane = controller.getWorkspacePane()
    expect(pane.open).toBe(true)
    expect(pane.error).toBe('文件系统未组合')
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    controller.dispatch({ kind: 'workspace-enter' })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-cancel-edit' })
    controller.dispatch({ kind: 'workspace-pane' })
    expect(controller.getWorkspacePane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('loads the root lazily on open', async () => {
    const fake = defaultTree()
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, fake)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    const pane = controller.getWorkspacePane()
    expect(pane.root).toBe('/ws')
    expect(pane.nodes.map(node => node.name)).toEqual(['src', 'README.md'])
    expect(fake.resolved).toEqual(['/ws'])
    await ctx.fiber.dispose()
  })

  it('expands a directory on Enter and collapses on a second Enter', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, defaultTree())
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-enter' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(3)
    })
    expect(controller.getWorkspacePane().nodes.map(node => node.name)).toEqual([
      'src',
      'app.ts',
      'README.md',
    ])
    controller.dispatch({ kind: 'workspace-enter' })
    expect(controller.getWorkspacePane().nodes.length).toBe(2)
    controller.dispatch({ kind: 'workspace-enter' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(3)
    })
    await ctx.fiber.dispose()
  })

  it('opens an inline preview on file Enter and returns to the tree on escape', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, defaultTree())
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    expect(controller.getWorkspacePane().selectedIndex).toBe(1)
    controller.dispatch({ kind: 'workspace-enter' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().preview?.name).toBe('README.md')
    })
    const preview = controller.getWorkspacePane().preview
    expect(controller.getWorkspacePane().open).toBe(true)
    expect(preview?.lines).toEqual(['hello', 'world', 'third'])
    expect(preview?.scrollOffset).toBe(0)
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    expect(controller.getWorkspacePane().preview?.scrollOffset).toBe(0)
    controller.dispatch({
      kind: 'workspace-preview-layout',
      layout: { lines: preview!.lines, pageRows: 2, maxOffset: 1 },
    })
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    expect(controller.getWorkspacePane().preview?.scrollOffset).toBe(1)
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    expect(controller.getWorkspacePane().preview?.scrollOffset).toBe(1)
    controller.dispatch({ kind: 'workspace-escape' })
    expect(controller.getWorkspacePane().preview).toBeUndefined()
    expect(controller.getWorkspacePane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('inserts and closes the overlay on workspace-insert', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, defaultTree())
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    controller.dispatch({ kind: 'workspace-enter' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().preview).toBeDefined()
    })
    controller.dispatch({ kind: 'workspace-insert' })
    expect(controller.getWorkspacePane().open).toBe(false)
    expect(controller.getWorkspacePane().preview).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('opens the workspace overlay from /files', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, defaultTree())
    })
    controller.dispatch({ kind: 'command', query: 'files' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().open).toBe(true)
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    await ctx.fiber.dispose()
  })

  it('resolves the path draft and replaces the root on success', async () => {
    const fake = defaultTree()
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, fake)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-edit' })
    expect(controller.getWorkspacePane().editing).toBe(true)
    controller.dispatch({ kind: 'workspace-apply', value: '/elsewhere' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().root).toBe('/elsewhere')
    })
    const pane = controller.getWorkspacePane()
    expect(pane.editing).toBe(false)
    expect(pane.resolveError).toBeUndefined()
    expect(pane.nodes.map(node => node.name)).toEqual(['note.txt'])
    await ctx.fiber.dispose()
  })

  it('keeps the previous root and paints the failure pair on FS_NOT_FOUND', async () => {
    const fake = defaultTree()
    fake.failOn = '/missing'
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, fake)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-apply', value: '/missing' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().resolveError).toBe('FS_NOT_FOUND')
    })
    const pane = controller.getWorkspacePane()
    expect(pane.root).toBe('/ws')
    expect(pane.nodes.length).toBe(2)
    await ctx.fiber.dispose()
  })

  it('cancels the draft back to browse without touching the root', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, defaultTree())
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-cancel-edit' })
    const pane = controller.getWorkspacePane()
    expect(pane.editing).toBe(false)
    expect(pane.root).toBe('/ws')
    await ctx.fiber.dispose()
  })

  it('drops an in-flight resolve that lands after Esc closed the overlay', async () => {
    const fake = defaultTree()
    const { ctx, controller } = await bench((ctx) => {
      provideFs(ctx, fake)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-apply', value: '/elsewhere' })
    controller.dispatch({ kind: 'workspace-escape' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(controller.getWorkspacePane().open).toBe(false)
    // Reopen: the stale /elsewhere result must not have landed.
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(controller.getWorkspacePane().nodes.length).toBe(2)
    })
    expect(controller.getWorkspacePane().root).toBe('/ws')
    await ctx.fiber.dispose()
  })

  it('uses dot when cwd is omitted and reports an open root failure', async () => {
    const dot: FsFake = {
      tree: new Map([['.', [entry('./a.ts', 'file')]]]),
      resolved: [],
    }
    const omitted = await bench((ctx) => { provideFs(ctx, dot) }, null)
    omitted.controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(omitted.controller.getWorkspacePane().nodes).toHaveLength(1) })
    expect(dot.resolved).toEqual(['.'])
    await omitted.ctx.fiber.dispose()

    const failed = defaultTree()
    failed.failOn = '/ws'
    const failure = await bench((ctx) => { provideFs(ctx, failed) })
    failure.controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => {
      expect(failure.controller.getWorkspacePane().resolveError).toBe('FS_NOT_FOUND')
    })
    await failure.ctx.fiber.dispose()
  })

  it('drops a root listing that resolves after the pane closes', async () => {
    const gate = Promise.withResolvers<FsTarget>()
    const { ctx, controller } = await bench((ctx) => {
      ctx.provide('fs', {
        resolve: () => gate.promise,
        listDir: () => Promise.resolve([]),
      } as never)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    controller.dispatch({ kind: 'workspace-escape' })
    gate.resolve(target('/ws'))
    await Promise.resolve()
    expect(controller.getWorkspacePane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('drops a root failure and directory listing after the pane closes', async () => {
    const rootGate = Promise.withResolvers<FsTarget>()
    const rootFailure = await bench((ctx) => {
      ctx.provide('fs', {
        resolve: () => rootGate.promise,
        listDir: () => Promise.resolve([]),
      } as never)
    })
    rootFailure.controller.dispatch({ kind: 'workspace-pane' })
    rootFailure.controller.dispatch({ kind: 'workspace-escape' })
    rootGate.reject(new Error('late root failure'))
    await Promise.resolve()
    expect(rootFailure.controller.getWorkspacePane().open).toBe(false)
    await rootFailure.ctx.fiber.dispose()

    const listGate = Promise.withResolvers<FsDirEntry[]>()
    const fake: FsFake = {
      tree: new Map([['/ws', [entry('/ws/src', 'directory')]]]),
      resolved: [],
    }
    const listing = await bench((ctx) => {
      ctx.provide('fs', {
        resolve: (path: string) => Promise.resolve(target(path)),
        listDir: (value: FsTarget) => String(value.targetKey) === '/ws'
          ? Promise.resolve(fake.tree.get('/ws')!)
          : listGate.promise,
      } as never)
    })
    listing.controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(listing.controller.getWorkspacePane().nodes).toHaveLength(1) })
    listing.controller.dispatch({ kind: 'workspace-enter' })
    listing.controller.dispatch({ kind: 'workspace-escape' })
    listGate.resolve([entry('/ws/src/a.ts', 'file')])
    await Promise.resolve()
    expect(listing.controller.getWorkspacePane().open).toBe(false)
    await listing.ctx.fiber.dispose()
  })

  it('drops a resolved path result after editing is cancelled by close', async () => {
    const applyGate = Promise.withResolvers<FsTarget>()
    const fake = defaultTree()
    const { ctx, controller } = await bench((ctx) => {
      ctx.provide('fs', {
        resolve: (path: string) => path === '/late' ? applyGate.promise : Promise.resolve(target(path)),
        listDir: (value: FsTarget) => Promise.resolve(fake.tree.get(String(value.targetKey)) ?? []),
      } as never)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(controller.getWorkspacePane().nodes).toHaveLength(2) })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-apply', value: '/late' })
    controller.dispatch({ kind: 'workspace-escape' })
    applyGate.resolve(target('/late'))
    await Promise.resolve()
    expect(controller.getWorkspacePane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('keeps expansion and path apply inert after the fs provider unloads', async () => {
    const fake = defaultTree()
    let disposeFs: (() => void) | undefined
    const { ctx, controller } = await bench((ctx) => {
      disposeFs = provideFs(ctx, fake)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(controller.getWorkspacePane().nodes).toHaveLength(2) })
    disposeFs?.()
    controller.dispatch({ kind: 'workspace-enter' })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-apply', value: '/elsewhere' })
    await Promise.resolve()
    expect(controller.getWorkspacePane().root).toBe('/ws')
    await ctx.fiber.dispose()
  })

  it('drops a late path failure after the pane closes', async () => {
    const gate = Promise.withResolvers<FsTarget>()
    const fake = defaultTree()
    const { ctx, controller } = await bench((ctx) => {
      ctx.provide('fs', {
        resolve: (path: string) => path === '/late-failure' ? gate.promise : Promise.resolve(target(path)),
        listDir: (value: FsTarget) => Promise.resolve(fake.tree.get(String(value.targetKey)) ?? []),
      } as never)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(controller.getWorkspacePane().nodes).toHaveLength(2) })
    controller.dispatch({ kind: 'workspace-edit' })
    controller.dispatch({ kind: 'workspace-apply', value: '/late-failure' })
    controller.dispatch({ kind: 'workspace-escape' })
    gate.reject(new Error('late failure'))
    await Promise.resolve()
    expect(controller.getWorkspacePane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('logs directory expansion failure and leaves other entries open', async () => {
    const fake = defaultTree()
    fake.tree.delete('/ws/src')
    const failed = await bench((ctx) => { provideFs(ctx, fake) })
    failed.controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(failed.controller.getWorkspacePane().nodes).toHaveLength(2) })
    failed.controller.dispatch({ kind: 'workspace-enter' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(failed.controller.getWorkspacePane().nodes).toHaveLength(2)
    await failed.ctx.fiber.dispose()

    const otherTree: FsFake = {
      tree: new Map([['/ws', [{ ...entry('/ws/link', 'file'), type: 'other' as never }]]]),
      resolved: [],
    }
    const other = await bench((ctx) => { provideFs(ctx, otherTree) })
    other.controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(other.controller.getWorkspacePane().nodes).toHaveLength(1) })
    other.controller.dispatch({ kind: 'workspace-enter' })
    expect(other.controller.getWorkspacePane().open).toBe(true)
    await other.ctx.fiber.dispose()
  })

  it('surfaces a ✗ feedback row when listDir rejects during expansion', async () => {
    const fake = defaultTree()
    const { ctx, controller } = await bench((ctx) => {
      ctx.provide('fs', {
        resolve: (path: string) => Promise.resolve(target(path)),
        listDir: (value: FsTarget) => {
          if (String(value.targetKey) === '/ws/src') {
            return Promise.reject(new Error('FS_DENIED'))
          }
          return Promise.resolve(fake.tree.get(String(value.targetKey)) ?? [])
        },
      } as never)
    })
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => { expect(controller.getWorkspacePane().nodes).toHaveLength(2) })
    controller.dispatch({ kind: 'workspace-enter' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 工作目录展开失败：FS_DENIED')
    })
    await ctx.fiber.dispose()
  })
})


describe('explicit delivery browsing', () => {
  it('does not open a stale file after the selected delivery changes during resolution', async () => {
    const gate = Promise.withResolvers<FsTarget>()
    const { ctx, controller } = await bench()
    const stat = vi.fn(async () => ({ type: 'file', size: 8 }))
    const read = vi.fn(async () => new TextEncoder().encode('old file'))
    ctx.provide('fs', { resolve: () => gate.promise, stat, readBytes: read } as never)
    try {
      controller.session?.append('deliverables/presented', { turn: 1, callId: ToolCallId('late-delivery'), files: [
        { path: '/ws/old.md' }, { path: '/ws/current.md' },
      ] })
      controller.dispatch({ kind: 'command', query: 'deliveries' })
      controller.dispatch({ kind: 'workspace-enter' })
      controller.dispatch({ kind: 'workspace-move', delta: 1 })
      gate.resolve(target('/ws/old.md'))
      await vi.waitFor(() => expect(stat).toHaveBeenCalledOnce())
      expect(read).not.toHaveBeenCalled()
      expect(controller.getWorkspacePane().preview).toBeUndefined()
      expect(controller.getWorkspacePane().selectedIndex).toBe(1)
    } finally { await controller.dispose();await ctx.fiber.dispose() }
  })

  it('lists only the current Session declarations, previews text, and opens the selected file', async () => {
    const { ctx, controller } = await bench()
    const open = vi.spyOn(internals, 'openUrl').mockImplementation(() => {})
    const read = vi.fn(async () => new TextEncoder().encode('# Delivered report\nComplete text'))
    ctx.provide('fs', {
      resolve: async (path: string) => target(path),
      stat: async () => ({ type: 'file', size: 32 }),
      readBytes: read,
      processPath: (file: FsTarget) => file.displayPath,
    } as never)
    try {
      controller.session?.append('deliverables/presented', { turn: 1, callId: ToolCallId('delivery'), files: [
        { path: '/ws/报告.md', description: 'Final report' }, { path: '/ws/slides.pptx', description: 'Slides' },
      ] })
      controller.dispatch({ kind: 'command', query: 'deliveries' })
      expect(controller.getWorkspacePane().mode).toBe('deliveries')
      await vi.waitFor(() => expect(controller.getWorkspacePane().nodes.map(row => row.path)).toEqual(['/ws/报告.md', '/ws/slides.pptx']))
      controller.dispatch({ kind: 'workspace-enter' })
      await vi.waitFor(() => expect(controller.getWorkspacePane().preview?.lines).toContain('Complete text'))
      expect(read).toHaveBeenCalledWith(target('/ws/报告.md'), expect.any(AbortSignal), 1048576)
      controller.dispatch({ kind: 'workspace-escape' })
      controller.dispatch({ kind: 'workspace-move', delta: 1 })
      controller.dispatch({ kind: 'workspace-enter' })
      await vi.waitFor(() => expect(controller.getWorkspacePane().preview?.path).toBe('/ws/slides.pptx'))
      expect(read).toHaveBeenCalledTimes(1)
      controller.dispatch({ kind: 'workspace-open-system' })
      await vi.waitFor(() => expect(open).toHaveBeenCalledWith('file:///ws/slides.pptx'))
      controller.dispatch({ kind: 'new-session' })
      await vi.waitFor(() => expect(controller.getModel().deliveries).toBeUndefined())
      controller.dispatch({ kind: 'command', query: 'deliveries' })
      expect(controller.getWorkspacePane().nodes).toEqual([])
    } finally { open.mockRestore();await controller.dispose();await ctx.fiber.dispose() }
  })
})

it('opens event JSON and exact file coordinates in the new review browser', async () => {
  const calls: unknown[] = []
  const { ctx, controller } = await bench(ctx => {
    ctx.provide('workspaceChanges', {
      summary: () => ({ turn: 1, cwd: '/ws', files: [
        { path: 'a/index.ts', display: 'a/index.ts', added: 1, deleted: 0 },
        { path: 'b/index.ts', display: 'b/index.ts', added: 2, deleted: 1 },
      ], total: 2, added: 3, deleted: 1 }),
      diff: async (...args: unknown[]) => { calls.push(args);return { kind: 'text', path: 'b/index.ts', display: 'b/index.ts', before: true, after: true,
        coarse: false, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old-b', '+new-b'] }] } },
    } as never)
  })
  try {
    const event = controller.session!.append('workspace/changes', { turn: 1 })
    controller.dispatch({ kind: 'command', query: 'timeline' })
    await vi.waitFor(() => expect(controller.getBrowserPane().busy).toBe(false))
    expect(controller.getBrowserPane().rows.some(row => row.title.includes('workspace/changes'))).toBe(true)
    controller.dispatch({ kind: 'command', query: 'review' })
    await vi.waitFor(() => expect(controller.getBrowserPane().rows).toHaveLength(2))
    controller.dispatch({ kind: 'browser-move', delta: 1 })
    controller.dispatch({ kind: 'browser-enter' })
    await vi.waitFor(() => expect(controller.getBrowserPane().detail).toContain('+new-b'))
    expect(calls[0]).toEqual([controller.session!.id, event.seq, 1, expect.any(AbortSignal)])
  } finally { await controller.dispose();await ctx.fiber.dispose() }
})

it('manually refreshes a changed file tree and preserves the selected path', async () => {
  const tree = new Map([['/ws', [entry('/ws/a', 'file'), entry('/ws/b', 'file')]]])
  const { ctx, controller } = await bench(ctx => { provideFs(ctx, { tree, resolved: [] }) })
  try {
    controller.dispatch({ kind: 'workspace-pane' })
    await vi.waitFor(() => expect(controller.getWorkspacePane().nodes).toHaveLength(2))
    controller.dispatch({ kind: 'workspace-move', delta: 1 })
    tree.set('/ws', [entry('/ws/added', 'file'), entry('/ws/a', 'file'), entry('/ws/b', 'file')])
    controller.dispatch({ kind: 'workspace-refresh' })
    await vi.waitFor(() => expect(controller.getWorkspacePane().nodes).toHaveLength(3))
    const pane = controller.getWorkspacePane()
    expect(pane.nodes[pane.selectedIndex]?.path).toBe('/ws/b')
    tree.delete('/ws')
    controller.dispatch({ kind: 'workspace-refresh' })
    await vi.waitFor(() => expect(controller.getWorkspacePane().resolveError).toContain('刷新失败'))
    expect(controller.getWorkspacePane().nodes).toHaveLength(3)
  } finally { await controller.dispose();await ctx.fiber.dispose() }
})
