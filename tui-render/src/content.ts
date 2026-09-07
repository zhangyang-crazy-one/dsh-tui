/**
 * Content-safe rendering utilities: the render layer's single owner of
 * control-byte escaping and display-width measurement. `escapeContent`
 * neutralizes every control byte in untrusted content before it reaches the
 * terminal; `displayWidth`, `wcwidthSafeSlice`, `padDisplayEnd`, and
 * {@link wrapDisplayLines} are the one width source for every alignment,
 * wrapping, truncation, and column-pad decision in this package. The
 * host (`@deepseek-ai/dsh-tui`) re-exports escape and width helpers so its own surface keeps a
 * stable import, but ownership lives here — the render layer never imports
 * back into the host.
 * @module @deepseek-ai/dsh-tui-render/content
 */

import stringWidth from 'string-width'

/** Grapheme splitter so a glyph wider than the wrap budget still advances. */
const GRAPHEME = new Intl.Segmenter(undefined, { granularity: 'grapheme' })


/**
 * Escape every control byte in untrusted content so it cannot be interpreted
 * by the terminal: C0 controls become printable form and the ESC byte is
 * neutralized. Only the render layer may call {@link styled} afterwards.
 * @param text - untrusted plain text.
 * @returns control-sequence-free text.
 */
export function escapeContent(text: string): string {
  return text
    .replace(
      /[\u0000-\u0008\u000B-\u001F\u007F]/g,
      char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
    )
    .replace(/\u001B/g, '\\x1b')
}

/**
 * Pattern matching BMP symbols/emojis that `string-width` treats as 1 column,
 * but render as 2 columns in terminal fonts or require a 2-cell placeholder.
 */
const WIDE_SYMBOLS_OR_EMOJIS =
  /[\u26A0\u26A1\u2699\u2139\u23F1\u2328\u2709\u270F\u2712\u2702\u26C8\u2764\u2B50]/gu

/**
 * The number of terminal columns a string occupies.
 *
 * Counts printable ASCII as 1 column, CJK glyphs as 2 columns, standard emojis
 * and ZWJ sequences as 2 columns, and single-codepoint emojis (⚠️, ⚙, ℹ, ⏱, etc.)
 * as 2 columns. Circled digits (U+2460–U+24F4, U+2776–U+2793) occupy 1 column
 * in monospace terminal grids.
 *
 * @param text - the string to measure.
 * @returns its display width in columns.
 */
export function displayWidth(text: string): number {
  if (text === '') return 0
  let cols = 0
  let simple = true
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code >= 0x20 && code <= 0x7e) {
      cols += 1
    } else if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x3000 && code <= 0x303f)
      || (code >= 0xff01 && code <= 0xff60)
    ) {
      cols += 2
    } else {
      simple = false
      break
    }
  }
  if (simple) return cols

  const base = stringWidth(text)
  if (!/[\u26A0\u26A1\u2699\u2139\u23F1\u2328\u2709\u270F\u2712\u2702\u26C8\u2764\u2B50]/u.test(text)) {
    return base
  }
  let extra = 0
  for (const match of text.matchAll(WIDE_SYMBOLS_OR_EMOJIS)) {
    if (text.charCodeAt(match.index + 1) === 0xFE0F) {
      continue
    }
    extra += 1
  }
  return base + extra
}

/**
 * Slice a string so its display width fits `maxCols` columns. The cut never
 * lands inside a grapheme: `wcwidthSafeSlice('中文ab', 2)` returns `中`.
 * @param text - the string to truncate.
 * @param maxCols - the column budget.
 * @returns the longest prefix within the budget.
 */
export function wcwidthSafeSlice(text: string, maxCols: number): string {
  if (maxCols <= 0) return ''
  const budget = Math.floor(maxCols)
  if (/^[\x20-\x7e]*$/u.test(text.slice(0, budget + 1))) return text.slice(0, budget)
  let cols = 0
  let end = 0
  for (const { segment } of GRAPHEME.segment(text)) {
    const width = displayWidth(segment)
    if (cols + width > maxCols) break
    cols += width
    end += segment.length
  }
  return text.slice(0, end)
}

