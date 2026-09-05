import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  editDraftExternally,
  externalEditorInternals,
  resolveEditorCommand,
  type EditorSpawn,
} from '../src/external-editor.ts'
import { internals, RuntimeController } from '../src/index.ts'

const roots = new Set<string>()

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-editor-test-'))
  roots.add(path)
  return path
}

function childProcess(
  settle: (child: EventEmitter, file: string) => void,
  capture?: (program: string, args: readonly string[], options: SpawnOptions) => void,
): EditorSpawn {
  return (program, args, options) => {
    capture?.(program, args, options)
    const child = new EventEmitter()
    const file = args.at(-1)
    if (file === undefined) throw new Error('editor argv lacks draft path')
    queueMicrotask(() => { settle(child, file) })
    return child as ChildProcess
  }
}

describe('external editor command resolution', () => {
  it('prefers VISUAL and parses direct quoted argv without a shell', () => {
    expect(resolveEditorCommand({
      VISUAL: 'code --wait "profile name"',
      EDITOR: 'vim',
    })).toEqual({ program: 'code', args: ['--wait', 'profile name'] })
    expect(resolveEditorCommand({ EDITOR: "vim -c 'set spell'" })).toEqual({
      program: 'vim', args: ['-c', 'set spell'],
    })
    expect(resolveEditorCommand({
      VISUAL: '   ',
      EDITOR: "vim  \"single'quote\" 'double\"quote' 'slash\\inside' path\\ with",
    })).toEqual({
      program: 'vim',
      args: ["single'quote", 'double"quote', 'slash\\inside', 'path with'],
    })
    expect(resolveEditorCommand({})).toBeUndefined()
    expect(resolveEditorCommand({ EDITOR: "''" })).toBeUndefined()
    expect(() => resolveEditorCommand({ EDITOR: "vim 'unterminated" })).toThrow(
      '未闭合的引号或转义',
    )
    expect(() => resolveEditorCommand({ EDITOR: 'vim \\' })).toThrow(
      '未闭合的引号或转义',
    )
    expect(() => resolveEditorCommand({ EDITOR: 'vim\0bad' })).toThrow('包含 NUL')
  })
})

