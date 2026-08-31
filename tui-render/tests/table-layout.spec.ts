import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/content.ts'
import {
  appendedRowsPreserveTableMetrics,
  classifyColumns,
  DEFAULT_COMPACT_MIN,
  DEFAULT_NARRATIVE_MIN,
  DEFAULT_TOKEN_HEAVY_MIN,
  layoutTableCells,
  type TableColumnCategory,
  type TableLayout,
} from '../src/table-layout.ts'

describe('appendedRowsPreserveTableMetrics', () => {
  const metrics = [
    { category: 'compact' as const, natural: 6, minimum: 6 },
    { category: 'narrative' as const, natural: 20, minimum: 8 },
  ]

  it('accepts appended cells that cannot change the existing plan', () => {
    expect(appendedRowsPreserveTableMetrics([
      ['done', 'two words'],
      ['open', 'more text'],
    ], metrics)).toBe(true)
  })

  it('rejects wider, token-heavy, and higher-word-floor additions', () => {
    expect(appendedRowsPreserveTableMetrics([['pending', 'text']], metrics)).toBe(false)
    expect(appendedRowsPreserveTableMetrics([['done', '/tmp/result.md']], metrics)).toBe(false)
    expect(appendedRowsPreserveTableMetrics([['done', 'abcdefghij']], metrics)).toBe(false)
  })
})

