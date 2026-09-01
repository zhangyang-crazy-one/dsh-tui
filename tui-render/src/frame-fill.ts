/**
 * Full-frame background fill, fixed-column rail painting, and caret
 * anchoring. The product frame is a uniformly pure-black plane, but Ink emits
 * centered leading spaces and whole overflow frames as ordinary bytes without
 * a per-row erase. This wrapper keeps the `bg` token active for every
 * colored-tier string write, restores it
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
 * The transcript rail follows the same frame-suffix path but uses absolute
 * CUP coordinates. It therefore stays in one physical terminal column even
 * when a preceding emoji sequence has a different width in Ink and the host
 * terminal. The overlay clears cells from a prior position before repainting
 * the current track, then restores the composer caret last.
 *
 * The transcript snapshot is authoritative at the same suffix: changed
 * visible physical lines repaint at absolute coordinates after Ink's
 * incremental output, then shortened or vacated ranges are cleared. A partial
 * Ink diff therefore cannot leave missing cells, while stable rows remain
 * write-free. A changed repaint key defers one full transcript scrub until
 * synchronized output ends, then repaints the snapshot after Ink's last write.
 * @module @deepseek-ai/dsh-tui-render/frame-fill
 */

import {
  bgSequence,
  currentTier,
  paintBackgroundRow,
  paintRow,
  styled,
} from './theme.ts'
import type { ColorTier } from './terminal-capabilities.ts'
import { displayWidth } from './content.ts'
import { hyperlinksEnabled, isOsc8Href, wrapOsc8 } from './hyperlink.ts'
import { completeDeltaStdoutDrain } from './frame-metrics.ts'
import type { FrameMetricsHandle } from './frame-metrics.ts'
import {
  diffVisibleFrameSnapshots,
  visibleFrameSnapshot,
} from './frame-snapshot.ts'
import type { VisibleFrameSnapshot } from './frame-snapshot.ts'
import type { PhysicalLine } from './physical-line.ts'

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

/** Raw overlay writer installed on the wrapped stdout. */
const WRITE_FRAME_OVERLAY = Symbol('dsh.tui.write-frame-overlay')

/**
 * The composer's caret, in frame-suffix terms: `up` counts rows above the
 * frame's bottom edge (the line just after the last output row) and `col` is
 * the 1-based target column. `'hide'` parks the cursor invisible, e.g. while
 * a full-content panel owns the screen.
 */
export type FrameCaret = { readonly up: number; readonly col: number } | 'hide'

/** Absolute terminal geometry and thumb position for one transcript rail. */
export interface FrameRail {
  /** One-based terminal column. */
  readonly col: number
  /** One-based first terminal row. */
  readonly topRow: number
  /** Number of track rows. */
  readonly rows: number
  /** Zero-based first thumb row within the track. */
  readonly thumbStart: number
  /** Number of thumb rows. */
  readonly thumbRows: number
}

let frameCaret: FrameCaret | undefined
let frameRail: FrameRail | undefined
let paintedFrameRail: FrameRail | undefined
let paintedVisibleFrame: VisibleFrameSnapshot | undefined
let paintedTranscriptRepaintKey: string | number | undefined

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

/**
 * Publish fixed terminal cells for the next frame write. StreamView calls this
 * during render so the frame suffix and pointer region derive from the same
 * measured geometry.
 * @param rail - current rail geometry, or undefined without overflow.
 */
export function setFrameRail(rail: FrameRail | undefined): void {
  frameRail = rail
}

function railCell(
  row: number,
  col: number,
  text: string,
  tier: ColorTier,
): string {
  return `\x1b[${String(row)};${String(col)}H${text === ' '
    ? styled(text, 'bg', tier)
    : styled(styled(text, text === '█' ? 'accent' : 'fgDim', tier), 'bg', tier)}`
}

/** Paint one rail cell and clear the guard cell that can retain a wide glyph. */
function railRow(
  row: number,
  col: number,
  text: string,
  tier: ColorTier,
): string {
  const guard = col > 1 ? railCell(row, col - 1, ' ', tier) : ''
  return guard + railCell(row, col, text, tier)
}

