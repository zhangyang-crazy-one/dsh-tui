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
  messageGapLines,
  messageSeparatorLine,
  mixedLine,
  projectBlockRows,
  turnPartGap,
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
  it('projects user copy on a full-width message surface with separate marker contrast', () => {
    const projection = projectBlockRows({
      id: 'u1',
      kind: 'user',
      source: 'hello',
    }, settledScope({ width: 40 }), undefined)
    expect(projection.lines).toHaveLength(1)
    expect(projection.lines[0]).toMatchObject({
      text: '> hello',
      background: 'messageBg',
      backgroundColumns: 40,
    })
    expect(projection.lines[0]?.spans.map(span => span.token)).toEqual([
      'fgDim',
      'fgSoft',
    ])
  })

  it('emits no rows for hidden reasoning', () => {
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
    expect(projection.lines).toEqual([])
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
    expect(collapsed.lines[0]?.text).toBe('▸ bash · ✓ ls')
    expect(collapsed.lines[0]?.spans.find(s => collapsed.lines[0]?.text.slice(s.start, s.end) === '✓')?.token).toBe('fgDim')
    expect(collapsed.lines[0]).toMatchObject({
      background: 'toolBg',
      backgroundColumns: 80,
    })
    const expanded = projectBlockRows(entry, settledScope({ fold: { reasoning: false, tools: true } }), undefined)
    expect(expanded.lines.length).toBeGreaterThanOrEqual(2)

    const oversizeEntry: BlockRowsEntry = {
      id: 't-oversize',
      kind: 'tool-card',
      source: '',
      meta: {
        toolCard: {
          name: 'bash',
          arguments: '{"command":"cat big.log"}',
          status: 'ok',
          resultText: Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join('\n'),
        },
      },
    }
    const oversize = projectBlockRows(oversizeEntry, settledScope({ fold: { reasoning: false, tools: true } }), undefined)
    expect(oversize.lines).toHaveLength(8)
    expect(oversize.lines.at(-1)?.text).toContain('/tools 详情 · 597 剩余源行')
  })

  it('projects explicit failure details and a full-width tool summary card', () => {
    const failed = projectBlockRows({
      id: 'failed-tool',
      kind: 'tool-card',
      source: '',
      meta: {
        toolCard: {
          name: 'bash',
          arguments: '{"command":"pnpm test"}',
          status: 'error',
          resultText: 'setup\n2 tests failed',
          error: { name: 'ToolError', code: 'TEST_FAILED' },
        },
      },
    }, settledScope(), undefined)
    expect(failed.lines[0]?.text).toBe('▸ bash · 失败 TEST_FAILED · 2 tests failed')

    const summary = projectBlockRows({
      id: 'tool-summary',
      kind: 'tool-summary',
      source: '▸ 工具记录 · 已收起 7 个 · 失败 2 · Ctrl+E 展开',
      meta: { toolSummaryStatus: 'error' },
    }, settledScope({ width: 40 }), undefined)
    expect(summary.lines).toHaveLength(1)
    expect(summary.lines[0]).toMatchObject({
      text: '▸ 工具记录 · 已收起 7 个 · 失败 2 · Ctrl+E 展开',
      background: 'toolBg',
      backgroundColumns: 40,
    })
    expect(summary.lines[0]?.spans[0]?.token).toBe('error')
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
      '▸ Read artifact.txt · ✓ artifact.txt',
    ])
    const expanded = projectBlockRows(
      entry,
      settledScope({ fold: { reasoning: false, tools: true } }),
      undefined,
    )
    expect(expanded.lines.map(line => line.text)).toEqual([
      '▾ Read artifact.txt · ✓',
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
      '产物 · a.ts · b.ts',
      'turn 1 · 12 tok · 200 ms',
      '── 已完成 ──',
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
    for (const source of ['# Title\n\nBody paragraph', '# Title\n\nBody paragraph\n']) {
      const entry: BlockRowsEntry = {
        id: `m1-${String(source.length)}`,
        kind: 'markdown',
        source,
      }
      const state = createMarkdownProjectorState(entry.id, settledScope())
      const projection = projectBlockRows(entry, settledScope(), state)
      const texts = projection.lines.map(line => line.text)
      const titleIndex = texts.findIndex(text => text.includes('Title'))
      const bodyIndex = texts.findIndex(text => text.includes('Body paragraph'))
      expect(titleIndex).toBeGreaterThanOrEqual(0)
      expect(bodyIndex - titleIndex).toBe(2)
      expect(texts[bodyIndex - 1]).toBe(' ')
    }
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

describe('module spacing and separator lines (Task 6)', () => {
  it('paints the message-gap separator with line across the conversation width, including widths below 40', () => {
    const wide = messageSeparatorLine(80)
    expect(wide.text).toBe('─'.repeat(80))
    expect(wide.displayWidth).toBe(80)
    expect(wide.spans).toEqual([{ start: 0, end: 80, token: 'line', bold: false }])
    expect(wide.background).toBeUndefined()

    const narrow = messageSeparatorLine(32)
    expect(narrow.text).toBe('─'.repeat(32))
    expect(narrow.displayWidth).toBe(32)
    expect(narrow.spans).toEqual([{ start: 0, end: 32, token: 'line', bold: false }])
    expect(narrow.background).toBeUndefined()
  })

  it('messageGapLines returns exactly two rows: line separator followed by a blank row', () => {
    const gap = messageGapLines(50, 2)
    expect(gap).toHaveLength(2)
    expect(gap[0]?.text).toBe('─'.repeat(50))
    expect(gap[0]?.displayWidth).toBe(50)
    expect(gap[0]?.spans[0]?.token).toBe('line')
    expect(gap[0]?.rowInBlock).toBe(2)
    expect(gap[1]?.text).toBe(' ')
    expect(gap[1]?.rowInBlock).toBe(3)
  })

  it('projects user message with userMessageGap into user row, line separator, and blank spacer', () => {
    const entry: BlockRowsEntry = {
      id: 'u-gap',
      kind: 'user',
      source: 'ping',
      meta: { userMessageGap: true },
    }
    const projection = projectBlockRows(entry, settledScope({ width: 40 }), undefined)
    expect(projection.lines).toHaveLength(3)
    // Row 0: user message on messageBg
    expect(projection.lines[0]).toMatchObject({
      text: '> ping',
      background: 'messageBg',
      backgroundColumns: 40,
    })
    // Row 1: line separator on frame bg (no messageBg)
    expect(projection.lines[1]).toMatchObject({
      text: '─'.repeat(40),
      displayWidth: 40,
    })
    expect(projection.lines[1]?.background).toBeUndefined()
    expect(projection.lines[1]?.spans[0]?.token).toBe('line')
    // Row 2: blank spacer
    expect(projection.lines[2]?.text).toBe(' ')
    expect(projection.lines[2]?.background).toBeUndefined()
  })

  it('turnPartGap keeps adjacent tool cards gapless and enforces 1 blank row between other modules', () => {
    // Start of turn: 0 rows
    expect(turnPartGap(undefined, 'reasoning')).toBe(0)
    expect(turnPartGap(undefined, 'card')).toBe(0)
    expect(turnPartGap(undefined, 'text')).toBe(0)

    // Adjacent tool cards/summary: 0 rows (gapless)
    expect(turnPartGap('card', 'card')).toBe(0)
    expect(turnPartGap('card', 'tool-summary')).toBe(0)
    expect(turnPartGap('tool-summary', 'card')).toBe(0)
    expect(turnPartGap('tool-summary', 'tool-summary')).toBe(0)

    // Inter-module boundaries: 1 blank row
    expect(turnPartGap('reasoning', 'card')).toBe(1)
    expect(turnPartGap('reasoning', 'tool-summary')).toBe(1)
    expect(turnPartGap('card', 'text')).toBe(1)
    expect(turnPartGap('tool-summary', 'text')).toBe(1)
    expect(turnPartGap('text', 'reasoning')).toBe(1)
    expect(turnPartGap('reasoning', 'text')).toBe(1)
  })

  it('projectDividerEntry emits a full-width line separator when source is empty or dash', () => {
    const emptyDivider = projectBlockRows({
      id: 'd-empty',
      kind: 'divider',
      source: '',
    }, settledScope({ width: 60 }), undefined)
    expect(emptyDivider.lines).toHaveLength(1)
    expect(emptyDivider.lines[0]?.text).toBe('─'.repeat(60))
    expect(emptyDivider.lines[0]?.spans[0]?.token).toBe('line')

    const dashDivider = projectBlockRows({
      id: 'd-dash',
      kind: 'divider',
      source: '─',
    }, settledScope({ width: 35 }), undefined)
    expect(dashDivider.lines).toHaveLength(1)
    expect(dashDivider.lines[0]?.text).toBe('─'.repeat(35))
    expect(dashDivider.lines[0]?.spans[0]?.token).toBe('line')
  })
})
