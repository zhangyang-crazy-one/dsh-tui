import { afterEach, describe, expect, it } from 'vitest'
import { detectGitBranch } from '../src/git-branch.ts'
import { join, relative, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('detectGitBranch', () => {
  it.each(['absolute', 'relative'] as const)('reads a worktree HEAD from a %s gitdir', (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-tui-gitdir-'))
    roots.push(root)
    const worktree = join(root, 'worktree')
    const nested = join(worktree, 'nested')
    const gitDirectory = join(root, 'metadata', 'linked-worktree')
    mkdirSync(nested, { recursive: true })
    mkdirSync(gitDirectory, { recursive: true })
    writeFileSync(join(gitDirectory, 'HEAD'), 'ref: refs/heads/linked-worktree\n')
    const gitDir = kind === 'absolute' ? gitDirectory : relative(worktree, gitDirectory)
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`)
    expect(detectGitBranch(worktree)).toBe('linked-worktree')
    expect(detectGitBranch(nested)).toBe('linked-worktree')
  })

  it('detects git branch in the current repository root', () => {
    const root = resolve('.')
    const branch = detectGitBranch(root)
    expect(branch).toBeDefined()
    expect(typeof branch).toBe('string')
    expect(branch!.length).toBeGreaterThan(0)
  })

  it('detects git branch in nested subdirectories', () => {
    const sub = resolve('./packages/tui/tui-render')
    const branch = detectGitBranch(sub)
    expect(branch).toBeDefined()
    expect(typeof branch).toBe('string')
  })

  it('returns undefined for non-existent or root directories', () => {
    expect(detectGitBranch('')).toBeUndefined()
    expect(detectGitBranch('/tmp')).toBeUndefined()
  })
})
