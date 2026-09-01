/**
 * ScrollScheduler: latest-target physical-row catch-up over a configurable
 * frame clock, with distance-adaptive step, snap for edge commands and
 * no leftover timer after dispose. All tests use vi fake timers so the
 * internal `setInterval` injection stays wired to the host test runner.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createScrollScheduler,
  SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD,
  SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS,
  SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP,
  SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME,
} from '../src/scroll-scheduler.ts'
import type { ScrollScheduler } from '../src/scroll-scheduler.ts'

const FRAME_MS = SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS

afterEach(() => {
  vi.useRealTimers()
})

function start(): ScrollScheduler {
  vi.useFakeTimers()
  return createScrollScheduler({
    frameIntervalMs: FRAME_MS,
    stepPerFrame: SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME,
    catchUpThreshold: SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD,
    maxCatchUpStep: SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP,
  })
}

describe('createScrollScheduler defaults', () => {
  it('starts at row 0 with no animation', () => {
    const scheduler = createScrollScheduler()
    expect(scheduler.getPresented()).toBe(0)
    expect(scheduler.getTarget()).toBe(0)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })

  it('honors an initial position', () => {
    const scheduler = createScrollScheduler({ initialPosition: 42 })
    expect(scheduler.getPresented()).toBe(42)
    expect(scheduler.getTarget()).toBe(42)
    scheduler.dispose()
  })

  it('keeps the published default constants in sync with the constructor', () => {
    expect(SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS).toBe(16)
    expect(SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME).toBe(1)
    expect(SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD).toBe(10)
    expect(SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP).toBe(8)
  })
})

describe('createScrollScheduler single-line key pacing', () => {
  it('moves exactly one row on the next frame for a one-row key', () => {
    const scheduler = start()
    scheduler.setTarget(1)
    expect(scheduler.isAnimating()).toBe(true)
    expect(scheduler.getPresented()).toBe(0)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(1)
    expect(scheduler.getTarget()).toBe(1)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })

  it('settles smoothly across many single-row keys without overshoot', () => {
    const scheduler = start()
    for (let index = 1; index <= 5; index += 1) {
      scheduler.setTarget(index)
      vi.advanceTimersByTime(FRAME_MS)
      expect(scheduler.getPresented()).toBe(index)
    }
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })
})

describe('createScrollScheduler wheel-burst coalescing', () => {
  it('keeps only the latest target when multiple inputs land in the same tick', () => {
    const scheduler = start()
    scheduler.setTarget(8)
    scheduler.setTarget(12)
    scheduler.setTarget(3)
    expect(scheduler.getTarget()).toBe(3)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(1)
    vi.advanceTimersByTime(FRAME_MS * 2)
    expect(scheduler.getPresented()).toBe(3)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })

  it('never replays intermediate targets once a newer one arrives', () => {
    const scheduler = start()
    scheduler.setTarget(50)
    scheduler.setTarget(-50)
    expect(scheduler.getTarget()).toBe(-50)
    vi.advanceTimersByTime(FRAME_MS * 200)
    expect(scheduler.getPresented()).toBe(-50)
    expect(scheduler.getTarget()).toBe(-50)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })
})

describe('createScrollScheduler direction reversal', () => {
  it('replaces the target on the next input without waiting for prior motion', () => {
    const scheduler = start()
    scheduler.setTarget(50)
    vi.advanceTimersByTime(FRAME_MS * 5)
    const midMotion = scheduler.getPresented()
    expect(midMotion).toBeGreaterThan(0)
    expect(midMotion).toBeLessThan(50)
    scheduler.setTarget(-30)
    expect(scheduler.getTarget()).toBe(-30)
    expect(scheduler.isAnimating()).toBe(true)
    vi.advanceTimersByTime(FRAME_MS * 200)
    expect(scheduler.getPresented()).toBe(-30)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })
})

describe('createScrollScheduler release-after-settle stillness', () => {
  it('stops producing ticks once presented reaches the target', () => {
    const scheduler = start()
    scheduler.setTarget(4)
    vi.advanceTimersByTime(FRAME_MS * 4)
    expect(scheduler.getPresented()).toBe(4)
    expect(scheduler.isAnimating()).toBe(false)
    vi.advanceTimersByTime(FRAME_MS * 100)
    expect(scheduler.getPresented()).toBe(4)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })

  it('stops the timer immediately when setTarget matches the presented row', () => {
    const scheduler = start()
    scheduler.setTarget(50)
    expect(scheduler.isAnimating()).toBe(true)
    scheduler.setTarget(0)
    expect(scheduler.isAnimating()).toBe(false)
    expect(scheduler.getTarget()).toBe(0)
    expect(scheduler.getPresented()).toBe(0)
    scheduler.dispose()
  })
})

describe('createScrollScheduler snap commands', () => {
  it('snaps both presented and target to the requested row', () => {
    const scheduler = start()
    scheduler.setTarget(40)
    scheduler.snapTo(7)
    expect(scheduler.getPresented()).toBe(7)
    expect(scheduler.getTarget()).toBe(7)
    expect(scheduler.isAnimating()).toBe(false)
    vi.advanceTimersByTime(FRAME_MS * 50)
    expect(scheduler.getPresented()).toBe(7)
    scheduler.dispose()
  })

  it('cancels in-flight motion immediately on snap', () => {
    const scheduler = start()
    scheduler.setTarget(99)
    vi.advanceTimersByTime(FRAME_MS * 3)
    scheduler.snapTo(0)
    expect(scheduler.getPresented()).toBe(0)
    expect(scheduler.getTarget()).toBe(0)
    expect(scheduler.isAnimating()).toBe(false)
    vi.advanceTimersByTime(FRAME_MS * 50)
    expect(scheduler.getPresented()).toBe(0)
    scheduler.dispose()
  })

  it('treats snap as a no-op while already at the destination', () => {
    const scheduler = start()
    scheduler.snapTo(12)
    expect(scheduler.getPresented()).toBe(12)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })
})

describe('createScrollScheduler distance-adaptive catch-up', () => {
  it('uses stepPerFrame inside the smooth band', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({
      frameIntervalMs: FRAME_MS,
      stepPerFrame: 2,
      catchUpThreshold: 10,
      maxCatchUpStep: 8,
      initialPosition: 100,
    })
    scheduler.setTarget(106)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(102)
    vi.advanceTimersByTime(FRAME_MS * 2)
    expect(scheduler.getPresented()).toBe(106)
    scheduler.dispose()
  })

  it('switches to maxCatchUpStep once the distance exceeds the threshold', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({
      frameIntervalMs: FRAME_MS,
      stepPerFrame: 1,
      catchUpThreshold: 10,
      maxCatchUpStep: 8,
    })
    scheduler.setTarget(200)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(8)
    vi.advanceTimersByTime(FRAME_MS * 10)
    expect(scheduler.getPresented()).toBe(88)
    scheduler.dispose()
  })

  it('caps the final tick at the remaining distance without overshoot', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({
      frameIntervalMs: FRAME_MS,
      stepPerFrame: 1,
      catchUpThreshold: 10,
      maxCatchUpStep: 8,
    })
    scheduler.setTarget(5)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(1)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(2)
    vi.advanceTimersByTime(FRAME_MS * 10)
    expect(scheduler.getPresented()).toBe(5)
    expect(scheduler.isAnimating()).toBe(false)
    scheduler.dispose()
  })

  it('walks backward with the same per-tick cadence', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({
      frameIntervalMs: FRAME_MS,
      stepPerFrame: 1,
      catchUpThreshold: 10,
      maxCatchUpStep: 8,
      initialPosition: 0,
    })
    scheduler.setTarget(-20)
    vi.advanceTimersByTime(FRAME_MS)
    expect(scheduler.getPresented()).toBe(-8)
    vi.advanceTimersByTime(FRAME_MS * 5)
    expect(scheduler.getPresented()).toBe(-20)
    scheduler.dispose()
  })
})

describe('createScrollScheduler manual tick', () => {
  it('advances one step per tick without driving the timer', () => {
    const scheduler = createScrollScheduler({
      frameIntervalMs: FRAME_MS,
      stepPerFrame: 3,
      catchUpThreshold: 10,
      maxCatchUpStep: 8,
    })
    scheduler.setTarget(9)
    expect(scheduler.isAnimating()).toBe(true)
    expect(scheduler.tick()).toBe(3)
    expect(scheduler.isAnimating()).toBe(true)
    expect(scheduler.tick()).toBe(6)
    expect(scheduler.tick()).toBe(9)
    expect(scheduler.isAnimating()).toBe(false)
    expect(scheduler.tick()).toBe(9)
    scheduler.dispose()
  })

  it('returns the current presented row without advancing when already at target', () => {
    const scheduler = createScrollScheduler({ initialPosition: 8 })
    expect(scheduler.tick()).toBe(8)
    scheduler.dispose()
  })
})

describe('createScrollScheduler dispose hygiene', () => {
  it('leaves zero timers scheduled after dispose', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({ frameIntervalMs: FRAME_MS })
    scheduler.setTarget(50)
    expect(vi.getTimerCount()).toBe(1)
    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(scheduler.isAnimating()).toBe(false)
    vi.advanceTimersByTime(FRAME_MS * 100)
    expect(scheduler.getPresented()).toBe(0)
  })

  it('clears the timer even when no motion is pending', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({ frameIntervalMs: FRAME_MS })
    expect(vi.getTimerCount()).toBe(0)
    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores further commands after dispose', () => {
    const scheduler = createScrollScheduler({ frameIntervalMs: FRAME_MS })
    scheduler.dispose()
    scheduler.setTarget(20)
    scheduler.snapTo(30)
    scheduler.tick()
    expect(scheduler.getPresented()).toBe(0)
    expect(scheduler.getTarget()).toBe(0)
  })
})

describe('createScrollScheduler shared-frame mode', () => {
  it('owns no timer and advances only when the arbiter calls tick', () => {
    vi.useFakeTimers()
    const scheduler = createScrollScheduler({ autoSchedule: false })
    scheduler.setTarget(3)
    expect(vi.getTimerCount()).toBe(0)
    expect(scheduler.getPresented()).toBe(0)
    expect(scheduler.tick()).toBe(1)
    scheduler.dispose()
  })

  it('rebases presented and target together through an anchor shift', () => {
    const scheduler = createScrollScheduler({ autoSchedule: false, initialPosition: 4 })
    scheduler.setTarget(10)
    scheduler.rebase(5, 20)
    expect(scheduler.getPresented()).toBe(9)
    expect(scheduler.getTarget()).toBe(15)
    scheduler.rebase(100, 12)
    expect(scheduler.getPresented()).toBe(12)
    expect(scheduler.getTarget()).toBe(12)
    scheduler.dispose()
  })
})