/** Absolute rail bytes for this frame, including stale-position clearing. */
function railOverlay(tier: ColorTier): string {
  let cells = ''
  const next = frameRail
  const previous = paintedFrameRail
  if (
    previous !== undefined
    && (next === undefined || previous.col !== next.col)
  ) {
    for (let index = 0; index < previous.rows; index += 1) {
      cells += railRow(previous.topRow + index, previous.col, ' ', tier)
    }
  } else if (
    previous !== undefined
    && next !== undefined
    && previous.col === next.col
  ) {
    const nextStart = next.topRow
    const nextEnd = next.topRow + next.rows
    for (let index = 0; index < previous.rows; index += 1) {
      const row = previous.topRow + index
      if (row < nextStart || row >= nextEnd) {
        cells += railRow(row, previous.col, ' ', tier)
      }
    }
  }
  if (next !== undefined) {
    for (let index = 0; index < next.rows; index += 1) {
      const thumb = index >= next.thumbStart
        && index < next.thumbStart + next.thumbRows
      cells += railRow(next.topRow + index, next.col, thumb ? '█' : '·', tier)
    }
  }
  paintedFrameRail = next
  return cells === '' ? '' : `\x1b7${cells}\x1b8`
}

function paintPhysicalLine(line: PhysicalLine, tier: ColorTier): string {
  const parts = line.spans.map((span) => {
    const text = styled(span.text, span.token, tier, span.bold)
    return span.href !== undefined
      && hyperlinksEnabled()
      && isOsc8Href(span.href)
      ? wrapOsc8(text, span.href)
      : text
  })
  return line.background === 'codeBg'
    ? paintBackgroundRow(parts, 'codeBg', Math.max(1, line.displayWidth), tier)
    : paintRow(parts, tier)
}

