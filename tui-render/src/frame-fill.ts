/**
 * Full-frame background fill, fixed-column rail painting, and caret
 * anchoring. The product frame is a uniform Soft Slate plane, but Ink emits
 * centered leading spaces and whole overflow frames as ordinary bytes without
 * a per-row erase. This wrapper keeps the `bg` token active for every
 * colored-tier string write, restores it
 * immediately after content resets, and returns to the terminal default after
 * the write. Visible-line and screen erases therefore use theme BCE, while
 * `ESC[3J` temporarily switches to the terminal default so a scrollback wipe
 * cannot paint and fill the saved buffer. Entering the alternate screen still
 * triggers a themed full-display erase for never-painted rows. The `none` tier
 * leaves styling bytes untouched (zero-ANSI contract). Terminals without BCE
 * still rely on printed background cells for regions an erase cannot paint.
 *
 * The caret anchor works around a React-reconciler ordering fact:
 * `resetAfterCommit` — where Ink renders frames — runs right after the
 * mutation phase, before layout and passive effects, so any cursor position
 * set from an effect trails the text by one commit (the IME follow-along
 * bug). The composer instead publishes its caret during render via
 * {@link setFrameCaret}, and the stream wrapper appends the positioning
 * sequence after Ink's own cursor suffix. The published row and column are
 * absolute, so independent overlays restore the same position without
 * depending on the cursor left by a previous write.
 * The transcript rail follows the same frame-suffix path but uses absolute
 * CUP coordinates. It therefore stays in one physical terminal column even
 * when a preceding emoji sequence has a different width in Ink and the host
 * terminal. The overlay clears cells from a prior position before repainting
 * the current track, wraps layout-only rail writes in synchronized output,
 * then restores the composer caret last.
 *
 * The transcript snapshot is authoritative at the same suffix: changed
 * visible physical lines repaint at absolute coordinates after Ink's
 * incremental output, then shortened or vacated ranges are cleared. A partial
 * Ink diff therefore cannot leave missing cells, while stable rows remain
 * write-free. A changed repaint key defers one full-width scrub of every owned
 * transcript row until synchronized output ends, then repaints the snapshot
 * after Ink's last write.
 * @module @deepseek-ai/dsh-tui-render/frame-fill
 */

import {
  currentAppearance,
  bgSequence,
  currentTier,
  paintBackgroundRow,
  paintRow,
  styled,
} from './theme.ts'
import type { ColorTier } from './terminal-capabilities.ts'
import { displayWidth } from './content.ts'
import { hyperlinksEnabled, isOsc8Href, wrapOsc8 } from './hyperlink.ts'
import { completeDeltaStdoutDrain, takeScrollPaintCompletion } from './frame-metrics.ts'
import type { FrameMetricsHandle } from './frame-metrics.ts'
import {
  diffVisibleFrameSnapshots,
  visibleFrameSnapshot,
} from './frame-snapshot.ts'
import type { VisibleFrameSnapshot } from './frame-snapshot.ts'
import type { PhysicalLine } from './physical-line.ts'
import { TerminalChunks, terminalBackground } from './terminal-chunks.ts'
import { deferTerminalPaint, registerTerminalOutput, TerminalOutput, type OutputSource } from './terminal-output.ts'

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

/** Start of a synchronized-output frame for layout-only overlays. */
const START_SYNC = '\x1b[?2026h'

/** Cursor visibility sequences Ink emits in its frame suffix. */
const SHOW_CURSOR = '\x1b[?25h'
const HIDE_CURSOR = '\x1b[?25l'

/** Raw overlay writer installed on the wrapped stdout. */
const WRITE_FRAME_OVERLAY = Symbol('dsh.tui.write-frame-overlay')
const DISPOSE_FRAME_OUTPUT = Symbol('dsh.tui.dispose-frame-output')
export const MAX_PENDING_CONTROL_BYTES = 64 * 1024
export const MAX_PENDING_CONTROLS = 64

/**
 * The composer's absolute one-based terminal position. `'hide'` parks the
 * cursor invisible while a panel without an editor owns the screen.
 */
