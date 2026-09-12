import { describe, expect, it } from 'vitest'
import {
  displayWidth,
  displayColumnSlice,
  escapeContent,
  formatSymbolSpacing,
  padDisplayEnd,
  wcwidthSafeSlice,
  wrapDisplayLines,
} from '../src/content.ts'

describe('displayColumnSlice', () => {
  it('uses terminal columns without splitting CJK or ZWJ graphemes', () => {
    expect(displayColumnSlice('a中b', 1, 3)).toBe('中')
    expect(displayColumnSlice('a中b', 0, 1)).toBe('a')
    expect(displayColumnSlice('a中b', 3, 4)).toBe('b')
    expect(displayColumnSlice('x👨‍👩‍👧‍👦y', 1, 3)).toBe('👨‍👩‍👧‍👦')
    expect(displayColumnSlice('hello world', 2, 7)).toBe('llo w')
  })
})

describe('escapeContent', () => {
  it('neutralizes the ESC byte and every C0 control except tab and newline', () => {
    expect(escapeContent('a\x1b[2Jb')).toBe('a\\x1b[2Jb')
    expect(escapeContent('\u0000')).toBe('\\x00')
    expect(escapeContent('\u0001\u0008')).toBe('\\x01\\x08')
    expect(escapeContent('\u000b\u000c')).toBe('\\x0b\\x0c')
    expect(escapeContent('\u000e\u001f')).toBe('\\x0e\\x1f')
    expect(escapeContent('\u007f')).toBe('\\x7f')
    expect(escapeContent('a\tb\nc\rd')).toBe('a\tb\nc\nd')
    expect(escapeContent('a\tb\nc\r\nd')).toBe('a\tb\nc\nd')
  })

  it('leaves plain text untouched', () => {
    expect(escapeContent('plain')).toBe('plain')
    expect(escapeContent('')).toBe('')
  })

  it('escapes every control byte in a mixed run', () => {
    expect(escapeContent('a\x1b\x07b')).toBe('a\\x1b\\x07b')
  })
})

describe('displayWidth', () => {
  it('returns zero for empty string', () => {
    expect(displayWidth('')).toBe(0)
  })

  it('counts CJK glyphs as two columns and ASCII as one', () => {
    expect(displayWidth('中文ab')).toBe(6)
    expect(displayWidth('ab')).toBe(2)
  })

  it('measures emoji as two columns', () => {
    expect(displayWidth('😀')).toBe(2)
  })

  it('collapses ZWJ emoji sequences to two columns', () => {
    expect(displayWidth('👨‍👩‍👧‍👦')).toBe(2)
  })

  it('measures circled and enclosed numbers as single-column glyphs', () => {
    expect(displayWidth('①')).toBe(1)
    expect(displayWidth('②')).toBe(1)
    expect(displayWidth('⑩')).toBe(1)
    expect(displayWidth('⑴')).toBe(1)
    expect(displayWidth('⒈')).toBe(1)
    expect(displayWidth('❶')).toBe(1)
  })

  it('measures BMP single-codepoint emojis as two columns', () => {
    expect(displayWidth('⚠')).toBe(2)
    expect(displayWidth('⚠️')).toBe(2)
    expect(displayWidth('⚙')).toBe(2)
    expect(displayWidth('⚙️')).toBe(2)
    expect(displayWidth('ℹ')).toBe(2)
    expect(displayWidth('⏱')).toBe(2)
    expect(displayWidth('⚠︎')).toBe(1)
    expect(displayWidth('⚡')).toBe(2)
    expect(displayWidth('⭐')).toBe(2)
  })

  it('preserves single-column width for UI chrome symbols', () => {
    expect(displayWidth('·')).toBe(1)
    expect(displayWidth('…')).toBe(1)
    expect(displayWidth('—')).toBe(1)
    expect(displayWidth('✓')).toBe(1)
    expect(displayWidth('✗')).toBe(1)
  })

  it('pads CJK to a display-column budget without using string length', () => {
    expect(padDisplayEnd('中', 4)).toBe('中  ')
    expect(displayWidth(padDisplayEnd('中', 4))).toBe(4)
    expect(padDisplayEnd('ab', 4)).toBe('ab  ')
    expect(padDisplayEnd('abcd', 3)).toBe('abcd')
    expect(padDisplayEnd('x', 0)).toBe('x')
  })
})

