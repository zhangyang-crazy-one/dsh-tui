/**
 * Tests for {@link ../src/block-rows.ts}. Pure-data projector assertions:
 * row counts are exact, settled blocks return stable line references,
 * and the markdown projector delegates to the existing incremental
 * projector so the cache + scanner stay authoritative.
 */

import { describe, expect, it } from 'vitest'
import {
  type BlockRowsEntry,
  type BlockRowsScope,
  computeBlockRowsScopeKey,
  createMarkdownProjectorState,
  lineForText,
  mixedLine,
  projectBlockRows,
} from '../src/block-rows.ts'
import type { MarkdownRenderLine } from '../src/markdown-projector.ts'

function settledScope(overrides: Partial<BlockRowsScope> = {}): BlockRowsScope {
  return {
    width: 80,
    theme: 'truecolor',
    fold: { reasoning: false, tools: false },
    renderMode: 'settled',
    scopeKey: computeBlockRowsScopeKey(80, 'truecolor', { reasoning: false, tools: false }, 'settled'),
    ...overrides,
  }
}

function streamingScope(overrides: Partial<BlockRowsScope> = {}): BlockRowsScope {
  return settledScope({
    renderMode: 'streaming',
    scopeKey: computeBlockRowsScopeKey(80, 'truecolor', { reasoning: false, tools: false }, 'streaming'),
    ...overrides,
  })
}

describe('computeBlockRowsScopeKey', () => {
  it('changes on every input field so caches stay valid', () => {
    const baseline = computeBlockRowsScopeKey(80, 'truecolor', { reasoning: false, tools: false }, 'settled')
    expect(baseline).toBe('80|truecolor|r0|t0|settled')
    expect(computeBlockRowsScopeKey(120, 'truecolor', { reasoning: false, tools: false }, 'settled'))
      .not.toBe(baseline)
    expect(computeBlockRowsScopeKey(80, '256', { reasoning: false, tools: false }, 'settled'))
      .not.toBe(baseline)
    expect(computeBlockRowsScopeKey(80, 'truecolor', { reasoning: true, tools: false }, 'settled'))
      .not.toBe(baseline)
    expect(computeBlockRowsScopeKey(80, 'truecolor', { reasoning: false, tools: true }, 'settled'))
      .not.toBe(baseline)
    expect(computeBlockRowsScopeKey(80, 'truecolor', { reasoning: false, tools: false }, 'streaming'))
      .not.toBe(baseline)
  })
})

describe('lineForText / mixedLine', () => {
  it('produces display-width-correct lines from text', () => {
    const line = lineForText('● hello', 'accent', true, 0)
    expect(line.text).toBe('● hello')
    expect(line.displayWidth).toBe(7)
    expect(line.spans).toEqual([{ start: 0, end: 7, token: 'accent', bold: true }])
    expect(line.rowInBlock).toBe(0)
  })

  it('mixedLine concatenates segments with disjoint spans', () => {
    const line = mixedLine([
      { text: '产物 · ', token: 'fg', bold: false },
      { text: 'a.ts', token: 'fgDim', bold: false },
    ], 0)
    expect(line.text).toBe('产物 · a.ts')
    expect(line.displayWidth).toBeGreaterThan(0)
    expect(line.spans).toHaveLength(2)
  })
})

