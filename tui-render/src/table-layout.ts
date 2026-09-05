/**
 * Adaptive column-width allocation for GFM pipe tables.
 *
 * The layout is a pure data module: it takes row-major cell text plus a
 * column budget and emits a layout record without terminal writes. Both
 * active and settled Markdown use its display-width allocation and wrapping.
 *
 * Algorithm overview:
 *
 *   1. Compute one {@link TableColumnMetrics} per column (category, natural
 *      width, minimum readable width).
 *   2. Preserve natural widths when they fit the available cell budget.
 *   3. Otherwise, allocate above readable minimums by the estimated number
 *      of wrapped lines saved per added column. Compact values stay whole.
 *   4. If even minimum widths cannot be honored, emit a records fallback
 *      that joins each row's first cell with the remaining cells on
 *      indented continuation lines, separated by divider rules.
 *
 * Short emoji / status columns naturally keep their full natural width
 * because their natural width and minimum width collapse to the same
 * value when the content is a single CJK glyph or a short status token.
 *
 * @module @deepseek-ai/dsh-tui-render/table-layout
 */

import { displayWidth, padDisplayEnd, wrapDisplayLines } from './content.ts'

/** Content classification used to determine minimum readable column widths. */
export type TableColumnCategory = 'compact' | 'narrative' | 'token-heavy'

/**
 * Per-column allocation record. `natural` is the unconstrained display width
 * (max cell). `minimum` is the readable floor used when shrinking.
 */
export interface TableColumnMetrics {
  readonly category: TableColumnCategory
  /** Unconstrained natural display width; at least 1. */
  readonly natural: number
  /** Smallest readable display width; never below 1 and never above `natural`. */
  readonly minimum: number
  /** Distinct explicit-line widths used to estimate wrapping benefit. */
  readonly wrapWidths: readonly number[]
  /** Explicit-line widths per logical row, parallel across columns. */
  readonly lineWidthsByRow: readonly (readonly number[])[]
}

/**
 * Rich cell record. Carries enough metadata for downstream rendering to map
 * back to inline formatting, hyperlinks, and selection regions without
 * losing track of which column / row the cell came from.
 */
export interface TableCell {
  /** Original cell text (un-escaped; the renderer escapes when painting). */
  readonly text: string
  /** Display width of `text`. */
  readonly width: number
  /** Original column index in the source cells. */
  readonly column: number
  /** Original row index in the source cells; 0 is the header. */
  readonly row: number
}

/** User-tunable allocation parameters. All fields are optional. */
export interface TableLayoutOptions {
  /** Total columns available for the entire table (including box-drawing chrome). */
  readonly maxCols: number
  /** Minimum readable floor for `compact` columns. Default: 1. */
  readonly compactMin?: number
  /** Minimum readable floor for `narrative` columns. Default: 4. */
  readonly narrativeMin?: number
  /** Minimum readable floor for `token-heavy` columns. Default: 8. */
  readonly tokenHeavyMin?: number
  /** Cap on an unbreakable word when computing minimums. Default: 30. */
  readonly wordCap?: number
  /** Box-drawing overhead per column. Default: 3. */
  readonly columnOverhead?: number
  /** Fixed box-drawing chrome for the outer borders. Default: 1. */
  readonly extraChrome?: number
  /** Indent string for record value continuation lines. Default: '  '. */
  readonly recordIndent?: string
  /** Divider character for record separators. Default: '─'. */
  readonly dividerChar?: string
}

/**
 * Grid (boxed) layout. The renderer can either reuse `lines` directly or
 * regenerate its own paint from `widths`, `columns`, `header`, and `body`.
 */
export interface TableGridLayout {
  readonly kind: 'grid'
  readonly widths: readonly number[]
  readonly columns: readonly TableColumnMetrics[]
  readonly header: readonly TableCell[]
  readonly body: readonly (readonly TableCell[])[]
  /** Painted grid in visual order (rule, header rows, mid rule, body rows, bottom rule). */
  readonly lines: readonly TableLayoutLine[]
  readonly maxCols: number
}

/**
 * Records fallback layout. Used when even the readable minimums cannot be
 * honored. `lines` contains divider rules interleaved with `record` lines.
 */
