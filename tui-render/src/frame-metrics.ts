/**
 * RendererMetricProbe: incremental streaming-renderer instrumentation for the
 * TUI render layer. Counting channels (rows / cells / bytes / evictions)
 * accumulate monotonically across the whole run and summarize a resettable
 * window; latency channels record durations into a bounded ring summarized
 * as count / mean / max / p95, matching frame-stats.ts. Render-queue
 * observations expose both a depth gauge (current + window max) and a ring
 * of age samples. The snapshot shape is plain JSON-serializable data so the
 * host can extend writeFrameStatsFile without further mapping. StreamView,
 * Markdown projection, scrolling, and the stdout wrapper report directly to
 * this session-owned handle.
 * @module @deepseek-ai/dsh-tui-render/frame-metrics
 */

import type { FrameStatsSnapshot } from './frame-stats.ts'

/** Bounded ring capacity for renderer-metric latency samples (ms). */
export const FRAME_METRICS_CAPACITY = 120

/**
 * Counting-channel summary: lifetime monotonic total plus a resettable
 * window. Lifetime totals never decrease; window stats reset via
 * {@link FrameMetricsHandle.resetWindow} so callers can take periodic
 * rate snapshots without losing the run-level aggregate.
 */
export interface FrameMetricsCounterSnapshot {
  /** Monotonic lifetime total since the channel was created. */
  total: number
  /** Number of increment events recorded in the current window. */
  windowCount: number
  /** Sum of increment values in the current window. */
  windowSum: number
  /** Largest single increment value in the current window. */
  windowMax: number
}

/**
 * Render-queue observation: a depth gauge plus a latency ring for queue
 * age. `currentDepth` is the most recent observation; `maxDepth` is the
 * largest observation in the current window.
 */
export interface RenderQueueSnapshot {
  /** Last observed queue depth. */
  currentDepth: number
  /** Largest observed queue depth in the current window. */
  maxDepth: number
  /** Latency channel for queue age in ms (ring + p95). */
  ageMs: FrameStatsSnapshot
}

/** Plain JSON-serializable snapshot of every renderer-metric channel. */
export interface FrameMetricsSnapshot {
  /** delta-ingress-to-stdout-drain latency in ms (ring + p95). */
  deltaIngressToStdoutDrainMs: FrameStatsSnapshot
  /** Markdown parse bytes observed by the projector (counter). */
  markdownParseBytes: FrameMetricsCounterSnapshot
  /** Stable rows reused from the line store (counter). */
  stableRowsReused: FrameMetricsCounterSnapshot
  /** Tail rows rerendered because their content changed (counter). */
  tailRowsRerendered: FrameMetricsCounterSnapshot
  /** Rows mounted into the Ink tree (counter). */
  mountedRows: FrameMetricsCounterSnapshot
  /** Cells actually written to stdout (counter). */
  writtenCells: FrameMetricsCounterSnapshot
  /** Render-queue age latency (ring + p95) and depth gauges. */
  renderQueue: RenderQueueSnapshot
  /** Scroll input-to-paint latency in ms (ring + p95). */
  scrollInputToPaintMs: FrameStatsSnapshot
  /** Cache bytes allocated by the line store (counter). */
  cacheBytes: FrameMetricsCounterSnapshot
  /** Cache eviction events (counter). */
  cacheEvictions: FrameMetricsCounterSnapshot
  /** Elapsed ms since the probe was created (pacing context). */
  elapsedMs: number
}

