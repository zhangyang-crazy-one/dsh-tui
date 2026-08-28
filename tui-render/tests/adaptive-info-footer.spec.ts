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
      'deepseek-official/deepseek-v4-flash · 状态 生成中 · 强度 high',
      '上下文 2048/8192 · tokens 150 · cache 410',
      '~/project · ↑↓/jk 滚动',
    ])
    expect(lines.join('\n')).not.toMatch(/费用|cost|\$/u)
  })

  it('drops complete low-priority segments as width narrows', () => {
    const medium = formatAdaptiveInfoFooter(view, 35)
    expect(medium[0]).toContain('状态 生成中')
    expect(medium[0]).not.toContain('强度')
    expect(medium[1]).toBe('上下文 2048/8192 · tokens 150')
    expect(medium[2]).toBe('~/project · ↑↓/jk 滚动')

    const narrow = formatAdaptiveInfoFooter(view, 22)
    expect(narrow[0]).toContain('状态 生成中')
    expect(narrow[1]).toBe('上下文 2048/8192')
    expect(narrow.every(line => displayWidth(line) <= 22)).toBe(true)
  })

  it('formats bounded and always retry variants and escapes failure codes', () => {
    expect(formatAdaptiveInfoFooter({
      ...view,
      retry: { retry: 2, maxRetries: 4, remainingMs: 1250, failureCode: 'RATE\x1b[2J' },
    }, 80)[2]).toBe('重试 2/4 · 2s · RATE\\x1b[2J')
    expect(formatAdaptiveInfoFooter({
      ...view,
      retry: { retry: 7, remainingMs: 0, failureCode: 'BUSY' },
    }, 80)[2]).toBe('重试 7 · 0s · BUSY')
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
})
