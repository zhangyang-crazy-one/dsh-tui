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
const HAS_CONTROL_BYTE = /[\u0000-\u0008\u000B-\u001F\u007F\r]/u

export function escapeContent(text: string): string {
  if (text === '' || !HAS_CONTROL_BYTE.test(text)) return text
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(
      /[\u0000-\u0008\u000B-\u001F\u007F]/g,
      char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
    )
    .replace(/\u001B/g, '\\x1b')
}


const EMOJI_OR_PICTOGRAPHIC = /\p{Extended_Pictographic}/u

/**
 * Single-column symbols the TUI draws constantly (box-drawing gutters, rules,
 * `·`, `…`, `›`). None is pictographic, emoji-capable, or combining, so each
 * measures 1 alone; a following combining mark or selector is itself outside
 * every fast range and still sends the whole string to the exact path.
 * @param code - one UTF-16 code unit.
 * @returns whether it is a known narrow symbol.
 */
function isNarrowSymbol(code: number): boolean {
  return (code >= 0x2500 && code <= 0x259f) // box drawing, block elements
    || (code >= 0x00a0 && code <= 0x00ff && code !== 0x00a9 && code !== 0x00ad && code !== 0x00ae)
    || (code >= 0x2010 && code <= 0x2027) // dashes, quotes, bullet, ellipsis
    || (code >= 0x2030 && code <= 0x203b) // per-mille, primes, ‹ ›, ※
}

/**
 * The number of terminal columns a string occupies.
 *
 * Counts printable ASCII as 1 column, CJK glyphs as 2 columns, standard emojis
 * and ZWJ sequences as 2 columns, and single-codepoint emojis as 2 columns.
 * Circled digits (U+2460–U+24F4, U+2776–U+2793) occupy 1 column in monospace
 * terminal grids. Strips ANSI sequences safely via stringWidth.
 *
 * @param text - the string to measure.
 * @returns its display width in columns.
 */
const DISPLAY_WIDTH_CACHE_LIMIT = 1024
const displayWidthCache = new Map<string, number>()

function cacheDisplayWidth(text: string, width: number): number {
  if (text.length <= 256) {
    if (displayWidthCache.size >= DISPLAY_WIDTH_CACHE_LIMIT) {
      const oldest = displayWidthCache.keys().next().value
      if (oldest !== undefined) displayWidthCache.delete(oldest)
    }
    displayWidthCache.set(text, width)
  }
  return width
}

export function displayWidth(text: string): number {
  if (text === '') return 0
  const cached = text.length <= 256 ? displayWidthCache.get(text) : undefined
  if (cached !== undefined) return cached
  let cols = 0
  let simple = true
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if ((code >= 0x20 && code <= 0x7e) || isNarrowSymbol(code)) {
      cols += 1
    } else if (code === 0x1b && text.charCodeAt(i + 1) === 0x5b) {
      // A complete SGR sequence (ESC [ params m) is zero-width, exactly as
      // string-width strips it; any other escape takes the exact path.
      let end = i + 2
      for (; end < text.length; end += 1) {
        const c = text.charCodeAt(end)
        if (c < 0x30 || c > 0x3b) break
      }
      if (text[end] !== 'm') {
        simple = false
        break
      }
      i = end
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
  if (simple) return cacheDisplayWidth(text, cols)

  const base = stringWidth(text)
  if (!/[\u{1F300}-\u{1FAFF}\u2000-\u2BFF]/u.test(text)) {
    return cacheDisplayWidth(text, base)
  }
  let extra = 0
  for (const { segment } of GRAPHEME.segment(text)) {
    if (segment.includes('\uFE0E')) continue
    if (EMOJI_OR_PICTOGRAPHIC.test(segment) && stringWidth(segment) === 1) {
      extra += 1
    }
  }
  return cacheDisplayWidth(text, base + extra)
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
 * Mapping of narrow BMP emojis (East Asian Width 'N' in Unicode, causing terminal
 * grids to allocate only 1 column and clip/overlap the glyph) to true wide
 * emojis (East Asian Width 'W', 2 columns across all terminal emulators).
 */
export const NARROW_TO_WIDE_EMOJIS: Record<string, string> = {
  '\u26A0': '🚨', // ⚠️ / ⚠ -> 🚨 (warning / alert)
  '\u2139': '💡', // ℹ️ / ℹ -> 💡 (info / tip)
  '\u2699': '🔧', // ⚙️ / ⚙ -> 🔧 (settings / tools)
  '\u23F1': '⏰', // ⏱️ / ⏱ -> ⏰ (timer / clock)
  '\u2709': '📧', // ✉️ / ✉ -> 📧 (mail)
  '\u270F': '📝', // ✏️ / ✏ -> 📝 (edit / memo)
}

/**
 * Format symbols and emojis with balanced spacing and variation selectors so
 * they don't collide with adjacent CJK characters or get clipped in monospace
 * terminal grids.
 *
 * 1. Replaces narrow BMP emojis/symbols that terminals treat as 1-column with
 *    true wide emojis (East Asian Width 'W', 2 columns) so they render without
 *    cell clipping or overlap (e.g. ⚠️ -> 🚨, ℹ️ -> 💡, ⚙️ -> 🔧).
 * 2. Adds padding space between circled numbers / emojis and adjacent CJK ideographs
 *    (e.g. "①和" -> "① 和", "把①" -> "把 ①", "🚨注意" -> "🚨 注意").
 *
 * @param text - source plain text.
 * @returns text with balanced symbol spacing.
 */
export function formatSymbolSpacing(text: string): string {
  if (text === '' || /^[\x20-\x7e]*$/u.test(text)) return text
  let res = text.replace(
    /([\u26A0\u2699\u2139\u23F1\u2709\u270F])[\uFE0E\uFE0F]?/gu,
    (_: string, ch: string): string => NARROW_TO_WIDE_EMOJIS[ch] ?? ch,
  )
  res = res.replace(
    /([\u2328\u2712\u2702\u26C8\u2764])(?!\uFE0F|\uFE0E)/gu,
    '$1\uFE0F',
  )
  res = res.replace(
    /([\u2460-\u24F4\u2776-\u2793\u3251-\u325F\u32B1-\u32BF])([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])/gu,
    '$1 $2',
  )
  res = res.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])([\u2460-\u24F4\u2776-\u2793\u3251-\u325F\u32B1-\u32BF])/gu,
    '$1 $2',
  )
  res = res.replace(
    /([\u{1F300}-\u{1FAFF}\u2600-\u27BF][\uFE0E\uFE0F]?)([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])/gu,
    '$1 $2',
  )
  res = res.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF01-\uFF60])([\u{1F300}-\u{1FAFF}\u2600-\u27BF][\uFE0E\uFE0F]?)/gu,
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
  return wrapDisplayLinesLimited(text, maxCols, Number.POSITIVE_INFINITY).lines
}

