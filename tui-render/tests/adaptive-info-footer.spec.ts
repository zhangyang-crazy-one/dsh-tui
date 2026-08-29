import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/content.ts'
import { formatAdaptiveInfoFooter } from '../src/adaptive-info-footer.ts'

const view = {
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  status: '生成中',
  effort: 'high',
  environment: '~/project',
  tip: '↑↓/jk 滚动',
  tokenUsage: {
    uncachedInputTokens: 120,
    outputTokens: 30,
    cacheReadTokens: 400,
    cacheWriteTokens: 10,
  },
  contextPressure: {
    projectedTokens: 2048,
    contextWindow: 8192,
  },
} as const

describe('formatAdaptiveInfoFooter', () => {
  it('formats authoritative wide footer segments without a cost guess', () => {
    const lines = formatAdaptiveInfoFooter(view, 120)
    expect(lines).toEqual([
      '~/project · 状态 生成中 · ↑↓/jk 滚动',
      'deepseek-official/deepseek-v4-flash · 强度 high · 上下文 2048/8192 · ↑530 · ↓30 · 缓存命中 75%',
    ])
    expect(lines.join('\n')).not.toMatch(/费用|cost|\$/u)
    expect(lines.join('\n')).not.toContain('cache 410')
  })

  it('uses all prompt-side buckets and omits a rate when there was no prompt input', () => {
    const withWrites = formatAdaptiveInfoFooter({
      ...view,
      tokenUsage: {
        uncachedInputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 90,
        cacheWriteTokens: 100,
      },
    }, 120)
    expect(withWrites[1]).toContain('↑200')
    expect(withWrites[1]).toContain('缓存命中 45%')
    expect(withWrites.join('\n')).not.toContain('cache 190')

    const outputOnly = formatAdaptiveInfoFooter({
      ...view,
      tokenUsage: {
        uncachedInputTokens: 0,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    }, 120)
    expect(outputOnly[1]).toContain('↑0 · ↓5')
    expect(outputOnly[1]).not.toContain('缓存命中')
  })

  it('never rounds a partial cache hit to one hundred percent', () => {
    const lines = formatAdaptiveInfoFooter({
      ...view,
      tokenUsage: {
        uncachedInputTokens: 5,
        outputTokens: 1,
        cacheReadTokens: 995,
        cacheWriteTokens: 0,
      },
    }, 120)
    expect(lines[1]).toContain('缓存命中 99.5%')
  })

  it('drops complete low-priority segments as width narrows', () => {
    const medium = formatAdaptiveInfoFooter(view, 35)
    expect(medium[0]).toContain('状态 生成中')
    expect(medium[0]).not.toContain('↑↓/jk')
    expect(medium[1]).toBe('deepseek-official/deepseek-v4-flash')
    expect(medium[1]).not.toContain('缓存命中')

    const narrow = formatAdaptiveInfoFooter(view, 22)
    expect(narrow[0]).toContain('状态 生成中')
    expect(narrow[1]).toBe('deepseek-official/dee…')
    expect(narrow.every(line => displayWidth(line) <= 22)).toBe(true)
  })

  it('formats bounded and always retry variants and escapes failure codes', () => {
    expect(formatAdaptiveInfoFooter({
      ...view,
      retry: { retry: 2, maxRetries: 4, remainingMs: 1250, failureCode: 'RATE\x1b[2J' },
    }, 80)[0]).toContain('重试 2/4 · 2s · RATE\\x1b[2J')
    expect(formatAdaptiveInfoFooter({
      ...view,
      retry: { retry: 7, remainingMs: 0, failureCode: 'BUSY' },
    }, 80)[0]).toContain('重试 7 · 0s · BUSY')
  })

  it('returns frozen CJK-safe lines', () => {
    const lines = formatAdaptiveInfoFooter({
      provider: '提供方',
      model: '模型',
      status: '空闲',
    }, 16)
    expect(Object.isFrozen(lines)).toBe(true)
    expect(lines.every(line => displayWidth(line) <= 16)).toBe(true)
  })

  it('omits an empty tip without leaving a trailing separator', () => {
    expect(formatAdaptiveInfoFooter({
      provider: 'provider',
      model: 'model',
      status: '空闲',
      environment: '~/project',
      tip: '',
    }, 80)).toEqual([
      '~/project · 状态 空闲',
      'provider/model',
    ])
  })

  it('neutralizes control bytes in every dynamic plain-text field', () => {
    const lines = formatAdaptiveInfoFooter({
      provider: 'provider\x1b[2J',
      model: 'model\x07',
      status: '生成中',
      environment: '/tmp\x1b[H',
      tip: '↑↓/jk 滚动',
    }, 120)
    expect(lines.join('\n')).not.toContain('\x1b')
    expect(lines.join('\n')).not.toContain('\x07')
    expect(lines.join('\n')).toContain('provider\\x1b[2J')
    expect(lines.join('\n')).toContain('model\\x07')
    expect(lines.join('\n')).toContain('/tmp\\x1b[H')
  })
})
