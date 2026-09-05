/** Earlier stalls remain visible after recent samples roll over. */
import { describe, expect, it } from 'vitest'
import { DurationStats } from '../src/duration-stats.ts'

describe('full-run duration statistics', () => {
  it('retains early slow frames in p95/p99/max beyond the 120-frame recent window', () => {
    const stats = new DurationStats(120)
    for (let index = 0; index < 40; index += 1) stats.record(300)
    for (let index = 0; index < 360; index += 1) stats.record(8)
    const snapshot = stats.snapshot()
    expect(snapshot.count).toBe(120)
    expect(snapshot.max).toBe(8)
    expect(snapshot.run).toMatchObject({ count: 400, max: 300, mean: 37.2 })
    expect(snapshot.run.p95).toBeGreaterThanOrEqual(300)
    expect(snapshot.run.p99).toBeGreaterThanOrEqual(300)
    stats.resetWindow()
    expect(stats.snapshot()).toMatchObject({ count: 0, run: { count: 400, max: 300 } })
    stats.reset()
    expect(stats.snapshot()).toMatchObject({ count: 0, run: { count: 0, max: 0, p95: 0, p99: 0 } })
  })
})
