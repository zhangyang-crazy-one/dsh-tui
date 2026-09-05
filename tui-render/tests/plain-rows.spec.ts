/** Full reasoning remains reachable through bounded, rebuildable derived rows. */
import { expect, it } from 'vitest'
import { PlainTextRowCache } from '../src/plain-rows.ts'

it('reuses unchanged reasoning and returns every row including its final line', () => {
  const cache = new PlainTextRowCache({ maxRows: 6000, maxBytes: 4 * 1024 * 1024 })
  const source = Array.from({ length: 5001 }, (_, index) => `思考 ${index}`).join('\n')
  const rows = cache.rows('thought', source, 100)
  expect(rows.length).toBe(5001)
  expect(rows.at(-1)?.text).toBe('  思考 5000')
  expect(rows.slice(100, 102).map(row => row.text)).toEqual(['  思考 100', '  思考 101'])
  expect(cache.rows('thought', source, 100)).toBe(rows)
  expect(cache.rows('thought', source, 80)).toBe(rows)
  expect(rows.at(100)).toBe(rows.at(100))
  expect(cache.rows('thought', `${source}\n尾部`, 100).at(-1)?.text).toBe('  尾部')
})

it('does not reuse already-wrapped rows when a different width changes wrapping', () => {
  const cache = new PlainTextRowCache({ maxRows: 100, maxBytes: 4096 })
  const narrow = cache.rows('a', 'abcdefgh', 4)
  const wide = cache.rows('a', 'abcdefgh', 8)
  expect(wide).not.toBe(narrow)
  expect(wide.slice().map(row => row.text)).toEqual(['  abcdefgh'])
  expect(cache.rows('a', 'abcdefgh', 10)).toBe(wide)
  expect(cache.rows('a', 'abcdefgh', 3).slice().map(row => row.text)).toEqual(['  abc', '  def', '  gh'])
})

it('rebuilds evicted widths without invalidating a visible row source', () => {
  const cache = new PlainTextRowCache({ maxRows: 2, maxBytes: 1024 })
  const rows = cache.rows('a', '中文abcd', 4)
  expect(rows.slice().map(row => row.text)).toEqual(['  中文', '  abcd'])
  cache.rows('b', 'new', 4)
  expect(cache.rows('a', '中文abcd', 4)).not.toBe(rows)
  expect(rows.at(-1)?.text).toBe('  abcd')
  const wider = cache.rows('a', '中文abcd', 8)
  expect(wider.length).toBe(1)
  cache.clear()
  expect(cache.rows('a', '中文abcd', 8)).not.toBe(wider)
  expect(cache.rows('escape', '\x1b[2J\t', 80).at(0)?.text).toBe('  \\x1b[2J\\t')
})
