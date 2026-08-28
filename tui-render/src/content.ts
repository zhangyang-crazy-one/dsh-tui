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

/** First grapheme; a one-unit slice if the iterator is empty. */
function firstGrapheme(text: string): string {
  for (const part of GRAPHEME.segment(text)) return part.segment
  // v8 ignore next -- Intl.Segmenter yields a grapheme for every non-empty string.
  return text.slice(0, 1)
}

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
 * The number of terminal columns a string occupies.
 * @param text - the string to measure.
 * @returns its display width in columns.
 */
export function displayWidth(text: string): number {
  return stringWidth(text)
}

/**
 * Slice a string so its display width fits `maxCols` columns. The cut never
 * lands inside a wide glyph: `wcwidthSafeSlice('中文ab', 2)` keeps `中文`
 * intact instead of splitting the first character.
 * @param text - the string to truncate.
 * @param maxCols - the column budget.
 * @returns the longest prefix within the budget.
 */
export function wcwidthSafeSlice(text: string, maxCols: number): string {
  let cols = 0
  let end = 0
  for (const char of text) {
    const width = stringWidth(char)
    if (cols + width > maxCols) break
    cols += width
    end += char.length
  }
  return text.slice(0, end)
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
    let rest = line
    while (rest !== '') {
      const chunk = wcwidthSafeSlice(rest, maxCols)
      if (chunk === '') {
        const first = firstGrapheme(rest)
        out.push(first)
        rest = rest.slice(first.length)
        continue
      }
      out.push(chunk)
      rest = rest.slice(chunk.length)
    }
  }
  return out
}
