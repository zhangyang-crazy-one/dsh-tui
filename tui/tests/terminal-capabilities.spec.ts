import { describe, expect, it } from 'vitest'
import { detectBrandRenderTier, detectColorSupport, detectNotifyCapability, notifyBytes, sanitizeOscPayload, stripControlCharacters, DISABLE_BRACKETED_PASTE, ENABLE_BRACKETED_PASTE, ESC_TIMEOUT_MS } from '../src/terminal-capabilities.ts'

describe('detectColorSupport', () => {
  it('prefers COLORTERM=truecolor', () => {
    expect(detectColorSupport({ COLORTERM: 'truecolor', TERM: 'xterm-256color' })).toBe('truecolor')
  })

  it('falls back to the 256-color TERM whitelist', () => {
    expect(detectColorSupport({ TERM: 'xterm-256color' })).toBe('256')
  })

  it('falls back to basic ANSI', () => {
    expect(detectColorSupport({ TERM: 'xterm' })).toBe('16')
  })

  it('NO_COLOR forces none', () => {
    expect(detectColorSupport({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('none')
  })
})

describe('capability constants', () => {
  it('exposes the bracket paste pair and the ESC window', () => {
    expect(ENABLE_BRACKETED_PASTE).toBe('\x1b[?2004h')
    expect(DISABLE_BRACKETED_PASTE).toBe('\x1b[?2004l')
    expect(ESC_TIMEOUT_MS).toBeGreaterThanOrEqual(30)
    expect(ESC_TIMEOUT_MS).toBeLessThanOrEqual(50)
  })
})

describe('detectBrandRenderTier', () => {
  it('uses half blocks in modern UTF-8 terminals independently of color', () => {
    expect(detectBrandRenderTier({ TERM: 'xterm-256color', LANG: 'en_US.UTF-8' })).toBe('half-block')
    expect(detectBrandRenderTier({ TERM: 'xterm-256color', LANG: 'C.UTF-8', NO_COLOR: '1' })).toBe('half-block')
  })

  it('uses conservative generated fallbacks for kernel, non-UTF-8, and dumb terminals', () => {
    expect(detectBrandRenderTier({ TERM: 'linux', LANG: 'C.UTF-8' })).toBe('full-block')
    expect(detectBrandRenderTier({ TERM: 'xterm', LC_ALL: 'C' })).toBe('ascii')
    expect(detectBrandRenderTier({ TERM: 'dumb', LANG: 'en_US.UTF-8' })).toBe('plain')
  })
})

describe('detectNotifyCapability', () => {
  const base = { TERM: 'xterm-256color' }

  it('prefers OSC99 for iTerm2 and VTE descendants', () => {
    expect(detectNotifyCapability({ ...base, ITERM_SESSION_ID: 'w0t0p0' })).toBe('osc99')
    expect(detectNotifyCapability({ ...base, TERM_PROGRAM: 'iTerm.app' })).toBe('osc99')
    expect(detectNotifyCapability({ ...base, KONSOLE_VERSION: '220823' })).toBe('osc99')
    expect(detectNotifyCapability({ ...base, VTE_VERSION: '6800' })).toBe('osc99')
  })

  it('selects OSC9 for Windows Terminal and BEL otherwise', () => {
    expect(detectNotifyCapability({ ...base, WT_SESSION: '{guid}' })).toBe('osc9')
    expect(detectNotifyCapability({ TERM: 'vt100' })).toBe('bell')
  })
})

describe('notifyBytes', () => {
  it('emits the exact ladder payloads with BEL staying byte-minimal', () => {
    expect(notifyBytes('osc99')).toBe('\x1b]99;i=1:d=0;DeepSeek 回合已结束\x07')
    expect(notifyBytes('osc9')).toBe('\x1b]9;DeepSeek 回合已结束\x07')
    expect(notifyBytes('bell')).toBe('\x07')
  })

  it('carries the summary payload on both OSC transports', () => {
    expect(notifyBytes('osc99', 'DeepSeek ✅ 任务完成 · 修复通知')).toBe('\x1b]99;i=1:d=0;DeepSeek ✅ 任务完成 · 修复通知\x07')
    expect(notifyBytes('osc9', 'DeepSeek ✅ 任务完成')).toBe('\x1b]9;DeepSeek ✅ 任务完成\x07')
  })

  it('forwards the explicit titleSuffix through to the OSC sanitiser', () => {
    expect(notifyBytes('osc9', 'a'.repeat(100) + ' · 修复通知', ' · 修复通知'))
      .toBe('\x1b]9;' + 'a'.repeat(73) + ' · 修复通知\x07')
  })

  it('strips control characters and caps the OSC payload at 80 code points', () => {
    expect(notifyBytes('osc9', 'a\u0007b\u001bc\u009bd')).toBe('\x1b]9;abcd\x07')
    expect(notifyBytes('osc9', 'x'.repeat(200))).toBe(`\x1b]9;${'x'.repeat(80)}\x07`)
    const emojiBytes = notifyBytes('osc9', '😀'.repeat(90))
    expect(Array.from(emojiBytes.slice('\x1b]9;'.length, -1))).toHaveLength(80)
  })
})

describe('stripControlCharacters', () => {
  it('drops every C0 and C1 code point', () => {
    expect(stripControlCharacters('a\u0007b\u001bc\u009bd')).toBe('abcd')
  })

  it('preserves BMP characters including CJK and emoji code points', () => {
    expect(stripControlCharacters('修复 · 通知 😀')).toBe('修复 · 通知 😀')
  })
})

describe('sanitizeOscPayload', () => {
  it('returns the input unchanged when it fits the limit', () => {
    expect(sanitizeOscPayload('short text', 80)).toBe('short text')
  })

  it('preserves the explicit titleSuffix by shortening the prefix first', () => {
    const result = sanitizeOscPayload('a'.repeat(100) + ' · 修复通知', 80, ' · 修复通知')
    expect(Array.from(result)).toHaveLength(80)
    expect(result.endsWith(' · 修复通知')).toBe(true)
    expect(result.startsWith('aaaa')).toBe(true)
  })

  it('keeps the suffix even when the summary alone is shorter than the budget', () => {
    expect(sanitizeOscPayload('✅ 任务完成 · 跑测试', 80, ' · 跑测试')).toBe('✅ 任务完成 · 跑测试')
  })

  it('truncates the suffix when it alone exceeds the limit', () => {
    const longTitle = '测'.repeat(120)
    const result = sanitizeOscPayload(`摘要 · ${longTitle}`, 80, ` · ${longTitle}`)
    expect(Array.from(result)).toHaveLength(80)
    expect(result.startsWith(' · 测')).toBe(true)
  })

  it('preserves the full title suffix even when the summary itself contains a delimiter', () => {
    const summary = `${'a'.repeat(60)} · b · c · d`
    const title = 'foo · bar · baz'
    const payload = `${summary} · ${title}`
    const result = sanitizeOscPayload(payload, 80, ` · ${title}`)
    expect(Array.from(result)).toHaveLength(80)
    expect(result.endsWith(` · ${title}`)).toBe(true)
    expect(result.startsWith('aaaa')).toBe(true)
  })

  it('preserves the title suffix when both the summary and the title contain ` · `', () => {
    const summary = `${'first · second · third'.repeat(4)} extra padding`
    const title = 'α · β · γ'
    const payload = `${summary} · ${title}`
    const result = sanitizeOscPayload(payload, 80, ` · ${title}`)
    expect(result.endsWith(` · ${title}`)).toBe(true)
    expect(Array.from(result).length).toBeLessThanOrEqual(80)
  })

  it('uses the explicit titleSuffix even when an internal separator could be misread', () => {
    const result = sanitizeOscPayload('DeepSeek a · b · 修复通知 · extra · trailing', 80, ' · extra · trailing')
    expect(result.endsWith(' · extra · trailing')).toBe(true)
    expect(result.startsWith('DeepSeek a · b · 修复通知')).toBe(true)
  })

  it('preserves the suffix when a control character appears inside the payload', () => {
    const result = sanitizeOscPayload('ab\u0007c · 修复通知', 80, ' · 修复通知')
    expect(result.endsWith(' · 修复通知')).toBe(true)
    expect(result.startsWith('abc')).toBe(true)
    expect(result).not.toContain('\u0007')
  })

  it('caps on code points, never splitting supplementary-plane characters', () => {
    const result = sanitizeOscPayload('😀'.repeat(120), 80)
    expect(Array.from(result)).toHaveLength(80)
    expect(Array.from(result).every(char => char === '😀')).toBe(true)
  })

  it('strips control characters before measuring length', () => {
    expect(sanitizeOscPayload('a\u0007b\u001bc\u009bd · 修复通知', 80)).toBe('abcd · 修复通知')
  })

  it('falls back to a hard cap when no titleSuffix is provided', () => {
    const result = sanitizeOscPayload('a'.repeat(120), 80)
    expect(Array.from(result)).toHaveLength(80)
    expect(result).toBe('a'.repeat(80))
  })

  it('falls back to a hard cap when the explicit titleSuffix does not match the payload end', () => {
    const result = sanitizeOscPayload('a'.repeat(120), 80, ' · 修复通知')
    expect(Array.from(result)).toHaveLength(80)
    expect(result).toBe('a'.repeat(80))
  })

  it('falls back to a hard cap when the titleSuffix is empty', () => {
    const result = sanitizeOscPayload('a'.repeat(120), 80, '')
    expect(Array.from(result)).toHaveLength(80)
  })
})
