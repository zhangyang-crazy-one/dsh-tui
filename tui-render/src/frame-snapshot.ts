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

/**
 * Build a stable identity including text, style, link and background semantics.
 * @param line - physical line to identify.
 * @returns deterministic comparison identity.
 */
export function physicalLineIdentity(line: PhysicalLine): string {
  return JSON.stringify([
    line.text,
    line.displayWidth,
    line.background ?? 'bg',
    line.spans.map(span => [
      span.text,
      span.token,
      span.bold === true ? 1 : 0,
      span.href ?? '',
    ]),
  ])
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

function geometryIdentity(geometry: FrameGeometry): string {
  return JSON.stringify(geometry)
}

/**
 * Compare adjacent visible frames. Shortened and removed rows carry an
 * explicit `clearColumns` width so the terminal adapter erases stale cells.
 * @param previous - prior frame, or undefined on first paint.
 * @param next - frame to publish.
 * @returns minimal row changes, or a forced visible-region repaint.
 */
export function diffVisibleFrameSnapshots(
  previous: VisibleFrameSnapshot | undefined,
  next: VisibleFrameSnapshot,
): FrameSnapshotDiff {
  const forced = previous === undefined
    || geometryIdentity(previous.geometry) !== geometryIdentity(next.geometry)
  const oldRows = new Map(previous?.rows.map(row => [row.id, row]) ?? [])
  const changes: FrameRowChange[] = []
  let unchangedRows = 0
  for (const row of next.rows) {
    const old = oldRows.get(row.id)
    oldRows.delete(row.id)
    if (
      !forced
      && old !== undefined
      && old.row === row.row
      && old.col === row.col
      && old.identity === row.identity
    ) {
      unchangedRows += 1
      continue
    }
    changes.push({
      row: row.row,
      col: row.col,
      line: row.line,
      clearColumns: Math.max(old?.line.displayWidth ?? 0, row.line.displayWidth),
    })
  }
  for (const old of oldRows.values()) {
    changes.push({
      row: old.row,
      col: old.col,
      line: undefined,
      clearColumns: old.line.displayWidth,
    })
  }
  return { forced, changes, unchangedRows }
}
