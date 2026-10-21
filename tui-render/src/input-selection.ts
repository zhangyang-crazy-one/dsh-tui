/** Pure keyboard selection in the composer's UTF-16 buffer coordinates. */
import { moveCaretByGrapheme } from './composer-cursor.ts'
import { maskComposerInput } from './secret-input.ts'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The owner retains the unmasked source; rendering translates both endpoints. */
export interface InputSelectionState {
  text: string
  caretIndex: number
  selectionAnchor?: number | undefined
}

/** Snap stale or partial offsets to a complete grapheme's leading boundary. */
function boundary(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, text.length))
  for (const part of graphemes.segment(text)) {
    if (part.index + part.segment.length > clamped) return part.index
  }
  return text.length
}

/** Ordered selection endpoints; an absent or collapsed anchor has no payload. */
export function inputSelectionRange(state: InputSelectionState): { start: number; end: number } | undefined {
  if (state.selectionAnchor === undefined) return undefined
  const caret = boundary(state.text, state.caretIndex)
  const anchor = boundary(state.text, state.selectionAnchor)
  return caret === anchor ? undefined : { start: Math.min(caret, anchor), end: Math.max(caret, anchor) }
}

/** Move by grapheme or logical line edge; Shift preserves the initial anchor. */
export function moveInputSelection(state: InputSelectionState, options: {
  direction: 'left' | 'right' | 'home' | 'end'
  extend: boolean
}): InputSelectionState {
  const caret = boundary(state.text, state.caretIndex)
  const range = inputSelectionRange(state)
  let next: number
  if (!options.extend && range !== undefined && (options.direction === 'left' || options.direction === 'right')) {
    next = options.direction === 'left' ? range.start : range.end
  } else if (options.direction === 'home') {
    next = state.text.slice(0, caret).lastIndexOf('\n') + 1
  } else if (options.direction === 'end') {
    const newline = state.text.indexOf('\n', caret)
    next = newline < 0 ? state.text.length : newline
  } else {
    next = moveCaretByGrapheme(state.text, caret, options.direction === 'left' ? -1 : 1)
  }
  return { text: state.text, caretIndex: next,
    selectionAnchor: options.extend ? boundary(state.text, state.selectionAnchor ?? caret) : undefined }
}

/** Exact copy payload for ordinary input; credential buffers never leave through copy. */
export function selectedInputText(state: InputSelectionState, options: { secret?: boolean } = {}): string | undefined {
  const range = inputSelectionRange(state)
  if (range === undefined || options.secret || maskComposerInput(state.text, state.caretIndex).text !== state.text) return undefined
  return state.text.slice(range.start, range.end)
}

/** Typed text, newline, and bracketed paste share replacement semantics. */
export function replaceInputSelection(state: InputSelectionState, text: string): InputSelectionState {
  const caret = boundary(state.text, state.caretIndex)
  const range = inputSelectionRange(state) ?? { start: caret, end: caret }
  return { text: state.text.slice(0, range.start) + text + state.text.slice(range.end),
    caretIndex: range.start + text.length, selectionAnchor: undefined }
}

/** Delete the selection, or a whole adjacent grapheme when no selection exists. */
export function deleteInputSelection(state: InputSelectionState, direction: 'backward' | 'forward'): InputSelectionState {
  if (inputSelectionRange(state) !== undefined) return replaceInputSelection(state, '')
  const caret = boundary(state.text, state.caretIndex)
  const adjacent = moveCaretByGrapheme(state.text, caret, direction === 'backward' ? -1 : 1)
  return replaceInputSelection({ ...state, caretIndex: caret, selectionAnchor: adjacent }, '')
}