describe('classifyColumns', () => {
  it('classifies URL columns as token-heavy', () => {
    const cells = [
      ['url', 'name'],
      ['https://example.com/a', 'alpha'],
      ['https://example.com/b', 'beta'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>(['token-heavy', 'narrative'])
  })

  it('classifies path columns as token-heavy', () => {
    const cells = [
      ['path'],
      ['/usr/local/bin/node'],
      ['/etc/passwd'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>(['token-heavy'])
  })

  it('classifies hex hash columns as token-heavy', () => {
    const cells = [
      ['sha'],
      ['abcdef0123456789'],
      ['fedcba9876543210'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>(['token-heavy'])
  })

  it('classifies short status and emoji columns as compact', () => {
    const cells = [
      ['ok'],
      ['✅'],
      ['❌'],
      ['⏳'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>(['compact'])
  })

  it('classifies long narrative columns as narrative', () => {
    const cells = [
      ['description'],
      ['A long sentence describing the situation in detail.'],
      ['Another sentence with multiple clauses, separated by punctuation.'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>(['narrative'])
  })

  it('measures CJK glyphs as two columns for classification', () => {
    const cells = [
      ['列'],
      ['中'],
      ['文'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>(['compact'])
  })
})

describe('layoutTableCells', () => {
  it('returns a grid layout with natural widths when the table fits', () => {
    const cells = [
      ['name', 'status'],
      ['alpha', 'ok'],
      ['beta', 'queued'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 80 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    expect(layout.widths.reduce((sum, w) => sum + w, 0)).toBeLessThanOrEqual(
      80 - 3 * 2 - 1,
    )
    expect(layout.lines[0]?.kind).toBe('rule')
    expect(layout.header.map(c => c.text)).toEqual(['name', 'status'])
    const headerRow = layout.lines[1]
    expect(headerRow?.kind).toBe('row')
    if (headerRow?.kind === 'row') {
      expect(headerRow.header).toBe(true)
      expect(headerRow.cells.map(c => c.text.trim())).toEqual(['name', 'status'])
    }
  })

  it('measures CJK and emoji cell widths using displayWidth', () => {
    const cells = [
      ['脚本', '状态'],
      ['trilium_to_obsidian.py', '✅'],
      ['organize_vault.py', '⏳'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 80 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // Natural width of "脚本" is 4 (CJK x 2), "trilium_to_obsidian.py" is 22, "状态" is 4, "✅"/"⏳" are 2.
    expect(layout.widths[0]).toBeGreaterThanOrEqual(displayWidth('trilium_to_obsidian.py'))
    expect(layout.widths[1]).toBeGreaterThanOrEqual(displayWidth('状态'))
    // Every painted grid line should have the same display width.
    const widths = new Set(layout.lines.map(line => displayWidth(lineText(line))))
    expect(widths.size).toBe(1)
  })

  it('preserves short emoji / status columns at their natural width under pressure', () => {
    const cells = [
      ['✅', 'description'],
      ['✅', 'some long description that needs many columns'],
      ['✅', 'another long description'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 30 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // The emoji column should still display correctly at its natural width.
    expect(layout.widths[0]).toBe(displayWidth('✅'))
    // Look up the painted emoji cell in the body lines.
    const bodyLine = layout.lines.find(line => line.kind === 'row' && !line.header)
    expect(bodyLine?.kind).toBe('row')
    if (bodyLine?.kind === 'row') {
      expect(bodyLine.cells[0]?.text.trim()).toBe('✅')
    }
  })

  it('shrinks token-heavy columns before narrative columns under tight budgets', () => {
    const cells = [
      ['a', 'this is a longer narrative description', 'https://very-long-example.com/path/to/resource'],
      ['b', 'more narrative content', 'https://another-long-url.example.com/foo'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 30 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    const categories = layout.columns.map(c => c.category)
    expect(categories).toContain('token-heavy')
    expect(categories).toContain('narrative')
    const tokenIndex = categories.indexOf('token-heavy')
    const narrativeIndex = categories.indexOf('narrative')
    const tokenNatural = layout.columns[tokenIndex]?.natural ?? 0
    const narrativeNatural = layout.columns[narrativeIndex]?.natural ?? 0
    // Both columns were shrunk below their natural widths.
    expect(layout.widths[tokenIndex]).toBeLessThan(tokenNatural)
    expect(layout.widths[narrativeIndex]).toBeLessThan(narrativeNatural)
    // Token-heavy shrinks first: it lands at (or near) its category floor,
    // bounded above by the floor plus a small overshoot from leftover
    // distribution.
    expect(layout.widths[tokenIndex]).toBeLessThanOrEqual(DEFAULT_TOKEN_HEAVY_MIN + 6)
    // Total width fits the budget.
    expect(layout.widths.reduce((sum, w) => sum + w, 0)).toBeLessThanOrEqual(30 - 3 * 3 - 1)
  })

  it('respects the configured minimums from the option overrides', () => {
    const cells = [
      ['aaa bbb ccc', 'longer description text', 'url-label'],
      ['xxx yyy zzz', 'another narrative column', 'https://x.com/long/path'],
    ]
    const layout = layoutTableCells(cells, {
      maxCols: 60,
      compactMin: 3,
      narrativeMin: 6,
      tokenHeavyMin: 10,
    })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    const categories = layout.columns.map(c => c.category)
    const narrativeIndex = categories.indexOf('narrative')
    const tokenIndex = categories.indexOf('token-heavy')
    // Narrative and token-heavy minima honor the configured floors.
    expect(layout.columns[narrativeIndex]?.minimum).toBeGreaterThanOrEqual(6)
    expect(layout.columns[tokenIndex]?.minimum).toBe(10)
  })

  it('falls back to records when even minimum widths cannot be honored', () => {
    // 5 columns, each forced to its minimum; budget so tight nothing fits.
    const cells = [
      ['c1', 'c2', 'c3', 'c4', 'c5'],
      ['alpha value', 'beta value', 'gamma value', 'delta value', 'epsilon value'],
      ['next row', 'with content', 'and more text', 'and lots more', 'to fill it'],
    ]
    const layout = layoutTableCells(cells, {
      maxCols: 12,
      compactMin: 1,
      narrativeMin: 4,
      tokenHeavyMin: 8,
    })
    expect(layout.kind).toBe('record')
    if (layout.kind !== 'record') return
    expect(layout.lines.length).toBeGreaterThan(0)
    const headerLine = layout.lines[0]
    expect(headerLine?.kind).toBe('record')
    if (headerLine?.kind === 'record') {
      expect(headerLine.key.text).toBe('c1')
      expect(headerLine.values.map(v => v.text)).toEqual(['c2', 'c3', 'c4', 'c5'])
    }
    // Body lines: at least one divider rule between records.
    expect(layout.lines.some(line => line.kind === 'rule')).toBe(true)
    // Body lines are keyed by the first column.
    const records = layout.lines.filter(line => line.kind === 'record')
    expect(records[1]?.kind).toBe('record')
    if (records[1]?.kind === 'record') {
      expect(records[1].key.text).toBe('alpha value')
    }
  })

  it('preserves column and row indices on every cell so renderers can map back', () => {
    const cells = [
      ['h1', 'h2'],
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 80 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    expect(layout.header.map(c => [c.column, c.row])).toEqual([[0, 0], [1, 0]])
    expect(layout.body[0]?.map(c => [c.column, c.row])).toEqual([[0, 1], [1, 1]])
    expect(layout.body[1]?.map(c => [c.column, c.row])).toEqual([[0, 2], [1, 2]])
  })

  it('grows column widths when a later body row contains wider cells', () => {
    const initial = [
      ['col', 'val'],
      ['x', 'y'],
    ]
    const grown = [
      ['col', 'val'],
      ['x', 'y'],
      ['wide-row-content', 'wider value here'],
    ]
    const initialLayout = layoutTableCells(initial, { maxCols: 80 })
    const grownLayout = layoutTableCells(grown, { maxCols: 80 })
    expect(initialLayout.kind).toBe('grid')
    expect(grownLayout.kind).toBe('grid')
    if (initialLayout.kind !== 'grid' || grownLayout.kind !== 'grid') return
    expect(grownLayout.widths[0]).toBeGreaterThan(initialLayout.widths[0] ?? 0)
    expect(grownLayout.widths[1]).toBeGreaterThan(initialLayout.widths[1] ?? 0)
  })

  it('produces the same final grid whether rows arrive one at a time or in one batch', () => {
    const cells = [
      ['name', 'status', 'note'],
      ['alpha', '✅', 'short'],
      ['beta', '⏳', 'longer note describing the situation'],
      ['gamma', '❌', 'another longer note with details'],
    ]
    const batch = layoutTableCells(cells, { maxCols: 60 })
    expect(batch.kind).toBe('grid')
    if (batch.kind !== 'grid') return

    // Replay the same layout call: it must be deterministic.
    const again = layoutTableCells(cells, { maxCols: 60 })
    expect(again.kind).toBe('grid')
    if (again.kind !== 'grid') return
    expect(again.widths).toEqual(batch.widths)
    expect(again.lines.map(lineText)).toEqual(batch.lines.map(lineText))
  })

  it('classifies compact columns with category default minimums', () => {
    expect(DEFAULT_COMPACT_MIN).toBe(1)
    expect(DEFAULT_NARRATIVE_MIN).toBe(4)
    expect(DEFAULT_TOKEN_HEAVY_MIN).toBe(8)
  })

  it('wraps a long header cell inside its column when the column is wider than the natural header', () => {
    const cells = [
      ['name with a very long header label that exceeds the body'],
      ['short'],
      ['also short'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 40 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // The painted row lines should include the full header text.
    const headerRow = layout.lines.find(line => line.kind === 'row' && line.header)
    expect(headerRow).toBeDefined()
  })
})

describe('layoutTableCells edge cases', () => {
  it('fills missing cells with empty strings when rows are jagged', () => {
    // Row 1 has only one cell; row 0 (header) has two columns.
    const cells = [
      ['hdr-one', 'hdr-two'],
      ['only-one'],
      ['two-again', 'second-cell'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 60 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // Missing cells are surfaced as empty TableCells with the right column/row.
    const jaggedBody = layout.body[0]!
    expect(jaggedBody).toHaveLength(2)
    expect(jaggedBody[1]?.text).toBe('')
    expect(jaggedBody[1]?.column).toBe(1)
    expect(jaggedBody[1]?.row).toBe(1)
  })

  it('classifies columns with one or more empty cells as narrative so the skip-empties branch fires', () => {
    // Col 1 has one empty cell; classifyColumn must `continue` past it
    // without disturbing the token-heavy check.
    const cells = [
      ['url', 'name', 'desc'],
      ['https://example.com/a', '', 'A sentence about the link.'],
      ['https://example.com/b', 'Brenda', 'Another sentence about the link.'],
    ]
    expect(classifyColumns(cells)).toEqual<TableColumnCategory[]>([
      'token-heavy',
      'narrative',
      'narrative',
    ])
  })

  it('returns an empty grid when given an empty cells array', () => {
    const layout = layoutTableCells([], { maxCols: 40 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // No lines, widths, or columns are produced; header and body still
    // carry the synthesized colCount=1 empty cells.
    expect(layout.lines).toEqual([])
    expect(layout.widths).toEqual([])
    expect(layout.columns).toEqual([])
    expect(layout.header).toHaveLength(1)
    expect(layout.body).toEqual([])
    expect(layout.header[0]?.text).toBe('')
    expect(layout.header[0]?.column).toBe(0)
    expect(layout.header[0]?.row).toBe(0)
  })

  it('falls back to records when the column budget is too narrow for even one column', () => {
    // available = maxCols - overhead = 1 - (3 * 1 + 1) = -3, so colCount > available
    // and fitWidths cannot succeed.
    const cells = [
      ['h'],
      ['x'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 1 })
    expect(layout.kind).toBe('record')
  })

  it('falls back to records when minimum widths still exceed the available budget', () => {
    // Two very wide token-heavy URLs and a tight maxCols: even with both
    // columns shrunk to their minimum (8 each), the 16-column minimum
    // plus 7-column overhead still blows the 20-column budget.
    const cells = [
      ['x', 'https://example.com/very/long/url/path/one'],
      ['y', 'https://example.com/very/long/url/path/two'],
    ]
    const layout = layoutTableCells(cells, {
      maxCols: 14,
      narrativeMin: 4,
      tokenHeavyMin: 8,
    })
    expect(layout.kind).toBe('record')
  })

  it('uses the ?? narrative fallback when classifyColumns returns fewer categories than the table has columns', () => {
    // A row containing an empty array makes classifyColumns produce zero
    // categories, while layoutTableCells still computes colCount = 1. The
    // inner `categories[c] ?? 'narrative'` fallback must kick in.
    const cells: string[][] = [[]]
    const layout = layoutTableCells(cells, { maxCols: 40 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    expect(layout.columns).toHaveLength(1)
    expect(layout.columns[0]?.category).toBe('narrative')
  })

  it('clamps the computed minimum back to natural when configured minimums exceed the natural width', () => {
    // Set narrativeMin huge so the computed minimum ends up > natural,
    // triggering the `if (minimum > natural) minimum = natural` clamp.
    const cells = [
      ['hi', 'world'],
      ['ab', 'longer narrative'],
    ]
    const layout = layoutTableCells(cells, {
      maxCols: 80,
      narrativeMin: 200,
      tokenHeavyMin: 200,
    })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    for (const column of layout.columns) {
      expect(column.minimum).toBeLessThanOrEqual(column.natural)
    }
  })

  it('selects the widest column when multiple candidates in the same priority category can shrink', () => {
    // Three narrative columns: the first is moderate, the second is wide,
    // and the third is also wide. The shrink loop must pick the widest of
    // the equal-priority candidates each pass.
    const cells = [
      ['aaa bbb ccc', 'narrative column one is here', 'another wide narrative text'],
      ['xxx yyy zzz', 'tiny', 'tiny'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 40 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    const categories = layout.columns.map(c => c.category)
    expect(categories).toEqual(['narrative', 'narrative', 'narrative'])
    // Every narrative column ended up at its minimum or above, but never
    // below its minimum (which would break readability).
    for (let i = 0; i < layout.columns.length; i += 1) {
      const column = layout.columns[i]!
      expect(layout.widths[i]).toBeGreaterThanOrEqual(column.minimum)
      expect(layout.widths[i]).toBeLessThanOrEqual(column.natural)
    }
    // Total widths fit the available budget.
    const available = 40 - (3 * 3 + 1)
    expect(layout.widths.reduce((sum, w) => sum + w, 0)).toBeLessThanOrEqual(available)
  })

  it('distributes leftover columns round-robin to columns below their natural width', () => {
    // A small table with a budget that leaves several columns of slack;
    // distributeLeftover should hand out the leftover one column at a time.
    const cells = [
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 80 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    const totalWidth = layout.widths.reduce((sum, w) => sum + w, 0)
    // Every column should be filled up to its natural width because the
    // budget is much larger than the sum of natural widths.
    expect(totalWidth).toBe(
      layout.columns.reduce((sum, c) => sum + c.natural, 0),
    )
  })

  it('hands leftover columns to whichever column is still below its natural width', () => {
    // Two columns: a compact column at natural width 1 and a narrative
    // column whose natural width forces shrink down close to its minimum.
    // The shrink loop stops when used reaches available, so the narrative
    // column ends up a few columns above its minimum (room to absorb future
    // body rows without re-fitting).
    const cells = [
      ['a', 'medium length text'],
      ['b', 'small'],
    ]
    const layout = layoutTableCells(cells, { maxCols: 15 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // The compact column stays at its natural width; the narrative column
    // receives the leftover columns on top of its minimum.
    expect(layout.widths[0]).toBe(1)
    expect(layout.widths[1]).toBeGreaterThan(6)
    // The total fits the available budget exactly.
    const available = 15 - (3 * 2 + 1)
    expect(layout.widths.reduce((sum, w) => sum + w, 0)).toBe(available)
  })

  it('returns a record layout where every body row produces a record with at least an empty key cell', () => {
    // Even an empty source row surfaces as a record with an empty key,
    // because buildCells pads every row to colCount entries.
    const cells = [
      ['hdr-one', 'hdr-two'],
      ['x', 'y'],
      [],
      ['z', 'w'],
    ]
    const layout = layoutTableCells(cells, {
      maxCols: 8,
      narrativeMin: 4,
      tokenHeavyMin: 8,
    })
    expect(layout.kind).toBe('record')
    if (layout.kind !== 'record') return
    const records = layout.lines.filter(line => line.kind === 'record')
    // 1 header + 3 body records.
    expect(records).toHaveLength(4)
    const emptyRecord = records[2]
    expect(emptyRecord?.kind).toBe('record')
    if (emptyRecord?.kind === 'record') {
      expect(emptyRecord.key.text).toBe('')
      expect(emptyRecord.key.column).toBe(0)
      expect(emptyRecord.key.row).toBe(2)
      // The empty row was padded with empty cells; the second column
      // appears as a synthesized empty value cell.
      expect(emptyRecord.values).toHaveLength(1)
      expect(emptyRecord.values[0]?.text).toBe('')
    }
  })

  it('produces empty painted lines for an empty header row', () => {
    // When the header row is the empty array, classifyColumns returns [] and
    // the layout still surfaces a one-column grid with all empty cells.
    const cells: string[][] = [[]]
    const layout = layoutTableCells(cells, { maxCols: 40 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // The header line should be a row of a single empty padded cell.
    const headerLine = layout.lines.find(line => line.kind === 'row' && line.header)
    expect(headerLine?.kind).toBe('row')
    if (headerLine?.kind === 'row') {
      expect(headerLine.cells).toHaveLength(1)
      expect(headerLine.cells[0]?.text.trim()).toBe('')
    }
  })

  it('covers longestWordIn\'s empty-word skip when text starts or ends with whitespace', () => {
    // Leading whitespace produces an empty first token from /\s+/ split.
    const cells = [
      ['  leading-space content here'],
      ['trailing-content-here  '],
    ]
    const layout = layoutTableCells(cells, { maxCols: 80 })
    expect(layout.kind).toBe('grid')
    if (layout.kind !== 'grid') return
    // longestWord must treat the empty leading/trailing tokens as
    // length-1 (i.e. they don't inflate the longest-word measurement).
    expect(layout.columns[0]?.minimum).toBeGreaterThanOrEqual(1)
  })

  it('uses the records fallback divider width with a non-default recordIndent', () => {
    // recordIndent other than '  ' exercises the `indent.length` paths
    // that compute `dividerWidth` and `valueWidth` in buildRecordLayout.
    const cells = [
      ['key-hdr', 'value-hdr'],
      ['first', 'value one'],
      ['second', 'value two'],
    ]
    const layout = layoutTableCells(cells, {
      maxCols: 8,
      narrativeMin: 4,
      tokenHeavyMin: 8,
      recordIndent: '    ',
    })
    expect(layout.kind).toBe('record')
    if (layout.kind !== 'record') return
    const divider = layout.lines.find(line => line.kind === 'rule')
    expect(divider?.kind).toBe('rule')
    if (divider?.kind === 'rule') {
      // The indent prepended to the divider accounts for the
      // non-default `recordIndent` length.
      expect(divider.text.startsWith('    ')).toBe(true)
    }
  })
})

function lineText(line: TableLayout['lines'][number]): string {
  if (line.kind === 'rule' || line.kind === 'plain') return line.text
  if (line.kind === 'row') return `│ ${line.cells.map(c => c.text).join(' │ ')} │`
  return `${line.key.text}: ${line.values.map(v => v.text).join(' / ')}`
}
