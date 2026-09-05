/** Display identifiers never contain or duplicate long canonical bodies. */
import { expect, it } from 'vitest'
import { DisplayRevisionIndex } from '../src/display-revision.ts'

it('retains small identifiers for large source and invalidates same-length replacements', () => {
  const index = new DisplayRevisionIndex()
  const owner = {}
  const source = '中文'.repeat(100_000)
  const first = index.revision(owner, [source])
  expect(first.length).toBeLessThan(10)
  expect(index.revision(owner, [source])).toBe(first)
  const changed = index.revision(owner, [source.slice(0, -1) + '改'])
  expect(changed).not.toBe(first)
  expect(index.revision(owner, [source.slice(0, -1) + '改'])).toBe(changed)
  expect(index.revision(owner, [source, 'extra'])).not.toBe(changed)
  expect(index.revision({})).not.toBe(first)
})
