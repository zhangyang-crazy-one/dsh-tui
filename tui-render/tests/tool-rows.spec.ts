/** Preview row generation follows viewport demand; eviction never removes source. */
import { describe, expect, it } from 'vitest'
import { ToolRowCache } from '../src/tool-rows.ts'
import { toolPolicyDefaults } from '../src/render-policy.ts'
import type { ToolBodyCard } from '../src/tool-body.ts'

const card: ToolBodyCard = { name: 'generic', arguments: '{}', status: 'ok', resultText: Array.from({ length: 5001 }, (_, index) => `line-${index}`).join('\n') }

describe('ToolRowCache', () => {
  it('measures bounded previews but formats only the requested visible rows', () => {
    const cache = new ToolRowCache(toolPolicyDefaults())
    const cards = Array.from({ length: 100 }, (_, index) => cache.rows(`tool-${index}`, card, 100, true, 'zh-CN'))
    expect(cache.stats().materialized).toBe(0)
    expect(cards.every(rows => rows.length === 8)).toBe(true)
    expect(cards[50]!.slice(1, 3).map(row => row.text)).toEqual(['  参数', '  {}'])
    expect(cache.stats().materialized).toBe(2)
    expect(cards[50]!.at(-1)?.text).toContain('/tools')
    expect(cache.stats().materialized).toBe(3)
  })

  it('rebuilds evicted rows and invalidates changed width, content, locale, and fold', () => {
    const cache = new ToolRowCache({ ...toolPolicyDefaults(), cacheEntries: 2, cacheRows: 3 })
    const first = cache.rows('first', card, 80, true, 'zh-CN')
    const original = first.at(1)
    first.slice()
    expect(cache.stats().rows).toBeLessThanOrEqual(3)
    expect(first.at(1)).toEqual(original)
    for (let index = 0; index < 100; index += 1) {
      cache.rows('first', card, index % 2 === 0 ? 80 : 112, index % 2 === 0, 'zh-CN').slice()
      cache.rows(`other-${index}`, card, 80, true, 'en-US').at(1)
      expect(cache.stats().entries).toBeLessThanOrEqual(2)
      expect(cache.stats().rows).toBeLessThanOrEqual(3)
    }
    expect(cache.rows('first', { ...card, arguments: '{"new":true}' }, 80, true, 'en-US').at(2)?.text).toContain('new')
    expect(cache.rows('first', card, 80, false, 'zh-CN').length).toBe(1)
    expect(cache.stats().evictions).toBeGreaterThan(0)
    cache.clear()
    expect(cache.stats()).toMatchObject({ entries: 0, rows: 0 })
    expect(card.resultText).toContain('line-5000')
  })
})
