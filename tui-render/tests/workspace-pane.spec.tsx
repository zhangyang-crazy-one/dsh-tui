/**
 * WorkspacePane: title `工作区`, tree glyphs `▸`/`▾`, selection prefix `› `,
 * mode footnotes per D-09, escaped names, and the resolve-failure copy pair
 * (`✗ 路径无效：{原因}` + `当前路径保持不变 · 可重试`).
 */

import { renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { WorkspacePane } from '../src/workspace-pane.tsx'
import type { WorkspacePaneState } from '../src/workspace-pane.tsx'

/** Strip SGR/CSI sequences so content assertions read the painted text. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

/** A browse-mode open state with the given overrides. */
function openState(overrides: Partial<WorkspacePaneState> = {}): WorkspacePaneState {
  return {
    open: true,
    root: '/workspace',
    nodes: [],
    selectedIndex: 0,
    editing: false,
    ...overrides,
  }
}

/** Render the pane to plain text (no SGR) for content assertions. */
function renderPlain(state: WorkspacePaneState, maxCols = 80): string {
  return stripAnsi(renderToString(createElement(WorkspacePane, { state, maxCols })))
}

describe('WorkspacePane', () => {
  it('paints nothing when closed', () => {
    expect(renderPlain({ ...openState(), open: false })).toBe('')
  })

  it('paints the S19 opener error when fs is not composed', () => {
    const output = renderPlain(openState({ error: '文件系统未组合' }))
    expect(output).toContain('工作区')
    expect(output).toContain('✗ 文件系统未组合')
    expect(output).toContain('Esc 关闭')
  })

  it('paints the empty-directory copy with the e path next step', () => {
    const output = renderPlain(openState())
    expect(output).toContain('此目录为空')
    expect(output).toContain('e 输入路径 · Esc 关闭')
  })

  it('paints tree rows with directory glyphs and the selection prefix', () => {
    const output = renderPlain(
      openState({
        nodes: [
          { path: '/workspace/src', name: 'src', depth: 0, kind: 'directory', expanded: true },
          { path: '/workspace/src/app.ts', name: 'app.ts', depth: 1, kind: 'file', expanded: false },
          { path: '/workspace/docs', name: 'docs', depth: 0, kind: 'directory', expanded: false },
        ],
        selectedIndex: 0,
      }),
    )
    expect(output).toContain('› ▾ src')
    expect(output).toContain('app.ts')
    expect(output).toContain('▸ docs')
    expect(output).toContain('j/k 选择 · Enter 打开 · e 路径 · Esc 关闭')
  })

  it('switches the footnote while the path draft is editing', () => {
    const output = renderPlain(openState({ editing: true }))
    expect(output).toContain('Enter 解析 · Esc 取消')
    expect(output).not.toContain('j/k 选择')
  })

  it('paints the resolve failure pair and keeps the browse copy', () => {
    const output = renderPlain(openState({ resolveError: 'FS_NOT_FOUND' }))
    expect(output).toContain('✗ 路径无效：FS_NOT_FOUND')
    expect(output).toContain('当前路径保持不变 · 可重试')
  })

  it('escapes CSI in a filename instead of passing it through', () => {
    const output = renderPlain(
      openState({
        nodes: [
          { path: '/workspace/x', name: '清屏\x1b[2J', depth: 0, kind: 'file', expanded: false },
        ],
      }),
    )
    expect(output).toContain('清屏\\x1b[2J')
  })

  it('never paints 应用 in the browse footnote', () => {
    const output = renderPlain(
      openState({
        nodes: [
          { path: '/workspace/x', name: 'x', depth: 0, kind: 'file', expanded: false },
        ],
      }),
    )
    expect(output).not.toContain('应用')
  })
})
