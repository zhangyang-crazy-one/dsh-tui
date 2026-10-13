/** The dsh-tui bundle layer composes over dsh 0.2 base rows. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PATCH = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')

describe('dsh-tui bundle patch', () => {
  it('names its plugins through package exports so profile edits record portable rows', () => {
    for (const entry of ['startup', 'settings', 'zen-proxy', 'runtime']) {
      expect(PATCH).toContain(`name: "@crazyhappyone/dsh-tui/${entry}"`)
    }
    expect(PATCH).not.toMatch(/name: "\.\.?\/dist\//u)
  })

  it('uses only config keys the 0.2 base rows accept', () => {
    // 0.2 llm-deepseek is Messages-only, system-prompt splits the persona, and
    // 0.2.1 registers no {{cwd}} prompt variable.
    expect(PATCH).not.toMatch(/^\s+protocol:/mu)
    expect(PATCH).not.toMatch(/^\s+persona:/mu)
    expect(PATCH).not.toContain('{{cwd}}')
    expect(PATCH).toContain('personaPrefix:')
  })

  it('inserts the volatile tui settings row and workspace-changes before tui-runtime', () => {
    expect(PATCH).toMatch(/- id: tui\n\s+name: "@crazyhappyone\/dsh-tui\/settings"/u)
    expect(PATCH).toContain("name: '@deepseek-ai/dsh-workspace-changes'")
    expect(PATCH).toContain('timeoutMs: 30000')
    expect(PATCH).toContain('diffTimeoutMs: 100')
    expect(PATCH.indexOf('workspace-changes')).toBeLessThan(PATCH.indexOf('id: tui-runtime'))
  })

  it('mounts no source-only provider packages', () => {
    expect(PATCH).not.toContain('@deepseek-ai/dsh-llm-openai')
    expect(PATCH).not.toContain('@deepseek-ai/dsh-llm-anthropic')
  })
})
