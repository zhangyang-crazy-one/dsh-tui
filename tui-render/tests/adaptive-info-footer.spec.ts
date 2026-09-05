import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/content.ts'
import {
  formatAdaptiveInfoFooter,
  formatAdaptiveInfoFooterRows,
  formatQuietStatusRow,
} from '../src/adaptive-info-footer.ts'

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
      '~/project · 状态 生成中 · deepseek-official',
      '上下文 [███░░░░░░░] 25% · ↑530 · ↓30 · 缓存命中 75% · 强度 high',
      '↑↓/jk 滚动',
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
    expect(medium[1]).toContain('上下文')
    expect(medium[1]).not.toContain(view.model)
    expect(medium[1]).not.toContain('缓存命中')

    const narrow = formatAdaptiveInfoFooter(view, 22)
    expect(narrow[0]).toContain('状态 生成中')
    expect(narrow[1]).toContain('上下文 25%')
    expect(narrow.every(line => displayWidth(line) <= 22)).toBe(true)
  })

  it('drops complete hierarchy rows as height narrows', () => {
    expect(formatAdaptiveInfoFooter(view, 120, 2)).toHaveLength(2)
    expect(formatAdaptiveInfoFooter(view, 120, 2).join('\n')).not.toContain('↑↓/jk')
    expect(formatAdaptiveInfoFooter(view, 120, 1)).toEqual([
      '~/project · 状态 生成中 · deepseek-official',
    ])
  })

  it('returns semantic runs for context, status, and operations without duplicating the model', () => {
    const rows = formatAdaptiveInfoFooterRows(view, 120)
    expect(rows.map(row => row.kind)).toEqual(['workspace', 'metrics', 'operations'])
    expect(rows[0]?.runs).toContainEqual({ text: '状态 生成中', token: 'accentText' })
    expect(rows[1]?.runs.some(run => run.text.includes(view.model))).toBe(false)
    expect(rows[1]?.runs).toContainEqual({ text: '███', token: 'accentText' })
    expect(rows[1]?.runs).toContainEqual({ text: '░░░░░░░', token: 'fgDim' })
    expect(rows[2]?.runs).toEqual([{ text: '↑↓/jk 滚动', token: 'fgDim' }])
    expect(Object.isFrozen(rows)).toBe(true)
    expect(Object.isFrozen(rows[1]?.runs)).toBe(true)
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
      '~/project · 状态 空闲 · provider',
    ])
  })

  it('neutralizes control bytes in every dynamic plain-text field', () => {
    const lines = formatAdaptiveInfoFooter({
      provider: 'provider',
      model: 'model',
      effort: 'high\x07',
      status: '生成中',
      environment: '/tmp\x1b[H',
      tip: '↑↓/jk 滚动',
    }, 120)
    expect(lines.join('\n')).not.toContain('\x1b')
    expect(lines.join('\n')).not.toContain('\x07')
    expect(lines.join('\n')).toContain('high\\x07')
    expect(lines.join('\n')).toContain('/tmp\\x1b[H')
  })

  it.each([20, 40, 80, 112, 200])('fits quiet controls and context in %s columns', (columns) => {
    const row = formatQuietStatusRow({ ...view, tip: undefined, reasoningVisible: false }, columns)
    const text = row.runs.map(run => run.text).join('')
    expect(displayWidth(text)).toBeLessThanOrEqual(columns)
    expect(text).toContain('生成中')
    expect(text).not.toContain(view.model)
    if (columns >= 80) {
      expect(text).toContain('思考关')
    }
    if (columns >= 112) expect(text).toContain('/status')
  })

  it('selects the English dictionary for controls and metric labels', () => {
    const localized = { ...view, locale: 'en-US' as const, status: 'idle', tip: undefined, reasoningVisible: true }
    expect(formatQuietStatusRow(localized, 112).runs.map(run => run.text).join('')).toContain('Thinking on')
    const lines = formatAdaptiveInfoFooter(localized, 112).join('\n')
    expect(lines).toContain('Status idle')
    expect(lines).toContain('Context')
    expect(lines).toContain('Cache hit 75%')
    expect(lines).not.toMatch(/上下文|缓存命中|状态/)
  })

  it.each([80, 112, 140, 200])('keeps the usage meter and cache hit in the default %s-column row', (columns) => {
    const row = formatQuietStatusRow({ ...view, tip: undefined }, columns)
    const text = row.runs.map(run => run.text).join('')
    expect(text).toContain('上下文 [███░░░░░░░] 25%')
    expect(text).toContain('缓存命中 75%')
    expect(text).toContain('生成中')
    expect(text).not.toContain('↑530')
    expect(displayWidth(text)).toBeLessThanOrEqual(columns)
    if (columns >= 112) expect(text).toContain('2.0K/8.2K')
  })

  it('uses the same prompt denominator in quiet and detailed cache rates', () => {
    const row = formatQuietStatusRow({ ...view, tokenUsage: {
      uncachedInputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 100, outputTokens: 5,
    } }, 112)
    expect(row.runs.map(run => run.text).join('')).toContain('缓存命中 45%')
    const partial = formatQuietStatusRow({ ...view, tokenUsage: {
      uncachedInputTokens: 5, cacheReadTokens: 995, cacheWriteTokens: 0, outputTokens: 1,
    } }, 112)
    expect(partial.runs.map(run => run.text).join('')).toContain('缓存命中 99.5%')
  })

  it('omits unavailable metrics and preserves errors before optional context fields', () => {
    const noUsage = formatQuietStatusRow({ provider: '', model: '', status: '空闲',
      contextPressure: { projectedTokens: 100 },
      tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 8 },
    }, 112).runs.map(run => run.text).join('')
    expect(noUsage).toContain('上下文 100')
    expect(noUsage).not.toMatch(/命中|\[|%/u)
    const narrow = formatQuietStatusRow({ ...view, status: '请求失败' }, 20)
    expect(narrow.runs).toContainEqual({ text: '请求失败', token: 'error' })
    expect(narrow.runs.map(run => run.text).join('')).not.toMatch(/缓存命|上下…/u)
  })
})
