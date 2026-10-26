import { describe, expect, it, vi } from 'vitest'
import { composerIndex } from '../src/composer-index.ts'
import {
  deleteInputSelection, inputSelectionRange, moveInputSelection,
  replaceInputSelection, selectedInputText,
} from '../src/input-selection.ts'
import type { InputSelectionState } from '../src/input-selection.ts'

describe('composer keyboard selection', () => {
  it('extends one whole CJK, combining, or emoji grapheme at a time and reverses direction', () => {
    const text = '中日한e\u0301🧑‍💻'
    let state: InputSelectionState = { text, caretIndex: text.length }
    for (const expected of ['🧑‍💻', 'e\u0301🧑‍💻', '한e\u0301🧑‍💻', '日한e\u0301🧑‍💻', text]) {
      state = moveInputSelection(state, { direction: 'left', extend: true })
      expect(selectedInputText(state)).toBe(expected)
      expect(state.selectionAnchor).toBe(text.length)
    }
    state = moveInputSelection(state, { direction: 'right', extend: true })
    expect(selectedInputText(state)).toBe(text.slice(1))
  })

  it('selects to logical line edges and across newlines', () => {
    const state = { text: '中日\n한글\nend', caretIndex: 4 }
    const home = moveInputSelection(state, { direction: 'home', extend: true })
    expect(selectedInputText(home)).toBe('한')
    const end = moveInputSelection(home, { direction: 'end', extend: true })
    expect(selectedInputText(end)).toBe('글')
    const across = moveInputSelection(end, { direction: 'right', extend: true })
    expect(selectedInputText(across)).toBe('글\n')
    expect(inputSelectionRange(across)).toEqual({ start: 4, end: 6 })
  })

  it('collapses ordinary arrows to the selected boundary and clears ordinary Home/End', () => {
    const state = { text: 'a中日z', caretIndex: 3, selectionAnchor: 1 }
    expect(moveInputSelection(state, { direction: 'left', extend: false })).toEqual({ text: state.text, caretIndex: 1, selectionAnchor: undefined })
    expect(moveInputSelection(state, { direction: 'right', extend: false })).toEqual({ text: state.text, caretIndex: 3, selectionAnchor: undefined })
    expect(moveInputSelection(state, { direction: 'home', extend: false }).caretIndex).toBe(0)
    expect(moveInputSelection(state, { direction: 'end', extend: false }).selectionAnchor).toBeUndefined()
  })

  it('replaces reversed selections for typed text, pasted multiline text, and both delete keys', () => {
    const state = { text: 'a中🧑‍💻z', caretIndex: 1, selectionAnchor: 7 }
    expect(replaceInputSelection(state, '日\n한')).toEqual({ text: 'a日\n한z', caretIndex: 4, selectionAnchor: undefined })
    for (const direction of ['backward', 'forward'] as const) {
      expect(deleteInputSelection(state, direction)).toEqual({ text: 'az', caretIndex: 1, selectionAnchor: undefined })
    }
  })

  it('deletes complete graphemes without selection and clamps stale offsets', () => {
    expect(deleteInputSelection({ text: 'e\u0301🧑‍💻', caretIndex: 2 }, 'forward').text).toBe('e\u0301')
    expect(deleteInputSelection({ text: 'e\u0301🧑‍💻', caretIndex: 2 }, 'backward').text).toBe('🧑‍💻')
    expect(replaceInputSelection({ text: 'a', caretIndex: 50, selectionAnchor: -10 }, '中')).toEqual({ text: '中', caretIndex: 1, selectionAnchor: undefined })
    expect(inputSelectionRange({ text: 'abc', caretIndex: 1, selectionAnchor: 1 })).toBeUndefined()
    expect(inputSelectionRange({ text: 'a🧑‍💻z', caretIndex: 6, selectionAnchor: 3 })).toEqual({ start: 1, end: 6 })
    expect(deleteInputSelection({ text: '', caretIndex: 0 }, 'backward')).toEqual({ text: '', caretIndex: 0, selectionAnchor: undefined })
    expect(selectedInputText({ text: 'abc', caretIndex: 1 })).toBeUndefined()
  })

  it('never copies explicitly secret buffers or masked slash credentials', () => {
    expect(selectedInputText({ text: 'fixture-secret', caretIndex: 14, selectionAnchor: 0 }, { secret: true })).toBeUndefined()
    const text = '/key OPENAI_API_KEY sk-fixture-secret'
    expect(selectedInputText({ text, caretIndex: text.length, selectionAnchor: 0 })).toBeUndefined()
    expect(selectedInputText({ text: '普通文字', caretIndex: 4, selectionAnchor: 0 })).toBe('普通文字')
  })
})