/** Renderer-metric store the streaming pipeline reports into. */
export interface FrameMetricsHandle {
  /** Record one delta-ingress-to-stdout-drain latency sample (ms). */
  recordDeltaIngressToStdoutDrain(ms: number): void
  /** Add parsed Markdown bytes to the counter (negative deltas allowed). */
  addMarkdownParseBytes(n: number): void
  /** Add reused stable rows to the counter (negative deltas allowed). */
  addStableRowsReused(n: number): void
  /** Add rerendered tail rows to the counter (negative deltas allowed). */
  addTailRowsRerendered(n: number): void
  /** Add mounted rows to the counter (negative deltas allowed). */
  addMountedRows(n: number): void
  /** Add written cells to the counter (negative deltas allowed). */
  addWrittenCells(n: number): void
  /** Record one render-queue age sample (ms) and current depth observation. */
  recordRenderQueue(depth: number, ageMs: number): void
  /** Record one scroll input-to-paint latency sample (ms). */
  recordScrollInputToPaint(ms: number): void
  /** Add cache bytes to the counter (negative deltas allowed). */
  addCacheBytes(n: number): void
  /** Add cache eviction events to the counter. */
  addCacheEvictions(n: number): void
  /** Reset the window state of every channel (lifetime totals preserved). */
  resetWindow(): void
  /** Plain JSON-serializable snapshot of every channel. */
  snapshot(): FrameMetricsSnapshot
  /** Elapsed ms since the probe was created (pacing context). */
  elapsedMs(): number
}

/** Earliest model-delta ingress still waiting for a stdout drain callback. */
const PENDING_DELTA_INGRESS = new WeakMap<FrameMetricsHandle, number>()

/**
 * Mark canonical renderer input as changed. Repeated deltas before the next
 * completed stdout write retain the earliest timestamp, so coalescing does
 * not hide queueing latency.
 * @param metrics - session-owned renderer metrics.
 * @param nowMs - monotonic timestamp; defaults to `performance.now()`.
 */
export function markDeltaIngress(
  metrics: FrameMetricsHandle,
  nowMs: number = performance.now(),
): void {
  if (!PENDING_DELTA_INGRESS.has(metrics)) {
    PENDING_DELTA_INGRESS.set(metrics, nowMs)
  }
}

/**
 * Complete the pending delta latency at the terminal write callback. A write
 * without a preceding model delta records nothing.
 * @param metrics - session-owned renderer metrics.
 * @param nowMs - monotonic timestamp; defaults to `performance.now()`.
 */
export function completeDeltaStdoutDrain(
  metrics: FrameMetricsHandle,
  nowMs: number = performance.now(),
): void {
  const startedAt = PENDING_DELTA_INGRESS.get(metrics)
  if (startedAt === undefined) return
  PENDING_DELTA_INGRESS.delete(metrics)
  metrics.recordDeltaIngressToStdoutDrain(Math.max(0, nowMs - startedAt))
}

/** Internal mutable counter state, kept private to the module. */
interface CounterState {
  total: number
  windowCount: number
  windowSum: number
  windowMax: number
}

/** Build an empty counter state. */
function emptyCounter(): CounterState {
  return { total: 0, windowCount: 0, windowSum: 0, windowMax: 0 }
}

/** Snapshot a counter state into a plain JSON-serializable object. */
function summarizeCounter(state: CounterState): FrameMetricsCounterSnapshot {
  return {
    total: state.total,
    windowCount: state.windowCount,
    windowSum: state.windowSum,
    windowMax: state.windowMax,
  }
}