export interface TableRecordLayout {
  readonly kind: 'record'
  readonly header: readonly TableCell[]
  readonly lines: readonly TableLayoutLine[]
  readonly maxCols: number
  /** Display columns reserved for the key (first column). */
  readonly keyWidth: number
  /** Display columns reserved for value continuations. */
  readonly valueWidth: number
  /** Indent prepended to value continuation lines. */
  readonly valueIndent: string
}

/** Discriminated union of grid and records layouts. */
export type TableLayout = TableGridLayout | TableRecordLayout

/** Allocation result without materialized visual rows. */
export type TableLayoutPlan =
  | {
    readonly kind: 'grid'
    readonly widths: readonly number[]
    readonly columns: readonly TableColumnMetrics[]
    readonly maxCols: number
  }
  | {
    readonly kind: 'record'
    readonly columns: readonly TableColumnMetrics[]
    readonly maxCols: number
    readonly keyWidth: number
    readonly valueWidth: number
    readonly valueIndent: string
  }

/**
 * A single line in either layout. Compatible with `TableLine` in
 * {@link ./markdown.tsx}: the `rule`, `row`, and `plain` variants share the
 * same shape, while `record` is the new key/value form. The `row` variant
 * carries `TableCell` records instead of plain strings so the renderer can
 * look up inline formatting.
 */
export type TableLayoutLine =
  | { readonly kind: 'rule'; readonly text: string }
  | { readonly kind: 'row'; readonly header: boolean; readonly cells: readonly TableCell[] }
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'record'; readonly key: TableCell; readonly values: readonly TableCell[] }

/** Default cap for a single unbreakable word inside a cell. */
export const DEFAULT_WORD_CAP = 30
/** Default minimum readable width for `compact` columns. */
export const DEFAULT_COMPACT_MIN = 1
/** Default minimum readable width for `narrative` columns. */
export const DEFAULT_NARRATIVE_MIN = 4
/** Default minimum readable width for `token-heavy` columns. */
export const DEFAULT_TOKEN_HEAVY_MIN = 8
/** Default box-drawing overhead per column (separator + side borders). */
export const DEFAULT_COLUMN_OVERHEAD = 3
/** Default fixed box-drawing chrome (outer borders). */
export const DEFAULT_EXTRA_CHROME = 1
/** Default width boundary distinguishing compact from narrative columns. */
const COMPACT_MAX_WIDTH = 4

/**
 * Heuristic pattern matching tokens that should always be classified
 * `token-heavy` (URLs, POSIX-style paths, hex hashes). Each match arm
 * intentionally avoids false positives on short status words.
 */
const TOKEN_HEAVY_PATTERN =
  /(?:https?:\/\/|\.{0,2}\/[a-z0-9_./-]+|^[a-f0-9]{8,}$)/i
/** Long whitespace-free cells are identifiers even when they are not URLs. */
const TOKEN_HEAVY_WIDTH = 12

/**
 * Classify each column by content shape. The first matching pattern wins:
 *   - any token-heavy token → `token-heavy`
 *   - else max width <= {@link COMPACT_MAX_WIDTH} → `compact`
 *   - else → `narrative`
 * @param cells - row-major cells; row 0 is the header.
 * @returns one {@link TableColumnCategory} per column.
 */
export function classifyColumns(
  cells: readonly (readonly string[])[],
): readonly TableColumnCategory[] {
  const colCount = Math.max(0, ...cells.map(row => row.length))
  const result: TableColumnCategory[] = []
  for (let c = 0; c < colCount; c += 1) {
    const column: string[] = []
    for (const row of cells) column.push(row[c] ?? '')
    result.push(classifyColumn(column))
  }
  return result
}

function classifyColumn(cells: readonly string[]): TableColumnCategory {
  for (const cell of cells) {
    if (cell.length === 0) continue
    if (
      TOKEN_HEAVY_PATTERN.test(cell)
      || (!/\s/u.test(cell) && displayWidth(cell) > TOKEN_HEAVY_WIDTH)
    ) return 'token-heavy'
  }
  let maxWidth = 0
  for (const cell of cells) maxWidth = Math.max(maxWidth, displayWidth(cell))
  if (maxWidth <= COMPACT_MAX_WIDTH) return 'compact'
  return 'narrative'
}

/**
 * Compute adaptive column widths and produce a layout for `cells`.
 *
 * The function is pure: same input produces the same output. The result is
 * either a {@link TableGridLayout} (when the table fits the column budget)
 * or a {@link TableRecordLayout} (when even minimum widths cannot fit).
 *
 * @param cells - row-major cells; row 0 is the header.
 * @param options - {@link TableLayoutOptions}.
 * @returns the computed layout.
 */
