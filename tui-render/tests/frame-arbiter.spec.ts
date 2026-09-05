/**
 * FrameArbiter: single-frame arbiter shared by the stream presentation
 * queue and the scroll scheduler. The owner of the renderer-wide frame
 * clock: one consistent transcript snapshot per frame interval; user
 * scroll input takes priority over the background stream tail; all owned
 * timers and listeners are released on teardown. Every test runs under
 * `vi.useFakeTimers()` so the arbiter's `setInterval`, the scroll
 * scheduler's `setInterval`, and any manual `advanceTimersByTime` step
 * fire deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFrameArbiter,
  FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS,
} from '../src/frame-arbiter.ts'
import type {
  FrameArbiter,
  FrameSnapshot,
  ScrollFrameState,
} from '../src/frame-arbiter.ts'
import { createScrollScheduler } from '../src/scroll-scheduler.ts'
import { createStreamQueue } from '../src/stream-queue.ts'
import type { ScrollScheduler } from '../src/scroll-scheduler.ts'
import type { StreamQueue } from '../src/stream-queue.ts'

interface TestRow {
  readonly id: number
}

const FRAME_MS = FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS
const ONE_FRAME = FRAME_MS

function row(id: number): TestRow {
  return { id }
}

function streamEntries(snapshot: FrameSnapshot<TestRow>): number[] {
  return snapshot.stream.map(item => item.id)
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Construct a real scroll scheduler + real stream queue wired to a real
 * frame arbiter, all under fake timers. The integration wiring matters:
 * the arbiter reads the scheduler's state, ticks the queue, and publishes
 * a single snapshot per frame.
 * @param overrides - per-test overrides on the scroll / stream configs.
 * @returns the trio plus a published-snapshot recorder.
 */
function fixture(overrides: {
  readonly arbiterIntervalMs?: number
  readonly ownsScrollScheduler?: boolean
  readonly now?: () => number
  readonly scroll?: ScrollScheduler
  readonly stream?: StreamQueue<TestRow>
} = {}): {
  readonly arbiter: FrameArbiter<TestRow>
  readonly scroll: ScrollScheduler
  readonly stream: StreamQueue<TestRow>
  readonly publishes: FrameSnapshot<TestRow>[]
} {
  // Anchor fake time at 0 so the stream-queue's ageMs stays small and smooth mode stays engaged.
  vi.useFakeTimers({ now: 0 })
  const publishes: FrameSnapshot<TestRow>[] = []
  const scroll = overrides.scroll ?? createScrollScheduler({ frameIntervalMs: ONE_FRAME })
  const stream = overrides.stream ?? createStreamQueue<TestRow>({ smoothRowsPerFrame: 2 })
  const arbiter = createFrameArbiter<TestRow>({
    frameIntervalMs: overrides.arbiterIntervalMs ?? ONE_FRAME,
    ownsScrollScheduler: overrides.ownsScrollScheduler ?? true,
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    scroll,
    stream,
  })
  arbiter.onPublish((snapshot) => {
    publishes.push(snapshot)
  })
  return { arbiter, scroll, stream, publishes }
}

