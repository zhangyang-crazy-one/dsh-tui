/**
 * Cell atlas of the last painted frame: characters and active OSC 8 URLs at
 * 1-based SGR coordinates. Mouse click looks up a URL; drag-select copies
 * reading-order text. Ink does not own a grid, so this parser consumes the
 * bytes actually written to stdout after frame-fill, including absolute CUP
 * overlays and DEC cursor save/restore pairs.
 * @module @deepseek-ai/dsh-tui-render/screen-atlas
 */

import { displayWidth } from './content.ts'
import type { FrameSnapshotRow, VisibleFrameSnapshot } from './frame-snapshot.ts'
import { hyperlinksEnabled, wrapOsc8 } from './hyperlink.ts'
import type { PhysicalLine } from './physical-line.ts'
import { paintBackgroundRow, paintRow, styled } from './theme.ts'

/** One terminal cell. Empty `ch` marks the trailing half of a wide glyph. */
export interface ScreenCell {
  /** Visible grapheme, or '' for a wide-glyph continuation. */
  ch: string
  /** Active OSC 8 href, if any. */
  url: string | undefined
  /** Whether output wrote this cell rather than leaving untouched background. */
  written: boolean
}

/** Inclusive 1-based drag endpoints. */
export interface ScreenPoint {
  /** 1-based column. */
  col: number
  /** 1-based row. */
  row: number
}

const GRAPHEME = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function paintSnapshotLine(line: PhysicalLine): string {
  const parts = line.spans.map((span) => {
    const painted = styled(span.text, span.token, undefined, span.bold)
    const href = span.href ?? line.osc8?.href
    return href === undefined || !hyperlinksEnabled() ? painted : wrapOsc8(painted, href)
  })
  return line.background === 'codeBg'
    ? paintBackgroundRow(parts, 'codeBg', Math.max(1, line.displayWidth))
    : paintRow(parts)
}

/**
 * Ordered start/end so `start` precedes `end` in reading order.
 * @param a - one endpoint.
 * @param b - the other endpoint.
 * @returns ordered pair.
 */
export function orderedPoints(
  a: ScreenPoint,
  b: ScreenPoint,
): { start: ScreenPoint; end: ScreenPoint } {
  if (a.row < b.row || (a.row === b.row && a.col <= b.col)) {
    return { start: a, end: b }
  }
  return { start: b, end: a }
}

/**
 * Mutable cell grid fed by ANSI stdout chunks.
 */
export class ScreenAtlas {
  /** Column count. */
  width: number
  /** Row count. */
  height: number
  private cells: ScreenCell[]
  private cursorCol = 0
  private cursorRow = 0
  private savedCursorCol = 0
  private savedCursorRow = 0
  private wrapPending = false
  private activeUrl: string | undefined
  private leftover = ''
  private snapshotRanges: { row: number; col: number; width: number }[] = []
  private snapshotRows = new Map<number, FrameSnapshotRow>()
  private snapshotRail: VisibleFrameSnapshot['geometry']['rail']

