import { describe, expect, it } from 'vitest'
import {
  createFrameSnapshotRow,
  diffVisibleFrameSnapshots,
  type VisibleFrameSnapshot,
} from '../src/frame-snapshot.ts'
import { createPhysicalLine } from '../src/physical-line.ts'

function line(text: string, href?: string) {
  return createPhysicalLine({
    blockId: 'b1',
    spans: [{ text, token: 'fg', ...(href === undefined ? {} : { href }) }],
    sourceStart: 0,
    sourceEnd: text.length,
    blockRow: 0,
  })
}

function snapshot(text: string, columns = 80): VisibleFrameSnapshot {
  return {
    revision: text,
    geometry: {
      columns,
      rows: 24,
      transcriptTop: 3,
      transcriptLeft: 3,
      transcriptWidth: columns - 4,
      transcriptRows: 18,
    },
    rows: [createFrameSnapshotRow({ id: 'b1:0', row: 3, col: 3, line: line(text) })],
  }
}

describe('diffVisibleFrameSnapshots', () => {
  it('suppresses a stable row with identical content and style identity', () => {
    const previous = snapshot('stable')
    const next = snapshot('stable')
    expect(diffVisibleFrameSnapshots(previous, next)).toEqual({
      forced: false,
      changes: [],
      unchangedRows: 1,
    })
  })

  it('clears the former width when a mutable tail becomes shorter', () => {
    const diff = diffVisibleFrameSnapshots(snapshot('long-tail'), snapshot('短'))
    expect(diff.forced).toBe(false)
    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]?.clearColumns).toBe(9)
    expect(diff.changes[0]?.line?.text).toBe('短')
  })

  it('clears and replaces the complete surface width rather than only its text', () => {
    const previous = snapshot('plain')
    const surfaced = {
      ...previous,
      revision: 'surfaced',
      rows: [createFrameSnapshotRow({
        id: 'b1:0',
        row: 3,
        col: 3,
        line: createPhysicalLine({
          blockId: 'b1',
          spans: [{ text: '> hi', token: 'fgSoft' }],
          sourceStart: 0,
          sourceEnd: 2,
          blockRow: 0,
          background: 'messageBg',
          backgroundColumns: 40,
        }),
      })],
    }
    expect(diffVisibleFrameSnapshots(previous, surfaced).changes[0]?.clearColumns).toBe(40)
    expect(diffVisibleFrameSnapshots(surfaced, snapshot('next')).changes[0]?.clearColumns).toBe(40)
  })

  it('forces all visible rows after terminal geometry changes', () => {
    const diff = diffVisibleFrameSnapshots(snapshot('same', 80), snapshot('same', 100))
    expect(diff.forced).toBe(true)
    expect(diff.changes).toHaveLength(1)
    expect(diff.unchangedRows).toBe(0)
  })

  it('treats OSC targets as part of row identity', () => {
    const previous = snapshot('doc')
    const next = {
      ...previous,
      revision: 'linked',
      rows: [createFrameSnapshotRow({
        id: 'b1:0',
        row: 3,
        col: 3,
        line: line('doc', 'https://example.test'),
      })],
    }
    expect(diffVisibleFrameSnapshots(previous, next).changes).toHaveLength(1)
  })
})