export type FrameCaret = { readonly row: number; readonly col: number } | 'hide'

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
let transcriptInvalidated = false

/**
 * Publish the composer caret for the next frame writes. Called during the
 * composer's render so the value is current before Ink's resetAfterCommit
 * frame write; idempotent across discarded concurrent renders.
 * @param caret - the caret position, or undefined to leave the cursor alone.
 */
export function setFrameCaret(
  caret: { row: number; col: number } | undefined,
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

/** Release the rail's cells to the replacement pane without a later erase. */
export function releaseFrameRail(): void {
  frameRail = undefined
  paintedFrameRail = undefined
}

function railCell(
  row: number,
  col: number,
  text: string,
  tier: ColorTier,
): string {
  const position = `\x1b[${String(row)};${String(col)}H`
  if (text === ' ') return position + styled(text, 'bg', tier)
  const token = text === '█' ? 'accent' : 'fgDim'
  return position + styled(styled(text, token, tier), 'bg', tier)
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

function sameRail(a: FrameRail | undefined, b: FrameRail | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return a.col === b.col
    && a.topRow === b.topRow
    && a.rows === b.rows
    && a.thumbStart === b.thumbStart
    && a.thumbRows === b.thumbRows
}

/** Absolute rail bytes for this frame, including stale-position clearing. */
function railOverlay(tier: ColorTier, force = false): string {
  const next = frameRail
  const previous = paintedFrameRail
  if (!force && sameRail(previous, next)) return ''
  let cells = ''
  const geometry = visibleFrameSnapshot()?.geometry
  const clearPreviousRow = (row: number, col: number): string => {
    // After resize, the terminal clamps old coordinates into the new footer.
    // Ink owns cells outside the current transcript, including vacated chrome.
    if (geometry !== undefined && (
      col > geometry.columns
      || row < geometry.transcriptTop
      || row >= geometry.transcriptTop + geometry.transcriptRows
      || row > geometry.rows
    )) return ''
    return railRow(row, col, ' ', tier)
  }
  if (
    previous !== undefined
    && (next === undefined || previous.col !== next.col)
  ) {
    for (let index = 0; index < previous.rows; index += 1) {
      cells += clearPreviousRow(previous.topRow + index, previous.col)
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
        cells += clearPreviousRow(row, previous.col)
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

const paintedPhysicalLineCache = new WeakMap<PhysicalLine, Map<string, string>>()

function paintPhysicalLine(line: PhysicalLine, tier: ColorTier): string {
  const hyperlinks = hyperlinksEnabled()
  const cacheKey = `${tier}:${hyperlinks ? 1 : 0}`
  let byTier = paintedPhysicalLineCache.get(line)
  if (byTier === undefined) {
    byTier = new Map<string, string>()
    paintedPhysicalLineCache.set(line, byTier)
  }
  const cached = byTier.get(cacheKey)
  if (cached !== undefined) return cached

  const parts = line.spans.map((span) => {
    const text = styled(span.text, span.token, tier, span.bold)
    return span.href !== undefined
      && hyperlinks
      && isOsc8Href(span.href)
      ? wrapOsc8(text, span.href)
      : text
  })
  const painted = line.background !== undefined && line.background !== 'bg'
    ? paintBackgroundRow(
      parts,
      line.background,
      line.backgroundColumns ?? Math.max(1, line.displayWidth),
      tier,
    )
    : paintRow(parts, tier)
  byTier.set(cacheKey, painted)
  return painted
}

const blankPadCache = new Map<string, string>()

function blankPad(count: number, tier: ColorTier): string {
  if (count <= 0) return ''
  const key = `${currentAppearance()}:${tier}:${String(count)}`
  let cached = blankPadCache.get(key)
  if (cached === undefined) {
    cached = styled(' '.repeat(count), 'bg', tier)
    blankPadCache.set(key, cached)
  }
  return cached
}

/** Repaint changed rows; a new repaint key also scrubs the owned region once. */
function transcriptOverlay(
  tier: ColorTier,
  synchronizedFrameEnded: boolean,
): string {
  const next = visibleFrameSnapshot()
  if (next === undefined) {
    paintedVisibleFrame = undefined
    paintedTranscriptRepaintKey = undefined
    transcriptInvalidated = false
    return ''
  }
  if (!transcriptInvalidated && paintedVisibleFrame === next && (next.repaintKey === undefined || next.repaintKey === paintedTranscriptRepaintKey)) {
    return ''
  }
  const diff = diffVisibleFrameSnapshots(paintedVisibleFrame, next)
  // Old row coordinates and clear widths belong to the previous terminal
  // geometry. Wait for Ink's completed frame, then repaint only the new slot.
  if ((diff.forced || transcriptInvalidated) && !synchronizedFrameEnded) return ''
  const repaintAll = synchronizedFrameEnded && (
    diff.forced
    || transcriptInvalidated
    || (next.repaintKey !== undefined && next.repaintKey !== paintedTranscriptRepaintKey)
  )
  if (repaintAll) {
    paintedTranscriptRepaintKey = next.repaintKey
    transcriptInvalidated = false
  }
  paintedVisibleFrame = next
  let cells = ''
  if (repaintAll) {
    const { columns, transcriptRows, transcriptTop } = next.geometry
    const blank = blankPad(columns, tier)
    for (let index = 0; index < transcriptRows; index += 1) {
      cells += `\x1b[${String(transcriptTop + index)};1H${blank}`
    }
    for (const row of next.rows) {
      cells += `\x1b[${String(row.row)};${String(row.col)}H`
        + paintPhysicalLine(row.line, tier)
    }
    return cells === '' ? '' : `\x1b7${cells}\x1b8`
  }
  const railCol = next.geometry.rail?.col ?? next.geometry.columns
  const guardCol = railCol > 1 ? railCol - 1 : railCol
  for (const change of diff.changes) {
    const nextWidth = change.line === undefined
      ? 0
      : change.line.backgroundColumns ?? change.line.displayWidth
    const targetColumns = Math.max(change.clearColumns, guardCol - change.col)
    const padColumns = targetColumns - nextWidth
    if (change.line !== undefined) {
      cells += `\x1b[${String(change.row)};${String(change.col)}H`
        + paintPhysicalLine(change.line, tier)
    }
    if (padColumns > 0) {
      cells += `\x1b[${String(change.row)};${String(change.col + nextWidth)}H`
        + blankPad(padColumns, tier)
    }
  }
  return cells === '' ? '' : `\x1b7${cells}\x1b8`
}

/** Structural slot moves must be committed together with their Ink chrome. */
function transcriptSlotChanged(): boolean {
  const previous = paintedVisibleFrame?.geometry
  const next = visibleFrameSnapshot()?.geometry
  return previous !== undefined && next !== undefined && (
    previous.columns !== next.columns || previous.rows !== next.rows
    || previous.transcriptTop !== next.transcriptTop
    || previous.transcriptLeft !== next.transcriptLeft
    || previous.transcriptWidth !== next.transcriptWidth
    || previous.transcriptRows !== next.transcriptRows
  )
}

/** Clear a released or relocated slot before Ink paints replacement chrome. */
function prepareTranscriptOverlay(
  columns: number,
  rows: number,
  tier: ColorTier,
  inkFrameStarting: boolean,
): string {
  const previous = paintedVisibleFrame
  if (previous === undefined) return ''
  if (visibleFrameSnapshot() === undefined) {
    paintedVisibleFrame = undefined
    paintedTranscriptRepaintKey = undefined
    transcriptInvalidated = false
  } else {
    if (!inkFrameStarting || !transcriptSlotChanged()) return ''
    // Keep the old snapshot until the suffix, so the replacement geometry is
    // forced to repaint. Only START_SYNC prepares; body/END must not clear HUD.
    transcriptInvalidated = true
  }
  const blank = blankPad(Math.min(columns, previous.geometry.columns), tier)
  let cells = ''
  const bottom = Math.min(rows, previous.geometry.transcriptTop + previous.geometry.transcriptRows - 1)
  for (let row = previous.geometry.transcriptTop; row <= bottom; row += 1) {
    cells += `\x1b[${String(row)};1H${blank}`
  }
  return cells === '' ? '' : `\x1b7${cells}\x1b8`
}

/** The appended caret bytes for the current anchor, or '' when unset. */
function caretSuffix(): string {
  if (frameCaret === undefined) return ''
  if (frameCaret === 'hide') return HIDE_CURSOR
  return `\x1b[${frameCaret.row};${frameCaret.col}H${SHOW_CURSOR}`
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

/** Resize events can precede React's replacement snapshot publication. */
function snapshotFitsStdout(stdout: NodeJS.WriteStream): boolean {
  const snapshot = visibleFrameSnapshot()
  if (!stdout.isTTY || snapshot === undefined
    || !Number.isFinite(stdout.columns) || stdout.columns < 1
    || !Number.isFinite(stdout.rows) || stdout.rows < 1) return true
  return snapshot.geometry.columns === stdout.columns && snapshot.geometry.rows === stdout.rows
}

/**
 * Paint a newly measured rail in synchronized output even when Ink's visible
 * frame is unchanged.
 * Wrapped streams bypass their ordinary frame transform for these already
 * styled absolute cells; direct test streams receive the same bytes.
 * @param stdout - the stdout exposed by Ink's render context.
 * @param tier - color tier used for track and thumb cells.
 */
export function writePublishedFrameRail(
  stdout: NodeJS.WriteStream,
  tier: ColorTier = currentTier(),
): void {
  if (deferTerminalPaint(stdout, 'rail', () => writePublishedFrameRail(stdout, tier))) return
  if (!snapshotFitsStdout(stdout) || transcriptSlotChanged()) return
  const overlay = railOverlay(tier, true)
  if (overlay === '') return
  const bytes = START_SYNC + overlay + caretSuffix() + END_SYNC
  const writer = (stdout as FrameOverlayStream)[WRITE_FRAME_OVERLAY]
  if (writer === undefined) {
    stdout.write(bytes)
    return
  }
  writer(bytes)
}

/**
 * Flush the current visible-frame transcript snapshot and scroll rail to stdout.
 * Paints published viewport rows at CUP coordinates without waiting for an
 * Ink chrome flush. Structural slot changes wait for that flush atomically.
 * @param stdout - the stdout exposed by Ink's render context.
 * @param tier - color tier used for content and chrome cells.
 */
export function writePublishedFrameSnapshot(
  stdout: NodeJS.WriteStream,
  tier: ColorTier = currentTier(),
): void {
  if (deferTerminalPaint(stdout, 'transcript', () => writePublishedFrameSnapshot(stdout, tier))) return
  if (!snapshotFitsStdout(stdout) || transcriptSlotChanged()) return
  const transcript = transcriptOverlay(tier, true)
  const rail = railOverlay(tier, false)
  const overlay = transcript + rail
  if (overlay === '') return
  const bytes = START_SYNC + overlay + caretSuffix() + END_SYNC
  const writer = (stdout as FrameOverlayStream)[WRITE_FRAME_OVERLAY]
  if (writer === undefined) {
    stdout.write(bytes)
    return
  }
  writer(bytes, visibleFrameSnapshot()?.scrollRevision)
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
 * @param publishFrame - false while Ink is inside an unfinished synchronized frame.
 * @returns the chunk with frame-background and caret anchoring applied.
 */
export function transformFrameChunk(
  chunk: string,
  tier: ColorTier = currentTier(),
  publishFrame = true,
  onTranscriptPaint?: () => void,
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
  if (isFrame && publishFrame) {
    const transcript = transcriptOverlay(tier, out.includes(END_SYNC))
    if (transcript !== '') onTranscriptPaint?.()
    const overlay = transcript + railOverlay(tier, true) + caretSuffix()
    const syncIndex = out.lastIndexOf(END_SYNC)
    out = syncIndex < 0 ? out + overlay : out.slice(0, syncIndex) + overlay + out.slice(syncIndex)
  }
  return out
}

/** Loose call shape covering the WriteStream write overloads. */
type WriteCall = (chunk: unknown, ...args: unknown[]) => boolean

/** Wrapped stdout with a raw path for an already transformed rail overlay. */
type FrameOverlayStream = NodeJS.WriteStream & {
  [WRITE_FRAME_OVERLAY]?: (chunk: string, scrollRevision?: number) => boolean
  [DISPOSE_FRAME_OUTPUT]?: () => void
}

/** Release stream-local parser state when Ink relinquishes the terminal. */
export function disposeFrameOutput(stdout: NodeJS.WriteStream): void {
  (stdout as FrameOverlayStream)[DISPOSE_FRAME_OUTPUT]?.()
}

function invalidateFramePaint(): void {
  paintedVisibleFrame = undefined
  paintedTranscriptRepaintKey = undefined
  paintedFrameRail = undefined
  transcriptInvalidated = true
}

/** Ink 7 appends EL at the last column; terminals erase that just-painted glyph. */
function preserveFullWidthRows(chunk: string, columns: number): string {
  if (columns < 1 || !chunk.includes('\x1b[K')) return chunk
  return chunk.replace(/(\x1b\[(?:1)?G)([^\n]*?)\x1b\[K/gu, (match: string, home: string, body: string) =>
    displayWidth(body) === columns ? home + body : match)
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
  let synchronizedFrameOpen = false
  let inkBottomRow = stdout.rows
  let inkCursorRow = 1
  const parser = new TerminalChunks()
  const output = new TerminalOutput(stdout, invalidateFramePaint, () => ({ columns: stdout.columns, rows: stdout.rows,
    parserPendingBytes: parser.pendingBytes, sequenceOpen: parser.incomplete, caret: frameCaret }))
  const controls: { bytes: string; source: OutputSource }[] = []
  const deferredPaints = new Map<string, () => void>()
  let controlBytes = 0
  let background = ''
  let disposed = false
  const control = (bytes: string, source: OutputSource): boolean => {
    if (disposed) return false
    if (parser.incomplete || synchronizedFrameOpen) {
      if (controlBytes + Buffer.byteLength(bytes) > MAX_PENDING_CONTROL_BYTES || controls.length >= MAX_PENDING_CONTROLS) throw new Error('TUI deferred control budget exceeded')
      controls.push({ bytes, source })
      controlBytes += Buffer.byteLength(bytes)
      return false
    }
    return output.write(bytes + caretSuffix(), source)
  }
  const flushControls = (): void => {
    if (parser.incomplete || synchronizedFrameOpen) return
    for (const item of controls.splice(0)) output.write(item.bytes + caretSuffix(), item.source)
    controlBytes = 0
    const paints = [...deferredPaints]
    deferredPaints.clear()
    for (const [key, paint] of paints) output.latest(key, paint)
  }
  const unregister = registerTerminalOutput(wrapped, { control, output, defer: (key, paint) => {
    if (!parser.incomplete && !synchronizedFrameOpen) return false
    deferredPaints.set(key, paint)
    return true
  } })
  const transformComplete = (chunk: string): { text: string; painted?: () => void } => {
    const syncStart = chunk.lastIndexOf(START_SYNC)
    const syncEnd = chunk.lastIndexOf(END_SYNC)
    if (syncStart >= 0 || syncEnd >= 0) synchronizedFrameOpen = syncStart > syncEnd
    const source = stdout.isTTY ? preserveFullWidthRows(chunk, stdout.columns) : chunk
    // Ink erases and diffs upward from the bottom of its fullscreen output.
    // Its cursor bookkeeping does not include the composer's absolute suffix.
    const inkChunk = stdout.isTTY
      && frameCaret !== undefined
      && /\x1b\[\d*A|\x1b\[2K/u.test(source)
      ? `\x1b[${Math.min(inkBottomRow, stdout.rows)};1H${source}`
      : source
    if (stdout.isTTY) {
      const position = trackInkRows(inkChunk, inkCursorRow, stdout.rows)
      if (position !== undefined) {
        inkCursorRow = position
        inkBottomRow = position
      }
    }
    const tier = getTier()
    // Ink's virtual transcript slot contains blank lines. Once another pane
    // takes over, its diff can skip those blanks even though our overlay left
    // real text there. Clear before Ink paints replacement content, never after.
    const released = stdout.isTTY ? prepareTranscriptOverlay(stdout.columns, stdout.rows, tier, source.includes(START_SYNC)) : ''
    const frameChunk = released === '' ? inkChunk
      : inkChunk.includes(START_SYNC) ? inkChunk.replace(START_SYNC, START_SYNC + released)
        : synchronizedFrameOpen ? released + inkChunk : START_SYNC + released + END_SYNC + inkChunk
    let onScrollPaint: (() => void) | undefined
    const inherited = background
    background = terminalBackground(chunk, background)
    const transformed = transformFrameChunk(inherited + frameChunk, tier, !synchronizedFrameOpen && snapshotFitsStdout(stdout), () => {
      const revision = visibleFrameSnapshot()?.scrollRevision
      if (frameMetrics !== undefined && revision !== undefined) {
        onScrollPaint = takeScrollPaintCompletion(frameMetrics, revision)
      }
    })
    return { text: transformed, ...(onScrollPaint === undefined ? {} : { painted: onScrollPaint }) }
  }
  const transformingWrite: WriteCall = (chunk, ...args) => {
    if (disposed) {
      const error = new Error('TUI output has been disposed')
      const callback = args.at(-1)
      if (typeof callback === 'function') { callback(error); return false }
      throw error
    }
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) return writeMeasured(chunk, args)
    const parts = parser.push(chunk)
    const painted: (() => void)[] = []
    const transformed = parts.map(part => {
      if (!part.decorate) return part.text
      const next = transformComplete(part.text)
      if (next.painted !== undefined) painted.push(next.painted)
      return next.text
    }).join('')
    if (transformed === '') {
      const callback = args.at(-1)
      if (typeof callback === 'function') queueMicrotask(() => callback())
      return true
    }
    const accepted = writeMeasured(transformed, args, () => { for (const complete of painted) complete() })
    flushControls()
    return accepted
  }
  const writeMeasured = (transformed: unknown, args: unknown[], onScrollPaint?: () => void, source: OutputSource = 'ink'): boolean => {
    if (typeof transformed === 'string') {
      frameMetrics?.addWrittenCells(countWrittenCells(transformed))
      const last = args.at(-1)
      const onDrain = (error?: unknown): void => {
        if (error !== undefined && error !== null) { invalidateFramePaint(); return }
        onScrollPaint?.()
        if (frameMetrics !== undefined) {
          completeDeltaStdoutDrain(frameMetrics)
          if (transformed.includes(END_SYNC)) frameMetrics.recordFramePresented()
        }
      }
      if (typeof last === 'function') {
        const original = last as (...callbackArgs: unknown[]) => void
        args[args.length - 1] = (...callbackArgs: unknown[]) => {
          onDrain(callbackArgs[0])
          original(...callbackArgs)
        }
      } else {
        args.push(onDrain)
      }
    }
    try {
      if (typeof transformed === 'string') return output.write(transformed, source, args.at(-1) as (error?: Error | null) => void)
      return write(transformed, ...args)
    } catch (error) { invalidateFramePaint(); throw error }
  }
  wrapped.write = transformingWrite
  const overlayStream = wrapped as FrameOverlayStream
  overlayStream[WRITE_FRAME_OVERLAY] = (chunk, revision) => {
    if (parser.incomplete || synchronizedFrameOpen) return control(chunk, 'transcript')
    const painted = frameMetrics !== undefined && revision !== undefined ? takeScrollPaintCompletion(frameMetrics, revision) : undefined
    return writeMeasured(chunk, [], painted, 'transcript')
  }
  overlayStream[DISPOSE_FRAME_OUTPUT] = () => {
    if (disposed) return
    disposed = true
    const cancel = parser.dispose() + (synchronizedFrameOpen ? END_SYNC : '')
    if (cancel !== '') output.write(cancel, 'lifecycle')
    background = ''
    synchronizedFrameOpen = false
    for (const item of controls.splice(0)) output.write(item.bytes, item.source)
    deferredPaints.clear()
    controlBytes = 0
    unregister()
    output.dispose()
    invalidateFramePaint()
    frameCaret = undefined
    frameRail = undefined
  }
  return wrapped
}

/** ANSI/OSC controls do not occupy cells in a completed terminal write. */
const TERMINAL_CONTROL_PATTERN = /\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b./gu

/**
 * Count printable display cells carried by one terminal write. Cursor moves,
 * SGR, OSC, CR/LF and other C0 controls are excluded. Cursor moves separate
 * graphemes, while SGR and hyperlink sequences preserve adjacent graphemes.
 * @param chunk - transformed bytes handed to the actual stdout stream.
 * @returns printable display-cell count.
 */
export function countWrittenCells(chunk: string): number {
  const printable = chunk
    .replace(TERMINAL_CONTROL_PATTERN, control => control.startsWith('\x1b]')
      || (control.startsWith('\x1b[') && control.endsWith('m')) ? '' : '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, '')
  // Cursor movement separates graphemes; SGR and hyperlink spans do not.
  // Keeping these segments short also bounds the width library's temporary work.
  return printable.split('\n').reduce((cells, line) => cells + displayWidth(line), 0)
}

/**
 * Track Ink's cursor before our absolute overlays. Incremental bodies contain
 * both LF and CNL, so counting only newlines loses the logical bottom. Ink
 * already wraps its physical lines; printable spans do not advance rows until
 * LF or a cursor control. Also invalidate snapshots only when Ink actually
 * overwrites their slot, keeping footer-only chrome updates differential.
 */
function trackInkRows(chunk: string, startRow: number, rows: number): number | undefined {
  let row = Math.max(1, Math.min(startRow, rows))
  let active = false
  const geometry = visibleFrameSnapshot()?.geometry
  const touch = (first: number, last = first): void => {
    if (geometry !== undefined && first < geometry.transcriptTop + geometry.transcriptRows
      && last >= geometry.transcriptTop) transcriptInvalidated = true
  }
  const move = (next: number): void => {
    row = Math.max(1, Math.min(next, rows))
    active = true
  }
  const text = (value: string): void => {
    if (value === '') return
    for (const [index, line] of value.split('\n').entries()) {
      if (index > 0) move(row + 1)
      if (/[^\u0000-\u001f\u007f]/u.test(line)) {
        touch(row)
        active = true
      }
    }
  }
  let index = 0
  for (const match of chunk.matchAll(TERMINAL_CONTROL_PATTERN)) {
    text(chunk.slice(index, match.index))
    const control = match[0]
    if (control === ENTER_ALTERNATE_SCREEN) {
      touch(1, rows)
      move(1)
    } else if (control.startsWith('\x1b[')) {
      const final = control.at(-1)
      // Styling dominates colored frames; only parse parameters for row work.
      if (final !== undefined && 'ABEFHfdKJ'.includes(final)) {
        const parameter = Number.parseInt(control.slice(2, -1), 10)
        const count = parameter || 1
        if (final === 'A' || final === 'F') move(row - count)
        else if (final === 'B' || final === 'E') move(row + count)
        else if (final === 'H' || final === 'f' || final === 'd') move(count)
        else if (final === 'K') { touch(row); active = true }
        else if (final === 'J') {
          const mode = parameter || 0
          if (mode === 0) touch(row, rows)
          else if (mode === 1) touch(1, row)
          else if (mode === 2) touch(1, rows)
          active = true
        }
      }
    }
    index = match.index + control.length
  }
  text(chunk.slice(index))
  return active ? row : undefined
}