/**
 * Format symbols and emojis with balanced spacing and variation selectors so
 * they don't collide with adjacent CJK characters or get clipped in monospace
 * terminal grids.
 *
 * 1. Attaches VS16 (\uFE0F) to common BMP emojis missing presentation selector
 *    (e.g. ⚠ -> ⚠️, ⚙ -> ⚙️).
 * 2. Adds padding space between circled numbers / emojis and adjacent CJK ideographs
 *    (e.g. "①和" -> "① 和", "把①" -> "把 ①", "⚠️注意" -> "⚠️ 注意").
 *
 * @param text - source plain text.
 * @returns text with balanced symbol spacing.
 */
export function formatSymbolSpacing(text: string): string {
  if (text === '' || /^[\x20-\x7e]*$/u.test(text)) return text
  let res = text.replace(
    /([\u26A0\u2699\u2139\u23F1\u2328\u2709\u270F\u2712\u2702\u26C8\u2764])(?!\uFE0F)/gu,
    '$1\uFE0F',
  )
  res = res.replace(
    /([\u2460-\u24F4\u2776-\u2793\u3251-\u325F\u32B1-\u32BF])([\u4E00-\u9FFF\u3400-\u4DBF])/gu,
    '$1 $2',
  )
  res = res.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF])([\u2460-\u24F4\u2776-\u2793\u3251-\u325F\u32B1-\u32BF])/gu,
    '$1 $2',
  )
  res = res.replace(
    /([\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?)([\u4E00-\u9FFF\u3400-\u4DBF])/gu,
    '$1 $2',
  )
  res = res.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF])([\u{1F300}-\u{1FAFF}\u2600-\u27BF])/gu,
    '$1 $2',
  )
  return res
}

/**
 * Slice a string by terminal display-column offsets without splitting a
 * grapheme. Both offsets are zero-based and the end is exclusive.
 * @param text - source text.
 * @param startCol - inclusive display-column offset.
 * @param endCol - exclusive display-column offset.
 * @returns graphemes fully covered by the requested column interval.
 */
export function displayColumnSlice(
  text: string,
  startCol: number,
  endCol: number,
): string {
  const start = Math.max(0, startCol)
  const end = Math.max(start, endCol)
  if (/^[\x20-\x7e]*$/u.test(text)) return text.slice(Math.ceil(start), Math.floor(end))
  let column = 0
  let out = ''
  for (const part of GRAPHEME.segment(text)) {
    const width = displayWidth(part.segment)
    const next = column + width
    if (column >= start && next <= end) out += part.segment
    if (column >= end) break
    column = next
  }
  return out
}

/**
 * Pad `text` on the right to `width` display columns. Uses
 * {@link displayWidth}, not `String.padEnd`, so CJK and emoji stay aligned
 * with ASCII in the same column.
 * @param text - already-escaped plain text.
 * @param width - target display columns; non-positive returns `text`.
 * @returns `text` plus trailing ASCII spaces, or `text` when it already fills
 *   the budget.
 */
export function padDisplayEnd(text: string, width: number): string {
  if (width <= 0) return text
  const cols = displayWidth(text)
  if (cols >= width) return text
  return `${text}${' '.repeat(width - cols)}`
}

/**
 * Split `text` into display rows that each fit `maxCols`. Explicit newlines
 * stay as row breaks. A glyph wider than `maxCols` occupies its own row so
 * the walk always advances.
 * @param text - already-escaped plain text.
 * @param maxCols - column budget per row; non-positive keeps explicit lines only.
 * @returns one string per terminal row.
 */
export function wrapDisplayLines(text: string, maxCols: number): string[] {
  const source = text.split('\n')
  if (maxCols <= 0) return source
  const out: string[] = []
  for (const line of source) {
    if (line === '' || displayWidth(line) <= maxCols) {
      out.push(line)
      continue
    }
    if (/^[\x20-\x7e]*$/u.test(line)) {
      for (let i = 0; i < line.length; i += maxCols) {
        out.push(line.slice(i, i + maxCols))
      }
      continue
    }
    let curLine = ''
    let curCols = 0
    for (const { segment } of GRAPHEME.segment(line)) {
      const width = displayWidth(segment)
      if (curCols + width > maxCols && curLine !== '') {
        out.push(curLine)
        curLine = segment
        curCols = width
      } else {
        curLine += segment
        curCols += width
      }
    }
    if (curLine !== '') {
      out.push(curLine)
    }
  }
  return out
}
