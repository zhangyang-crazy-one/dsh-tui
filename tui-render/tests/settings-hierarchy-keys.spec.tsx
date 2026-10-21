import { expect, it } from 'vitest'
import { mapKeyEvent, type LoopInputState } from '../src/loop.tsx'
const draft: LoopInputState = { text: 'unfinished chat draft', commandQuery: undefined, prefixG: false, renaming: false, mentionSelectedIndex: 0, mentionDismissed: false }
function map(key: string, overrides: Record<string, boolean>, settings: Parameters<typeof mapKeyEvent>[12]) {
  const info: Parameters<typeof mapKeyEvent>[2] = { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false, ...overrides }
  return mapKeyEvent(draft, key, info, [], { open: false, selectedId: undefined }, { open: false, selectedId: undefined }, undefined, undefined, undefined, undefined, undefined, undefined, settings)
}
it('opens a branch without replacing the chat draft and supports returning and JSON edit', () => {
  expect(map('\r', { return: true }, { open: true, navigable: true, editValue: '{"models":[]}' })).toMatchObject({ action: { kind: 'settings-edit' }, text: draft.text })
  expect(map('', { leftArrow: true }, { open: true })).toMatchObject({ action: { kind: 'settings-escape' }, text: draft.text })
  expect(map('i', {}, { open: true, navigable: true, editValue: '{"models":[]}' })).toMatchObject({ action: { kind: 'settings-edit-json' }, text: '{"models":[]}' })
  expect(map('i', {}, { open: true, navigable: true, editable: false }).kind).toBe('none')
})
it('searches Unicode text without changing the chat draft and handles acceptance and clearing', () => {
  expect(map('/', {}, { open: true })).toMatchObject({ action: { kind: 'settings-search', query: '', active: true }, text: draft.text })
  expect(map('模型', {}, { open: true, searching: true, filter: 'long-' })).toMatchObject({ action: { kind: 'settings-search', query: 'long-模型', active: true }, text: draft.text })
  expect(map('', { backspace: true }, { open: true, searching: true, filter: 'a😀' })).toMatchObject({ action: { kind: 'settings-search', query: 'a', active: true } })
  expect(map('\r', { return: true }, { open: true, searching: true, filter: 'model' })).toMatchObject({ action: { kind: 'settings-search', query: 'model', active: false } })
  expect(map('', { escape: true }, { open: true, searching: true, filter: 'model' })).toMatchObject({ action: { kind: 'settings-search', query: '', active: false } })
})
