/**
 * Jobs HUD: one `{id} · {status} · {label}` row per job with the host status
 * key untranslated, hidden when the list is empty (S18), content escaped and
 * truncated (D-08). No kill affordance — `job_kill` is not this entry.
 */

import { renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { JobsHud } from '../src/jobs-hud.tsx'
import type { JobHudItem } from '../src/jobs-hud.tsx'

/** Strip SGR/CSI sequences so content assertions read the painted text. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

/** Render the HUD to plain text (no SGR) for content assertions. */
function renderPlain(jobs: readonly JobHudItem[], maxCols = 80): string {
  return stripAnsi(renderToString(createElement(JobsHud, { jobs, maxCols })))
}

describe('JobsHud', () => {
  it('paints nothing for an empty list', () => {
    expect(renderPlain([])).toBe('')
  })

  it('paints `{id} · {status} · {label}` with the host status key', () => {
    const output = renderPlain([
      { id: 'bash-1', status: 'running', label: '跑测试' },
      { id: 'subagent-2', status: 'failed', label: '侦察' },
    ])
    expect(output).toContain('bash-1 · running · 跑测试')
    expect(output).toContain('subagent-2 · failed · 侦察')
  })

  it('escapes CSI in the label instead of passing it through', () => {
    const output = renderPlain([{ id: 'bash-1', status: 'running', label: '清屏\x1b[2J' }])
    expect(output).toContain('清屏\\x1b[2J')
  })

  it('truncates an over-long row to the column budget', () => {
    const output = renderPlain(
      [{ id: 'bash-1', status: 'running', label: '一二三四五六七八九十' }],
      24,
    )
    expect(output).toContain('…')
    expect(output).not.toContain('九十')
  })

  it('paints no kill affordance', () => {
    const output = renderPlain([{ id: 'bash-1', status: 'running', label: 'x' }])
    expect(output).not.toContain('杀')
    expect(output).not.toContain('Kill')
  })
})
