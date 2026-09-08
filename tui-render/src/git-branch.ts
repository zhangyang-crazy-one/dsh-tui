import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface CacheEntry {
  readonly branch: string | undefined
  readonly timestamp: number
}

const branchCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 2000

/**
 * Detect the current Git branch for a working directory by traversing upward
 * to locate `.git/HEAD`. Returns `undefined` if `cwd` is not in a Git repository.
 * Results are cached per directory with a 2-second TTL for terminal frame performance.
 *
 * @param cwd - The directory path to inspect.
 * @returns The branch name, short commit SHA if detached, or undefined.
 */
export function detectGitBranch(cwd: string): string | undefined {
  if (!cwd) return undefined
  const now = Date.now()
  const cached = branchCache.get(cwd)
  if (cached !== undefined && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.branch
  }

  let branch: string | undefined
  try {
    let dir = cwd
    while (dir) {
      const gitPath = join(dir, '.git')
      if (existsSync(gitPath)) {
        let headPath: string | undefined
        const stat = statSync(gitPath)
        if (stat.isDirectory()) {
          headPath = join(gitPath, 'HEAD')
        } else if (stat.isFile()) {
          // worktree or submodule
          const gitContent = readFileSync(gitPath, 'utf8')
          const match = /gitdir:\s*(.+)/u.exec(gitContent)
          if (match?.[1]) {
            const gitDir = match[1].trim()
            headPath = join(dir, gitDir, 'HEAD')
          }
        }
        if (headPath && existsSync(headPath)) {
          const head = readFileSync(headPath, 'utf8').trim()
          if (head.startsWith('ref: refs/heads/')) {
            branch = head.slice('ref: refs/heads/'.length)
          } else if (/^[0-9a-f]{7,40}$/iu.test(head)) {
            branch = head.slice(0, 7)
          }
        }
        break
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    branch = undefined
  }

  branchCache.set(cwd, { branch, timestamp: now })
  return branch
}