export function layoutTableCells(
  cells: readonly (readonly string[])[],
  options: TableLayoutOptions,
): TableLayout {
  const rowCount = cells.length
  const colCount = Math.max(
    1,
    cells.reduce((max, row) => Math.max(max, row.length), 0),
  )
  const maxCols = options.maxCols
  const recordIndent = options.recordIndent ?? '  '
  const dividerChar = options.dividerChar ?? '─'

  const headerCells = buildCells(cells[0] ?? [], 0, colCount)
  const bodyCells = cells.slice(1).map((row, idx) => buildCells(row, idx + 1, colCount))

  if (rowCount === 0) {
    return {
      kind: 'grid',
      widths: [],
      columns: [],
      header: headerCells,
      body: bodyCells,
      lines: [],
      maxCols,
    }
  }

  const plan = measureTableCells(cells, options)
  if (plan.kind === 'grid') {
    return buildGridLayout(
      headerCells,
      bodyCells,
      plan.columns,
      plan.widths,
      maxCols,
      dividerChar,
    )
  }

  return buildRecordLayout(
    headerCells,
    bodyCells,
    plan.columns,
    maxCols,
    recordIndent,
    dividerChar,
  )
}

/**
 * Measure table columns and choose grid versus record layout without wrapping
 * or materializing any output rows. Streaming renderers use this cheap plan
 * to decide whether previously painted rows remain reusable.
 * @param cells - row-major cells; row 0 is the header.
 * @param options - allocation thresholds and terminal width.
 * @returns immutable allocation plan.
 */
export function measureTableCells(
  cells: readonly (readonly string[])[],
  options: TableLayoutOptions,
): TableLayoutPlan {
  const colCount = Math.max(
    1,
    cells.reduce((max, row) => Math.max(max, row.length), 0),
  )
  const maxCols = options.maxCols
  const metrics = computeMetrics(
    cells,
    colCount,
    options.wordCap ?? DEFAULT_WORD_CAP,
    options.compactMin ?? DEFAULT_COMPACT_MIN,
    options.narrativeMin ?? DEFAULT_NARRATIVE_MIN,
    options.tokenHeavyMin ?? DEFAULT_TOKEN_HEAVY_MIN,
  )
  const overhead = (options.columnOverhead ?? DEFAULT_COLUMN_OVERHEAD) * colCount
    + (options.extraChrome ?? DEFAULT_EXTRA_CHROME)
  const available = Math.max(0, maxCols - overhead)
  if (cells.length > 0 && available >= colCount) {
    const widths = fitWidths(metrics, available)
    if (widths !== null) {
      return { kind: 'grid', widths, columns: metrics, maxCols }
    }
  }
  const indent = options.recordIndent ?? '  '
  const firstMetric = metrics[0] as TableColumnMetrics
  const keyWidth = Math.max(4, Math.min(firstMetric.natural, Math.max(8, Math.floor(maxCols / 3))))
  const dividerWidth = Math.max(4, Math.min(maxCols - indent.length, keyWidth + 2))
  return {
    kind: 'record',
    columns: metrics,
    maxCols,
    keyWidth,
    valueWidth: Math.max(4, maxCols - indent.length - dividerWidth),
    valueIndent: indent,
  }
}

/**
 * Test whether appended rows can reuse an existing column plan without
 * rescanning the table prefix. A row invalidates the plan when it widens a
 * column, changes its shrink category, or raises its readable word floor.
 * @param rows - newly appended committed rows plus the current raw tail.
 * @param metrics - column metrics from the last complete measurement.
 * @returns true when the existing widths and metrics remain valid.
 */
