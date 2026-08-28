import { describe, expect, it } from 'vitest'
import { tokenizeComposer } from '../src/composer-tokens.ts'

describe('tokenizeComposer', () => {
  it('segments commands, mentions, and durable image tokens without rewriting text', () => {
    const text = '请运行 /compact 给 @worker 处理 [图片 #12]，谢谢'
    const tokens = tokenizeComposer(text)
    expect(tokens).toEqual([
      { kind: 'text', text: '请运行 ' },
      { kind: 'command', text: '/compact' },
      { kind: 'text', text: ' 给 ' },
      { kind: 'mention', text: '@worker' },
      { kind: 'text', text: ' 处理 ' },
      { kind: 'image', text: '[图片 #12]' },
      { kind: 'text', text: '，谢谢' },
    ])
    expect(tokens.map(token => token.text).join('')).toBe(text)
    expect(Object.isFrozen(tokens)).toBe(true)
    expect(tokens.every(Object.isFrozen)).toBe(true)
  })

  it('keeps malformed, embedded, and incomplete fragments ordinary', () => {
    for (const text of ['/', '@', '[图片 #]', '[图片 #0]', 'prefix/compact', 'mail@example.com']) {
      expect(tokenizeComposer(text)).toEqual([{ kind: 'text', text }])
    }
  })

  it('preserves CJK command and mention text', () => {
    const text = '/计划 @子代理 文件'
    expect(tokenizeComposer(text)).toEqual([
      { kind: 'command', text: '/计划' },
      { kind: 'text', text: ' ' },
      { kind: 'mention', text: '@子代理' },
      { kind: 'text', text: ' 文件' },
    ])
  })
})
