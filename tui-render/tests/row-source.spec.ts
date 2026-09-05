/** Segmented transcript rows materialize only the requested interval. */
import { describe, expect, it, vi } from 'vitest'
import { RowSequence } from '../src/row-source.ts'

describe('RowSequence', () => {
  it('joins sources without reading offscreen rows', () => {
    const at = vi.fn((index: number) => index >= 0 && index < 5000 ? `row-${index}` : undefined)
    const rows = new RowSequence<string>()
    rows.append(['header'])
    rows.append({ length: 5000, at,
      slice: (start = 0, end = 5000) => Array.from({ length: end - start }, (_, index) => at(start + index)!),
    })
    rows.push('tail')
    const source = rows.build()
    expect(source.length).toBe(5002)
    expect(at).not.toHaveBeenCalled()
    expect(source.at(-1)).toBe('tail')
    expect(source.slice(4999, 5002)).toEqual(['row-4998', 'row-4999', 'tail'])
    expect(at.mock.calls.map(([index]) => index)).toEqual([4998, 4999])
    expect(source.at(5002)).toBeUndefined()
    expect(source.slice(3, 1)).toEqual([])
  })

  it('freezes the published segment directory and supports array-style slicing', () => {
    const rows = new RowSequence<number>()
    rows.append([])
    rows.append([1, 2])
    const first = rows.build()
    rows.push(3)
    expect(first.slice()).toEqual([1, 2])
    expect(rows.build().slice(-2)).toEqual([2, 3])
    expect(rows.build().slice(0, -1)).toEqual([1, 2])
    expect(rows.build().at(-4)).toBeUndefined()
    expect(Object.isFrozen(first)).toBe(true)
  })
})
