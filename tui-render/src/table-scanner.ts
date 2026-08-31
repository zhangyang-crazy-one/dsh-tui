/**
 * Append-only, fence-aware GFM pipe-table scanner for streaming Markdown.
 * Walks a tiny state machine over completed source lines so the upstream
 * projector can decide how much of the markdown source is already stable.
 *
 * The scanner is deliberately a pure data module: it never parses inline
 * Markdown, never renders anything, and never touches the terminal. Rendering
 * wiring (`layoutTable` in {@link ./markdown.tsx}) is a later concern.
 *
 * State machine:
 *
 *   none
 *     -- pipe row                  --> pending-header
 *   pending-header
 *     -- delimiter row (same cols) --> confirmed-table
 *     -- other pipe row            --> pending-header (current row replaces header)
 *     -- non-pipe / fence          --> none (header candidate invalidated)
 *   confirmed-table
 *     -- pipe row (same cols)      --> confirmed-table (body row appended)
 *     -- non-pipe / fence          --> none (table atomically closed)
 *
 * Pipe text inside a fenced code block (``` or ~~~) is invisible to the
 * scanner, even when the line contains pipes.
 *
 * @module @deepseek-ai/dsh-tui-render/table-scanner
 */

/** Minimum number of fence chars (` or ~) that opens or closes a code fence. */
const FENCE_MIN = 3

/** Cell pattern for a GFM delimiter cell: spaces, optional colons, one or more hyphens, spaces. */
const DELIMITER_CELL_PATTERN = /^[\s:]*-{1,}[\s:]*$/

/**
 * One completed source line the scanner classifies as part of a GFM table.
 * The text is the raw line content (no trailing newline); cells are the
 * trimmed text of each pipe-separated column.
 */
export interface PipeTableRow {
  /** Raw line content (no trailing newline, no surrounding whitespace). */
  readonly text: string
  /** Trimmed cells from left-to-right; empty cells are preserved. */
  readonly cells: readonly string[]
  /** Source offset of the row's first byte. */
  readonly start: number
  /** Source offset of the byte after the row's last content byte. */
  readonly end: number
  /** True when this row is a GFM delimiter row (header underline). */
  readonly isDelimiter: boolean
}

/** Scanner state when no pipe row has ever been seen, or after a close. */
export interface TableScannerStateNone {
  readonly kind: 'none'
}

/**
 * Scanner state when the most recent line looked like a pipe header but the
 * GFM delimiter row has not yet been observed.
 */
export interface TableScannerStatePending {
  readonly kind: 'pending-header'
  /** The candidate header row. */
  readonly header: PipeTableRow
}

/**
 * Scanner state when the header is followed by a matching delimiter row; the
 * scanner is now actively tracking body rows.
 */
export interface TableScannerStateConfirmed {
  readonly kind: 'confirmed-table'
  readonly header: PipeTableRow
  readonly delimiter: PipeTableRow
  readonly body: readonly PipeTableRow[]
}

/** Discriminated union of every scanner state. */
export type TableScannerState =
  | TableScannerStateNone
  | TableScannerStatePending
  | TableScannerStateConfirmed

/**
 * Atomically-closed table the consumer must commit exactly once. The scanner
 * sets `closedTable` on the snapshot that transitions out of
 * `confirmed-table`; it is then cleared so the next snapshot never repeats
 * the same rows.
 */
export interface ClosedTable {
  readonly header: PipeTableRow
  readonly delimiter: PipeTableRow
  readonly body: readonly PipeTableRow[]
  /** Flat list: header, delimiter, then body rows in source order. */
  readonly rows: readonly PipeTableRow[]
  /** Source offset of the table's first byte (the header's `start`). */
  readonly headerStart: number
  /** Source offset of the byte after the table's last content byte. */
  readonly end: number
}

/**
 * Snapshot returned by every scanner entry point. The consumer treats the
 * scanner as event-driven: each `feed`/`finalize` either advances the open
 * table or surfaces a `closedTable` to commit atomically.
 */
export interface TableScannerSnapshot {
  readonly state: TableScannerState
  /** Rows currently visible in the table. Empty when `state.kind === 'none'`. */
  readonly rows: readonly PipeTableRow[]
  /** Source offset where the mutable region begins (header start). 0 when no table. */
  readonly mutableStart: number
  /** Source offset where the mutable region ends (last row's `end`). 0 when no table. */
  readonly mutableEnd: number
  /**
   * Non-null when this snapshot transitioned out of `confirmed-table`. The
   * consumer MUST commit `closedTable.rows` exactly once, then move on;
   * subsequent snapshots will not repeat the rows.
   */
  readonly closedTable: ClosedTable | null
}

/**
 * Append-only, fence-aware GFM pipe-table scanner. Feed it chunks of the
 * assistant Markdown source in source order; never feed the same byte twice.
 *
 * The scanner is agnostic to width, theme, and rendering. Its only output is
 * source offsets plus raw pipe-row cells, so the projector can decide which
 * rows are stable and which must re-render.
 */
