import { describe, expect, it, vi } from 'vitest'
import { ComposerIndex, composerHeight, composerIndex, composerRowBudget, composerRowWindow } from '../src/composer-index.ts'
import { composerCursorPosition, composerFrameAnchor, composerLineWindow, moveCaretByGrapheme } from '../src/composer-cursor.ts'
import { displayWidth } from '../src/content.ts'

describe('draft line and grapheme index', () => {
  it('retains exact line offsets including empty lines and trailing newlines', () => {
    const text = '\n中文\né👩‍💻\t[图片 #1]\n'
    const index = new ComposerIndex(text)
    expect(index.lineStarts).toEqual([0, 1, 4, text.length])
    expect(index.lineStarts.map((_, row) => index.line(row).text).join('\n')).toBe(text)
    for (let caret = 0; caret <= text.length; caret++) {
      expect(index.rowAt(caret)).toBe(text.slice(0, caret).split('\n').length - 1)
    }
  })

  it.each([100, 1000, 10000])('does not segment/tokenize the prefix again while moving in a %i-unit fixture tail', count => {
    const text = '中文🙂abc'.repeat(count)
    const index = composerIndex(text)
    const line = index.line(0)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      for (let offset = 0; offset < 40; offset++) {
        const caret = text.length - offset
        const previous = moveCaretByGrapheme(text, caret, -1)
        expect(previous).toBeLessThan(caret)
        const window = composerLineWindow(text, previous, 76)
        expect(displayWidth(window.text)).toBeLessThanOrEqual(75)
        expect(window.caretColumn).toBeLessThan(76)
        expect(composerCursorPosition(text, previous).row).toBe(0)
        expect(composerIndex(text)).toBe(index)
        expect(index.line(0)).toBe(line)
      }
      // Window text width checks may segment the short visible string. No indexed
      // lookup may hand a full draft (or its long prefix) back to Segmenter.
      expect(segment.mock.calls.filter(([source]) => source.length > 100)).toHaveLength(0)
    } finally { segment.mockRestore() }
  })

  it('lazily segments only visited logical lines and replaces a changed revision', () => {
    const text = Array(1000).fill('中é👩‍💻\t').join('\n')
    const index = composerIndex(text)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      index.line(999)
      const calls = segment.mock.calls.length
      expect(calls).toBeGreaterThan(0)
      index.line(999)
      expect(segment.mock.calls).toHaveLength(calls)
      expect(composerIndex(text + ' restored')).not.toBe(index)
    } finally { segment.mockRestore() }
  })

  it('preserves terminal widths and never detaches a grapheme at a window edge', () => {
    const text = '中é👩‍💻\t[图片 #1]'
    const index = new ComposerIndex(text)
    const line = index.line(0)
    expect(line.glyphs.map(g => text.slice(g.start, g.end)).join('')).toBe(text)
    expect(line.columnAt(text.length)).toBe(displayWidth(text.replace('\t', '\\t')))
    for (const columns of [1, 2, 5, 8, 76]) {
      for (const caret of line.offsets) {
        const window = line.window(caret, columns)
        expect(window.text).not.toMatch(/^[\u200d\u0301\udc00-\udfff]/u)
        expect(displayWidth(window.text) + Number(window.hiddenPrefix)).toBeLessThan(columns)
        expect(window.caretColumn).toBeLessThan(columns)
      }
    }
    expect(line.glyphs.filter(g => g.kind === 'image').map(g => g.text).join('')).toBe('[图片 #1]')
  })

  it.each([24, 40])('bounds rows and anchors the IME at each visible caret in a %i-row terminal', rows => {
    const text = Array.from({ length: 1000 }, (_, i) => `中${i}`).join('\n')
    const index = new ComposerIndex(text)
    for (const row of [0, 1, 500, 998, 999]) {
      const caret = (index.lineStarts[row] as number) + 1
      const window = composerRowWindow(index, caret, rows, 3)
      expect(window.start).toBeLessThanOrEqual(row)
      expect(window.end).toBeGreaterThan(row)
      expect(window.end - window.start + 1).toBeLessThanOrEqual(composerRowBudget(rows, 3))
      expect(composerFrameAnchor(text, caret, { columns: 80, rows, rowsBelow: 3,
        promptWidth: 4, fullscreen: true, lineWindow: window }))
        .toEqual({ up: window.end - 1 - row + 3, col: 7 })
      expect(composerHeight(text, rows, 3)).toBe(1 + composerRowBudget(rows, 3))
    }
  })
})

describe('indexed selection endpoints', () => {
  it('snaps stale UTF-16 endpoints without traversing the draft prefix', () => {
    const text = 'a'.repeat(70000) + '\né👩‍💻\t'
    const index = new ComposerIndex(text)
    expect(index.snapCaret(text.length - 3)).toBe(70003)
    expect(index.snapCaret(70002)).toBe(70001)
    expect(index.snapCaret(-10)).toBe(0)
    expect(index.snapCaret(text.length + 100)).toBe(text.length)
  })
})