export function appendedRowsPreserveTableMetrics(
  rows: readonly (readonly string[])[],
  metrics: readonly TableColumnMetrics[],
): boolean {
  if (rows.some(row => row.length > metrics.length)) return false
  for (const row of rows) {
    const widths = metrics.map((_metric, column) => (row[column] ?? '').split('\n').map(displayWidth))
    if (!metrics[0]?.lineWidthsByRow.some((_value, index) => metrics.every((metric, column) => {
      const previous = metric.lineWidthsByRow[index] as readonly number[]
      const next = widths[column] as readonly number[]
      return previous.length === next.length && previous.every((width, part) => width === next[part])
    }))) return false
  }
  for (let column = 0; column < metrics.length; column += 1) {
    const metric = metrics[column] as TableColumnMetrics
    const values = rows.map(row => row[column] ?? '')
    for (const value of values) {
      if (value.split('\n').some(line => !metric.wrapWidths.includes(displayWidth(line)))) return false
      if (longestFittingIdentifier(value, DEFAULT_WORD_CAP) > metric.minimum) return false
    }
    const appendedCategory = classifyColumn(values)
    if (appendedCategory === 'token-heavy' && metric.category !== 'token-heavy') {
      return false
    }
    if (
      metric.category === 'narrative'
      && values.some(value => longestWordIn(value, DEFAULT_WORD_CAP) > metric.minimum)
    ) return false
  }
  return true
}

function buildCells(
  row: readonly string[],
  rowIndex: number,
  colCount: number,
): TableCell[] {
  const cells: TableCell[] = []
  for (let c = 0; c < colCount; c += 1) {
    const text = row[c] ?? ''
    cells.push({ text, width: displayWidth(text), column: c, row: rowIndex })
  }
  return cells
}

function computeMetrics(
  cells: readonly (readonly string[])[],
  colCount: number,
  wordCap: number,
  compactMin: number,
  narrativeMin: number,
  tokenHeavyMin: number,
): TableColumnMetrics[] {
  const categories = classifyColumns(cells)
  const result: TableColumnMetrics[] = []
  for (let c = 0; c < colCount; c += 1) {
    const column: string[] = []
    let natural = 1
    let longestWord = 1
    let identifierWidth = 1
    const wrapWidths = new Set<number>()
    const lineWidthsByRow: number[][] = []
    for (const row of cells) {
      const cell = row[c] ?? ''
      column.push(cell)
      const lineWidths = cell.split('\n').map(displayWidth)
      lineWidthsByRow.push(lineWidths)
      for (const w of lineWidths) {
        wrapWidths.add(w)
        if (w > natural) natural = w
      }
      longestWord = Math.max(longestWord, longestWordIn(cell, wordCap))
      identifierWidth = Math.max(identifierWidth, longestFittingIdentifier(cell, wordCap))
    }
    const category = categories[c] ?? 'narrative'
    let minimum: number
    if (category === 'compact') {
      /* v8 ignore if -- compact columns always satisfy natural <= COMPACT_MAX_WIDTH, so this else branch is unreachable. */
      /* v8 ignore next -- the else branch is unreachable because the if condition is always true. */
      if (natural <= COMPACT_MAX_WIDTH) {
        // Short compact columns preserve their natural width entirely.
        minimum = natural
      } else {
        minimum = Math.max(compactMin, longestWord)
      }
    } else if (category === 'narrative') {
      minimum = Math.max(narrativeMin, longestWord)
    } else {
      // Readable identifiers remain whole. Only tokens beyond the configured
      // word cap may hard-wrap, so one long URL cannot force a records layout.
      minimum = Math.max(tokenHeavyMin, identifierWidth)
    }
    /* v8 ignore next -- natural is always >= minimum after computeMetrics clamps minimum <= natural. */
    if (minimum > natural) minimum = natural
    /* v8 ignore next -- defensive minimum < 1 clamp is unreachable: floors and natural are both >= 1. */
    if (minimum < 1) minimum = 1
    result.push({ category, natural, minimum, wrapWidths: [...wrapWidths].sort((a, b) => a - b), lineWidthsByRow })
  }
  return result
}

/**
 * Allocate readable floors, then spend columns at wrap-count breakpoints.
 * Distinct line widths make repeated appended rows preserve the allocation.
 */
