/** Composer caret geometry: pure row/col over display width. */

import { describe, expect, it } from 'vitest'
import {
  composerCursorPosition,
  composerFrameAnchor,
  clampCaretIndex,
  moveCaretByGrapheme,
} from '../src/composer-cursor.ts'

describe('composerCursorPosition', () => {
  it('places the caret at the end of a single-line buffer', () => {
    expect(composerCursorPosition('hello', 5)).toEqual({ row: 0, col: 5 })
    expect(composerCursorPosition('', 0)).toEqual({ row: 0, col: 0 })
  })

  it('splits rows on newlines and measures the caret line', () => {
    expect(composerCursorPosition('first\nsecond\nthird', 18)).toEqual({
      row: 2,
      col: 5,
    })
    expect(composerCursorPosition('first\nsecond', 6)).toEqual({
      row: 1,
      col: 0,
    })
  })

  it('counts CJK as two columns per glyph (display width, not char index)', () => {
    expect(composerCursorPosition('中文ab', 4)).toEqual({ row: 0, col: 6 })
    expect(composerCursorPosition('中', 1)).toEqual({ row: 0, col: 2 })
  })

  it('counts emoji and ZWJ sequences by display width without splitting', () => {
    expect(composerCursorPosition('👨\u200d👩\u200d👧', 5)).toEqual({
      row: 0,
      col: 2,
    })
    expect(composerCursorPosition('😀x', 3)).toEqual({ row: 0, col: 3 })
  })

  it('treats in-line tabs and zero-width characters via display width', () => {
    // string-width measures a tab as zero columns; the caret follows the
    // display grid, so the tab contributes no column.
    expect(composerCursorPosition('a\tb', 3)).toEqual({ row: 0, col: 2 })
    // A zero-width joiner occupies no column either.
    expect(composerCursorPosition('e\u200b', 2)).toEqual({ row: 0, col: 1 })
  })

  it('clamps an out-of-range caret to the buffer bounds', () => {
    expect(composerCursorPosition('ab', 99)).toEqual({ row: 0, col: 2 })
    expect(composerCursorPosition('ab', -3)).toEqual({ row: 0, col: 0 })
  })

  it('keeps the caret on the caret line for a mid-line index', () => {
    expect(composerCursorPosition('a\nbc', 3)).toEqual({ row: 1, col: 1 })
  })
})

describe('clampCaretIndex', () => {
  it('treats a missing index as the end of the buffer', () => {
    expect(clampCaretIndex('ab', undefined)).toBe(2)
    expect(clampCaretIndex('', undefined)).toBe(0)
  })

  it('clamps an out-of-range index', () => {
    expect(clampCaretIndex('ab', -3)).toBe(0)
    expect(clampCaretIndex('ab', 99)).toBe(2)
    expect(clampCaretIndex('ab', 1)).toBe(1)
  })
})

describe('moveCaretByGrapheme', () => {
  it('stays at the ends of an empty or occupied buffer', () => {
    expect(moveCaretByGrapheme('', 0, -1)).toBe(0)
    expect(moveCaretByGrapheme('', 0, 1)).toBe(0)
    expect(moveCaretByGrapheme('ab', 0, -1)).toBe(0)
    expect(moveCaretByGrapheme('ab', 2, 1)).toBe(2)
  })

  it('steps one code-unit letter at a time', () => {
    expect(moveCaretByGrapheme('ab', 2, -1)).toBe(1)
    expect(moveCaretByGrapheme('ab', 1, -1)).toBe(0)
    expect(moveCaretByGrapheme('ab', 0, 1)).toBe(1)
    expect(moveCaretByGrapheme('ab', 1, 1)).toBe(2)
  })

  it('steps a CJK glyph as one unit', () => {
    expect(moveCaretByGrapheme('中文', 2, -1)).toBe(1)
    expect(moveCaretByGrapheme('中文', 0, 1)).toBe(1)
  })

  it('steps an emoji ZWJ sequence as one unit', () => {
    const family = '👨\u200d👩\u200d👧'
    expect(moveCaretByGrapheme(family, family.length, -1)).toBe(0)
    expect(moveCaretByGrapheme(family, 0, 1)).toBe(family.length)
  })
})

describe('composerFrameAnchor', () => {
  const viewport = { promptWidth: 2, columns: 80, rows: 24 }

  it('keeps a fullscreen single-line caret on the last output row', () => {
    // `> ` is two columns; empty buffer → CSI column 3. Fullscreen TTY
    // frames leave the cursor on that row, so up is 0 — not 1.
    expect(
      composerFrameAnchor('', 0, { ...viewport, fullscreen: true }),
    ).toEqual({ up: 0, col: 3 })
    expect(
      composerFrameAnchor('hi', 2, { ...viewport, fullscreen: true }),
    ).toEqual({ up: 0, col: 5 })
  })

  it('moves up one row after a trailing-newline (non-fullscreen) frame', () => {
    expect(
      composerFrameAnchor('', 0, { ...viewport, fullscreen: false }),
    ).toEqual({ up: 1, col: 3 })
    expect(
      composerFrameAnchor('hi', 2, { ...viewport, fullscreen: false }),
    ).toEqual({ up: 1, col: 5 })
  })

  it('counts CJK display width in the 1-based column', () => {
    expect(
      composerFrameAnchor('中', 1, { ...viewport, fullscreen: true }),
    ).toEqual({ up: 0, col: 5 })
  })

  it('moves up from the last composer line for a caret on an earlier line', () => {
    expect(
      composerFrameAnchor('one\ntwo', 0, { ...viewport, fullscreen: true }),
    ).toEqual({ up: 1, col: 3 })
    expect(
      composerFrameAnchor('one\ntwo', 0, { ...viewport, fullscreen: false }),
    ).toEqual({ up: 2, col: 3 })
  })

  it('clamps the column into the viewport', () => {
    expect(
      composerFrameAnchor('ab', 2, {
        promptWidth: 2,
        columns: 3,
        rows: 24,
        fullscreen: true,
      }),
    ).toEqual({ up: 0, col: 3 })
    expect(
      composerFrameAnchor('', 0, {
        promptWidth: 2,
        columns: 0,
        rows: 1,
        fullscreen: true,
      }),
    ).toEqual({ up: 0, col: 1 })
  })

  it('counts palette rows below the composer in up', () => {
    expect(
      composerFrameAnchor('hi', 2, {
        ...viewport,
        fullscreen: true,
        rowsBelow: 3,
      }),
    ).toEqual({ up: 3, col: 5 })
    expect(
      composerFrameAnchor('hi', 2, {
        ...viewport,
        fullscreen: false,
        rowsBelow: 3,
      }),
    ).toEqual({ up: 4, col: 5 })
  })
})