/**
 * Wrap at most `limit` display rows. A truncated result means later source
 * was not measured, so callers can stop on long values.
 * @param text - already-escaped plain text.
 * @param maxCols - column budget per row.
 * @param limit - maximum returned rows; must be positive.
 * @returns fitted rows and whether source remains beyond the limit.
 */
export function wrapDisplayLinesLimited(
  text: string,
  maxCols: number,
  limit: number,
): { readonly lines: string[]; readonly truncated: boolean } {
  const bounded = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY
  const source = text.split('\n')
  if (bounded === 0) return { lines: [], truncated: text !== '' }
  if (maxCols <= 0) {
    const lines = source.slice(0, bounded)
    return { lines, truncated: source.length > lines.length }
  }
  const out: string[] = []
  const room = (): boolean => out.length < bounded
  const mark = (line: string): void => {
    const marker = `${wcwidthSafeSlice(line, Math.max(0, maxCols - 1))}…`
    if (out.length < bounded) out.push(marker)
    else out[out.length - 1] = marker
  }
  for (let lineIndex = 0; lineIndex < source.length; lineIndex += 1) {
    const line = source[lineIndex] ?? ''
    const laterLine = lineIndex < source.length - 1
    if (line === '' || displayWidth(line) <= maxCols) {
      if (!room()) {
        mark('')
        return { lines: out, truncated: true }
      }
      if (out.length + 1 === bounded && laterLine) {
        mark(line)
        return { lines: out, truncated: true }
      }
      out.push(line)
      continue
    }
    if (/^[\x20-\x7e]*$/u.test(line)) {
      for (let i = 0; i < line.length; i += maxCols) {
        const piece = line.slice(i, i + maxCols)
        const continues = i + maxCols < line.length || laterLine
        if (!room()) {
          mark(piece)
          return { lines: out, truncated: true }
        }
        if (out.length + 1 === bounded && continues) {
          mark(piece)
          return { lines: out, truncated: true }
        }
        out.push(piece)
      }
      continue
    }
    let curLine = ''
    let curCols = 0
    const segments = [...GRAPHEME.segment(line)]
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex]?.segment ?? ''
      const width = displayWidth(segment)
      if (curCols + width <= maxCols || curLine === '') {
        curLine += segment
        curCols += width
        continue
      }
      if (!room()) {
        mark(curLine)
        return { lines: out, truncated: true }
      }
      const continues = segmentIndex < segments.length || laterLine
      if (out.length + 1 === bounded && continues) {
        mark(curLine)
        return { lines: out, truncated: true }
      }
      out.push(curLine)
      curLine = segment
      curCols = width
    }
    if (curLine !== '') {
      if (!room()) {
        mark(curLine)
        return { lines: out, truncated: true }
      }
      if (out.length + 1 === bounded && laterLine) {
        mark(curLine)
        return { lines: out, truncated: true }
      }
      out.push(curLine)
    }
  }
  return { lines: out, truncated: false }
}