describe('editDraftExternally', () => {
  it('uses one tty fd, direct spawn, trims one newline, and removes all residue', async () => {
    const parent = await root()
    const tty = join(parent, 'tty')
    await writeFile(tty, '', { mode: 0o600 })
    const suspend = vi.fn()
    let capturedStdio: SpawnOptions['stdio']
    const capture = vi.fn((
      _program: string,
      _args: readonly string[],
      options: SpawnOptions,
    ) => { capturedStdio = options.stdio })
    const spawn = childProcess((child, file) => {
      void writeFile(file, 'edited draft\n', { mode: 0o600 }).then(() => {
        child.emit('exit', 0, null)
      })
    }, capture)
    await expect(editDraftExternally(
      { program: 'fixture-editor', args: ['--wait'] },
      'original draft',
      { suspend, spawn, tempParent: parent, ttyPath: tty },
    )).resolves.toBe('edited draft')
    expect(suspend).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith(
      'fixture-editor',
      ['--wait', expect.stringMatching(/\/dsh-editor-[^/]+\/draft\.md$/u)],
      expect.objectContaining({ shell: false }),
    )
    const stdio = capturedStdio as number[]
    expect(stdio[0]).toBe(stdio[1])
    expect(stdio[1]).toBe(stdio[2])
    expect(await readdir(parent)).toEqual(['tty'])
  })

  it('returns null for nonzero exit and linked readback, with zero temp residue', async () => {
    const parent = await root()
    const tty = join(parent, 'tty')
    const outside = join(parent, 'outside')
    await writeFile(tty, '', { mode: 0o600 })
    await writeFile(outside, 'outside', { mode: 0o600 })
    await expect(editDraftExternally(
      { program: 'fixture-editor', args: [] },
      'original',
      {
        suspend: () => {},
        tempParent: parent,
        ttyPath: tty,
        spawn: childProcess((child) => { child.emit('exit', 3, null) }),
      },
    )).resolves.toBeNull()
    await expect(editDraftExternally(
      { program: 'fixture-editor', args: [] },
      'original',
      {
        suspend: () => {},
        tempParent: parent,
        ttyPath: tty,
        spawn: childProcess((child, file) => {
          void rm(file).then(() => symlink(outside, file)).then(() => {
            child.emit('exit', 0, null)
          })
        }),
      },
    )).resolves.toBeNull()
    expect((await readdir(parent)).sort()).toEqual(['outside', 'tty'])
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

  it('refuses collisions and symlinks and cleans after tty open failure', async () => {
    const parent = await root()
    const privateRoot = join(parent, 'private')
    await mkdir(privateRoot, { mode: 0o700 })
    await chmod(privateRoot, 0o700)
    const draft = join(privateRoot, 'draft.md')
    await writeFile(draft, 'collision', { mode: 0o600 })
    await expect(externalEditorInternals.createEditorFile(privateRoot, 'next')).rejects.toMatchObject({
      code: 'EEXIST',
    })
    await rm(draft)
    await symlink(join(parent, 'missing-target'), draft)
    await expect(externalEditorInternals.validateEditorFile(privateRoot, draft)).rejects.toThrow(
      'not a regular file',
    )
    await rm(privateRoot, { recursive: true })
    const suspend = vi.fn()
    await expect(editDraftExternally(
      { program: 'fixture-editor', args: [] },
      'original',
      {
        suspend,
        spawn: childProcess(() => { throw new Error('spawn must stay unreachable') }),
        tempParent: parent,
        ttyPath: join(parent, 'missing-tty'),
      },
    )).rejects.toMatchObject({ code: 'ENOENT' })
    expect(suspend).toHaveBeenCalledOnce()
    expect(await readdir(parent)).toEqual([])
  })

  it('rejects escaped, foreign-owned, and permissive editor files', async () => {
    const parent = await root()
    const privateRoot = join(parent, 'private')
    await mkdir(privateRoot, { mode: 0o700 })
    const outside = join(parent, 'outside')
    await writeFile(outside, 'outside', { mode: 0o600 })
    await expect(externalEditorInternals.validateEditorFile(privateRoot, outside)).rejects.toThrow(
      'escaped its private directory',
    )
    const draft = await externalEditorInternals.createEditorFile(privateRoot, 'draft')
    await chmod(draft, 0o644)
    await expect(externalEditorInternals.validateEditorFile(privateRoot, draft)).rejects.toThrow(
      'permissions are not private',
    )
    await chmod(draft, 0o600)
    const uid = (process.getuid as () => number)()
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1)
    await expect(externalEditorInternals.validateEditorFile(privateRoot, draft)).rejects.toThrow(
      'owner changed',
    )
    getuid.mockRestore()
    expect(externalEditorInternals.ownedByCurrentUser(uid, uid)).toBe(true)
    expect(externalEditorInternals.ownedByCurrentUser(uid, uid + 1)).toBe(false)
  })

  it('cleans invalid roots and refuses cleanup after identity replacement', async () => {
    const parent = await root()
    const moved = join(parent, 'moved')
    await expect(externalEditorInternals.createWorkspace(
      'draft',
      parent,
      undefined,
      async (workspaceRoot) => {
        await rename(workspaceRoot, moved)
        await symlink(moved, workspaceRoot)
      },
    )).rejects.toThrow('not a private owned directory')
    await rm(moved, { recursive: true })

    const movedFileRoot = join(parent, 'moved-file-root')
    await expect(externalEditorInternals.createWorkspace(
      'draft',
      parent,
      undefined,
      async (workspaceRoot) => {
        await rename(workspaceRoot, movedFileRoot)
        await writeFile(workspaceRoot, 'replacement')
      },
    )).rejects.toThrow('not a private owned directory')
    await rm(movedFileRoot, { recursive: true })

    const getuid = vi.spyOn(process, 'getuid').mockReturnValue((process.getuid as () => number)() + 1)
    await expect(externalEditorInternals.createWorkspace('draft', parent)).rejects.toThrow(
      'not a private owned directory',
    )
    getuid.mockRestore()

    const workspace = await externalEditorInternals.createWorkspace('draft', parent)
    const original = `${workspace.root}-original`
    await rename(workspace.root, original)
    await mkdir(workspace.root)
    await expect(externalEditorInternals.cleanupWorkspace(workspace)).rejects.toThrow(
      'identity changed',
    )
    await rm(workspace.root, { recursive: true })
    await rm(original, { recursive: true })
  })

  it('maps spawn errors and signal exits and trims every newline form', async () => {
    const parent = await root()
    const tty = join(parent, 'tty')
    await writeFile(tty, '', { mode: 0o600 })
    await expect(editDraftExternally(
      { program: 'fixture-editor', args: [] },
      'draft',
      {
        suspend: () => {},
        spawn: childProcess((child) => { child.emit('error', new Error('spawn failed')) }),
        tempParent: parent,
        ttyPath: tty,
      },
    )).rejects.toThrow('spawn failed')
    await expect(editDraftExternally(
      { program: 'fixture-editor', args: [] },
      'draft',
      {
        suspend: () => {},
        spawn: childProcess((child) => { child.emit('exit', null, 'SIGTERM') }),
        tempParent: parent,
        ttyPath: tty,
      },
    )).resolves.toBeNull()
    expect(externalEditorInternals.trimEditorNewline('line\r\n')).toBe('line')
    expect(externalEditorInternals.trimEditorNewline('line\n')).toBe('line')
    expect(externalEditorInternals.trimEditorNewline('line')).toBe('line')
    expect(await readdir(parent)).toEqual(['tty'])
  })
})

describe('RuntimeController external-editor settlement', () => {
  function controller(
    request: ConstructorParameters<typeof RuntimeController>[5],
  ): { ctx: Context; controller: RuntimeController } {
    const ctx = new Context()
    const controller = new RuntimeController(
      ctx,
      { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
      { task: '' },
      () => {},
      () => {},
      request,
    )
    ;(controller as unknown as {
      agentHandle: { followup(message: never): void; cancel(): void }
    }).agentHandle = { followup: () => {}, cancel: () => {} }
    return { ctx, controller }
  }

  it('keeps the first accepted draft while a second request is in flight', async () => {
    let active = false
    let settle: ((result: { kind: 'success'; text: string }) => void) | undefined
    const fixture = controller((_draft, next) => {
      if (active) return false
      active = true
      settle = next
      return true
    })
    fixture.controller.dispatch({ kind: 'edit-external', text: 'first draft' })
    fixture.controller.dispatch({ kind: 'edit-external', text: 'second draft' })
    expect(fixture.controller.getComposerDraft()).toBe('first draft')
    settle?.({ kind: 'success', text: 'edited draft' })
    expect(fixture.controller.getComposerDraft()).toBe('edited draft')
    await fixture.controller.dispose()
    await fixture.ctx.fiber.dispose()
  })

  it('keeps the default request inert, redraws, and exposes the production spawn seam', async () => {
    const ctx = new Context()
    const controller = new RuntimeController(
      ctx,
      { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
      { task: '' },
      () => {},
    )
    ;(controller as unknown as {
      agentHandle: { followup(message: never): void; cancel(): void }
    }).agentHandle = { followup: () => {}, cancel: () => {} }
    controller.dispatch({ kind: 'edit-external', text: 'ignored' })
    expect(controller.getComposerDraft()).toBe('')
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.redraw()
    await vi.waitFor(() => { expect(listener).toHaveBeenCalledOnce() })
    const child = internals.editorSpawn(
      process.execPath,
      ['-e', 'process.exit(0)'],
      { stdio: 'ignore' },
    )
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', resolveExit)
    })
    expect(code).toBe(0)
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('renders locked warning, unchanged, and open-failure feedback', async () => {
    const settlements = [
      { kind: 'unconfigured' as const },
      { kind: 'unchanged' as const },
      { kind: 'error' as const, reason: 'tty unavailable' },
    ]
    const expected = [
      '未配置编辑器 · 请设置 $VISUAL 或 $EDITOR',
      '✗ 编辑器退出非零 · 输入未变',
      '✗ 无法打开编辑器：tty unavailable',
    ]
    for (const [index, settlement] of settlements.entries()) {
      const fixture = controller((_draft, settle) => {
        settle(settlement)
        return false
      })
      fixture.controller.dispatch({ kind: 'edit-external', text: 'unchanged' })
      expect(fixture.controller.getFeedback()).toBe(expected[index])
      await fixture.controller.dispose()
      await fixture.ctx.fiber.dispose()
    }
  })
})