describe('projectBlockRows — non-markdown blocks', () => {
  it('emits exactly one dim row for a collapsed reasoning fold', () => {
    const entry: BlockRowsEntry = {
      id: 'r1',
      kind: 'reasoning',
      source: 'first line\nsecond',
      meta: {
        reasoningExpanded: false,
        reasoningDurationMs: 1234,
      },
    }
    const projection = projectBlockRows(entry, settledScope(), undefined)
    expect(projection.lines).toHaveLength(1)
    expect(projection.lines[0]?.text).toContain('▸ ✻ 思考 (1.2s)')
    expect(projection.lines[0]?.text).toContain('Ctrl+O 展开')
  })

  it('emits a header plus wrapped reasoning rows when expanded', () => {
    const entry: BlockRowsEntry = {
      id: 'r2',
      kind: 'reasoning',
      source: ['a'.repeat(120)].join(''),
      meta: {
        reasoningExpanded: true,
        reasoningDurationMs: 2500,
      },
    }
    const projection = projectBlockRows(entry, settledScope({ width: 40 }), undefined)
    expect(projection.lines.length).toBeGreaterThan(2)
    expect(projection.lines[0]?.text.startsWith('▾ ✻ 思考 (2.5s)')).toBe(true)
  })

  it('rendering a divider yields a single fg-dim row', () => {
    const entry: BlockRowsEntry = {
      id: 'd1',
      kind: 'divider',
      source: '──',
    }
    const projection = projectBlockRows(entry, settledScope(), undefined)
    expect(projection.lines).toHaveLength(1)
    expect(projection.lines[0]?.spans[0]?.token).toBe('fgDim')
  })

  it('tool-card collapsed keeps its summary on the heading row', () => {
    const entry: BlockRowsEntry = {
      id: 't1',
      kind: 'tool-card',
      source: '',
      meta: {
        toolCard: {
          name: 'bash',
          arguments: '{"command":"ls"}',
          status: 'ok',
          resultText: 'file.txt',
        },
      },
    }
    const collapsed = projectBlockRows(entry, settledScope({ fold: { reasoning: false, tools: false } }), undefined)
    expect(collapsed.lines).toHaveLength(1)
    expect(collapsed.lines[0]?.text).toBe('▸ bash · 完成 ls')
    const expanded = projectBlockRows(entry, settledScope({ fold: { reasoning: false, tools: true } }), undefined)
    expect(expanded.lines.length).toBeGreaterThanOrEqual(2)
  })

  it('tool-card projection preserves presenter titles and specialized result rows', () => {
    const entry: BlockRowsEntry = {
      id: 't-presented',
      kind: 'tool-card',
      source: '',
      meta: {
        toolCard: {
          name: 'read_file',
          arguments: '{"path":"artifact.txt"}',
          status: 'ok',
          callView: { card: 'generic', title: 'Read artifact.txt' },
          resultView: {
            card: 'read',
            title: 'Read artifact.txt',
            path: 'artifact.txt',
            offset: 0,
            lines: [{ number: 1, text: 'payload' }],
            totalLines: 1,
          },
        },
      },
    }
    const collapsed = projectBlockRows(
      entry,
      settledScope({ fold: { reasoning: false, tools: false } }),
      undefined,
    )
    expect(collapsed.lines.map(line => line.text)).toEqual([
      '▸ Read artifact.txt · 完成 artifact.txt',
    ])
    const expanded = projectBlockRows(
      entry,
      settledScope({ fold: { reasoning: false, tools: true } }),
      undefined,
    )
    expect(expanded.lines.map(line => line.text)).toEqual([
      '▾ Read artifact.txt · 完成',
      '  结果',
      '  1 payload',
    ])
  })

  it('turn-tail emits zero rows when nothing to show', () => {
    const projection = projectBlockRows({
      id: 'tt1',
      kind: 'turn-tail',
      source: '',
      meta: {},
    }, settledScope(), undefined)
    expect(projection.lines).toHaveLength(0)
  })

  it('turn-tail emits completion, product, and stats rows when present', () => {
    const projection = projectBlockRows({
      id: 'tt2',
      kind: 'turn-tail',
      source: '',
      meta: {
        turnTailCompletionBoundary: true,
        turnTailProduced: ['a.ts', 'b.ts'],
        turnTailStats: 'turn 1 · 12 tok · 200 ms',
      },
    }, settledScope(), undefined)
    expect(projection.lines.map(line => line.text)).toEqual([
      '── 已完成 ──',
      '产物 · a.ts · b.ts',
      'turn 1 · 12 tok · 200 ms',
    ])
  })

  it('compaction produces one collapsed row and two expanded', () => {
    const collapsed = projectBlockRows({
      id: 'c1',
      kind: 'compaction',
      source: '',
      meta: {
        compactionExpanded: false,
        compactionShadowedCount: 6,
        compactionSummary: '一段摘要',
      },
    }, settledScope(), undefined)
    expect(collapsed.lines).toHaveLength(1)
    const expanded = projectBlockRows({
      id: 'c2',
      kind: 'compaction',
      source: '',
      meta: {
        compactionExpanded: true,
        compactionShadowedCount: 6,
        compactionSummary: '一段摘要',
      },
    }, settledScope(), undefined)
    expect(expanded.lines).toHaveLength(2)
    expect(expanded.lines[1]?.text).toContain('一段摘要')
  })
})