describe('formatSymbolSpacing', () => {
  it('adds padding between circled numbers and adjacent CJK characters', () => {
    expect(formatSymbolSpacing('- ①在 ~/.dsh/settings.yaml 里加 provider 路由')).toBe(
      '- ① 在 ~/.dsh/settings.yaml 里加 provider 路由',
    )
    expect(formatSymbolSpacing('把 ①和 ②直接写进')).toBe('把 ① 和 ② 直接写进')
    expect(formatSymbolSpacing('把①写进')).toBe('把 ① 写进')
  })

  it('normalizes narrow BMP emojis to true wide emojis and pads adjacent CJK characters and punctuation', () => {
    expect(formatSymbolSpacing('⚠️注意：商汤网关 schema 较严格')).toBe('🚨 注意：商汤网关 schema 较严格')
    expect(formatSymbolSpacing('⚙设置')).toBe('🔧 设置')
    expect(formatSymbolSpacing('提示💡内容')).toBe('提示 💡 内容')
    expect(formatSymbolSpacing('⚠️【注意】')).toBe('🚨 【注意】')
    expect(formatSymbolSpacing('ℹ️ 说明')).toBe('💡 说明')
  })

  it('leaves pure ASCII untouched', () => {
    expect(formatSymbolSpacing('plain text 123')).toBe('plain text 123')
    expect(formatSymbolSpacing('')).toBe('')
  })
})

describe('wcwidthSafeSlice', () => {
  it('preserves combining marks, variation selectors, and joined emoji at the cut', () => {
    expect(wcwidthSafeSlice('a\u0301b', 1)).toBe('a\u0301')
    expect(wcwidthSafeSlice('👩‍💻x', 2)).toBe('👩‍💻')
    expect(wcwidthSafeSlice('❤️x', 2)).toBe('❤️')
  })
  it('never cuts inside a wide glyph', () => {
    expect(wcwidthSafeSlice('中文ab', 2)).toBe('中')
    expect(wcwidthSafeSlice('中文ab', 4)).toBe('中文')
    expect(wcwidthSafeSlice('中文ab', 6)).toBe('中文ab')
  })

  it('stops at the first glyph when the budget is too small', () => {
    expect(wcwidthSafeSlice('中文ab', 1)).toBe('')
    expect(wcwidthSafeSlice('中文ab', 0)).toBe('')
  })

  it('truncates inside a run of narrow glyphs', () => {
    expect(wcwidthSafeSlice('abcd', 3)).toBe('abc')
  })

  it('keeps the whole string when the budget fits', () => {
    expect(wcwidthSafeSlice('a中b', 5)).toBe('a中b')
    expect(wcwidthSafeSlice('', 4)).toBe('')
  })
})

describe('wrapDisplayLines', () => {
  it('keeps explicit newlines and wraps overflowing rows', () => {
    expect(wrapDisplayLines('ab\ncd', 10)).toEqual(['ab', 'cd'])
    expect(wrapDisplayLines('abcdef', 3)).toEqual(['abc', 'def'])
  })

  it('never splits a wide glyph and still advances when the glyph is wider than the budget', () => {
    expect(wrapDisplayLines('中文ab', 4)).toEqual(['中文', 'ab'])
    expect(wrapDisplayLines('中', 1)).toEqual(['中'])
  })

  it('returns the source lines when the budget is non-positive', () => {
    expect(wrapDisplayLines('ab\ncd', 0)).toEqual(['ab', 'cd'])
  })
})