/** Repaint changed rows; a new repaint key also scrubs the owned region once. */
function transcriptOverlay(
  tier: ColorTier,
  synchronizedFrameEnded: boolean,
): { bytes: string; afterSync: boolean } {
  const next = visibleFrameSnapshot()
  if (next === undefined) {
    paintedVisibleFrame = undefined
    paintedTranscriptRepaintKey = undefined
    return { bytes: '', afterSync: false }
  }
  const repaintAll = synchronizedFrameEnded
    && next.repaintKey !== undefined
    && next.repaintKey !== paintedTranscriptRepaintKey
  if (repaintAll) paintedTranscriptRepaintKey = next.repaintKey
  const diff = diffVisibleFrameSnapshots(paintedVisibleFrame, next)
  paintedVisibleFrame = next
  let cells = ''
  if (repaintAll) {
    const { transcriptLeft, transcriptRows, transcriptTop, transcriptWidth } = next.geometry
    const blank = styled(' '.repeat(transcriptWidth), 'bg', tier)
    for (let index = 0; index < transcriptRows; index += 1) {
      cells += `\x1b[${String(transcriptTop + index)};${String(transcriptLeft)}H${blank}`
    }
    for (const row of next.rows) {
      cells += `\x1b[${String(row.row)};${String(row.col)}H`
        + paintPhysicalLine(row.line, tier)
    }
    return {
      bytes: cells === '' ? '' : `\x1b7${cells}\x1b8`,
      afterSync: true,
    }
  }
  for (const change of diff.changes) {
    const nextWidth = change.line?.displayWidth ?? 0
    const staleColumns = change.clearColumns - nextWidth
    if (change.line !== undefined) {
      cells += `\x1b[${String(change.row)};${String(change.col)}H`
        + paintPhysicalLine(change.line, tier)
    }
    if (staleColumns > 0) {
      cells += `\x1b[${String(change.row)};${String(change.col + nextWidth)}H`
        + styled(' '.repeat(staleColumns), 'bg', tier)
    }
  }
  return {
    bytes: cells === '' ? '' : `\x1b7${cells}\x1b8`,
    afterSync: false,
  }
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
 * Paint a newly measured rail even when Ink's visible frame is unchanged.
 * Wrapped streams bypass their ordinary frame transform for these already
 * styled absolute cells; direct test streams receive the same bytes.
 * @param stdout - the stdout exposed by Ink's render context.
 * @param tier - color tier used for track and thumb cells.
 */
export function writePublishedFrameRail(
  stdout: NodeJS.WriteStream,
  tier: ColorTier = currentTier(),
): void {
  const overlay = railOverlay(tier)
  if (overlay === '') return
  const bytes = overlay + caretSuffix()
  const writer = (stdout as FrameOverlayStream)[WRITE_FRAME_OVERLAY]
  if (writer === undefined) {
    stdout.write(bytes)
    return
  }
  writer(bytes)
}

/**
 * Keep the frame background active across every colored-tier string chunk and
 * content reset, protect scrollback erasure with the terminal default, append
 * a full display erase right after an alternate-screen entry, and paint the
 * fixed-column rail before synchronized output ends whenever the chunk carries
 * frame cursor bytes. It appends the published caret after Ink's own cursor
 * suffix so the freshest position wins. Content bytes pass through unchanged;
 * at the `none` tier styling stays zero-ANSI while the caret anchor still
 * applies.
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
  const isFrame =
    out.includes(END_SYNC) ||
    out.includes(SHOW_CURSOR) ||
    out.includes(HIDE_CURSOR)
  if (isFrame) {
    const transcript = transcriptOverlay(tier, out.includes(END_SYNC))
    if (transcript.bytes !== '' && transcript.afterSync) {
      out += transcript.bytes
    } else if (transcript.bytes !== '') {
      const syncIndex = out.lastIndexOf(END_SYNC)
      out = syncIndex < 0
        ? out + transcript.bytes
        : out.slice(0, syncIndex) + transcript.bytes + out.slice(syncIndex)
    }
    const overlay = railOverlay(tier)
    if (overlay !== '') {
      const syncIndex = out.lastIndexOf(END_SYNC)
      out = syncIndex < 0
        ? out + overlay
        : out.slice(0, syncIndex) + overlay + out.slice(syncIndex)
    }
    out += caretSuffix()
  }
  return out
}

/** Loose call shape covering the WriteStream write overloads. */
type WriteCall = (chunk: unknown, ...args: unknown[]) => boolean

/** Wrapped stdout with a raw path for an already transformed rail overlay. */
type FrameOverlayStream = NodeJS.WriteStream & {
  [WRITE_FRAME_OVERLAY]?: (chunk: string) => boolean
}

/**
 * Wrap a stdout stream so every written chunk passes through
 * {@link transformFrameChunk} at the tier current at write time. The wrapper
 * prototypes the real stream so size, resize events, and TTY flags stay live.
 * @param stdout - the stream Ink writes frames to.
 * @param getTier - tier source evaluated per write (defaults to {@link currentTier}).
 * @param frameMetrics - optional written-cell and stdout-drain measurements.
 * @returns the stream to hand to Ink's `render` options.
 */
export function wrapStdoutForFrameBg(
  stdout: NodeJS.WriteStream,
  getTier: () => ColorTier = currentTier,
  frameMetrics?: FrameMetricsHandle,
): NodeJS.WriteStream {
  const write = stdout.write.bind(stdout) as WriteCall
  const wrapped = Object.create(stdout) as NodeJS.WriteStream
  const transformingWrite: WriteCall = (chunk, ...args) => {
    const transformed = typeof chunk === 'string'
      ? transformFrameChunk(chunk, getTier())
      : chunk
    if (frameMetrics !== undefined && typeof transformed === 'string') {
      frameMetrics.addWrittenCells(countWrittenCells(transformed))
      const last = args.at(-1)
      const onDrain = (): void => {
        completeDeltaStdoutDrain(frameMetrics)
      }
      if (typeof last === 'function') {
        const original = last as (...callbackArgs: unknown[]) => void
        args[args.length - 1] = (...callbackArgs: unknown[]) => {
          onDrain()
          original(...callbackArgs)
        }
      } else {
        args.push(onDrain)
      }
    }
    return write(transformed, ...args)
  }
  wrapped.write = transformingWrite
  const overlayStream = wrapped as FrameOverlayStream
  overlayStream[WRITE_FRAME_OVERLAY] = (chunk: string) => write(chunk)
  return wrapped
}

/** ANSI/OSC controls do not occupy cells in a completed terminal write. */
const TERMINAL_CONTROL_PATTERN = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b./gu

/**
 * Count printable display cells carried by one terminal write. Cursor moves,
 * SGR, OSC, CR/LF and other C0 controls are excluded.
 * @param chunk - transformed bytes handed to the actual stdout stream.
 * @returns printable display-cell count.
 */
export function countWrittenCells(chunk: string): number {
  const printable = chunk
    .replace(TERMINAL_CONTROL_PATTERN, '')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
  return displayWidth(printable)
}
