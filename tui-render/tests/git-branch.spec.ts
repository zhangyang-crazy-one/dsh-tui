import { describe, expect, it } from 'vitest'
import { detectGitBranch } from '../src/git-branch.ts'
import { resolve } from 'node:path'

describe('detectGitBranch', () => {
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
