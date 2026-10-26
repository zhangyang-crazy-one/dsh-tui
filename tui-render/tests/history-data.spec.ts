import { describe, expect, it } from 'vitest'
import { ExactHistoryWindow, overlayMap } from '../src/history-data.ts'

describe('history read layers', () => {
  it.each([100, 1_000, 10_000])('does not iterate %i settled entries when constructing or reading the active overlay', (count) => {
    let visits = 0
    class CountedMap extends Map<string, number> {
      override *[Symbol.iterator](): MapIterator<[string, number]> {
        for (const entry of super[Symbol.iterator]()) { visits++; yield entry }
      }
    }
    const settled = new CountedMap(Array.from({ length: count }, (_, i) => [String(i), i]))
    const overlay = overlayMap(settled, new Map([['active', 123], ['0', -1]]))
    expect(overlay.size).toBe(count + 1)
    expect(overlay.get('active')).toBe(123)
    expect(overlay.get('0')).toBe(-1)
    expect(overlay.get('99')).toBe(99)
    expect(overlay.has('absent')).toBe(false)
    expect(visits).toBe(0)
    expect([...overlay].length).toBe(count + 1)
    expect(visits).toBe(count)
    expect(settled.get('0')).toBe(0)
  })

  it('rejects queued work after source or geometry replacement and preserves prepared append prefixes', () => {
    const window = new ExactHistoryWindow<object>()
    const history = Array.from({ length: 10_000 }, () => ({}))
    window.update(history, '80', 64)
    const first = window.generation
    expect(window.start).toBe(9_936)
    window.advance(first, 256)
    expect(window.start).toBe(9_680)
    window.update([...history, {}], '80', 64)
    expect(window.start).toBe(9_680)
    expect(window.advance(first, Infinity)).toBe(false)
    const appended = window.generation
    window.update(history, '120', 64)
    expect(window.advance(appended, Infinity)).toBe(false)
    expect(window.start).toBe(9_936)
    const resized = window.generation
    window.update([{}], '120', 64)
    expect(window.advance(resized, Infinity)).toBe(false)
    expect(window.complete).toBe(true)
  })
})

describe('bounded history row materialization', () => {
  it('keeps exact heights and canonical rebuilds after eviction and retires source factories with their directory owner', async () => {
    const { HistoryRowCache } = await import('../src/history-data.ts')
    const line = (text: string) => ({ text, displayWidth: text.length, spans: [], rowInBlock: 0,
      sourceStart: 0, sourceEnd: text.length, rawTail: false })
    const cache = new HistoryRowCache(1, 10_000)
    let rebuilds = 0
    const a = cache.wrap('a', 'a', [line('A')], () => { rebuilds++; return [line('A')] })
    cache.wrap('b', 'b', [line('B')], () => [line('B')])
    expect(cache.stats().rows).toBe(1)
    expect(a.length).toBe(1)
    expect(rebuilds).toBe(0)
    expect(a.at(0)?.text).toBe('A')
    expect(rebuilds).toBe(1)
    expect(a.at(0)?.text).toBe('A')
    expect(rebuilds).toBe(1)
    cache.retainOwners(new Set())
    expect(cache.stats()).toMatchObject({ entries: 0, rows: 0, estimatedBytes: 0 })
  })

  it('reports required pin overshoot separately and returns to budget on unpin', async () => {
    const { HistoryRowCache } = await import('../src/history-data.ts')
    const line = { text: 'A', displayWidth: 1, spans: [], rowInBlock: 0, sourceStart: 0, sourceEnd: 1, rawTail: false }
    const cache = new HistoryRowCache(1, 10_000)
    cache.setPins(new Set(['visible']))
    const source = cache.wrap('visible', 'body', [line, line], () => [line, line])
    expect(source.length).toBe(2)
    expect(cache.stats()).toMatchObject({ pinnedRows: 2, overBudgetRows: 1 })
    cache.setPins(new Set())
    expect(cache.stats()).toMatchObject({ pinnedRows: 0, overBudgetRows: 0, entries: 0 })
    expect(source.at(1)).toEqual(line)
    expect(cache.stats()).toMatchObject({ pinnedRows: 2, overBudgetRows: 1 })
    cache.clear()
    expect(cache.stats().entries).toBe(0)
  })
})
