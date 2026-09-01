/** FrameProbe: bounded render-cost stats, snapshot shape, p95, and the React
 * Profiler mount wiring (onRender actualDuration per subtree commit). */

import { describe, expect, it } from 'vitest'
import { render, renderToString } from 'ink'
import { createElement, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  FRAME_STATS_CAPACITY,
  FrameProbe,
  createFrameProbe,
  frameStatsSnapshot,
} from '../src/frame-stats.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

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

describe('createFrameProbe', () => {
  it('summarizes clock-driven commits as count/mean/max/p95 over the ring', () => {
    const clock = fakeClock()
    const probe = createFrameProbe(clock.now)
    for (const ms of [10, 20, 30, 40]) {
      clock.advance(ms)
      probe.record(ms)
    }
    const snapshot = frameStatsSnapshot(probe)
    expect(snapshot.count).toBe(4)
    expect(snapshot.mean).toBe(25)
    expect(snapshot.max).toBe(40)
    // p95 of 4 samples is the largest (rank 4).
    expect(snapshot.p95).toBe(40)
    expect(snapshot.samples).toEqual([10, 20, 30, 40])
    expect(snapshot.samples).not.toBe(probe.snapshot().samples)
  })

  it('computes p95 as the sorted quantile for a larger sample set', () => {
    const probe = createFrameProbe()
    for (let index = 1; index <= 20; index += 1) probe.record(index)
    // 20 * 0.95 = 19 → rank 19 → sorted[18] = 19.
    expect(probe.snapshot().p95).toBe(19)
    expect(probe.snapshot().max).toBe(20)
  })

  it('caps the ring at the bounded capacity, dropping the oldest first', () => {
    const probe = createFrameProbe()
    for (let index = 0; index < FRAME_STATS_CAPACITY + 30; index += 1) {
      probe.record(index)
    }
    const snapshot = probe.snapshot()
    expect(snapshot.count).toBe(FRAME_STATS_CAPACITY)
    expect(snapshot.samples.length).toBe(FRAME_STATS_CAPACITY)
    expect(snapshot.samples[0]).toBe(30)
    expect(snapshot.samples.at(-1)).toBe(FRAME_STATS_CAPACITY + 29)
  })

  it('reports zeroed stats before any commit', () => {
    const probe = createFrameProbe()
    expect(probe.snapshot()).toEqual({
      count: 0,
      mean: 0,
      max: 0,
      p95: 0,
      samples: [],
    })
    expect(probe.commits).toBe(0)
  })

  it('tracks total commits and clock-driven elapsed time', () => {
    const clock = fakeClock()
    const probe = createFrameProbe(clock.now)
    clock.advance(500)
    probe.record(12)
    probe.record(8)
    clock.advance(1500)
    expect(probe.commits).toBe(2)
    expect(probe.elapsedMs()).toBe(2000)
  })

  it('starts the workload window once and discards launch samples', () => {
    const clock = fakeClock()
    const probe = createFrameProbe(clock.now)
    clock.advance(200)
    probe.record(80)
    probe.beginMeasurement()
    clock.advance(25)
    probe.record(7)
    probe.beginMeasurement()
    expect(probe.snapshot().samples).toEqual([7])
    expect(probe.commits).toBe(1)
    expect(probe.elapsedMs()).toBe(25)
  })

  it('summarizes single-sample and single-channel edge cases', () => {
    const probe = createFrameProbe()
    probe.record(42)
    expect(probe.snapshot()).toEqual({
      count: 1,
      mean: 42,
      max: 42,
      p95: 42,
      samples: [42],
    })
  })

  it('keeps the running max when a later sample is smaller', () => {
    const probe = createFrameProbe()
    probe.record(40)
    probe.record(10)
    probe.record(30)
    const snapshot = probe.snapshot()
    expect(snapshot.max).toBe(40)
    expect(snapshot.mean).toBeCloseTo(80 / 3)
    expect(snapshot.p95).toBe(40)
  })
})

/** External store that drives commits from outside React (live-mount regression). */
function createCommitStore(): {
  subscribe(listener: () => void): () => void
  getSnapshot(): number
  bump(): void
} {
  let value = 0
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => value,
    bump() {
      value += 1
      for (const listener of listeners) listener()
    },
  }
}

/** A stateful child whose own store updates commit under a stable wrapper. */
function CommitPump(props: {
  store: ReturnType<typeof createCommitStore>
}): ReactNode {
  const value = useSyncExternalStore(
    callback => props.store.subscribe(callback),
    () => props.store.getSnapshot(),
  )
  return createElement('ink-text', null, String(value))
}

describe('FrameProbe component', () => {
  it('renders children through the Profiler wrapper and records the synchronous commit', () => {
    const probe = createFrameProbe()
    const out = renderToString(
      createElement(FrameProbe, {
        probe,
        children: createElement('ink-text', null, 'probe child'),
      }),
    )
    expect(out).toContain('probe child')
    // Ink's renderToString commits the tree synchronously, so the Profiler
    // fires once for that commit.
    expect(probe.snapshot().count).toBe(1)
    expect(probe.commits).toBe(1)
  })

  it('records every subtree commit while mounted, even with stable wrapper props', async () => {
    const probe = createFrameProbe()
    const store = createCommitStore()
    // Production shape: FrameProbe mounts once with fixed props and a
    // referentially stable child element; the commits come from the child's
    // own store updates. React skips re-rendering the stable wrapper, so the
    // per-commit record must come from the Profiler, which fires onRender for
    // every commit in the subtree. The useInsertionEffect channel recorded
    // only the initial mount (count=1) and this test failed on it.
    const stdout = fakeTtyStdout()
    const stdin = fakeTtyStdin()
    const instance = render(
      createElement(
        FrameProbe,
        { probe },
        createElement(CommitPump, { store }),
      ),
      {
        // The helpers return structural TTY fakes, not NodeJS stream types;
        // the host typecheck program sees this .ts spec, so cast at the Ink boundary.
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      // The mount is one commit; each bump is another commit in the subtree.
      store.bump()
      await instance.waitUntilRenderFlush()
      store.bump()
      await instance.waitUntilRenderFlush()
      store.bump()
      await instance.waitUntilRenderFlush()
      expect(probe.snapshot().count).toBeGreaterThanOrEqual(4)
      expect(probe.commits).toBeGreaterThanOrEqual(4)
    } finally {
      instance.unmount()
    }
  })
})
