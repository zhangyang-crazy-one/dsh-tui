/**
 * Full-frame background fill and caret anchoring. The product frame is a
 * uniformly pure-black plane, but Ink emits centered leading spaces and whole
 * overflow frames as ordinary bytes without a per-row erase. This wrapper
 * keeps the `bg` token active for every colored-tier string write, restores it
 * immediately after content resets, and returns to the terminal default after
 * the write. Visible-line and screen erases therefore use black BCE, while
 * `ESC[3J` temporarily switches to the terminal default so a scrollback wipe
 * cannot paint and fill the saved buffer. Entering the alternate screen still
 * triggers a black full-display erase for never-painted rows. The `none` tier
 * leaves styling bytes untouched (zero-ANSI contract). Terminals without BCE
 * still rely on printed background cells for regions an erase cannot paint.
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

/** Complete SGR reset emitted by product styling and Ink. */
const SGR_RESET = '\x1b[0m'

/** Erase saved lines / scrollback; it must run on the terminal default bg. */
const ERASE_SCROLLBACK = '\x1b[3J'

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
 * Keep the frame background active across every colored-tier string chunk and
 * content reset, protect scrollback erasure with the terminal default, append
 * a full display erase right after an alternate-screen entry, and — whenever the chunk is a frame
 * carrying cursor bytes — append the published caret position after Ink's
 * own cursor suffix so the freshest position wins. Content bytes pass
 * through unchanged; at the `none` tier styling stays zero-ANSI while the
 * caret anchor still applies.
 * @param chunk - raw bytes about to be written to the terminal.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns the chunk with frame-background and caret anchoring applied.
 */
export function transformFrameChunk(
  chunk: string,
  tier: ColorTier = currentTier(),
): string {
  let out = chunk
  const on = bgSequence(tier)
  if (on !== '') {
    if (out.includes('\x1b')) {
      out = out
        .replaceAll(SGR_RESET, `${SGR_RESET}${on}`)
        .replaceAll(BG_OFF, `${BG_OFF}${on}`)
        .replaceAll(
          ERASE_SCROLLBACK,
          `${BG_OFF}${ERASE_SCROLLBACK}${on}`,
        )
    }
    if (out.includes(ENTER_ALTERNATE_SCREEN)) {
      out = out.replaceAll(
        ENTER_ALTERNATE_SCREEN,
        `${ENTER_ALTERNATE_SCREEN}${on}${ERASE_DISPLAY}`,
      )
    }
    out = `${on}${out}${BG_OFF}`
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
