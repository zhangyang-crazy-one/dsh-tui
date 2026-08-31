/**
 * FrameProbe: commit-driven render-cost instrumentation for the Ink surface.
 * Each React commit in the probed subtree records the Profiler onRender
 * actualDuration — the time React spent rendering that subtree for the
 * commit — into a bounded ring (capacity 120) summarized as
 * count/mean/max/p95 (p95 is the sorted quantile). renderMs is the React
 * render-phase cost of the commit; it never claims wall-clock terminal paint,
 * it excludes the Ink host-diff/commit phase, and no interval sampler exists
 * to masquerade pacing cadence as render cost. The Profiler wrapper fires
 * onRender for every commit in the subtree even when its own props and
 * children stay referentially stable, because React skips re-rendering such a
 * wrapper but still commits the subtree.
 * @module @deepseek-ai/dsh-tui-render/frame-stats
 */

import { createElement, Profiler } from 'react'
import type { ProfilerOnRenderCallback, ReactNode } from 'react'

/** Bounded ring capacity for recorded render durations. */
export const FRAME_STATS_CAPACITY = 120

/** Bounded summary of one measurement channel's recorded durations (ms). */
export interface FrameStatsSnapshot {
  /** Number of samples currently in the ring. */
  count: number
  /** Arithmetic mean of the ring samples (0 when empty). */
  mean: number
  /** Largest ring sample (0 when empty). */
  max: number
  /** Sorted-quantile 95th percentile of the ring samples (0 when empty). */
  p95: number
  /** The ring samples, oldest first. */
  samples: readonly number[]
}

/** Stats store the render tree reports commits into. */
export interface FrameProbeHandle {
  /** Record one committed subtree render duration (ms), Profiler actualDuration channel. */
  record(renderMs: number): void
  /** Read-only bounded stats for the Profiler channel. */
  snapshot(): FrameStatsSnapshot
  /** Start the first workload window, discarding launch and history-hydration samples. */
  beginMeasurement(): void
  /** Total commits recorded (one per Profiler onRender). */
  readonly commits: number
  /** Elapsed ms since the probe was created (pacing context). */
  elapsedMs(): number
}

/** Summarize one bounded ring; empty rings report zeroed stats. */
function summarize(samples: number[]): FrameStatsSnapshot {
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

/**
 * Create a probe store. `now` is injectable so tests drive pacing with a
 * deterministic clock.
 * @param now - clock in ms (defaults to performance.now).
 * @param capacity - bounded ring capacity (default 120).
 * @returns the probe handle.
 */
export function createFrameProbe(
  now: () => number = () => performance.now(),
  capacity: number = FRAME_STATS_CAPACITY,
): FrameProbeHandle {
  const samples: number[] = []
  let startedAt = now()
  let commits = 0
  let measurementStarted = false
  return {
    record(renderMs: number) {
      commits += 1
      samples.push(renderMs)
      if (samples.length > capacity) samples.splice(0, samples.length - capacity)
    },
    snapshot() {
      return summarize(samples)
    },
    beginMeasurement() {
      if (measurementStarted) return
      measurementStarted = true
      samples.length = 0
      commits = 0
      startedAt = now()
    },
    get commits() {
      return commits
    },
    elapsedMs() {
      return now() - startedAt
    },
  }
}

/**
 * Read-only snapshot of the renderMs channel.
 * @param probe - the probe handle.
 * @returns the bounded stats snapshot.
 */
export function frameStatsSnapshot(probe: FrameProbeHandle): FrameStatsSnapshot {
  return probe.snapshot()
}

/** FrameProbe props. */
export interface FrameProbeProps {
  /** The stats store this probe reports into. */
  probe: FrameProbeHandle
  /** The tree this probe measures commits for. */
  children?: ReactNode
}

/**
 * Mount inside the render tree to record one sample per commit in the
 * subtree. The React Profiler fires onRender after every commit in which the
 * subtree rendered — including commits that skip this wrapper itself because
 * its props and children are referentially stable — so child commits are
 * recorded even when the wrapper bails out. Mount at the tree root
 * (mountTuiRender does this when a probe is provided).
 * @param props - probe store and children.
 * @returns the profiled tree.
 */
export function FrameProbe(props: FrameProbeProps): ReactNode {
  const { probe, children } = props
  return createElement(
    Profiler,
    { id: 'dsh-tui-render', onRender: profilerOnRender(probe) },
    children,
  )
}

/** Bind the Profiler onRender callback to a probe's record channel. */
function profilerOnRender(
  probe: FrameProbeHandle,
): ProfilerOnRenderCallback {
  return (_id, _phase, actualDuration) => {
    probe.record(actualDuration)
  }
}
