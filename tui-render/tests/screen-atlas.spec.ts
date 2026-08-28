/**
 * Screen atlas: ANSI feed, OSC 8 lookup, selection extract and overlay.
 */

import { describe, expect, it, vi } from 'vitest'
import { orderedPoints, ScreenAtlas } from '../src/screen-atlas.ts'

describe('orderedPoints', () => {
  it('orders by reading order', () => {
    expect(orderedPoints({ col: 2, row: 1 }, { col: 1, row: 1 })).toEqual({
      start: { col: 1, row: 1 },
      end: { col: 2, row: 1 },
    })
    expect(orderedPoints({ col: 1, row: 1 }, { col: 2, row: 1 }).start.col).toBe(1)
    expect(orderedPoints({ col: 1, row: 3 }, { col: 8, row: 1 }).start.row).toBe(1)
  })
})

describe('ScreenAtlas', () => {
  it('writes graphemes, OSC 8, and CUP', () => {
    const atlas = new ScreenAtlas(8, 3)
    atlas.feed('\x1b[Hhi\x1b]8;;https://ex.com\x1b\\ab\x1b]8;;\x1b\\')
    expect(atlas.cellAt(1, 1)?.ch).toBe('h')
    expect(atlas.urlAt(3, 1)).toBe('https://ex.com')
    expect(atlas.urlAt(4, 1)).toBe('https://ex.com')
    expect(atlas.urlAt(5, 1)).toBeUndefined()
    expect(atlas.cellAt(0, 1)).toBeUndefined()
  })

  it('segments one mixed stdout chunk once and preserves combining glyphs', () => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      const atlas = new ScreenAtlas(12, 2)
      atlas.feed('ab\x1b[2C\x1b]8;;https://ex.com\x1b\\cd\x1b]8;;\x1b\\!')
      expect(segment).toHaveBeenCalledTimes(1)
    } finally {
      segment.mockRestore()
    }

    const unicode = new ScreenAtlas(12, 2)
    unicode.feed('e\u0301\x1b[2C\x1b]8;;https://ex.com\x1b\\中\x1b]8;;\x1b\\!')
    expect(unicode.cellAt(1, 1)?.ch).toBe('e\u0301')
    expect(unicode.cellAt(4, 1)?.ch).toBe('中')
    expect(unicode.cellAt(5, 1)?.ch).toBe('')
    expect(unicode.urlAt(4, 1)).toBe('https://ex.com')
    expect(unicode.cellAt(6, 1)?.ch).toBe('!')
    expect(unicode.urlAt(6, 1)).toBeUndefined()
  })

  it('applies cursor motion, erase, CR/LF/backspace, and leftover ESC', () => {
    const atlas = new ScreenAtlas(6, 3)
    atlas.feed('abc\b \n\rd\x1b[2A\x1b[3C!\x1b[2J')
    expect(atlas.extract({ col: 1, row: 1 }, { col: 6, row: 3 }).trim()).toBe('')
    atlas.feed('\x1b')
    atlas.feed('[Hxy')
    expect(atlas.cellAt(1, 1)?.ch).toBe('x')
    atlas.feed('\x1b[2;1Hzz\x1b[1K')
    atlas.feed('\x1b[B\x1b[D\x1b[C')
    atlas.feed('\x1b[G')
    atlas.feed('\x1b[3J')
    atlas.feed('\x1b[2K')
    atlas.feed('\x1b[1;1Hok')
    expect(atlas.extract({ col: 1, row: 1 }, { col: 2, row: 1 })).toBe('ok')
  })

  it('applies inclusive line erasure and clears the whole row for CSI 2 K', () => {
    const atlas = new ScreenAtlas(6, 2)
    atlas.feed('\x1b[1;1Habcdef\x1b[1;3H\x1b[1K')
    expect(atlas.extract({ col: 1, row: 1 }, { col: 6, row: 1 })).toBe('   def')
    atlas.feed('\x1b[1;3H\x1b[2K')
    expect(atlas.extract({ col: 1, row: 1 }, { col: 6, row: 1 })).toBe('')
  })

  it('defers right-margin wrapping until the next printable cell', () => {
    const atlas = new ScreenAtlas(4, 3)
    atlas.feed('abcd\r\nef')
    expect(atlas.extract({ col: 1, row: 1 }, { col: 4, row: 2 })).toBe('abcd\nef')

    const wrapped = new ScreenAtlas(4, 2)
    wrapped.feed('abcdX')
    expect(wrapped.extract({ col: 1, row: 1 }, { col: 4, row: 2 })).toBe('abcd\nX')
  })

  it('holds incomplete OSC 8 and generic OSC, then completes', () => {
    const atlas = new ScreenAtlas(10, 2)
    atlas.feed('\x1b]8;;http')
    atlas.feed('s://a\x1b\\Z\x1b]8;;\x07')
    expect(atlas.urlAt(1, 1)).toBe('https://a')
    atlas.feed('\x1b]0;title\x1b\\')
    atlas.feed('\x1b]0;partial')
    atlas.feed('\u0007')
  })

  it('extracts a reversed range and paints a reverse overlay', () => {
    const atlas = new ScreenAtlas(8, 2)
    atlas.feed('\x1b[Hhello')
    expect(atlas.extract({ col: 5, row: 1 }, { col: 1, row: 1 })).toBe('hello')
    const overlay = atlas.selectionOverlay({ col: 1, row: 1 }, { col: 2, row: 1 })
    expect(overlay).toContain('\x1b[7m')
    expect(overlay).toContain('he')
    expect(atlas.selectionOverlay({ col: 8, row: 2 }, { col: 8, row: 2 })).toContain(
      '\x1b[7m',
    )
    const wide = new ScreenAtlas(8, 2)
    wide.feed('\x1b[H中')
    expect(wide.selectionOverlay({ col: 2, row: 1 }, { col: 2, row: 1 })).toBe('')

    const multi = new ScreenAtlas(4, 3)
    multi.feed('abcd\r\nefgh\r\nijkl')
    expect(multi.extract({ col: 2, row: 1 }, { col: 3, row: 3 })).toBe('bcd\nefgh\nijk')
    expect(multi.selectionOverlay({ col: 2, row: 1 }, { col: 3, row: 3 })).toContain('efgh')
    expect(multi.extract({ col: 0, row: 1 }, { col: 5, row: 1 })).toBe('abcd')
  })

  it('resizes, wraps a wide glyph, skips C0, and treats tab as a space', () => {
    const atlas = new ScreenAtlas(4, 2)
    atlas.feed('中\t\x01x')
    expect(atlas.cellAt(1, 1)?.ch).toBe('中')
    expect(atlas.cellAt(2, 1)?.ch).toBe('')
    atlas.resize(6, 3)
    expect(atlas.cellAt(1, 1)?.ch).toBe('中')
    atlas.resize(6, 3)
    atlas.feed('\x1b[?2026h')
    atlas.feed('\x1b[1;1fA')
    atlas.feed('\x1b[')
    atlas.feed('K')
    atlas.feed('\x1b7saved')
    atlas.feed('\x1b]8;;\x1b\\')

    const bounded = new ScreenAtlas(1, 1)
    bounded.feed('中ab')
    expect(bounded.cellAt(1, 1)?.ch).toBe('b')
  })

  it('covers explicit cursor, erase, OSC, and CSI parameter variants', () => {
    const atlas = new ScreenAtlas(6, 3)
    atlas.feed('abcdef')
    atlas.feed('\x1b[3G!\x1b[1J')
    atlas.feed('\x1b[A')
    atlas.feed('\x1b[;Hq')
    atlas.feed('\x1b]8;without-separator\x1b\\x')
    expect(atlas.urlAt(2, 1)).toBeUndefined()
    atlas.feed('\x1b]0;title\x07tail\x1b\\')
    expect(atlas.cellAt(1, 1)?.ch).toBe('q')
  })
})
