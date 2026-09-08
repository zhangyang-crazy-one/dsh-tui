/**
 * Shared visible-frame geometry for transcript painting and interaction.
 * Ink, the viewport, ScreenAtlas, selection/link hit testing and the fixed
 * rail consume these same physical rows instead of independently measuring
 * or decoding terminal output.
 * @module @deepseek-ai/dsh-tui-render/frame-snapshot
 */

import type { PhysicalLine } from './physical-line.ts'

/** Fixed transcript slot and terminal dimensions for one published frame. */
export interface FrameGeometry {
  readonly columns: number
  readonly rows: number
  readonly transcriptTop: number
  readonly transcriptLeft: number
  readonly transcriptWidth: number
  readonly transcriptRows: number
  readonly rail?: {
    readonly col: number
    readonly topRow: number
    readonly rows: number
    readonly thumbStart: number
    readonly thumbRows: number
  }
}

/** One visible physical row at absolute one-based terminal coordinates. */
export interface FrameSnapshotRow {
  readonly id: string
  readonly row: number
  readonly col: number
  readonly line: PhysicalLine
  readonly identity: string
}

/** One consistent visible transcript publication. */
export interface VisibleFrameSnapshot {
  readonly revision: string
  /** Changed key requests one full transcript-region scrub before repaint. */
  readonly repaintKey?: string | number
  readonly geometry: FrameGeometry
  readonly rows: readonly FrameSnapshotRow[]
}

/** Changed or removed row range emitted by the differential adapter. */
export interface FrameRowChange {
  readonly row: number
  readonly col: number
  readonly line: PhysicalLine | undefined
  readonly clearColumns: number
}

/** Differential result; `forced` repaints every visible row. */
export interface FrameSnapshotDiff {
  readonly forced: boolean
  readonly changes: readonly FrameRowChange[]
  readonly unchangedRows: number
}

let publishedSnapshot: VisibleFrameSnapshot | undefined

/**
 * Publish the current frame for the stdout/interaction adapter.
 * @param snapshot - current visible frame, or undefined during teardown.
 */
export function setVisibleFrameSnapshot(snapshot: VisibleFrameSnapshot | undefined): void {
  publishedSnapshot = snapshot
}

/**
 * Read the current renderer-owned frame without consuming it.
 * @returns the current frame, or undefined before paint and after teardown.
 */
export function visibleFrameSnapshot(): VisibleFrameSnapshot | undefined {
  return publishedSnapshot
}

const lineIdentityCache = new WeakMap<PhysicalLine, string>()

/**
 * Build a stable identity including text, style, link and background semantics.
 * @param line - physical line to identify.
 * @returns deterministic comparison identity.
 */
export function physicalLineIdentity(line: PhysicalLine): string {
  let cached = lineIdentityCache.get(line)
  if (cached !== undefined) return cached
  cached = JSON.stringify([
    line.text,
    line.displayWidth,
    line.background ?? 'bg',
    line.backgroundColumns ?? line.displayWidth,
    line.spans.map(span => [
      span.text,
      span.token,
      span.bold === true ? 1 : 0,
      span.href ?? '',
    ]),
  ])
  lineIdentityCache.set(line, cached)
  return cached
}

/**
 * Create one absolute snapshot row with its stable comparison identity.
 * @param input - row id, terminal position, and physical line.
 * @returns the frozen snapshot row.
 */
export function createFrameSnapshotRow(input: {
  id: string
  row: number
  col: number
  line: PhysicalLine
}): FrameSnapshotRow {
  return Object.freeze({
    ...input,
    identity: physicalLineIdentity(input.line),
  })
}

function sameGeometry(a: FrameGeometry, b: FrameGeometry): boolean {
  if (a === b) return true
  if (
    a.columns !== b.columns
    || a.rows !== b.rows
    || a.transcriptTop !== b.transcriptTop
    || a.transcriptLeft !== b.transcriptLeft
    || a.transcriptWidth !== b.transcriptWidth
    || a.transcriptRows !== b.transcriptRows
  ) return false
  const rA = a.rail
  const rB = b.rail
  if (rA === rB) return true
  if (rA === undefined || rB === undefined) return false
  return rA.col === rB.col && rA.topRow === rB.topRow && rA.rows === rB.rows
}

function screenRowKey(row: Pick<FrameSnapshotRow, 'row' | 'col'>): number {
  return (row.row << 16) | row.col
}

/** Number of terminal cells one physical row paints, including surface fill. */
function paintedColumns(line: PhysicalLine): number {
  return line.backgroundColumns ?? line.displayWidth
}

/**
 * Compare adjacent visible frames by terminal coordinate. Shortened and
 * removed rows carry an explicit `clearColumns` width so the terminal adapter
 * erases stale cells without clearing a different row that moved into the
 * same screen position.
 * @param previous - prior frame, or undefined on first paint.
 * @param next - frame to publish.
 * @returns minimal row changes, or a forced visible-region repaint.
 */
export function diffVisibleFrameSnapshots(
  previous: VisibleFrameSnapshot | undefined,
  next: VisibleFrameSnapshot,
): FrameSnapshotDiff {
  const forced = previous === undefined
    || !sameGeometry(previous.geometry, next.geometry)
  const oldRows = new Map<number, FrameSnapshotRow>()
  if (previous !== undefined) {
    for (const row of previous.rows) {
      oldRows.set(screenRowKey(row), row)
    }
  }
  const changes: FrameRowChange[] = []
  let unchangedRows = 0
  for (const row of next.rows) {
    const key = screenRowKey(row)
    const old = oldRows.get(key)
    oldRows.delete(key)
    if (
      !forced
      && old !== undefined
      && old.identity === row.identity
    ) {
      unchangedRows += 1
      continue
    }
    changes.push({
      row: row.row,
      col: row.col,
      line: row.line,
      clearColumns: Math.max(
        old === undefined ? 0 : paintedColumns(old.line),
        paintedColumns(row.line),
      ),
    })
  }
  for (const old of oldRows.values()) {
    changes.push({
      row: old.row,
      col: old.col,
      line: undefined,
      clearColumns: paintedColumns(old.line),
    })
  }
  return { forced, changes, unchangedRows }
}
