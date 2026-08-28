/**
 * Cell atlas of the last painted frame: characters and active OSC 8 URLs at
 * 1-based SGR coordinates. Mouse click looks up a URL; drag-select copies
 * reading-order text. Ink does not own a grid, so this parser consumes the
 * bytes actually written to stdout after frame-fill.
 * @module @deepseek-ai/dsh-tui-render/screen-atlas
 */

import { displayWidth } from './content.ts'

/** One terminal cell. Empty `ch` marks the trailing half of a wide glyph. */
export interface ScreenCell {
  /** Visible grapheme, or '' for a wide-glyph continuation. */
  ch: string
  /** Active OSC 8 href, if any. */
  url: string | undefined
}

/** Inclusive 1-based drag endpoints. */
export interface ScreenPoint {
  /** 1-based column. */
  col: number
  /** 1-based row. */
  row: number
}

const GRAPHEME = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

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
  private wrapPending = false
  private activeUrl: string | undefined
  private leftover = ''

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
        next[row * nextWidth + col] = previous ?? { ch: ' ', url: undefined }
      }
    }
    this.width = nextWidth
    this.height = nextHeight
    this.cells = next
    this.cursorCol = Math.min(this.cursorCol, this.width - 1)
    this.cursorRow = Math.min(this.cursorRow, this.height - 1)
    this.wrapPending = false
  }

  /**
   * Consume one stdout chunk, holding incomplete ESC prefixes.
   * @param chunk - bytes written to the terminal.
   */
  feed(chunk: string): void {
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
   * Reading-order plain text between two inclusive endpoints. Trailing spaces
   * on each row are trimmed; rows join with `\n`.
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
        const cell = this.cellAt(col, row)
        if (cell === undefined || cell.ch === '') continue
        line += cell.ch
      }
      lines.push(line.replace(/ +$/u, ''))
    }
    return lines.join('\n')
  }

  /**
   * Reverse-video overlay that rewrites the selected cells. Empty when the
   * range has no glyphs.
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
        const cell = this.cellAt(col, row)
        if (cell === undefined || cell.ch === '') {
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
    }))
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
    })
    for (let extra = 1; extra < width; extra++) {
      this.put(this.cursorCol + extra, this.cursorRow, {
        ch: '',
        url: this.activeUrl,
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
        this.put(col, row, { ch: ' ', url: undefined })
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