/** Bounded latency ring + p95, mirroring frame-stats.ts summarize semantics. */
function summarizeLatency(samples: number[]): FrameStatsSnapshot {
  const count = samples.length
  if (count === 0) {
    return { count: 0, mean: 0, max: 0, p95: 0, samples: [] }
  }
  let sum = 0
  let max = 0
  for (const sample of samples) {
    sum += sample
    if (sample > max) max = sample
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.min(count, Math.max(1, Math.ceil(count * 0.95)))
  // v8 ignore next -- rank is clamped to [1, count], so the indexed read is always defined.
  const p95 = sorted[rank - 1] ?? 0
  return {
    count,
    mean: sum / count,
    max,
    p95,
    samples: samples.slice(),
  }
}

/** Add an increment to a counter state. Negative deltas are allowed. */
function addToCounter(state: CounterState, n: number): void {
  state.total += n
  state.windowCount += 1
  state.windowSum += n
  if (n > state.windowMax) state.windowMax = n
}

/** Record a sample into a bounded ring, dropping the oldest first. */
function recordRing(ring: number[], sample: number, capacity: number): void {
  ring.push(sample)
  if (ring.length > capacity) ring.splice(0, ring.length - capacity)
}

/** Reset the window portion of a counter state, keeping the lifetime total. */
function resetCounterWindow(state: CounterState): void {
  state.windowCount = 0
  state.windowSum = 0
  state.windowMax = 0
}

/**
 * Create a renderer-metric probe store. `now` is injectable so tests drive
 * pacing with a deterministic clock.
 * @param now - clock in ms (defaults to performance.now).
 * @param capacity - bounded ring capacity for latency samples (default 120).
 * @returns the probe handle.
 */
export function createFrameMetrics(
  now: () => number = () => performance.now(),
  capacity: number = FRAME_METRICS_CAPACITY,
): FrameMetricsHandle {
  const startedAt = now()
  const drainSamples: number[] = []
  const scrollSamples: number[] = []
  const queueAgeSamples: number[] = []
  const counters = {
    markdownParseBytes: emptyCounter(),
    stableRowsReused: emptyCounter(),
    tailRowsRerendered: emptyCounter(),
    mountedRows: emptyCounter(),
    writtenCells: emptyCounter(),
    cacheBytes: emptyCounter(),
    cacheEvictions: emptyCounter(),
  }
  const queueState = {
    currentDepth: 0,
    maxDepth: 0,
  }
  return {
    recordDeltaIngressToStdoutDrain(ms: number): void {
      recordRing(drainSamples, ms, capacity)
    },
    addMarkdownParseBytes(n: number): void {
      addToCounter(counters.markdownParseBytes, n)
    },
    addStableRowsReused(n: number): void {
      addToCounter(counters.stableRowsReused, n)
    },
    addTailRowsRerendered(n: number): void {
      addToCounter(counters.tailRowsRerendered, n)
    },
    addMountedRows(n: number): void {
      addToCounter(counters.mountedRows, n)
    },
    addWrittenCells(n: number): void {
      addToCounter(counters.writtenCells, n)
    },
    recordRenderQueue(depth: number, ageMs: number): void {
      queueState.currentDepth = depth
      if (depth > queueState.maxDepth) queueState.maxDepth = depth
      recordRing(queueAgeSamples, ageMs, capacity)
    },
    recordScrollInputToPaint(ms: number): void {
      recordRing(scrollSamples, ms, capacity)
    },
    addCacheBytes(n: number): void {
      addToCounter(counters.cacheBytes, n)
    },
    addCacheEvictions(n: number): void {
      addToCounter(counters.cacheEvictions, n)
    },
    resetWindow(): void {
      resetCounterWindow(counters.markdownParseBytes)
      resetCounterWindow(counters.stableRowsReused)
      resetCounterWindow(counters.tailRowsRerendered)
      resetCounterWindow(counters.mountedRows)
      resetCounterWindow(counters.writtenCells)
      resetCounterWindow(counters.cacheBytes)
      resetCounterWindow(counters.cacheEvictions)
      queueState.maxDepth = queueState.currentDepth
      drainSamples.length = 0
      scrollSamples.length = 0
      queueAgeSamples.length = 0
    },
    snapshot(): FrameMetricsSnapshot {
      return {
        deltaIngressToStdoutDrainMs: summarizeLatency(drainSamples),
        markdownParseBytes: summarizeCounter(counters.markdownParseBytes),
        stableRowsReused: summarizeCounter(counters.stableRowsReused),
        tailRowsRerendered: summarizeCounter(counters.tailRowsRerendered),
        mountedRows: summarizeCounter(counters.mountedRows),
        writtenCells: summarizeCounter(counters.writtenCells),
        renderQueue: {
          currentDepth: queueState.currentDepth,
          maxDepth: queueState.maxDepth,
          ageMs: summarizeLatency(queueAgeSamples),
        },
        scrollInputToPaintMs: summarizeLatency(scrollSamples),
        cacheBytes: summarizeCounter(counters.cacheBytes),
        cacheEvictions: summarizeCounter(counters.cacheEvictions),
        elapsedMs: now() - startedAt,
      }
    },
    elapsedMs(): number {
      return now() - startedAt
    },
  }
}