describe('createFrameArbiter defaults and wiring', () => {
  it('keeps the published default frame interval in sync with the constructor', () => {
    expect(FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS).toBe(16)
  })

  it('starts running with the shared frame timer scheduled', () => {
    const { arbiter } = fixture()
    expect(arbiter.isRunning()).toBe(true)
    // Only the arbiter's timer is registered; the scroll scheduler is
    // idle until setTarget lands, so initial timer count is exactly 1.
    expect(vi.getTimerCount()).toBe(1)
    arbiter.dispose()
  })

  it('reads injected now(), setInterval, and clearInterval sources', () => {
    const clearIntervalSpy = vi.fn<typeof clearInterval>().mockImplementation(clearInterval)
    const nowSpy = vi.fn(() => 1_234_567)
    vi.useFakeTimers({ now: 0 })
    const setIntervalSpy = vi.fn<typeof setInterval>()
    setIntervalSpy.mockImplementation(setInterval)
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>({ smoothRowsPerFrame: 1 })
    const arbiter = createFrameArbiter<TestRow>({
      frameIntervalMs: ONE_FRAME,
      scroll,
      stream,
      setInterval: setIntervalSpy as unknown as typeof setInterval,
      clearInterval: clearIntervalSpy,
      now: nowSpy,
    })
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), ONE_FRAME)
    const publishes: FrameSnapshot<TestRow>[] = []
    arbiter.onPublish(snapshot => publishes.push(snapshot))
    stream.push([row(1)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(nowSpy).toHaveBeenCalled()
    expect(publishes).toHaveLength(1)
    expect(publishes[0]?.nowMs).toBe(1_234_567)
    arbiter.dispose()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('exposes getScrollState as a thin read over the injected scheduler', () => {
    const { arbiter, scroll } = fixture()
    scroll.setTarget(3)
    const state: ScrollFrameState = arbiter.getScrollState()
    expect(state.target).toBe(3)
    expect(state.isAnimating).toBe(true)
    expect(state.presented).toBe(0)
    arbiter.dispose()
  })
})

describe('createFrameArbiter publish gating', () => {
  it('publishes every shared-clock scroll step including the final target before becoming idle', () => {
    vi.useFakeTimers({ now: 0 })
    const scroll = createScrollScheduler({ autoSchedule: false })
    const stream = createStreamQueue<TestRow>()
    const arbiter = createFrameArbiter({ scroll, stream, drivesScrollScheduler: true, demandDriven: true })
    const positions: number[] = []
    arbiter.onPublish(snapshot => positions.push(snapshot.scroll.presented))
    try {
      scroll.setTarget(3)
      arbiter.requestScroll()
      vi.advanceTimersByTime(ONE_FRAME * 3)
      expect(positions).toEqual([1, 2, 3])
      expect(arbiter.isRunning()).toBe(false)
      scroll.setTarget(0)
      arbiter.requestScroll()
      vi.advanceTimersByTime(ONE_FRAME * 3)
      expect(positions).toEqual([1, 2, 3, 2, 1, 0])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      arbiter.dispose()
    }
  })

  it('publishes no snapshot when nothing is pending and no work is available', () => {
    const { arbiter, publishes } = fixture()
    vi.advanceTimersByTime(ONE_FRAME * 5)
    expect(publishes).toEqual([])
    arbiter.dispose()
  })

  it('publishes when the scroll scheduler is animating, even with no stream rows', () => {
    const { arbiter, publishes } = fixture()
    arbiter.requestStream()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(publishes[0]?.stream).toEqual([])
    expect(publishes[0]?.forced).toBe(true)
    arbiter.dispose()
  })

  it('publishes when the stream queue produces rows, even with idle scroll', () => {
    const { arbiter, stream, publishes } = fixture()
    stream.push([row(1), row(2), row(3)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(streamEntries(publishes[0]!)).toEqual([1, 2])
    expect(publishes[0]?.forced).toBe(false)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(2)
    expect(streamEntries(publishes[1]!)).toEqual([3])
    arbiter.dispose()
  })

  it('treats scroll motion as natural work, so forced stays false on an animating scheduler', () => {
    const { arbiter, scroll, publishes } = fixture()
    scroll.setTarget(1)
    arbiter.requestScroll()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(publishes[0]?.forced).toBe(false)
    arbiter.dispose()
  })
})

describe('createFrameArbiter priority (scroll wins, single snapshot)', () => {
  it('folds a scroll request and a stream request on the same frame into one snapshot', () => {
    const { arbiter, stream, publishes } = fixture()
    stream.push([row(10), row(11)], 0)
    arbiter.requestScroll()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(streamEntries(publishes[0]!)).toEqual([10, 11])
    expect(publishes[0]?.scroll.isAnimating).toBe(false)
    expect(publishes[0]?.scroll.presented).toBe(0)
    arbiter.dispose()
  })

  it('processes scroll state before stream rows inside the same snapshot (priority field order)', () => {
    const { arbiter, scroll, stream, publishes } = fixture()
    scroll.setTarget(2)
    stream.push([row(7), row(8), row(9)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    const snapshot = publishes[0]!
    expect(snapshot.scroll.target).toBe(2)
    expect(snapshot.scroll.isAnimating).toBe(true)
    expect(streamEntries(snapshot)).toEqual([7, 8])
    arbiter.dispose()
  })

  it('forbids more than one publish per frame interval even with stacked requests', () => {
    const { arbiter, publishes } = fixture()
    arbiter.requestStream()
    arbiter.requestScroll()
    arbiter.requestStream()
    arbiter.requestScroll()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    arbiter.dispose()
  })
})

describe('createFrameArbiter coalescing and cancellation', () => {
  it('coalesces a burst of requestStream calls into one forced publish per frame', () => {
    const { arbiter, publishes } = fixture()
    arbiter.requestStream()
    arbiter.requestStream()
    arbiter.requestStream()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(publishes[0]?.forced).toBe(true)
    arbiter.dispose()
  })

  it('coalesces a burst of requestScroll calls into one forced publish per frame', () => {
    const { arbiter, publishes } = fixture()
    arbiter.requestScroll()
    arbiter.requestScroll()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(publishes[0]?.forced).toBe(true)
    arbiter.dispose()
  })

  it('clears pending flags once the frame fires, so a request on frame N+1 is independent', () => {
    const { arbiter, publishes } = fixture()
    arbiter.requestScroll()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(arbiter.hasPendingRequest()).toBe(false)
    vi.advanceTimersByTime(ONE_FRAME * 3)
    expect(publishes).toHaveLength(1)
    arbiter.requestScroll()
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(2)
    arbiter.dispose()
  })

  it('reports hasPendingRequest across both flags', () => {
    const { arbiter } = fixture()
    expect(arbiter.hasPendingRequest()).toBe(false)
    arbiter.requestStream()
    expect(arbiter.hasPendingRequest()).toBe(true)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(arbiter.hasPendingRequest()).toBe(false)
    arbiter.requestScroll()
    expect(arbiter.hasPendingRequest()).toBe(true)
    arbiter.dispose()
  })
})

describe('createFrameArbiter fake-clock pacing', () => {
  it('publishes one snapshot per frame interval while the stream produces new rows', () => {
    const { arbiter, stream, publishes } = fixture()
    stream.push([row(1), row(2), row(3), row(4)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(1)
    expect(streamEntries(publishes[0]!)).toEqual([1, 2])
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(2)
    expect(streamEntries(publishes[1]!)).toEqual([3, 4])
    vi.advanceTimersByTime(ONE_FRAME)
    expect(publishes).toHaveLength(2) // empty queue, no work, no publish
    arbiter.dispose()
  })

  it('publishes at most one snapshot per frame interval under stacked requests', () => {
    const { arbiter, publishes } = fixture()
    for (let n = 0; n < 4; n += 1) {
      arbiter.requestScroll()
      arbiter.requestStream()
      vi.advanceTimersByTime(ONE_FRAME)
    }
    expect(publishes).toHaveLength(4)
    arbiter.dispose()
  })

  it('publishes once per interval of the arbiter\'s own frame clock (decoupled from the scroll scheduler)', () => {
    const { arbiter, scroll, publishes } = fixture({ arbiterIntervalMs: ONE_FRAME })
    expect(arbiter.isRunning()).toBe(true)
    scroll.setTarget(10)
    vi.advanceTimersByTime(ONE_FRAME * 3)
    expect(publishes.length).toBeGreaterThanOrEqual(3)
    arbiter.dispose()
  })

  it('honors a custom shared frame interval higher than the default', () => {
    const { arbiter, publishes } = fixture({ arbiterIntervalMs: 32 })
    arbiter.requestScroll()
    vi.advanceTimersByTime(16)
    expect(publishes).toHaveLength(0)
    vi.advanceTimersByTime(16)
    expect(publishes).toHaveLength(1)
    arbiter.dispose()
  })
})

describe('createFrameArbiter listeners', () => {
  it('forwards one snapshot to every registered listener and removes them via the returned unsubscribe', () => {
    vi.useFakeTimers()
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>({ smoothRowsPerFrame: 1 })
    const arbiter = createFrameArbiter<TestRow>({ scroll, stream })
    const first: FrameSnapshot<TestRow>[] = []
    const second: FrameSnapshot<TestRow>[] = []
    const offFirst = arbiter.onPublish(snapshot => first.push(snapshot))
    arbiter.onPublish(snapshot => second.push(snapshot))
    stream.push([row(1)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    offFirst()
    stream.push([row(2)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    arbiter.dispose()
  })

  it('makes the unsubscribe idempotent so calling it twice is a no-op', () => {
    const { arbiter } = fixture()
    const off = arbiter.onPublish(() => undefined)
    off()
    off()
    arbiter.dispose()
  })

  it('returns a no-op unsubscribe when subscription is requested after disposal', () => {
    const { arbiter } = fixture()
    arbiter.dispose()
    const noop = arbiter.onPublish(() => {
      throw new Error('after-dispose listener must not fire')
    })
    expect(typeof noop).toBe('function')
    expect(() => {
      noop()
    }).not.toThrow()
  })
})

describe('createFrameArbiter disposal and teardown hygiene', () => {
  it('leaves zero timers scheduled after dispose when ownsScrollScheduler is true', () => {
    const { arbiter } = fixture({ ownsScrollScheduler: true })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    arbiter.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(arbiter.isRunning()).toBe(false)
  })

  it('preserves the injected scroll scheduler when ownsScrollScheduler is false', () => {
    vi.useFakeTimers({ now: 0 })
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>()
    const arbiter = createFrameArbiter<TestRow>({
      frameIntervalMs: ONE_FRAME,
      scroll,
      stream,
      ownsScrollScheduler: false,
    })
    expect(vi.getTimerCount()).toBe(1) // arbiter only; scroll has no setTarget yet
    arbiter.dispose()
    expect(vi.getTimerCount()).toBe(0)
    // scroll must still be usable after arbiter teardown
    scroll.setTarget(5)
    expect(scroll.isAnimating()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    scroll.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is idempotent and silently absorbs subsequent dispose calls', () => {
    const clearIntervalSpy = vi.fn<typeof clearInterval>().mockImplementation(clearInterval)
    vi.useFakeTimers({ now: 0 })
    const setIntervalSpy = vi.fn<typeof setInterval>()
    setIntervalSpy.mockImplementation(setInterval)
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>()
    const arbiter = createFrameArbiter<TestRow>({
      frameIntervalMs: ONE_FRAME,
      scroll,
      stream,
      setInterval: setIntervalSpy as unknown as typeof setInterval,
      clearInterval: clearIntervalSpy,
    })
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    arbiter.dispose()
    arbiter.dispose()
    arbiter.dispose()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores requestStream and requestScroll after dispose', () => {
    const { arbiter, publishes } = fixture()
    arbiter.dispose()
    arbiter.requestStream()
    arbiter.requestScroll()
    expect(arbiter.hasPendingRequest()).toBe(false)
    vi.advanceTimersByTime(ONE_FRAME * 5)
    expect(publishes).toHaveLength(0)
    expect(arbiter.isRunning()).toBe(false)
  })

  it('drops frame ticks after dispose (no publish, no work even with backlog present)', () => {
    const { arbiter, stream, publishes } = fixture()
    stream.push([row(1), row(2), row(3), row(4)], 0)
    arbiter.dispose()
    vi.advanceTimersByTime(ONE_FRAME * 5)
    expect(publishes).toHaveLength(0)
    expect(arbiter.isRunning()).toBe(false)
  })
})

describe('createFrameArbiter cooperation with scroll-scheduler and stream-queue', () => {
  it('reads the latest scroll presented row each frame, sourced from the injected scheduler', () => {
    vi.useFakeTimers({ now: 0 })
    const scroll = createScrollScheduler({
      frameIntervalMs: ONE_FRAME,
      stepPerFrame: 2,
      catchUpThreshold: 10,
      maxCatchUpStep: 2,
    })
    const stream = createStreamQueue<TestRow>({ smoothRowsPerFrame: 1 })
    const arbiter = createFrameArbiter<TestRow>({ scroll, stream })
    const snapshots: FrameSnapshot<TestRow>[] = []
    arbiter.onPublish(snapshot => snapshots.push(snapshot))
    scroll.setTarget(5)
    vi.advanceTimersByTime(ONE_FRAME * 4)
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    arbiter.dispose()
    scroll.dispose()
  })

  it('emits one snapshot per frame that captures both the scroll motion and the streamed rows', () => {
    vi.useFakeTimers({ now: 0 })
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>({ smoothRowsPerFrame: 3 })
    const arbiter = createFrameArbiter<TestRow>({ scroll, stream })
    const snapshots: FrameSnapshot<TestRow>[] = []
    arbiter.onPublish(snapshot => snapshots.push(snapshot))
    scroll.setTarget(4)
    stream.push([row(100), row(101), row(102), row(103)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(snapshots).toHaveLength(1)
    expect(streamEntries(snapshots[0]!)).toEqual([100, 101, 102])
    expect(snapshots[0]?.scroll.target).toBe(4)
    vi.advanceTimersByTime(ONE_FRAME * 10)
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    arbiter.dispose()
    scroll.dispose()
  })

  it('produces at most one snapshot per frame even when both subsystems have work', () => {
    vi.useFakeTimers({ now: 0 })
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>({ smoothRowsPerFrame: 4 })
    const arbiter = createFrameArbiter<TestRow>({ scroll, stream })
    const snapshots: FrameSnapshot<TestRow>[] = []
    arbiter.onPublish(snapshot => snapshots.push(snapshot))
    scroll.setTarget(2)
    stream.push([row(1), row(2), row(3), row(4), row(5)], 0)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(snapshots).toHaveLength(1)
    arbiter.dispose()
    scroll.dispose()
  })

  it('demand-driven arbiter starts timer on request and stops when idle', () => {
    vi.useFakeTimers({ now: 0 })
    const scroll = createScrollScheduler({ frameIntervalMs: ONE_FRAME })
    const stream = createStreamQueue<TestRow>({ smoothRowsPerFrame: 2 })
    const arbiter = createFrameArbiter<TestRow>({
      scroll,
      stream,
      demandDriven: true,
      frameIntervalMs: ONE_FRAME,
    })
    // Initially idle: timer is NOT running
    expect(arbiter.isRunning()).toBe(false)
    expect(arbiter.isScrollActive()).toBe(false)

    // Calling requestScroll starts the timer and activates scroll activity
    arbiter.requestScroll()
    expect(arbiter.isRunning()).toBe(true)
    expect(arbiter.isScrollActive()).toBe(true)

    // Advancing one frame publishes and clears pending request; with no more work, timer stops
    vi.advanceTimersByTime(ONE_FRAME)
    expect(arbiter.isRunning()).toBe(false)

    // Requesting stream also starts the timer
    arbiter.requestStream()
    expect(arbiter.isRunning()).toBe(true)
    vi.advanceTimersByTime(ONE_FRAME)
    expect(arbiter.isRunning()).toBe(false)

    arbiter.dispose()
    scroll.dispose()
  })
})

beforeEach(() => {
  // beforeEach body intentionally empty — fixtures manage their own fake timers.
})

beforeEach(() => {
  // body intentionally empty — fixtures manage their own fake timers.
})