  /**
   * @param width - terminal columns.
   * @param height - terminal rows.
   */
  constructor(width = 80, height = 24) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.cells = this.blank()
  }

  /**
   * Resize the grid, preserving overlapping cells.
   * @param width - next columns.
   * @param height - next rows.
   */
  resize(width: number, height: number): void {
    const nextWidth = Math.max(1, width)
    const nextHeight = Math.max(1, height)
    if (nextWidth === this.width && nextHeight === this.height) return
    const next = new Array<ScreenCell>(nextWidth * nextHeight)
    for (let row = 0; row < nextHeight; row++) {
      for (let col = 0; col < nextWidth; col++) {
        const previous =
          row < this.height && col < this.width
            ? this.cells[row * this.width + col]
            : undefined
        next[row * nextWidth + col] = previous ?? {
          ch: ' ',
          url: undefined,
          written: false,
        }
      }
    }
    this.width = nextWidth
    this.height = nextHeight
    this.cells = next
    this.cursorCol = Math.min(this.cursorCol, this.width - 1)
    this.cursorRow = Math.min(this.cursorRow, this.height - 1)
    this.savedCursorCol = Math.min(this.savedCursorCol, this.width - 1)
    this.savedCursorRow = Math.min(this.savedCursorRow, this.height - 1)
    this.wrapPending = false
    this.snapshotRows.clear()
    this.snapshotRail = undefined
  }

  /**
   * Consume one stdout chunk, holding incomplete ESC prefixes.
   * @param chunk - bytes written to the terminal.
   */
  feed(chunk: string): void {
    this.snapshotRows.clear()
    this.snapshotRail = undefined
    const text = this.leftover + chunk
    this.leftover = ''
    const segments = GRAPHEME.segment(text)[Symbol.iterator]()
    let segment = segments.next()
    let index = 0
    while (index < text.length) {
      if (text.startsWith('\x1b]8;', index)) {
        const parsed = readOsc8(text, index)
        if (parsed === undefined) {
          this.leftover = text.slice(index)
          return
        }
        this.activeUrl = parsed.url
        index = parsed.end
        continue
      }
      if (text[index] === '\x1b') {
        if (index + 1 === text.length) {
          this.leftover = text.slice(index)
          return
        }
        if (text[index + 1] === '[') {
          const csi = readCsi(text, index)
          if (csi === undefined) {
            this.leftover = text.slice(index)
            return
          }
          this.applyCsi(csi.params, csi.final)
          index = csi.end
          continue
        }
        if (text[index + 1] === ']') {
          const osc = readOscGeneric(text, index)
          if (osc === undefined) {
            this.leftover = text.slice(index)
            return
          }
          index = osc
          continue
        }
        if (text[index + 1] === '7') {
          this.savedCursorCol = this.cursorCol
          this.savedCursorRow = this.cursorRow
        } else if (text[index + 1] === '8') {
          this.cursorCol = this.savedCursorCol
          this.cursorRow = this.savedCursorRow
          this.wrapPending = false
        }
        index += 2
        continue
      }
      if (text[index] === '\r') {
        this.cursorCol = 0
        this.wrapPending = false
        index += 1
        continue
      }
      if (text[index] === '\n') {
        this.advanceRow()
        this.cursorCol = 0
        this.wrapPending = false
        index += 1
        continue
      }
      if (text[index] === '\b') {
        this.wrapPending = false
        this.cursorCol = Math.max(0, this.cursorCol - 1)
        index += 1
        continue
      }
      while (!segment.done && segment.value.index < index) {
        segment = segments.next()
      }
      const grapheme = !segment.done && segment.value.index === index
        ? segment.value.segment
        // v8 ignore next -- every printable cursor starts an Intl grapheme segment.
        : text[index] as string
      this.writeGrapheme(grapheme)
      index += grapheme.length
    }
  }

  /**
   * Apply renderer-owned transcript rows directly. This is the normal product
   * geometry path; {@link feed} remains the fallback for external bytes and
   * shells that do not publish physical rows.
   * @param snapshot - shared visible frame from the transcript renderer.
   */
  applyFrameSnapshot(snapshot: VisibleFrameSnapshot): void {
    for (const range of this.snapshotRanges) {
      for (let offset = 0; offset < range.width; offset += 1) {
        const col = range.col - 1 + offset
        const row = range.row - 1
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue
        this.cells[row * this.width + col] = {
          ch: ' ',
          url: undefined,
          written: false,
        }
      }
    }
    this.snapshotRanges = []
    this.snapshotRows.clear()
    this.snapshotRail = snapshot.geometry.rail
    const saved = {
      col: this.cursorCol,
      row: this.cursorRow,
      url: this.activeUrl,
      wrap: this.wrapPending,
    }
    for (const row of snapshot.rows) {
      this.snapshotRows.set(row.row, row)
      this.cursorCol = Math.max(0, row.col - 1)
      this.cursorRow = Math.max(0, row.row - 1)
      this.wrapPending = false
      for (const span of row.line.spans) {
        this.activeUrl = span.href
        for (const part of GRAPHEME.segment(span.text)) this.writeGrapheme(part.segment)
      }
      this.snapshotRanges.push({
        row: row.row,
        col: row.col,
        width: row.line.displayWidth,
      })
    }
    const rail = snapshot.geometry.rail
    if (rail !== undefined) {
      for (let index = 0; index < rail.rows; index += 1) {
        const col = rail.col - 1
        const row = rail.topRow - 1 + index
        if (col < 0 || col >= this.width || row < 0 || row >= this.height) continue
        if (col > 0) {
          this.cells[row * this.width + col - 1] = {
            ch: ' ',
            url: undefined,
            written: false,
          }
        }
        const thumb = index >= rail.thumbStart && index < rail.thumbStart + rail.thumbRows
        this.cells[row * this.width + col] = {
          ch: thumb ? '█' : '·',
          url: undefined,
          written: true,
        }
      }
    }
    this.cursorCol = saved.col
    this.cursorRow = saved.row
    this.activeUrl = saved.url
    this.wrapPending = saved.wrap
  }

  /**
   * OSC 8 href at a 1-based SGR coordinate.
   * @param col - 1-based column.
   * @param row - 1-based row.
   * @returns the href, or undefined.
   */
  urlAt(col: number, row: number): string | undefined {
    return this.cellAt(col, row)?.url
  }

  /**
   * Cell at a 1-based SGR coordinate.
   * @param col - 1-based column.
   * @param row - 1-based row.
   * @returns the cell, or undefined when out of range.
   */
  cellAt(col: number, row: number): ScreenCell | undefined {
    if (col < 1 || row < 1 || col > this.width || row > this.height) {
      return undefined
    }
    return this.cells[(row - 1) * this.width + (col - 1)]
  }

  /**
   * Reading-order plain text between two inclusive endpoints. Published rail
   * cells are excluded, trailing spaces are trimmed, and rows join with `\n`.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @returns selected text.
   */
  extract(a: ScreenPoint, b: ScreenPoint): string {
    const { start, end } = orderedPoints(a, b)
    const lines: string[] = []
    for (let row = start.row; row <= end.row; row++) {
      const from = row === start.row ? start.col : 1
      const to = row === end.row ? end.col : this.width
      let line = ''
      for (let col = from; col <= to; col++) {
        if (this.isSnapshotRailControlCell(col, row)) continue
        const cell = this.cellAt(col, row)
        if (cell === undefined || cell.ch === '') continue
        line += cell.ch
      }
      lines.push(line.replace(/ +$/u, ''))
    }
    return lines.join('\n')
  }

  /**
   * Reverse-video overlay that rewrites selectable cells. Published rail cells
   * are excluded. Empty when the range has no glyphs.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @returns CUP + reverse SGR bytes.
   */
  selectionOverlay(a: ScreenPoint, b: ScreenPoint): string {
    const { start, end } = orderedPoints(a, b)
    let out = ''
    for (let row = start.row; row <= end.row; row++) {
      const from = row === start.row ? start.col : 1
      const to = row === end.row ? end.col : this.width
      let run = ''
      let runCol = 0
      const flush = () => {
        if (run === '' || runCol === 0) return
        out += `\x1b[${row};${runCol}H\x1b[7m${run}\x1b[27m`
        run = ''
        runCol = 0
      }
      for (let col = from; col <= to; col++) {
        if (this.isSnapshotRailControlCell(col, row)) {
          flush()
          continue
        }
        const cell = this.cellAt(col, row)
        if (cell === undefined || !cell.written || cell.ch === '') {
          flush()
          continue
        }
        if (run === '') runCol = col
        run += cell.ch
      }
      flush()
    }
    return out
  }

  /**
   * Repaint the written cells in a former selection with the normal page
   * foreground/background so reverse-video cells do not survive a range
   * change or release.
   * @param a - one endpoint.
   * @param b - the other endpoint.
   * @returns CUP + normal painted runs for the occupied cells.
   */
  restoreOverlay(a: ScreenPoint, b: ScreenPoint): string {
    const { start, end } = orderedPoints(a, b)
    let out = ''
    for (let row = start.row; row <= end.row; row++) {
      const from = row === start.row ? start.col : 1
      const to = row === end.row ? end.col : this.width
      const snapshotRow = this.snapshotRows.get(row)
      if (
        snapshotRow !== undefined
        && !this.snapshotRowOverlapsRailControl(snapshotRow)
        && from <= snapshotRow.col + snapshotRow.line.displayWidth - 1
        && to >= snapshotRow.col
      ) {
        out += `\x1b[${row};${snapshotRow.col}H${paintSnapshotLine(snapshotRow.line)}`
        continue
      }
      let run = ''
      let runCol = 0
      const flush = () => {
        if (run === '' || runCol === 0) return
        out += `\x1b[${row};${runCol}H${paintRow([styled(run, 'fg')])}`
        run = ''
        runCol = 0
      }
      for (let col = from; col <= to; col++) {
        if (this.isSnapshotRailControlCell(col, row)) {
          flush()
          continue
        }
        const cell = this.cellAt(col, row)
        if (cell === undefined || !cell.written || cell.ch === '') {
          flush()
          continue
        }
        if (run === '') runCol = col
        run += cell.ch
      }
      flush()
    }
    return out
  }

  private blank(): ScreenCell[] {
    return Array.from({ length: this.width * this.height }, () => ({
      ch: ' ',
      url: undefined,
      written: false,
    }))
  }

  private isSnapshotRailControlCell(col: number, row: number): boolean {
    const rail = this.snapshotRail
    return rail !== undefined
      && col >= Math.max(1, rail.col - 1)
      && col <= rail.col
      && row >= rail.topRow
      && row < rail.topRow + rail.rows
  }

  private snapshotRowOverlapsRailControl(row: FrameSnapshotRow): boolean {
    const rail = this.snapshotRail
    return rail !== undefined
      && row.row >= rail.topRow
      && row.row < rail.topRow + rail.rows
      && row.col + row.line.displayWidth - 1 >= Math.max(1, rail.col - 1)
  }

  private writeGrapheme(grapheme: string): void {
    if (grapheme < ' ' && grapheme !== '\t') return
    const width = Math.max(1, displayWidth(grapheme === '\t' ? ' ' : grapheme))
    if (this.wrapPending || this.cursorCol + width > this.width) {
      this.cursorCol = 0
      this.advanceRow()
      this.wrapPending = false
    }
    this.put(this.cursorCol, this.cursorRow, {
      ch: grapheme === '\t' ? ' ' : grapheme,
      url: this.activeUrl,
      written: true,
    })
    for (let extra = 1; extra < width; extra++) {
      this.put(this.cursorCol + extra, this.cursorRow, {
        ch: '',
        url: this.activeUrl,
        written: true,
      })
    }
    const nextCol = this.cursorCol + width
    this.wrapPending = nextCol >= this.width
    this.cursorCol = this.wrapPending ? this.width - 1 : nextCol
  }

  private put(col: number, row: number, cell: ScreenCell): void {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return
    this.cells[row * this.width + col] = cell
  }

  private advanceRow(): void {
    if (this.cursorRow + 1 < this.height) this.cursorRow += 1
  }

  private applyCsi(params: number[], final: string): void {
    this.wrapPending = false
    const first = params[0] ?? 0
    const second = params[1] ?? 0
    if (final === 'H' || final === 'f') {
      this.cursorRow = Math.max(0, (first === 0 ? 1 : first) - 1)
      this.cursorCol = Math.max(0, (second === 0 ? 1 : second) - 1)
      this.cursorRow = Math.min(this.cursorRow, this.height - 1)
      this.cursorCol = Math.min(this.cursorCol, this.width - 1)
      return
    }
    if (final === 'A') {
      this.cursorRow = Math.max(0, this.cursorRow - Math.max(1, first || 1))
      return
    }
    if (final === 'B') {
      this.cursorRow = Math.min(
        this.height - 1,
        this.cursorRow + Math.max(1, first || 1),
      )
      return
    }
    if (final === 'C') {
      this.cursorCol = Math.min(
        this.width - 1,
        this.cursorCol + Math.max(1, first || 1),
      )
      return
    }
    if (final === 'D') {
      this.cursorCol = Math.max(0, this.cursorCol - Math.max(1, first || 1))
      return
    }
    if (final === 'G') {
      this.cursorCol = Math.min(
        this.width - 1,
        Math.max(0, (first === 0 ? 1 : first) - 1),
      )
      return
    }
    if (final === 'J') {
      if (first === 2 || first === 3) {
        this.cells = this.blank()
        this.cursorCol = 0
        this.cursorRow = 0
      }
      return
    }
    if (final === 'K') {
      const row = this.cursorRow
      const start = first === 1 || first === 2 ? 0 : this.cursorCol
      const end = first === 1 ? this.cursorCol + 1 : this.width
      for (let col = start; col < end; col++) {
        this.put(col, row, { ch: ' ', url: undefined, written: false })
      }
    }
  }
}

