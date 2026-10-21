import { describe, expect, it } from 'vitest'
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