describe('projectBlockRows — markdown via the projector delegate', () => {
  it('delegates to the renderer-owned projector state and returns projector lines', () => {
    const entry: BlockRowsEntry = {
      id: 'm1',
      kind: 'markdown',
      source: '# Title\n\nBody paragraph\n',
    }
    const state = createMarkdownProjectorState('m1', settledScope())
    const projection = projectBlockRows(entry, settledScope(), state)
    const texts = projection.lines.map(line => line.text)
    expect(texts.some(t => t.includes('Title'))).toBe(true)
    expect(texts.some(t => t.includes('Body paragraph'))).toBe(true)
  })

  it('returns stable line references across re-projection of unchanged markdown', () => {
    const entry: BlockRowsEntry = {
      id: 'm2',
      kind: 'markdown',
      source: 'alpha\nbravo\ncharlie\n',
    }
    const state = createMarkdownProjectorState('m2', settledScope())
    const first = projectBlockRows(entry, settledScope(), state)
    const second = projectBlockRows(entry, settledScope(), state)
    expect(second.lines).toHaveLength(first.lines.length)
    for (let i = 0; i < first.lines.length; i += 1) {
      expect(second.lines[i]).toBe(first.lines[i])
    }
  })

  it('incremental projection: appending a delta adds lines without recomputing stable prefix', () => {
    const state = createMarkdownProjectorState('m3', settledScope())
    const initial = projectBlockRows({
      id: 'm3',
      kind: 'markdown',
      source: 'first paragraph\n\n',
    }, settledScope(), state)
    const appended = projectBlockRows({
      id: 'm3',
      kind: 'markdown',
      source: 'first paragraph\n\nsecond paragraph\n\n',
    }, settledScope(), state)
    expect(appended.lines.length).toBeGreaterThan(initial.lines.length)
    expect(appended.lines[0]).toBe(initial.lines[0])
    const lastAppended = appended.lines[appended.lines.length - 1] as MarkdownRenderLine
    expect(lastAppended.text).toContain('second paragraph')
  })

  it('holds a growing active table out of repeated mdast parsing', () => {
    const scope = streamingScope()
    const state = createMarkdownProjectorState('table-stream', scope)
    let source = 'prefix\n\n| ID | Path |\n| --- | --- |\n'
    let projection = projectBlockRows({
      id: 'table-stream',
      kind: 'markdown',
      source,
    }, scope, state)
    for (let index = 1; index <= 100; index += 1) {
      source += `| ${String(index)} | /tmp/item-${String(index)}.md |\n`
      projection = projectBlockRows({
        id: 'table-stream',
        kind: 'markdown',
        source,
      }, scope, state)
    }
    expect(projection.lines.some(line => line.text.includes('item-100.md'))).toBe(true)
    expect(state.stats().parsedBytes).toBeLessThan(source.length * 2)
  })

  it('reuses committed table rows when the active source settles', () => {
    const streaming = streamingScope()
    const state = createMarkdownProjectorState('table-settle', streaming)
    const source = [
      '| ID | Path |',
      '| --- | --- |',
      ...Array.from({ length: 500 }, (_, index) => (
        `| ${String(index + 1)} | /tmp/item-${String(index + 1)}.md |`
      )),
      '',
    ].join('\n')
    const active = projectBlockRows({
      id: 'table-settle',
      kind: 'markdown',
      source,
    }, streaming, state)
    const settled = projectBlockRows({
      id: 'table-settle',
      kind: 'markdown',
      source,
    }, settledScope(), state)
    expect(settled.lines).toHaveLength(active.lines.length)
    expect(settled.lines[0]).toBe(active.lines[0])
    expect(settled.lines[250]).toBe(active.lines[250])
  })
})
