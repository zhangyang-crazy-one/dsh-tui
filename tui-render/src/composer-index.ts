/** Draft-owned derived indexes. The source string remains the editing/send authority. */
import { displayWidth, escapeContent } from './content.ts'
import { tokenizeComposer } from './composer-tokens.ts'
import type { ComposerToken } from './composer-tokens.ts'

const GRAPHEME = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const safeText = (text: string): string => escapeContent(text).replace(/\t/gu, '\\t')

/** First item strictly greater than value; lookups never scan a text prefix. */
function upperBound(values: readonly number[], value: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if ((values[mid] as number) <= value) low = mid + 1
    else high = mid
  }
  return low
}

export interface ComposerGlyph {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly kind: ComposerToken['kind']
}

/** One logical line, indexed once when first visited. All offsets are UTF-16. */
export class ComposerLineIndex {
  readonly offsets: number[] = [0]
  readonly columns: number[] = [0]
  readonly rawColumns: number[] = [0]
  readonly glyphs: ComposerGlyph[] = []

  constructor(readonly text: string) {
    const tokens = tokenizeComposer(text)
    let tokenIndex = 0
    let tokenEnd = tokens[0]?.text.length ?? 0
    let column = 0
    let rawColumn = 0
    for (const { segment, index } of GRAPHEME.segment(text)) {
      while (index >= tokenEnd && tokenIndex + 1 < tokens.length) {
        tokenIndex += 1
        tokenEnd += (tokens[tokenIndex] as ComposerToken).text.length
      }
      const safe = safeText(segment)
      column += displayWidth(safe)
      rawColumn += displayWidth(segment)
      this.glyphs.push({ start: index, end: index + segment.length, text: safe,
        kind: tokens[tokenIndex]?.kind ?? 'text' })
      this.offsets.push(index + segment.length)
      this.columns.push(column)
      this.rawColumns.push(rawColumn)
    }
  }

  columnAt(caret: number, raw = false): number {
    const clamped = Math.max(0, Math.min(caret, this.text.length))
    const slot = upperBound(this.offsets, clamped) - 1
    const offset = this.offsets[slot] as number
    const columns = raw ? this.rawColumns : this.columns
    // Mid-grapheme offsets can arrive from an external editor; only inspect that glyph.
    return (columns[slot] as number) + (offset === clamped ? 0
      : displayWidth(raw ? this.text.slice(offset, clamped) : safeText(this.text.slice(offset, clamped))))
  }

  offsetAtColumn(column: number): number {
    return this.offsets[Math.max(0, upperBound(this.columns, column) - 1)] as number
  }

  window(caretIndex: number | undefined, columns: number): {
    text: string; startColumn: number; caretColumn: number; hiddenPrefix: boolean
    glyphs: readonly ComposerGlyph[]
  } {
    const caret = this.columnAt(caretIndex ?? 0)
    // Reserve a cell for the native caret, and a cell for the prefix marker.
    const hiddenPrefix = columns > 1 && caret >= columns
    const budget = Math.max(0, columns - 1 - Number(hiddenPrefix))
    const desiredStart = Math.max(0, caret - budget)
    let first = Math.max(0, upperBound(this.columns, desiredStart - 1))
    // Do not detach combining/zero-width glyphs at a column boundary.
    while (first > 0 && this.columns[first - 1] === this.columns[first]) first -= 1
    const startColumn = this.columns[first] ?? 0
    const end = Math.max(first, upperBound(this.columns, startColumn + budget) - 1)
    const glyphs = this.glyphs.slice(first, end)
    return { text: glyphs.map(glyph => glyph.text).join(''), startColumn,
      caretColumn: Math.max(0, caret - startColumn + Number(hiddenPrefix)), hiddenPrefix, glyphs }
  }
}

/** Newline offsets are cheap to build; hidden lines are not tokenized or segmented. */
export class ComposerIndex {
  readonly lineStarts: number[] = [0]
  private readonly lines = new Map<number, ComposerLineIndex>()

  constructor(readonly text: string) {
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) this.lineStarts.push(at + 1)
  }

  rowAt(caret: number): number {
    return upperBound(this.lineStarts, Math.max(0, Math.min(caret, this.text.length))) - 1
  }

  /** Clamp stale external/selection endpoints to a whole source grapheme. */
  snapCaret(caret: number): number {
    // Line indexing splits on LF, but UAX #29 keeps CRLF in one grapheme.
    if (this.text[caret] === '\n' && this.text[caret - 1] === '\r') caret -= 1
    const row = this.rowAt(caret)
    const start = this.lineStarts[row] as number
    const line = this.line(row)
    const local = Math.max(0, Math.min(caret - start, line.text.length))
    return start + (line.offsets[upperBound(line.offsets, local) - 1] as number)
  }

  line(row: number): ComposerLineIndex {
    let line = this.lines.get(row)
    if (line === undefined) {
      const start = this.lineStarts[row] as number
      const end = row + 1 < this.lineStarts.length ? (this.lineStarts[row + 1] as number) - 1 : this.text.length
      line = new ComposerLineIndex(this.text.slice(start, end))
      this.lines.set(row, line)
    }
    return line
  }
}

// Pure geometry helpers also share one revision. This retains at most one draft;
// mounted editors own their index with useMemo and release it on text change/unmount.
let currentIndex: ComposerIndex | undefined
export function composerIndex(text: string): ComposerIndex {
  if (currentIndex?.text !== text) currentIndex = new ComposerIndex(text)
  return currentIndex
}

/** Input data + indicator rows use at most one third of available terminal rows. */
export function composerRowBudget(rows: number, rowsBelow = 0): number {
  return Math.max(1, Math.floor((rows - Math.max(0, rowsBelow)) / 3))
}

/** Shared by InputBar and the shell's pre-measurement height estimate (includes header). */
export function composerHeight(text: string, rows: number, rowsBelow = 0): number {
  return 1 + Math.min(composerIndex(text).lineStarts.length, composerRowBudget(rows, rowsBelow))
}

export function composerRowWindow(index: ComposerIndex, caret: number, rows: number, rowsBelow = 0): {
  start: number; end: number; hiddenAbove: number; hiddenBelow: number
} {
  const total = index.lineStarts.length
  const budget = composerRowBudget(rows, rowsBelow)
  // At one row, put the indicator in the header so the caret still gets a row.
  const count = Math.min(total, total > budget ? Math.max(1, budget - 1) : budget)
  const row = index.rowAt(caret)
  const start = Math.max(0, Math.min(row - Math.floor(count / 2), total - count))
  return { start, end: start + count, hiddenAbove: start, hiddenBelow: total - start - count }
}
