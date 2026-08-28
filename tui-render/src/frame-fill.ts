/**
 * Full-frame background fill and caret anchoring. The Grok contract is a
 * uniformly pure-black frame, but Ink only emits rows that carry content:
 * gutters, inter-block blanks, and the region below the last frame row keep
 * the terminal's default background. BCE-capable terminals (xterm, iTerm2,
 * kitty, alacritty, Windows Terminal) fill erased cells with the SGR
 * background current at erase time, so this module wraps the frame stream:
 * every erase sequence that fills *visible* cells — log-update's per-row
 * `ESC[2K` / `ESC[K`, and `clearTerminal`'s `ESC[2J` — is bracketed by the
 * `bg` token and a bg reset, and entering the alternate screen is followed
 * by a full erase-display so never-painted rows land on black as well.
 * `ESC[3J` (erase saved lines / scrollback) is left unbracketed: a BCE
 * terminal fills erased cells with the current background, and wrapping
 * that sequence would paint the whole scrollback black on every overflowing
 * frame, filling the PTY and stalling Ink's writes. The `none` tier leaves
 * styling bytes untouched (zero-ANSI contract). Terminals without BCE still
 * show their default background on untouched rows; the per-row paintRow
 * strips remain the fallback there.
 *
 * The caret anchor works around a React-reconciler ordering fact:
 * `resetAfterCommit` — where Ink renders frames — runs right after the
 * mutation phase, before layout and passive effects, so any cursor position
 * set from an effect trails the text by one commit (the IME follow-along
 * bug). The composer instead publishes its caret during render via
 * {@link setFrameCaret}, and the stream wrapper appends the positioning
 * sequence after Ink's own (stale) cursor suffix — last write wins. On a
 * fullscreen TTY frame Ink leaves the cursor on the last output row, so the
 * last composer line is `up = 0`; a trailing-newline frame needs `up = 1`.
 * @module @deepseek-ai/dsh-tui-render/frame-fill
 */

import { bgSequence, currentTier } from './theme.ts'
import type { ColorTier } from './terminal-capabilities.ts'

/** Resets the active background to the terminal default. */
const BG_OFF = '\x1b[49m'

/**
 * Erase sequences that fill *visible* cells, in line form from log-update
 * (`eraseLine`, `eraseEndLine`) and in display form from `clearTerminal`'s
 * `eraseScreen`. No entry is a substring of another, so plain replacement
 * order is safe. `ESC[3J` is deliberately absent: it erases scrollback, not
 * the current screen, and bracketing it with `bg` makes BCE terminals paint
 * the whole saved buffer on every overflowing frame.
 */
const ERASE_SEQUENCES = ['\x1b[2K', '\x1b[K', '\x1b[2J'] as const

/** Enter-alternate-screen sequence Ink writes when mounting with `alternateScreen: true`. */
const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h'

/** Erase display (BCE fills with the current background) plus cursor home. */
const ERASE_DISPLAY = '\x1b[2J\x1b[H'

/** End of a synchronized-output frame; also where Ink's cursor suffix lives. */
const END_SYNC = '\x1b[?2026l'

/** Cursor visibility sequences Ink emits in its frame suffix. */
const SHOW_CURSOR = '\x1b[?25h'
const HIDE_CURSOR = '\x1b[?25l'

/**
 * The composer's caret, in frame-suffix terms: `up` counts rows above the
 * frame's bottom edge (the line just after the last output row) and `col` is
 * the 1-based target column. `'hide'` parks the cursor invisible, e.g. while
 * a full-content panel owns the screen.
 */
export type FrameCaret = { readonly up: number; readonly col: number } | 'hide'

let frameCaret: FrameCaret | undefined

/**
 * Publish the composer caret for the next frame writes. Called during the
 * composer's render so the value is current before Ink's resetAfterCommit
 * frame write; idempotent across discarded concurrent renders.
 * @param caret - the caret position, or undefined to leave the cursor alone.
 */
export function setFrameCaret(
  caret: { up: number; col: number } | undefined,
): void {
  frameCaret = caret
}

/** Park the cursor invisible from the next frame on (sticky until set). */
export function hideFrameCaret(): void {
  frameCaret = 'hide'
}

/** The appended caret bytes for the current anchor, or '' when unset. */
function caretSuffix(): string {
  if (frameCaret === undefined) return ''
  if (frameCaret === 'hide') return HIDE_CURSOR
  return (
    (frameCaret.up > 0 ? `\x1b[${frameCaret.up}A` : '') +
    `\x1b[${frameCaret.col}G` +
    SHOW_CURSOR
  )
}

/**
 * Caret bytes currently published for the next frame. Mouse selection overlay
 * rewrites cells after Ink's write and must restore this suffix so the
 * composer caret is not left on the inverted run.
 * @returns the same suffix {@link transformFrameChunk} appends, or ''.
 */
export function publishedCaretBytes(): string {
  return caretSuffix()
}

/**
 * Bracket every visible-cell erase sequence in one output chunk with the
 * tier's `bg` activator and a background reset, append a full
 * display erase right
 * after an alternate-screen entry, and — whenever the chunk is a frame
 * carrying cursor bytes — append the published caret position after Ink's
 * own cursor suffix so the freshest position wins. Content bytes pass
 * through unchanged; at the `none` tier styling stays zero-ANSI while the
 * caret anchor still applies.
 * @param chunk - raw bytes about to be written to the terminal.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns the chunk with erase bracketing and caret anchoring applied.
 */
export function transformFrameChunk(
  chunk: string,
  tier: ColorTier = currentTier(),
): string {
  if (!chunk.includes('\x1b')) return chunk
  let out = chunk
  const on = bgSequence(tier)
  if (on !== '') {
    for (const sequence of ERASE_SEQUENCES) {
      out = out.replaceAll(sequence, `${on}${sequence}${BG_OFF}`)
    }
    // Runs after the loop so the erase it inserts is not bracketed twice.
    if (out.includes(ENTER_ALTERNATE_SCREEN)) {
      out = out.replaceAll(
        ENTER_ALTERNATE_SCREEN,
        `${ENTER_ALTERNATE_SCREEN}${on}${ERASE_DISPLAY}${BG_OFF}`,
      )
    }
  }
  if (
    out.includes(END_SYNC) ||
    out.includes(SHOW_CURSOR) ||
    out.includes(HIDE_CURSOR)
  ) {
    out += caretSuffix()
  }
  return out
}

/** Loose call shape covering the WriteStream write overloads. */
type WriteCall = (chunk: unknown, ...args: unknown[]) => boolean

/**
 * Wrap a stdout stream so every written chunk passes through
 * {@link transformFrameChunk} at the tier current at write time. The wrapper
 * prototypes the real stream so size, resize events, and TTY flags stay live.
 * @param stdout - the stream Ink writes frames to.
 * @param getTier - tier source evaluated per write (defaults to {@link currentTier}).
 * @returns the stream to hand to Ink's `render` options.
 */
export function wrapStdoutForFrameBg(
  stdout: NodeJS.WriteStream,
  getTier: () => ColorTier = currentTier,
): NodeJS.WriteStream {
  const write = stdout.write.bind(stdout) as WriteCall
  const wrapped = Object.create(stdout) as NodeJS.WriteStream
  const transformingWrite: WriteCall = (chunk, ...args) =>
    write(
      typeof chunk === 'string' ? transformFrameChunk(chunk, getTier()) : chunk,
      ...args,
    )
  wrapped.write = transformingWrite
  return wrapped
}