export class TableScanner {
  private buffer = ''
  /** Absolute source offset of the buffer's first character. */
  private bufferBaseOffset = 0
  /** Total bytes fed across the scanner's lifetime (including the current buffer). */
  private totalFed = 0
  /** Active fence marker (` or `~`) or null when outside any fence. */
  private fenceMarker: string | null = null
  /** Length of the opening fence; close fences must match or exceed it. */
  private fenceLength = 0
  private stateKind: 'none' | 'pending-header' | 'confirmed-table' = 'none'
  private headerRow: PipeTableRow | null = null
  private delimiterRow: PipeTableRow | null = null
  private bodyRows: PipeTableRow[] = []
  private pendingClosed: ClosedTable | null = null

  /** Reset every internal state. Pending `closedTable` is also cleared. */
  reset(): void {
    this.buffer = ''
    this.bufferBaseOffset = 0
    this.totalFed = 0
    this.fenceMarker = null
    this.fenceLength = 0
    this.stateKind = 'none'
    this.headerRow = null
    this.delimiterRow = null
    this.bodyRows = []
    this.pendingClosed = null
  }

  /**
   * Append a source chunk and return the latest snapshot. Empty chunks still
   * surface any pending `closedTable` so the consumer cannot miss a close.
   * @param chunk - new source bytes (may end mid-line).
   * @returns the latest {@link TableScannerSnapshot}.
   */
  feed(chunk: string): TableScannerSnapshot {
    if (chunk === '') return this.snapshot()
    this.buffer += chunk
    this.totalFed += chunk.length
    this.processLines(false)
    return this.snapshot()
  }

  /**
   * Close the source. Any unterminated trailing line is flushed as a
   * completed line, then any open table is atomically finalized.
   * @returns the final snapshot.
   */
  finalize(): TableScannerSnapshot {
    if (this.buffer.length > 0) this.processLines(true)
    this.closeTable()
    return this.snapshot()
  }

  /**
   * Get the current snapshot without consuming any new input. Useful when the
   * consumer wants to re-poll a `closedTable` between `feed` calls.
   * @returns the latest {@link TableScannerSnapshot}.
   */
  snapshot(): TableScannerSnapshot {
    const closed = this.pendingClosed
    this.pendingClosed = null
    let rows: readonly PipeTableRow[] = []
    let mutableStart = 0
    let mutableEnd = 0
    if (this.stateKind === 'pending-header' && this.headerRow) {
      rows = [this.headerRow]
      mutableStart = this.headerRow.start
      mutableEnd = this.headerRow.end
    } else if (this.stateKind === 'confirmed-table' && this.headerRow && this.delimiterRow) {
      rows = [this.headerRow, this.delimiterRow, ...this.bodyRows]
      mutableStart = this.headerRow.start
      const last = this.bodyRows.length > 0 ? this.bodyRows[this.bodyRows.length - 1] : null
      mutableEnd = last ? last.end : this.delimiterRow.end
    }
    return {
      state: this.buildState(),
      rows,
      mutableStart,
      mutableEnd,
      closedTable: closed,
    }
  }

  /** Walk the buffer, classify each completed line, then trim the consumed prefix. */
  private processLines(forceFlush: boolean): void {
    let lineStart = 0
    const buf = this.buffer
    let i = 0
    while (i < buf.length) {
      if (buf.charCodeAt(i) === 10 /* \n */) {
        let end = i
        if (end > lineStart && buf.charCodeAt(end - 1) === 13 /* \r */) end -= 1
        const line = buf.slice(lineStart, end)
        const startOff = this.bufferBaseOffset + lineStart
        const endOff = this.bufferBaseOffset + end
        this.handleLine(line, startOff, endOff)
        lineStart = i + 1
      }
      i += 1
    }
    if (forceFlush && lineStart < buf.length) {
      const line = buf.slice(lineStart)
      const startOff = this.bufferBaseOffset + lineStart
      const endOff = this.bufferBaseOffset + buf.length
      this.handleLine(line, startOff, endOff)
      lineStart = buf.length
    }
    if (lineStart > 0) {
      this.buffer = buf.slice(lineStart)
      this.bufferBaseOffset += lineStart
    }
  }

  /** Dispatch one completed line through the state machine. */
  private handleLine(line: string, start: number, end: number): void {
    const fence = detectFence(line)
    if (fence !== null) {
      if (this.fenceMarker === null) {
        this.fenceMarker = fence.marker
        this.fenceLength = fence.length
      } else if (fence.marker === this.fenceMarker && fence.length >= this.fenceLength) {
        this.fenceMarker = null
        this.fenceLength = 0
      }
      this.closeTable()
      return
    }
    if (this.fenceMarker !== null) return

    const cells = parsePipeRow(line)
    if (cells === null) {
      this.closeTable()
      return
    }

    if (this.stateKind === 'none') {
      this.stateKind = 'pending-header'
      this.headerRow = { text: line, cells, start, end, isDelimiter: false }
      return
    }
    if (this.stateKind === 'pending-header' && this.headerRow) {
      if (isDelimiterRow(cells) && cells.length === this.headerRow.cells.length) {
        const delimiter: PipeTableRow = {
          text: line,
          cells,
          start,
          end,
          isDelimiter: true,
        }
        this.stateKind = 'confirmed-table'
        this.delimiterRow = delimiter
        this.bodyRows = []
        return
      }
      // Not a matching delimiter: the current line becomes a new header
      // candidate. We do not transition through `none`; the state stays
      // `pending-header` so a delimiter on the very next line still works.
      this.headerRow = { text: line, cells, start, end, isDelimiter: false }
      return
    }
    if (this.stateKind === 'confirmed-table' && this.delimiterRow) {
      if (cells.length === this.delimiterRow.cells.length) {
        this.bodyRows.push({ text: line, cells, start, end, isDelimiter: false })
        return
      }
      // Column mismatch: close the table and DO NOT consume the current row.
      this.closeTable()
      return
    }
  }

