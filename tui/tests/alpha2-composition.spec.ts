/**
 * deepseek-tui shipping composition on 0.1.6-alpha.2: runtime Loader comments,
 * default catalog without V4 Flash ids, and workspace-changes insert bounds.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PATCH = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

describe('deepseek-tui 0.1.6-alpha.2 composition', () => {
  it('documents runtime Loader resolution instead of a compile-time plugin graph', () => {
    expect(PATCH).toContain('runtime Loader')
    expect(PATCH).toContain('compile-time plugin graph')
  })

  it('defaults to deepseek-flash and does not re-list removed V4 Flash ids', () => {
    expect(PATCH).toContain("process.env.DSH_MODEL ?? 'deepseek-flash'")
    expect(PATCH).toContain("process.env.DSH_LLM_PROTOCOL ?? 'messages'")
    expect(PATCH).not.toContain('deepseek-v4-flash')
    expect(PATCH).not.toContain('deepseek-v4-flash-vision-exp')
  })

  it('inserts workspace-changes with documented config bounds before tui-runtime', () => {
    expect(PATCH).toContain("name: '@deepseek-ai/dsh-workspace-changes'")
    expect(PATCH).toContain('timeoutMs: 30000')
    expect(PATCH).toContain('outputMaxBytes: 8388608')
    expect(PATCH).toContain('maxFiles: 500')
    expect(PATCH).toContain('maxFileBytes: 2097152')
    expect(PATCH).toContain('diffTimeoutMs: 100')
    expect(PATCH.indexOf('workspace-changes')).toBeLessThan(PATCH.indexOf('tui-runtime'))
  })
})