function fitWidths(
  metrics: readonly TableColumnMetrics[],
  available: number,
): number[] | null {
  const natural = metrics.map(metric => metric.natural)
  if (natural.reduce((sum, width) => sum + width, 0) <= available) return natural
  const widths = metrics.map(metric => metric.minimum)
  let used = widths.reduce((sum, w) => sum + w, 0)
  if (used > available) return null
  while (used < available) {
    let best = -1
    let bestWidth = 0
    let bestGain = -1
    let bestPressure = -1
    for (const [index, metric] of metrics.entries()) {
      const width = widths[index] as number
      if (width >= metric.natural) continue
      let next = metric.natural
      for (const length of metric.wrapWidths) {
        const lines = Math.ceil(length / width)
        if (lines > 1) next = Math.min(next, Math.ceil(length / (lines - 1)))
      }
      next = Math.min(next, width + available - used)
      let saved = 0
      for (const length of metric.wrapWidths) saved += Math.ceil(length / width) - Math.ceil(length / next)
      const gain = saved / (next - width)
      const pressure = metric.natural / width
      if (gain > bestGain || (gain === bestGain && pressure > bestPressure)) {
        best = index
        bestWidth = next
        bestGain = gain
        bestPressure = pressure
      }
    }
    if (best < 0) break
    used += bestWidth - (widths[best] as number)
    widths[best] = bestWidth
  }
  const balanced = balancedWidths(metrics, available)
  return estimatedTableRows(metrics, widths) < estimatedTableRows(metrics, balanced) ? widths : balanced
}

/** Preserve balanced widths unless reallocation reduces a logical record's height. */
function balancedWidths(metrics: readonly TableColumnMetrics[], available: number): number[] {
  let low = 1
  let high = Math.max(...metrics.map(metric => metric.natural))
  const at = (ceiling: number): number[] => metrics.map(metric => Math.max(metric.minimum, Math.min(metric.natural, ceiling)))
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (at(middle).reduce((sum, width) => sum + width, 0) <= available) low = middle
    else high = middle - 1
  }
  const widths = at(low)
  let spare = available - widths.reduce((sum, width) => sum + width, 0)
  for (const [index, metric] of metrics.entries()) {
    if (spare === 0) break
    if ((widths[index] as number) < metric.natural && (widths[index] as number) <= low) {
      widths[index] = (widths[index] as number) + 1
      spare -= 1
    }
  }
  return widths
}

/** Joint row patterns avoid shortening a column when another cell still owns the row height. */
function estimatedTableRows(metrics: readonly TableColumnMetrics[], widths: readonly number[]): number {
  let height = 0
  const seen = new Set<string>()
  for (let row = 0; row < (metrics[0]?.lineWidthsByRow.length ?? 0); row += 1) {
    const pattern = metrics.map(metric => metric.lineWidthsByRow[row] as readonly number[])
    const key = JSON.stringify(pattern)
    if (seen.has(key)) continue
    seen.add(key)
    height += Math.max(...pattern.map((lines, index) => lines.reduce((sum, length) =>
      sum + Math.max(1, Math.ceil(length / (widths[index] as number))), 0)))
  }
  return height
}

/** Widest ASCII identifier that fits the configured word-preservation cap. */
function longestFittingIdentifier(text: string, cap: number): number {
  let longest = 1
  for (const match of text.matchAll(/[A-Za-z0-9_][A-Za-z0-9_./:@+-]*/gu)) {
    if (match[0].length <= cap) longest = Math.max(longest, match[0].length)
  }
  return longest
}

function longestWordIn(text: string, cap: number): number {
  let max = 1
  for (const word of text.split(/\s+/)) {
    if (word === '') continue
    const width = displayWidth(word)
    if (width > max) max = Math.min(cap, width)
  }
  return max
}

function buildGridLayout(
  headerCells: readonly TableCell[],
  bodyCells: readonly (readonly TableCell[])[],
  metrics: readonly TableColumnMetrics[],
  widths: readonly number[],
  maxCols: number,
  dividerChar: string,
): TableGridLayout {
  const lines: TableLayoutLine[] = []
  const ruleTop = ruleText(widths, 'top', dividerChar)
  const ruleMid = ruleText(widths, 'mid', dividerChar)
  const ruleBottom = ruleText(widths, 'bottom', dividerChar)
  lines.push({ kind: 'rule', text: ruleTop })
  for (const line of wrapRow(headerCells, widths, true)) {
    lines.push(line)
  }
  lines.push({ kind: 'rule', text: ruleMid })
  let previousMultiline = false
  for (const [index, row] of bodyCells.entries()) {
    const multiline = isMultilineTableRow(row.map(cell => cell.text), widths)
    if (index > 0 && (previousMultiline || multiline)) lines.push({ kind: 'rule', text: ruleMid })
    for (const line of wrapRow(row, widths, false)) {
      lines.push(line)
    }
    previousMultiline = multiline
  }
  lines.push({ kind: 'rule', text: ruleBottom })
  return {
    kind: 'grid',
    widths: [...widths],
    columns: metrics,
    header: [...headerCells],
    body: bodyCells,
    lines,
    maxCols,
  }
}