  /** Finalize the current table. `pending-header` collapses to `none` silently. */
  private closeTable(): void {
    if (this.stateKind === 'pending-header') {
      this.stateKind = 'none'
      this.headerRow = null
      return
    }
    if (this.stateKind === 'confirmed-table' && this.headerRow && this.delimiterRow) {
      const last = this.bodyRows.length > 0 ? this.bodyRows[this.bodyRows.length - 1] : null
      const end = last ? last.end : this.delimiterRow.end
      this.pendingClosed = {
        header: this.headerRow,
        delimiter: this.delimiterRow,
        body: this.bodyRows,
        rows: [this.headerRow, this.delimiterRow, ...this.bodyRows],
        headerStart: this.headerRow.start,
        end,
      }
    }
    this.stateKind = 'none'
    this.headerRow = null
    this.delimiterRow = null
    this.bodyRows = []
  }

  private buildState(): TableScannerState {
    if (this.stateKind === 'pending-header' && this.headerRow) {
      return { kind: 'pending-header', header: this.headerRow }
    }
    if (this.stateKind === 'confirmed-table' && this.headerRow && this.delimiterRow) {
      return {
        kind: 'confirmed-table',
        header: this.headerRow,
        delimiter: this.delimiterRow,
        body: this.bodyRows,
      }
    }
    return { kind: 'none' }
  }
}

/** Detect an opening or closing fence line. Returns null for indented code blocks. */
function detectFence(line: string): { marker: string; length: number } | null {
  let i = 0
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i += 1
  if (i >= 4) return null
  if (i >= line.length) return null
  const ch = line.charCodeAt(i)
  if (ch !== 96 /* ` */ && ch !== 126 /* ~ */) return null
  const runStart = i
  while (i < line.length && line.charCodeAt(i) === ch) i += 1
  const length = i - runStart
  if (length < FENCE_MIN) return null
  // Backtick fences forbid backticks in the info string; if any backticks
  // remain past the opening run the line is not a fence.
  if (ch === 96) {
    for (let j = i; j < line.length; j += 1) {
      if (line.charCodeAt(j) === 96) return null
    }
  }
  return { marker: String.fromCharCode(ch), length }
}

/**
 * Parse a pipe row into trimmed cells. Returns null when the line has no
 * unescaped pipe and is not a pipe row.
 * @param line - raw line content (no newline).
 * @returns trimmed cells, or null when the line is not a pipe row.
 */
function parsePipeRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let pipeCount = 0
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed.charCodeAt(i)
    if (ch === 92 /* \ */ && i + 1 < trimmed.length && trimmed.charCodeAt(i + 1) === 124 /* | */) {
      i += 1
      continue
    }
    if (ch === 124) pipeCount += 1
  }
  if (pipeCount === 0) return null

  let startIdx = 0
  let endIdx = trimmed.length
  if (trimmed.charCodeAt(0) === 124) startIdx = 1
  if (endIdx > 1 && trimmed.charCodeAt(endIdx - 1) === 124) endIdx -= 1

  const cells: string[] = []
  let current = ''
  let i = startIdx
  while (i < endIdx) {
    const ch = trimmed.charCodeAt(i)
    if (ch === 92 && i + 1 < endIdx && trimmed.charCodeAt(i + 1) === 124) {
      current += '|'
      i += 2
      continue
    }
    if (ch === 124) {
      cells.push(current.trim())
      current = ''
      i += 1
      continue
    }
    current += trimmed.charAt(i)
    i += 1
  }
  cells.push(current.trim())
  return cells
}

/**
 * Parse one unfinished presentation row without advancing scanner state.
 * Confirmed tables use this for the current raw tail while canonical source
 * remains committed only through complete newline-terminated rows.
 * @param line - raw source line without its newline.
 * @returns trimmed cells, or undefined when the line is not pipe-shaped.
 */
export function parsePipeTableCells(line: string): readonly string[] | undefined {
  return parsePipeRow(line) ?? undefined
}

/** True when every cell matches the GFM delimiter pattern. */
function isDelimiterRow(cells: readonly string[]): boolean {
  /* v8 ignore next -- parsePipeRow always pushes a trailing cell, so empty arrays never reach this helper. */
  if (cells.length === 0) return false
  for (const cell of cells) {
    if (!DELIMITER_CELL_PATTERN.test(cell)) return false
  }
  return true
}
