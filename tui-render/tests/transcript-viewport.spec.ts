import { describe, expect, it } from 'vitest'
import {
  EMPTY_TRANSCRIPT_VIEWPORT,
  physicalScrollRailGeometry,
  reduceTranscriptViewport,
} from '../src/transcript-viewport.ts'
import type { TranscriptBlockLayout } from '../src/transcript-viewport.ts'

function blocks(...rows: number[]): readonly TranscriptBlockLayout[] {
  let top = 0
  return rows.map((height, index) => {
    const block = { id: `block-${String(index)}`, top, rows: height }
    top += height
    return block
  })
}

describe('reduceTranscriptViewport', () => {
  it('scrolls in one physical-row coordinate and pages by the supplied delta', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 100,
      viewportRows: 20,
      blocks: blocks(25, 25, 25, 25),
    })
    const line = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 1 })
    expect(line).toMatchObject({ follow: false, offsetFromBottom: 1 })
    const page = reduceTranscriptViewport(line, { kind: 'scroll', delta: 19 })
    expect(page).toMatchObject({ follow: false, offsetFromBottom: 20 })
  })

  it('preserves a detached block row while content grows below it', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 60,
      viewportRows: 20,
      blocks: blocks(20, 20, 20),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 10 })
    expect(detached.anchor).toEqual({
      blockId: 'block-1',
      rowWithinBlock: 10,
      viewportRow: 0,
    })
    const streamed = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 68,
      viewportRows: 20,
      blocks: blocks(20, 20, 28),
      unseenRowsAdded: 8,
    })
    expect(streamed).toMatchObject({
      follow: false,
      offsetFromBottom: 18,
      unseenRows: 8,
      anchor: detached.anchor,
    })
  })

  it('does not count estimate refinement as unseen content', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 60,
      viewportRows: 20,
      blocks: blocks(20, 20, 20),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 10 })
    const refined = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 68,
      viewportRows: 20,
      blocks: blocks(20, 28, 20),
    })
    expect(refined).toMatchObject({ unseenRows: 0, follow: false })
    expect(refined.anchor).toEqual(detached.anchor)
  })

  it('keeps the anchor block across width reflow and clamps its inner row', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 80,
      viewportRows: 20,
      blocks: blocks(20, 20, 40),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 30 })
    expect(detached.anchor?.blockId).toBe('block-1')
    const reflowed = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 110,
      viewportRows: 20,
      blocks: blocks(30, 30, 50),
    })
    expect(reflowed.anchor?.blockId).toBe('block-1')
    expect(reflowed.anchor?.rowWithinBlock).toBe(detached.anchor?.rowWithinBlock)
  })

  it('recovers the nearest previous block when the anchor disappears', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 60,
      viewportRows: 20,
      blocks: blocks(20, 20, 20),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 20 })
    expect(detached.anchor?.blockId).toBe('block-1')
    const recovered = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 40,
      viewportRows: 20,
      blocks: [
        { id: 'block-0', top: 0, rows: 20 },
        { id: 'block-2', top: 20, rows: 20 },
      ],
    })
    expect(recovered.anchor?.blockId).toBe('block-0')
  })

  it('reattaches atomically at the latest edge', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 60,
      viewportRows: 20,
      blocks: blocks(20, 20, 20),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 1 })
    const streamed = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 62,
      viewportRows: 20,
      blocks: blocks(20, 20, 22),
    })
    const latest = reduceTranscriptViewport(streamed, { kind: 'edge', edge: 'latest' })
    expect(latest).toMatchObject({
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      anchor: undefined,
    })
  })

  it('restores follow mode when ordinary downward scrolling reaches the live edge', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 80,
      viewportRows: 20,
      blocks: blocks(20, 20, 40),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 12 })
    const streamed = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 84,
      viewportRows: 20,
      blocks: blocks(20, 20, 44),
      unseenRowsAdded: 4,
    })

    const latest = reduceTranscriptViewport(streamed, { kind: 'scroll', delta: -16 })

    expect(latest).toMatchObject({
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      anchor: undefined,
    })
  })

  it('maps rail positions from the oldest edge to the live edge', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 100,
      viewportRows: 20,
      blocks: blocks(25, 25, 25, 25),
    })
    const oldest = reduceTranscriptViewport(measured, { kind: 'position', fraction: 0 })
    const middle = reduceTranscriptViewport(oldest, { kind: 'position', fraction: 0.5 })
    const latest = reduceTranscriptViewport({ ...middle, unseenRows: 9 }, {
      kind: 'position',
      fraction: 1,
    })

    expect(oldest).toMatchObject({ follow: false, offsetFromBottom: 80 })
    expect(middle).toMatchObject({ follow: false, offsetFromBottom: 40 })
    expect(latest).toMatchObject({
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      anchor: undefined,
    })
  })

  it('keeps a following viewport attached while content is appended', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 60,
      viewportRows: 20,
      blocks: blocks(20, 20, 20),
    })
    const appended = reduceTranscriptViewport(measured, {
      kind: 'layout',
      contentRows: 68,
      viewportRows: 20,
      blocks: blocks(20, 20, 28),
      unseenRowsAdded: 8,
    })

    expect(appended).toMatchObject({
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
    })
    expect(appended.anchor).toBeUndefined()
  })

  it('reattaches when measurement correction collapses a detached offset to zero', () => {
    const measured = reduceTranscriptViewport(EMPTY_TRANSCRIPT_VIEWPORT, {
      kind: 'layout',
      contentRows: 80,
      viewportRows: 20,
      blocks: blocks(20, 20, 40),
    })
    const detached = reduceTranscriptViewport(measured, { kind: 'scroll', delta: 10 })
    const corrected = reduceTranscriptViewport(detached, {
      kind: 'layout',
      contentRows: 70,
      viewportRows: 20,
      blocks: blocks(20, 20, 30),
      unseenRowsAdded: 3,
    })

    expect(corrected).toMatchObject({
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
    })
    expect(corrected.anchor).toBeUndefined()
  })
})

describe('physicalScrollRailGeometry', () => {
  it('uses measured physical rows and disappears without overflow', () => {
    expect(physicalScrollRailGeometry(20, 20, 0)).toBeUndefined()
    expect(physicalScrollRailGeometry(100, 20, 0)).toEqual({
      rows: 20,
      thumbStart: 16,
      thumbRows: 4,
    })
    expect(physicalScrollRailGeometry(100, 20, 80)).toEqual({
      rows: 20,
      thumbStart: 0,
      thumbRows: 4,
    })
  })
})
