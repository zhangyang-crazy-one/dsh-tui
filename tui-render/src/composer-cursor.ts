/**
 * Composer caret geometry: the terminal cursor position that anchors the IME's
 * native inline preedit at the composer caret. Ink 7.1.1 exposes no runtime
 * composition state, and the terminal emulator renders the preedit itself at
 * the cursor, so the only contract we own is placing that cursor. Pure — no
 * I/O, no timing, no IME detection.
 * @module @deepseek-ai/dsh-tui-render/composer-cursor
 */

import { displayWidth } from './content.ts'

/** Grapheme splitter for left/right caret steps. */
const GRAPHEME = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** One caret position on the composer's line/column grid. */
export interface ComposerCaretPosition {
  /** Zero-based line of the caret within the buffered text. */
  row: number
  /** Zero-based display column of the caret within that line. */
  col: number
}

/**
 * Compute the composer caret position for a caret index into the buffered
 * text. Lines split on `\n`; each line's column is its display width, so wide
 * glyphs (CJK, emoji/ZWJ sequences) count their terminal columns and are never
 * split. A caret past the end clamps to the end; a negative caret clamps to 0.
 * @param text - the buffered text.
 * @param caretIndex - the caret offset into `text` (clamped into range).
 * @returns the caret's row/col on the display grid.
 */
export function composerCursorPosition(
  text: string,
  caretIndex: number,
): ComposerCaretPosition {
  const clamped = Math.max(0, Math.min(caretIndex, text.length))
  const before = text.slice(0, clamped)
  const lines = before.split('\n')
  // v8 ignore next -- String.prototype.split('\n') always yields at least one string.
  const lastLine = lines[lines.length - 1] ?? ''
  return { row: lines.length - 1, col: displayWidth(lastLine) }
}

/**
 * Clamp a caret offset into `text`. A missing index means the end of the
 * buffer, which is how tests and first-keystroke state omit the field.
 * @param text - the buffered text.
 * @param caretIndex - the requested offset, or undefined for the end.
 * @returns an index in `[0, text.length]`.
 */
export function clampCaretIndex(text: string, caretIndex: number | undefined): number {
  if (caretIndex === undefined) return text.length
  return Math.max(0, Math.min(caretIndex, text.length))
}

/**
 * Move the caret one grapheme left (`-1`) or right (`1`). A step never splits
 * a CJK glyph or an emoji/ZWJ sequence.
 * @param text - the buffered text.
 * @param caretIndex - the current offset, already clamped or not.
 * @param direction - `-1` left, `1` right.
 * @returns the next caret offset.
 */
export function moveCaretByGrapheme(
  text: string,
  caretIndex: number,
  direction: -1 | 1,
): number {
  const caret = clampCaretIndex(text, caretIndex)
  if (direction < 0) {
    if (caret <= 0) return 0
    let last = 0
    let offset = 0
    for (const part of GRAPHEME.segment(text.slice(0, caret))) {
      last = offset
      offset += part.segment.length
    }
    return last
  }
  if (caret >= text.length) return text.length
  for (const part of GRAPHEME.segment(text.slice(caret))) {
    return caret + part.segment.length
  }
  // v8 ignore next -- Intl.Segmenter yields a grapheme for every non-empty remainder.
  return text.length
}

/** Viewport used to turn composer caret geometry into a frame-suffix CSI anchor. */
export interface ComposerFrameAnchorOptions {
  /** Display columns of the prompt marker before the buffer (`> ` is 2). */
  promptWidth: number
  /** Terminal width in columns. */
  columns: number
  /** Terminal height in rows. */
  rows: number
  /**
   * Whether Ink wrote a fullscreen frame. A TTY frame whose height fills the
   * viewport is written without a trailing newline, so the cursor remains on
   * the last output row. Non-fullscreen frames append a newline and leave the
   * cursor one row below the frame.
   */
  fullscreen: boolean
  /**
   * Extra painted rows below the composer inside the same frame (the slash
   * palette). Fullscreen frames leave the cursor on the last output row, so
   * those rows must be counted in `up`.
   */
  rowsBelow?: number
}

/**
 * CSI origin appended after Ink's frame write: `up` counts rows above the
 * post-frame cursor, and `col` is the 1-based target column.
 */
export interface ComposerFrameAnchor {
  /** Rows to move up from the post-frame cursor; 0 keeps the current row. */
  up: number
  /** 1-based column for CSI `G`. */
  col: number
}

/**
 * Convert composer caret geometry into the CSI origin appended after Ink's
 * frame write. Fullscreen TTY frames leave the cursor on the last output row,
 * so the last composer line is `up = 0`; a trailing-newline frame leaves the
 * cursor one row below, so that line is `up = 1`.
 * @param text - the buffered text.
 * @param caretIndex - the caret offset into `text` (clamped into range).
 * @param options - prompt width, viewport, and whether the frame is fullscreen.
 * @returns the clamped `{ up, col }` handed to the frame-fill caret suffix.
 */
export function composerFrameAnchor(
  text: string,
  caretIndex: number,
  options: ComposerFrameAnchorOptions,
): ComposerFrameAnchor {
  const caret = composerCursorPosition(text, caretIndex)
  const lineCount = Math.max(1, text.split('\n').length)
  const rowsBelow = Math.max(0, options.rowsBelow ?? 0)
  const lastLineUp = lineCount - 1 - caret.row + rowsBelow
  const upFromCursor = options.fullscreen ? lastLineUp : lastLineUp + 1
  return {
    up: Math.max(0, Math.min(upFromCursor, Math.max(0, options.rows - 1))),
    col: Math.max(
      1,
      Math.min(options.promptWidth + caret.col + 1, Math.max(1, options.columns)),
    ),
  }
}
