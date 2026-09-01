/**
 * RendererMetricProbe: counter windowing, bounded latency rings, p95
 * computation, window reset semantics, multi-channel isolation, and the
 * JSON-serializable snapshot shape that writeFrameStatsFile will consume.
 */

import { describe, expect, it } from 'vitest'
import {
  FRAME_METRICS_CAPACITY,
  completeDeltaStdoutDrain,
  createFrameMetrics,
  markDeltaIngress,
} from '../src/frame-metrics.ts'
import type { FrameMetricsHandle, FrameMetricsSnapshot } from '../src/frame-metrics.ts'

/** A deterministic monotonic clock for pacing injection. */
function fakeClock(): { now: () => number; advance(ms: number): void } {
  let t = 1000
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

/** A zeroed latency-channel shape, mirroring the empty-ring contract. */
function zeroedLatency(): {
  count: number
  mean: number
  max: number
  p95: number
  samples: readonly number[]
} {
  return { count: 0, mean: 0, max: 0, p95: 0, samples: [] }
}

/** A zeroed counter-channel shape. */
function zeroedCounter(): {
  total: number
  windowCount: number
  windowSum: number
  windowMax: number
} {
  return { total: 0, windowCount: 0, windowSum: 0, windowMax: 0 }
}

describe('createFrameMetrics', () => {
  it('retains the earliest coalesced ingress until stdout drain completes', () => {
    const probe = createFrameMetrics()
    markDeltaIngress(probe, 10)
    markDeltaIngress(probe, 20)
    completeDeltaStdoutDrain(probe, 42)
    completeDeltaStdoutDrain(probe, 50)
    expect(probe.snapshot().deltaIngressToStdoutDrainMs.samples).toEqual([32])
  })

  it('reports zeroed counters, zeroed latencies and zero elapsed before any recording', () => {
    const clock = fakeClock()
    const probe = createFrameMetrics(clock.now)
    const snapshot = probe.snapshot()
    expect(snapshot).toEqual({
      deltaIngressToStdoutDrainMs: zeroedLatency(),
      markdownParseBytes: zeroedCounter(),
      stableRowsReused: zeroedCounter(),
      tailRowsRerendered: zeroedCounter(),
      mountedRows: zeroedCounter(),
      writtenCells: zeroedCounter(),
      renderQueue: {
        currentDepth: 0,
        maxDepth: 0,
        ageMs: zeroedLatency(),
      },
      scrollInputToPaintMs: zeroedLatency(),
      cacheBytes: zeroedCounter(),
      cacheEvictions: zeroedCounter(),
      elapsedMs: 0,
    })
    expect(probe.elapsedMs()).toBe(0)
  })

  it('accumulates counter increments into lifetime total and current window', () => {
    const probe = createFrameMetrics()
    probe.addMarkdownParseBytes(120)
    probe.addMarkdownParseBytes(80)
    probe.addMarkdownParseBytes(50)
    const snapshot = probe.snapshot()
    expect(snapshot.markdownParseBytes).toEqual({
      total: 250,
      windowCount: 3,
      windowSum: 250,
      windowMax: 120,
    })
  })

  it('records each latency sample with p95/mean/max from the bounded ring', () => {
    const probe = createFrameMetrics()
    for (const ms of [4, 8, 12, 16, 20]) {
      probe.recordDeltaIngressToStdoutDrain(ms)
    }
    const channel = probe.snapshot().deltaIngressToStdoutDrainMs
    expect(channel.count).toBe(5)
    expect(channel.mean).toBe(12)
    expect(channel.max).toBe(20)
    // 5 * 0.95 = 4.75 → ceil = 5 → rank 5 → sorted[4] = 20.
    expect(channel.p95).toBe(20)
    expect(channel.samples).toEqual([4, 8, 12, 16, 20])
  })

  it('caps each latency ring at the bounded capacity, dropping the oldest first', () => {
    const probe = createFrameMetrics()
    for (let index = 0; index < FRAME_METRICS_CAPACITY + 30; index += 1) {
      probe.recordScrollInputToPaint(index)
    }
    const channel = probe.snapshot().scrollInputToPaintMs
    expect(channel.count).toBe(FRAME_METRICS_CAPACITY)
    expect(channel.samples.length).toBe(FRAME_METRICS_CAPACITY)
    expect(channel.samples[0]).toBe(30)
    expect(channel.samples.at(-1)).toBe(FRAME_METRICS_CAPACITY + 29)
  })

  it('tracks render-queue depth gauge and age latency together', () => {
    const probe = createFrameMetrics()
    probe.recordRenderQueue(3, 12)
    probe.recordRenderQueue(7, 18)
    probe.recordRenderQueue(2, 6)
    const snapshot = probe.snapshot().renderQueue
    expect(snapshot.currentDepth).toBe(2)
    expect(snapshot.maxDepth).toBe(7)
    expect(snapshot.ageMs.count).toBe(3)
    expect(snapshot.ageMs.max).toBe(18)
    expect(snapshot.ageMs.p95).toBe(18)
  })

  it('keeps lifetime counter totals across resetWindow while clearing window stats', () => {
    const probe = createFrameMetrics()
    probe.addMarkdownParseBytes(100)
    probe.addMarkdownParseBytes(50)
    probe.recordDeltaIngressToStdoutDrain(15)
    probe.recordRenderQueue(9, 30)
    probe.resetWindow()
    const snapshot = probe.snapshot()
    expect(snapshot.markdownParseBytes).toEqual({
      total: 150,
      windowCount: 0,
      windowSum: 0,
      windowMax: 0,
    })
    expect(snapshot.deltaIngressToStdoutDrainMs).toEqual(zeroedLatency())
    expect(snapshot.renderQueue.currentDepth).toBe(9)
    // maxDepth resets to currentDepth; it does not track the prior peak.
    expect(snapshot.renderQueue.maxDepth).toBe(9)
    expect(snapshot.renderQueue.ageMs).toEqual(zeroedLatency())
  })

  it('isolates each channel so a recording on one does not affect another', () => {
    const probe = createFrameMetrics()
    probe.addMarkdownParseBytes(40)
    probe.addStableRowsReused(7)
    probe.addTailRowsRerendered(3)
    probe.addMountedRows(12)
    probe.addWrittenCells(240)
    probe.addCacheBytes(1024)
    probe.addCacheEvictions(2)
    probe.recordDeltaIngressToStdoutDrain(5)
    probe.recordScrollInputToPaint(11)
    const snapshot = probe.snapshot()
    expect(snapshot.markdownParseBytes.total).toBe(40)
    expect(snapshot.stableRowsReused.total).toBe(7)
    expect(snapshot.tailRowsRerendered.total).toBe(3)
    expect(snapshot.mountedRows.total).toBe(12)
    expect(snapshot.writtenCells.total).toBe(240)
    expect(snapshot.cacheBytes.total).toBe(1024)
    expect(snapshot.cacheEvictions.total).toBe(2)
    expect(snapshot.deltaIngressToStdoutDrainMs.count).toBe(1)
    expect(snapshot.scrollInputToPaintMs.count).toBe(1)
    // Cross-check that the latency rings are independent.
    expect(snapshot.deltaIngressToStdoutDrainMs.samples).toEqual([5])
    expect(snapshot.scrollInputToPaintMs.samples).toEqual([11])
  })

  it('handles a single latency sample without losing p95 or mean precision', () => {
    const probe = createFrameMetrics()
    probe.recordRenderQueue(1, 42)
    const snapshot = probe.snapshot().renderQueue
    expect(snapshot.ageMs).toEqual({
      count: 1,
      mean: 42,
      max: 42,
      p95: 42,
      samples: [42],
    })
  })

  it('tracks elapsed ms from the injected clock', () => {
    const clock = fakeClock()
    const probe = createFrameMetrics(clock.now)
    clock.advance(250)
    probe.addMountedRows(4)
    clock.advance(750)
    expect(probe.elapsedMs()).toBe(1000)
    expect(probe.snapshot().elapsedMs).toBe(1000)
    expect(probe.snapshot().mountedRows.total).toBe(4)
  })

  it('exposes a snapshot shape that round-trips through JSON.stringify', () => {
    const probe = createFrameMetrics()
    probe.addMarkdownParseBytes(64)
    probe.addStableRowsReused(9)
    probe.addTailRowsRerendered(2)
    probe.addMountedRows(15)
    probe.addWrittenCells(180)
    probe.addCacheBytes(512)
    probe.addCacheEvictions(1)
    probe.recordDeltaIngressToStdoutDrain(8)
    probe.recordScrollInputToPaint(14)
    probe.recordRenderQueue(4, 22)
    const snapshot = probe.snapshot()
    const json = JSON.stringify(snapshot)
    const parsed = JSON.parse(json) as FrameMetricsSnapshot
    expect(parsed).toEqual(snapshot)
    // Every channel is a plain object of numbers / arrays — no Maps / Dates /
    // functions / class instances leaked into the payload.
    expect(parsed.deltaIngressToStdoutDrainMs.samples).toEqual([8])
    expect(parsed.renderQueue.ageMs.samples).toEqual([22])
    expect(parsed.scrollInputToPaintMs.samples).toEqual([14])
  })

  it('preserves the snapshot.samples array identity across repeated snapshot calls', () => {
    const probe = createFrameMetrics()
    probe.recordDeltaIngressToStdoutDrain(3)
    probe.recordDeltaIngressToStdoutDrain(5)
    const first = probe.snapshot().deltaIngressToStdoutDrainMs.samples
    const second = probe.snapshot().deltaIngressToStdoutDrainMs.samples
    expect(first).not.toBe(second)
    expect(first).toEqual([3, 5])
    expect(second).toEqual([3, 5])
  })

  it('accepts negative deltas to subtract from a counter', () => {
    const probe = createFrameMetrics()
    probe.addCacheBytes(1000)
    probe.addCacheBytes(-300)
    const snapshot = probe.snapshot().cacheBytes
    expect(snapshot.total).toBe(700)
    expect(snapshot.windowCount).toBe(2)
    expect(snapshot.windowSum).toBe(700)
    // windowMax tracks the largest single increment, so it stays at 1000
    // even after the negative adjustment; this lets dashboards surface the
    // biggest single allocation regardless of later releases.
    expect(snapshot.windowMax).toBe(1000)
  })

  it('keeps maxDepth current after resetWindow when no further observations arrive', () => {
    const probe = createFrameMetrics()
    probe.recordRenderQueue(5, 10)
    probe.recordRenderQueue(9, 12)
    probe.resetWindow()
    const queue = probe.snapshot().renderQueue
    expect(queue.currentDepth).toBe(9)
    expect(queue.maxDepth).toBe(9)
  })
})

/** Type-level check: the snapshot is exhaustively a plain JSON-serializable
 * shape (no functions, no class instances, no Maps / Dates). */
function assertJsonSerializable(value: FrameMetricsSnapshot): string {
  return JSON.stringify(value)
}

describe('FrameMetricsHandle API surface', () => {
  it('exposes every required channel and the JSON-serializable snapshot', () => {
    const probe: FrameMetricsHandle = createFrameMetrics()
    probe.recordDeltaIngressToStdoutDrain(1)
    probe.addMarkdownParseBytes(1)
    probe.addStableRowsReused(1)
    probe.addTailRowsRerendered(1)
    probe.addMountedRows(1)
    probe.addWrittenCells(1)
    probe.recordRenderQueue(1, 1)
    probe.recordScrollInputToPaint(1)
    probe.addCacheBytes(1)
    probe.addCacheEvictions(1)
    probe.resetWindow()
    // The string is the proof — if any field were non-serializable this
    // would throw.
    expect(() => assertJsonSerializable(probe.snapshot())).not.toThrow()
    expect(typeof probe.elapsedMs()).toBe('number')
  })
})
