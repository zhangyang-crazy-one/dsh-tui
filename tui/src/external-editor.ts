/** Secure POSIX external-editor round trip for the terminal composer. */

import type { ChildProcess, SpawnOptions } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
  rm,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Direct executable plus argv parsed from `$VISUAL` or `$EDITOR`. */
export interface EditorCommand {
  readonly program: string
  readonly args: readonly string[]
}

/** Spawn face used by the editor bridge. */
export type EditorSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

interface EditorWorkspace {
  readonly root: string
  readonly path: string
  readonly device: bigint
  readonly inode: bigint
}

/** Parse a POSIX-style command string without invoking a shell. */
function parseEditorWords(value: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: 'single' | 'double' | undefined
  let escaped = false
  const push = (): void => {
    if (current === '') return
    words.push(current)
    current = ''
  }
  for (const character of value.trim()) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single'
      continue
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double'
      continue
    }
    if (/\s/u.test(character) && quote === undefined) {
      push()
      continue
    }
    current += character
  }
  if (escaped || quote !== undefined) {
    throw new Error('编辑器命令包含未闭合的引号或转义')
  }
  push()
  return words
}

/**
 * Resolve `$VISUAL` before `$EDITOR` into a direct spawn command.
 * @param env - environment snapshot.
 * @returns parsed executable and arguments, or undefined when neither is configured.
 */
export function resolveEditorCommand(
  env: NodeJS.ProcessEnv = process.env,
): EditorCommand | undefined {
  const configured = env.VISUAL?.trim() || env.EDITOR?.trim()
  if (configured === undefined || configured === '') return undefined
  if (configured.includes('\0')) throw new Error('编辑器命令包含 NUL')
  const [program, ...args] = parseEditorWords(configured)
  if (program === undefined) return undefined
  return { program, args }
}

function ownedByCurrentUser(
  uid: number,
  currentUid = (process.getuid as () => number)(),
): boolean {
  return uid === currentUid
}

/** Create one exclusive 0600 draft file under an already private directory. */
async function createEditorFile(root: string, content: string): Promise<string> {
  const path = join(root, 'draft.md')
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return path
}

/** Reject a replaced, linked, foreign-owned, or overly permissive editor file. */
async function validateEditorFile(root: string, path: string): Promise<void> {
  if (dirname(resolve(path)) !== resolve(root)) {
    throw new Error('editor draft escaped its private directory')
  }
  const stat = await lstat(path, { bigint: true })
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('editor draft is not a regular file')
  }
  if (!ownedByCurrentUser(Number(stat.uid))) {
    throw new Error('editor draft owner changed')
  }
  if ((Number(stat.mode) & 0o077) !== 0) {
    throw new Error('editor draft permissions are not private')
  }
}

async function createWorkspace(
  content: string,
  parent: string,
  createFile: (root: string, value: string) => Promise<string> = createEditorFile,
  beforeRootValidation?: (root: string) => void | Promise<void>,
): Promise<EditorWorkspace> {
  const root = await mkdtemp(join(parent, 'dsh-editor-'))
  try {
    await chmod(root, 0o700)
    await beforeRootValidation?.(root)
    const rootStat = await lstat(root, { bigint: true })
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !ownedByCurrentUser(Number(rootStat.uid))) {
      throw new Error('editor workspace is not a private owned directory')
    }
    const path = await createFile(root, content)
    await validateEditorFile(root, path)
    return { root, path, device: rootStat.dev, inode: rootStat.ino }
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

async function cleanupWorkspace(workspace: EditorWorkspace): Promise<void> {
  const stat = await lstat(workspace.root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || stat.dev !== workspace.device || stat.ino !== workspace.inode) {
    throw new Error('editor workspace identity changed before cleanup')
  }
  await rm(workspace.root, { recursive: true, force: false })
}

function waitForEditor(child: ChildProcess): Promise<number> {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      resolveExit(code ?? -1)
    })
  })
}

/** Remove exactly one trailing line ending from edited composer text. */
function trimEditorNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

/**
 * Write a private draft, suspend after preparation, run the editor on the
 * controlling terminal, and return edited text only for a clean exit/read.
 * @param command - direct executable and arguments.
 * @param draft - current composer text.
 * @param options - testable host effects and the root-owned suspend callback.
 * @returns edited text, or null when the editor exits nonzero or readback fails.
 */
export async function editDraftExternally(
  command: EditorCommand,
  draft: string,
  options: {
    readonly suspend: () => void
    readonly spawn: EditorSpawn
    readonly tempParent: string
    readonly ttyPath: string
  },
): Promise<string | null> {
  const workspace = await createWorkspace(draft, options.tempParent)
  let tty: Awaited<ReturnType<typeof open>> | undefined
  try {
    options.suspend()
    tty = await open(options.ttyPath, 'r+')
    const code = await waitForEditor(options.spawn(
      command.program,
      [...command.args, workspace.path],
      { stdio: [tty.fd, tty.fd, tty.fd], shell: false },
    ))
    if (code !== 0) return null
    try {
      await validateEditorFile(workspace.root, workspace.path)
      return trimEditorNewline(await readFile(workspace.path, 'utf8'))
    } catch {
      return null
    }
  } finally {
    await tty?.close()
    await cleanupWorkspace(workspace)
  }
}

/** Focused filesystem seams used to prove collision and symlink refusal. */
export const externalEditorInternals = {
  cleanupWorkspace,
  createEditorFile,
  createWorkspace,
  ownedByCurrentUser,
  trimEditorNewline,
  validateEditorFile,
}
