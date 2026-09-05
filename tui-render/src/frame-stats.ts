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

import { DurationStats } from './duration-stats.ts'
import type { DurationSnapshot as FrameStatsSnapshot } from './duration-stats.ts'
export type { DurationSnapshot as FrameStatsSnapshot } from './duration-stats.ts'

import { createElement, Profiler } from 'react'
import type { ProfilerOnRenderCallback, ReactNode } from 'react'

/** Bounded ring capacity for recorded render durations. */
export const FRAME_STATS_CAPACITY = 120

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
  const samples = new DurationStats(capacity)
  let startedAt = now()
  let commits = 0
  let measurementStarted = false
  return {
    record(renderMs: number) {
      commits += 1
      samples.record(renderMs)
    },
    snapshot() {
      return samples.snapshot()
    },
    beginMeasurement() {
      if (measurementStarted) return
      measurementStarted = true
      samples.reset()
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
