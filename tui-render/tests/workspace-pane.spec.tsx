/**
 * WorkspacePane: title `工作区`, tree glyphs `▸`/`▾`, selection prefix `› `,
 * mode footnotes per D-09, escaped names, and the resolve-failure copy pair
 * (`✗ 路径无效：{原因}` + `当前路径保持不变 · 可重试`).
 */

import { render, renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePane } from '../src/workspace-pane.tsx'
import type { WorkspacePaneState, WorkspacePreviewLayout } from '../src/workspace-pane.tsx'
import { displayWidth } from '../src/content.ts'
import { styled } from '../src/theme.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

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
function renderPlain(state: WorkspacePaneState, maxCols = 80, maxRows?: number): string {
  return stripAnsi(renderToString(createElement(WorkspacePane, { state, maxCols, maxRows }), { columns: maxCols }))
}

function previewState(lines: readonly string[], scrollOffset = 0, name = 'app.ts'): WorkspacePaneState {
  return openState({ preview: { path: `/workspace/${name}`, name, lines, scrollOffset } })
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

  it('paints a paged file preview with a line gutter and insert footnote', () => {
    const output = renderPlain(
      openState({
        preview: {
          path: '/workspace/README.md',
          name: 'README.md',
          lines: ['hello', 'world', 'third'],
          scrollOffset: 0,
        },
      }),
    )
    expect(output).toContain('预览: README.md')
    expect(output).toContain('1 │ hello')
    expect(output).toContain('2 │ world')
    expect(output).toContain('j/k 滚动 · q/Esc 返回 · i 插入路径')
    expect(output).not.toContain('Enter 打开')
  })

  it('pages the preview from scrollOffset', () => {
    const lines = Array.from({ length: 8 }, (_, index) => `LINE_${String(index)}`)
    const output = renderPlain(
      openState({
        preview: {
          path: '/workspace/notes.md',
          name: 'notes.md',
          lines,
          scrollOffset: 3,
        },
      }),
      80,
      5,
    )
    expect(output).toContain('LINE_3')
    expect(output).not.toContain('LINE_0')
    expect(output).toContain('4 │')
  })

  it('fills a physical page within a single long source line and resumes its continuation', () => {
    const lines = ['abcdefghijklmnopqrstuvwx', 'LAST']
    const first = renderPlain(previewState(lines), 12, 4)
    expect(first.split('\n').slice(1, -1)).toEqual(['  1 │ abcdef', '    │ ghijkl'])
    const second = renderPlain(previewState(lines, 2), 12, 4)
    expect(second.split('\n').slice(1, -1)).toEqual(['    │ mnopqr', '    │ stuvwx'])
    const last = renderPlain(previewState(lines, 4), 12, 4)
    expect(last.split('\n').slice(1, -1)).toEqual(['    │ stuvwx', '  2 │ LAST  '])
  })

  it('counts logical line numbers across exact wraps and blank lines', () => {
    const output = renderPlain(previewState(['abcdef', '', 'last']), 12, 5)
    expect(output.split('\n').slice(1, -1)).toEqual(['  1 │ abcdef', '  2 │       ', '  3 │ last  '])
  })

  it('clamps offsets at either end without a phantom line for an empty document', () => {
    expect(renderPlain(previewState(['first', 'last'], -10))).toContain('1 │ first')
    const end = renderPlain(previewState(['first', 'last'], 999))
    expect(end).toContain('2 │ last')
    expect(end).toContain('(1-2/2 行)')
    expect(end).toContain('1 │ first')
    const empty = renderPlain(previewState([], 10))
    expect(empty).toContain('(0-0/0 行)')
    expect(empty).not.toContain('│')
  })

  it('keeps source line ranges when the window starts inside a wrapped line', () => {
    const output = renderPlain(previewState(['x'.repeat(160), 'tail'], 1), 80, 4)
    expect(output).toContain('(1-1/2 行)')
    expect(output).not.toContain('tail')
    expect(output.split('\n').slice(1, -1).every(row => row.startsWith('    │ '))).toBe(true)
  })

  it.each([1, 2, 4, 8, 12, 20, 40])('bounds all preview rows at %i columns', (columns) => {
    const output = renderPlain(previewState(['中文👩‍💻é'.repeat(20)], 0, 'long-name-'.repeat(12)), columns, 5)
    expect(output.split('\n').length).toBeLessThanOrEqual(5)
    expect(output.split('\n').every(row => displayWidth(row) <= columns)).toBe(true)
  })

  it('retains CJK, joined emoji, and combining marks across wraps', () => {
    const output = renderPlain(previewState(['中👩‍💻é文']), 8, 6)
    expect(output.split('\n').slice(1, -1)).toEqual(['  1 │ 中', '    │ 👩‍💻', '    │ é ', '    │ 文'])
  })

  it('escapes content controls before measuring rows', () => {
    const output = renderPlain(previewState(['\t\x1b[2J\rX']), 8, 12)
    const body = output.split('\n').slice(1, -1).map(row => row.slice(6)).join('')
    expect(body).toBe('\\t\\x1b[2J\\rX')
    expect(output.split('\n').every(row => displayWidth(row) <= 8)).toBe(true)
  })

  it('keeps file names on one title row even when they contain newlines or tabs', () => {
    const output = renderPlain(previewState(['body'], 0, 'a\n\tb.ts'), 80, 3)
    expect(output.split('\n')).toHaveLength(3)
    expect(output).toContain('a\\n\\tb.ts')
  })

  it('retains every source character and indentation when syntax colors are applied', () => {
    const source = '  const greeting = "hello"; // comment'
    const output = renderPlain(previewState([source]), 80, 3)
    expect(output.split('\n')[1]).toBe(`  1 │ ${source}`.padEnd(80))
  })

  it.each([0, 1, 2, 3])('fits preview chrome and content into %i rows', (maxRows) => {
    const output = renderPlain(previewState(['body']), 80, maxRows)
    expect(output === '' ? 0 : output.split('\n').length).toBe(maxRows)
  })

  it('keeps gutter width stable across the 999/1000 line boundary', () => {
    const lines = Array.from({ length: 1001 }, (_, index) => String(index + 1))
    const output = renderPlain(previewState(lines, 998), 40, 5)
    expect(output.split('\n').slice(1, -1)).toEqual([
      ' 999 │ 999'.padEnd(40), '1000 │ 1000'.padEnd(40), '1001 │ 1001'.padEnd(40),
    ])
  })

  it('rewraps the same source after the preview column budget changes', () => {
    const state = previewState(['abcdefghijkl'])
    expect(renderPlain(state, 80, 4).split('\n').slice(1, -1)).toEqual(['  1 │ abcdefghijkl'.padEnd(80)])
    expect(renderPlain(state, 12, 4).split('\n').slice(1, -1)).toEqual(['  1 │ abcdef', '    │ ghijkl'])
  })

  it('preserves string and comment colors when a page starts within their tokens', () => {
    const renderPage = (source: string): string => renderToString(createElement(WorkspacePane, {
      state: previewState([source], 1), maxCols: 12, maxRows: 3,
    }), { columns: 12 })
    // Ink closes foreground spans with SGR 39 and merges the dim gutter with comments of the same color.
    expect(renderPage('"abcdefghijkl"')).toContain(styled('fghijk', 'codeString').replace(/\x1b\[0m$/u, '\x1b[39m'))
    expect(renderPage('//abcdefghijkl')).toContain(styled('    │ efghij', 'codeComment').replace(/\x1b\[0m$/u, '\x1b[39m'))
  })

  it.each([
    { lines: ['abcdefghijklmnopqrstuvwx', 'LAST'], columns: 12, rows: 4, pageRows: 2, maxOffset: 3 },
    { lines: ['abcdef', '', 'last'], columns: 12, rows: 4, pageRows: 2, maxOffset: 1 },
    { lines: ['中👩‍💻é文'], columns: 8, rows: 4, pageRows: 2, maxOffset: 2 },
    { lines: [], columns: 12, rows: 4, pageRows: 2, maxOffset: 0 },
    ...[0, 1, 2].map(rows => ({ lines: ['body'], columns: 12, rows, pageRows: 0, maxOffset: 0 })),
  ])('reports physical layout for $lines at $columns columns and $rows rows', ({ lines, columns, rows, pageRows, maxOffset }) => {
    const onPreviewLayout = vi.fn<(layout: WorkspacePreviewLayout) => void>()
    renderToString(createElement(WorkspacePane, {
      state: previewState(lines), maxCols: columns, maxRows: rows, onPreviewLayout,
    }), { columns })
    expect(onPreviewLayout).toHaveBeenCalledExactlyOnceWith({ lines, pageRows, maxOffset })
    expect(onPreviewLayout.mock.calls[0]?.[0].lines).toBe(lines)
  })

  it('reports layout changes and new document limits without reporting again for scrolling', async () => {
    const stdout = Object.assign(fakeTtyStdout(), { columns: 80, rows: 10 })
    const lines = ['abcdefghijklmnopqrstuvwx', 'LAST']
    const onPreviewLayout = vi.fn<(layout: WorkspacePreviewLayout) => void>()
    const element = (state: WorkspacePaneState, maxCols = 12, maxRows = 4) => createElement(WorkspacePane, {
      state, maxCols, maxRows, onPreviewLayout,
    })
    const instance = render(element(previewState(lines)), {
      stdout, stdin: fakeTtyStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      expect(onPreviewLayout).toHaveBeenCalledExactlyOnceWith({ lines, pageRows: 2, maxOffset: 3 })
      instance.rerender(element(previewState(lines, 1)))
      await instance.waitUntilRenderFlush()
      expect(onPreviewLayout).toHaveBeenCalledTimes(1)

      instance.rerender(element(previewState(lines, 1), 18, 4))
      await instance.waitUntilRenderFlush()
      expect(onPreviewLayout).toHaveBeenCalledTimes(2)
      expect(onPreviewLayout).toHaveBeenLastCalledWith({ lines, pageRows: 2, maxOffset: 1 })
      instance.rerender(element(previewState(lines, 1), 18, 5))
      await instance.waitUntilRenderFlush()
      expect(onPreviewLayout).toHaveBeenCalledTimes(3)
      expect(onPreviewLayout).toHaveBeenLastCalledWith({ lines, pageRows: 3, maxOffset: 0 })

      const replacement = [...lines]
      instance.rerender(element(previewState(replacement), 18, 5))
      await instance.waitUntilRenderFlush()
      expect(onPreviewLayout).toHaveBeenCalledTimes(4)
      expect(onPreviewLayout.mock.lastCall?.[0].lines).toBe(replacement)
      instance.rerender(element(openState(), 18, 5))
      await instance.waitUntilRenderFlush()
      expect(onPreviewLayout).toHaveBeenCalledTimes(4)
    } finally {
      instance.unmount()
    }
  })

  it('returns to the selected file tree when the controller closes the preview', () => {
    const state = openState({
      nodes: [{ path: '/workspace/app.ts', name: 'app.ts', depth: 0, kind: 'file', expanded: false }],
      preview: { path: '/workspace/app.ts', name: 'app.ts', lines: ['const n = 1'], scrollOffset: 0 },
    })
    expect(renderPlain(state)).toContain('i 插入路径')
    const tree = renderPlain({ ...state, preview: undefined })
    expect(tree).toContain('›   app.ts')
    expect(tree).toContain('Enter 打开')
    expect(tree).not.toContain('const n')
    expect(renderPlain({ ...state, open: false })).toBe('')
  })

})