function readOsc8(
  text: string,
  start: number,
): { url: string | undefined; end: number } | undefined {
  const payloadStart = start + '\x1b]8;'.length
  const st = text.indexOf('\x1b\\', payloadStart)
  const bel = text.indexOf('\u0007', payloadStart)
  const terminatedByBel = bel >= 0 && (st < 0 || bel < st)
  const payloadEnd = terminatedByBel ? bel : st
  if (payloadEnd < 0) return undefined
  const end = terminatedByBel ? payloadEnd + 1 : payloadEnd + 2
  const payload = text.slice(payloadStart, payloadEnd)
  const sep = payload.indexOf(';')
  const url = sep >= 0 ? payload.slice(sep + 1) : ''
  return { url: url === '' ? undefined : url, end }
}

function readOscGeneric(text: string, start: number): number | undefined {
  const payloadStart = start + 2
  const st = text.indexOf('\x1b\\', payloadStart)
  const bel = text.indexOf('\u0007', payloadStart)
  if (st >= 0 && (bel < 0 || st < bel)) return st + 2
  if (bel >= 0) return bel + 1
  return undefined
}

function readCsi(
  text: string,
  start: number,
): { params: number[]; final: string; end: number } | undefined {
  let index = start + 2
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) {
      const body = text.slice(start + 2, index)
      const numeric = body.replace(/[^\d;]/g, '')
      const params = numeric === ''
        ? []
        : numeric.split(';').map(part => (part === '' ? 0 : Number(part)))
      return { params, final: text[index] as string, end: index + 1 }
    }
    index += 1
  }
  return undefined
}