function wrapRow(
  row: readonly TableCell[],
  widths: readonly number[],
  header: boolean,
): TableLayoutLine[] {
  // widths and row both have exactly colCount entries, so every indexed
  // access is in-bounds; the type assertion documents the invariant.
  const wrapped = row.map((cell) => {
    const width = widths[cell.column] as number
    return cell.width <= width && !cell.text.includes('\n') ? [cell.text] : wrapTableCell(cell.text, width)
  })
  const height = wrapped.reduce((max, lines) => Math.max(max, lines.length), 1)
  const out: TableLayoutLine[] = []
  for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
    const cells = row.map((cell, col) => {
      const linesForCell = wrapped[col] as string[]
      const lineText = linesForCell[lineIndex] ?? ''
      const text = padDisplayEnd(lineText, widths[col] as number)
      return { text, width: displayWidth(text), column: cell.column, row: cell.row }
    })
    out.push({ kind: 'row', header, cells })
  }
  return out
}

/**
 * Identify records that need separation from neighboring body rows.
 * @param cells - one logical row, without padding.
 * @param widths - allocated display columns.
 * @returns whether a cell exceeds one physical line.
 */
export function isMultilineTableRow(cells: readonly string[], widths: readonly number[]): boolean {
  return cells.some((cell, index) => cell.includes('\n') || displayWidth(cell) > (widths[index] ?? 0))
}

/**
 * Wrap table prose at spaces before splitting an oversized word. Explicit
 * line breaks and all non-whitespace content remain visible.
 * @param text - escaped cell text.
 * @param width - available display columns inside the cell.
 * @returns physical rows without padding; long identifiers use hard wrapping.
 */
export function wrapTableCell(text: string, width: number): string[] {
  if (width <= 0) return text.split('\n')
  const out: string[] = []
  for (const source of text.split('\n')) {
    let line = ''
    for (const token of source.match(/\s+|\S+/gu) ?? []) {
      if (displayWidth(line + token) <= width) {
        line += token
        continue
      }
      if (line.trimEnd() !== '') out.push(line.trimEnd())
      const pieces = wrapDisplayLines(token.trimStart(), width)
      out.push(...pieces.slice(0, -1))
      line = pieces.at(-1) ?? ''
    }
    out.push(line.trimEnd())
  }
  return out
}

function ruleText(
  widths: readonly number[],
  kind: 'top' | 'mid' | 'bottom',
  dividerChar: string,
): string {
  const fill = widths.map(width => dividerChar.repeat(Math.max(1, width)))
  if (kind === 'top') return `┌─${fill.join('─┬─')}─┐`
  if (kind === 'bottom') return `└─${fill.join('─┴─')}─┘`
  return `├─${fill.join('─┼─')}─┤`
}

function buildRecordLayout(
  headerCells: readonly TableCell[],
  bodyCells: readonly (readonly TableCell[])[],
  metrics: readonly TableColumnMetrics[],
  maxCols: number,
  indent: string,
  dividerChar: string,
): TableRecordLayout {
  // metrics, bodyCells, headerCells, and every row in bodyCells all have
  // colCount entries by construction, so every indexed access is in-bounds.
  const firstMetric = metrics[0] as TableColumnMetrics
  const keyWidth = Math.max(4, Math.min(firstMetric.natural, Math.max(8, Math.floor(maxCols / 3))))
  const dividerWidth = Math.max(4, Math.min(maxCols - indent.length, keyWidth + 2))
  const valueWidth = Math.max(4, maxCols - indent.length - dividerWidth)
  const lines: TableLayoutLine[] = []
  lines.push({
    kind: 'record',
    key: headerCells[0] as TableCell,
    values: headerCells.slice(1),
  })
  for (let i = 0; i < bodyCells.length; i += 1) {
    if (i > 0) {
      lines.push({
        kind: 'rule',
        text: indent + dividerChar.repeat(dividerWidth),
      })
    }
    const row = bodyCells[i] as readonly TableCell[]
    lines.push({
      kind: 'record',
      key: row[0] as TableCell,
      values: row.slice(1),
    })
  }
  return {
    kind: 'record',
    header: [...headerCells],
    lines,
    maxCols,
    keyWidth,
    valueWidth,
    valueIndent: indent,
  }
}
