/**
 * Workflow compact HUD: `阶段 {title}` plus the current member row
 * `{seq} · {label} · {outcome}` while a run is live, nothing when no run is
 * live (S18). The outcome host key is omitted for an in-flight member (D-08).
 */

import { renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { WorkflowHud } from '../src/workflow-hud.tsx'
import type { WorkflowHudState } from '../src/workflow-hud.tsx'

/** Strip SGR/CSI sequences so content assertions read the painted text. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

/** Render the HUD to plain text (no SGR) for content assertions. */
function renderPlain(run: WorkflowHudState | undefined, maxCols = 80): string {
  return stripAnsi(renderToString(createElement(WorkflowHud, { run, maxCols })))
}

describe('WorkflowHud', () => {
  it('paints nothing when no run is live', () => {
    expect(renderPlain(undefined)).toBe('')
    expect(renderPlain({})).toBe('')
  })

  it('paints 阶段 plus the in-flight member without an outcome', () => {
    const output = renderPlain({
      phase: '设计',
      current: { seq: 2, label: '画草图' },
    })
    expect(output).toContain('阶段 设计')
    expect(output).toContain('2 · 画草图')
    expect(output).not.toContain('completed')
  })

  it('paints the settled member with its host outcome key', () => {
    const output = renderPlain({
      current: { seq: 1, label: '侦察', outcome: 'completed' },
    })
    expect(output).toContain('1 · 侦察 · completed')
  })

  it('paints the phase row alone when the run has no members yet', () => {
    const output = renderPlain({ phase: '启动' })
    expect(output).toContain('阶段 启动')
  })

  it('escapes CSI in the phase title instead of passing it through', () => {
    const output = renderPlain({ phase: '清屏\x1b[2J' })
    expect(output).toContain('清屏\\x1b[2J')
  })
})