describe('indexed selection boundary reuse', () => {
  it.each([700, 7000, 70000])('does not segment the full prefix for repeated %i-unit tail selections', units => {
    const text = '中文🙂abc'.repeat(units / 7)
    // Initial ingestion is allowed to be linear. Count only unchanged revisions.
    composerIndex(text).line(0)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      let state: InputSelectionState = { text, caretIndex: text.length }
      for (let step = 0; step < 40; step++) {
        state = moveInputSelection(state, { direction: 'left', extend: true })
        expect(inputSelectionRange(state)).toEqual({ start: state.caretIndex, end: text.length })
        expect(selectedInputText(state)).toBe(text.slice(state.caretIndex))
      }
      expect(segment.mock.calls).toHaveLength(0)
      expect(replaceInputSelection(state, '替换\n[图片 #2]').text)
        .toBe(text.slice(0, state.caretIndex) + '替换\n[图片 #2]')
      expect(deleteInputSelection(state, 'backward').text).toBe(text.slice(0, state.caretIndex))
      expect(segment.mock.calls).toHaveLength(0)
    } finally { segment.mockRestore() }
  })

  it('matches the full-draft grapheme reference for stale and reversed selection offsets', () => {
    const splitter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const text of ['中é👩‍💻\t\n[图片 #1]\n', 'a\r\né👩‍💻\r\n', '', '\n\n']) {
      const starts = [...splitter.segment(text)].map(part => part.index)
      const reference = (offset: number) => {
        const caret = Math.max(0, Math.min(offset, text.length))
        return caret === text.length ? caret : (starts.findLast(start => start <= caret) ?? 0)
      }
      for (let caret = -1; caret <= text.length + 1; caret++) {
        const anchor = text.length - caret
        const a = reference(caret)
        const b = reference(anchor)
        expect(inputSelectionRange({ text, caretIndex: caret, selectionAnchor: anchor }))
          .toEqual(a === b ? undefined : { start: Math.min(a, b), end: Math.max(a, b) })
      }
    }
  })
})

it('extends and deletes a CRLF as one complete source grapheme', () => {
  const text = 'a\r\nb'
  const right = moveInputSelection({ text, caretIndex: 1 }, { direction: 'right', extend: true })
  expect(right).toEqual({ text, caretIndex: 3, selectionAnchor: 1 })
  expect(selectedInputText(right)).toBe('\r\n')
  expect(moveInputSelection({ text, caretIndex: 3 }, { direction: 'left', extend: true }))
    .toEqual({ text, caretIndex: 1, selectionAnchor: 3 })
  expect(deleteInputSelection({ text, caretIndex: 3 }, 'backward').text).toBe('ab')
  expect(deleteInputSelection({ text, caretIndex: 1 }, 'forward').text).toBe('ab')
})

it('keeps End and Shift+End before the whole CRLF grapheme', () => {
  const text = 'a\r\nb'
  for (const extend of [false, true]) {
    const state = moveInputSelection({ text, caretIndex: 0 }, { direction: 'end', extend })
    expect(state.caretIndex).toBe(1)
    expect(selectedInputText(state)).toBe(extend ? 'a' : undefined)
    expect(deleteInputSelection(state, 'forward').text).toBe(extend ? '\r\nb' : 'ab')
  }
})
