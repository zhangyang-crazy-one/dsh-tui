import { expect, it } from 'vitest'
import { registerTuiLocale, listTuiLocales, tuiCopy } from '../src/ui-copy.ts'

it('registers partial language packs with explicit fallback and reversible lifetime', () => {
  const remove = registerTuiLocale('ja-JP', { on: '有効', inputHint: '入力' }, 'en-US')
  try {
    expect(listTuiLocales()).toContain('ja-JP')
    expect(tuiCopy('on', 'ja-JP')).toBe('有効')
    expect(tuiCopy('sendHint', 'ja-JP')).toBe('Enter to send')
    expect(() => registerTuiLocale('ja-JP', {})).toThrow()
    expect(() => registerTuiLocale('en-US', {})).toThrow()
    expect(() => registerTuiLocale('../bad', {})).toThrow()
  } finally { remove() }
  expect(listTuiLocales()).not.toContain('ja-JP')
  expect(tuiCopy('on', 'ja-JP')).toBe(tuiCopy('on', 'zh-CN'))
})
