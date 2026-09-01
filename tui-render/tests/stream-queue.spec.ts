/**
 * StreamQueue: pure-data smooth/catch-up presentation queue with hysteresis
 * on depth, oldest-row age and externally-reported drain pressure. Every
 * time value is supplied by the caller so the suite stays deterministic.
 */

import { describe, expect, it } from 'vitest'
import { createStreamQueue } from '../src/stream-queue.ts'
import type { StreamQueue, StreamQueueStats } from '../src/stream-queue.ts'

interface TestRow {
  readonly id: number
}

function rows(...ids: number[]): readonly TestRow[] {
  return ids.map(id => ({ id }))
}

function ids(values: readonly TestRow[]): number[] {
  return values.map(row => row.id)
}

describe('createStreamQueue smooth mode', () => {
  it('starts in smooth mode and exposes up to smoothRowsPerFrame rows per tick', () => {
    const queue = createStreamQueue<TestRow>({ smoothRowsPerFrame: 3 })
    queue.push(rows(1, 2, 3, 4, 5), 0)
    expect(ids(queue.tick(0))).toEqual([1, 2, 3])
    expect(ids(queue.tick(0))).toEqual([4, 5])
    expect(queue.tick(0)).toEqual([])
    expect(queue.getMode()).toBe('smooth')
  })

  it('keeps pushed rows in FIFO order across multiple ticks', () => {
    const queue = createStreamQueue<TestRow>({ smoothRowsPerFrame: 1 })
    queue.push(rows(10, 20), 0)
    queue.push(rows(30), 0)
    expect(ids(queue.tick(0))).toEqual([10])
    expect(ids(queue.tick(0))).toEqual([20])
    expect(ids(queue.tick(0))).toEqual([30])
  })

  it('reports empty age and zero recovery when the queue is empty', () => {
    const queue = createStreamQueue<TestRow>()
    const stats: StreamQueueStats = queue.getStats(1_000)
    expect(stats).toEqual({
      mode: 'smooth',
      depth: 0,
      oldestAgeMs: 0,
      drainPressureMs: 0,
      recoveringForMs: 0,
    })
  })

  it('reports the age of the oldest buffered row', () => {
    const queue = createStreamQueue<TestRow>({ smoothRowsPerFrame: 1 })
    queue.push(rows(1, 2), 100)
    const stats = queue.getStats(350)
    expect(stats.oldestAgeMs).toBe(250)
    expect(stats.depth).toBe(2)
  })

  it('returns no rows when the queue is empty', () => {
    const queue = createStreamQueue<TestRow>()
    expect(queue.tick(0)).toEqual([])
    expect(queue.getMode()).toBe('smooth')
  })
})

describe('createStreamQueue catch-up entry thresholds', () => {
  it('enters catch-up when depth crosses entryDepth', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 3,
      exitDepth: 1,
      recoveryDebounceMs: 50,
    })
    queue.push(rows(1, 2, 3, 4, 5, 6, 7, 8), 0)
    expect(ids(queue.tick(0))).toEqual([1, 2, 3, 4])
    expect(queue.getMode()).toBe('catch-up')
  })

  it('enters catch-up when oldest-row age crosses maxOldestAgeMs', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 1_000,
      exitDepth: 500,
      maxOldestAgeMs: 100,
      exitOldestAgeMs: 50,
      recoveryDebounceMs: 50,
    })
    queue.push(rows(1, 2), 0)
    queue.tick(80) // age 80 ≤ 100, smooth
    expect(queue.getMode()).toBe('smooth')
    queue.tick(120) // age 120 > 100, catch-up
    expect(queue.getMode()).toBe('catch-up')
  })

  it('enters catch-up when drain pressure crosses drainBackpressureMs', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 1_000,
      exitDepth: 500,
      drainBackpressureMs: 100,
      exitDrainBackpressureMs: 50,
      recoveryDebounceMs: 50,
    })
    queue.push(rows(1, 2), 0)
    queue.noteDrain(80)
    queue.tick(0) // drain 80 ≤ 100, smooth
    expect(queue.getMode()).toBe('smooth')
    queue.noteDrain(150)
    queue.tick(0)
    expect(queue.getMode()).toBe('catch-up')
  })

  it('clamps negative drain pressure to zero', () => {
    const queue = createStreamQueue<TestRow>()
    queue.noteDrain(-25)
    expect(queue.getStats(0).drainPressureMs).toBe(0)
  })
})

describe('createStreamQueue catch-up exit hysteresis', () => {
  it('stays in catch-up while still inside the recovery debounce window', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 2,
      exitDepth: 1,
      maxOldestAgeMs: 100,
      exitOldestAgeMs: 50,
      drainBackpressureMs: 100,
      exitDrainBackpressureMs: 50,
      recoveryDebounceMs: 50,
    })
    queue.push(rows(1, 2, 3), 0)
    queue.tick(200) // catch-up entered; queue emptied by 4-row budget
    expect(queue.getMode()).toBe('catch-up')
    queue.tick(250) // recovery timer starts here
    expect(queue.getMode()).toBe('catch-up')
    queue.tick(280) // 30ms past start; < 50ms debounce
    expect(queue.getMode()).toBe('catch-up')
    queue.tick(320) // 70ms past start; >= 50ms debounce
    expect(queue.getMode()).toBe('smooth')
  })

  it('does not exit catch-up while the drain pressure remains above the exit threshold', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 2,
      exitDepth: 1,
      drainBackpressureMs: 50,
      exitDrainBackpressureMs: 20,
      recoveryDebounceMs: 30,
    })
    queue.push(rows(1, 2, 3), 0)
    queue.noteDrain(100)
    queue.tick(0)
    expect(queue.getMode()).toBe('catch-up')
    queue.noteDrain(10)
    queue.tick(10) // recovery starts
    expect(queue.getMode()).toBe('catch-up') // 0ms past start; < 30ms
    queue.tick(35) // 25ms past start; < 30ms
    expect(queue.getMode()).toBe('catch-up')
    queue.tick(50) // 40ms past start; >= 30ms; drain low; depth low
    expect(queue.getMode()).toBe('smooth')
  })

  it('resets the recovery timer when a signal bounces above its exit threshold', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 2,
      exitDepth: 1,
      drainBackpressureMs: 50,
      exitDrainBackpressureMs: 20,
      recoveryDebounceMs: 100,
    })
    queue.push(rows(1, 2, 3), 0)
    queue.noteDrain(100)
    queue.tick(0) // catch-up
    expect(queue.getMode()).toBe('catch-up')
    queue.noteDrain(0)
    queue.tick(20) // recovery starts at t=20
    queue.tick(60) // 40ms past start
    expect(queue.getStats(60).recoveringForMs).toBe(40)
    queue.noteDrain(80) // pressure back above exit threshold
    queue.tick(80) // underExit false; recovery timer cleared
    expect(queue.getStats(80).recoveringForMs).toBe(0)
    queue.noteDrain(0)
    queue.tick(120) // fresh recovery starts at t=120
    queue.tick(200) // 80ms past start; < 100ms debounce
    expect(queue.getMode()).toBe('catch-up')
    queue.tick(250) // 130ms past start; >= 100ms debounce
    expect(queue.getMode()).toBe('smooth')
  })
})

describe('createStreamQueue severe backlog bound', () => {
  it('drops obsolete oldest presentations when an owner supplies a hard bound', () => {
    const queue = createStreamQueue<TestRow>({
      maxDepth: 3,
      smoothRowsPerFrame: 3,
    })
    queue.push(rows(1, 2, 3, 4, 5), 0)
    expect(ids(queue.tick(0))).toEqual([3, 4, 5])
  })

  it('publishes at most catchUpRowsPerFrame rows per tick even with a huge backlog', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 8,
      entryDepth: 4,
      exitDepth: 2,
    })
    const huge: TestRow[] = []
    for (let index = 0; index < 1_000; index += 1) huge.push({ id: index })
    queue.push(huge, 0)
    // First tick: updateMode flips to catch-up and the budget caps the dequeue.
    const firstTick = queue.tick(0)
    expect(firstTick).toHaveLength(8)
    expect(queue.getMode()).toBe('catch-up')
    const secondTick = queue.tick(0)
    expect(secondTick).toHaveLength(8)
    expect(queue.getMode()).toBe('catch-up')
  })

  it('still drains every backlogged row eventually across enough ticks', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 5,
      entryDepth: 3,
      exitDepth: 1,
      recoveryDebounceMs: 10,
    })
    const huge: TestRow[] = []
    for (let index = 0; index < 50; index += 1) huge.push({ id: index })
    queue.push(huge, 0)
    const collected: number[] = []
    for (let tick = 0; tick < 20; tick += 1) {
      const ready = queue.tick(tick * 16)
      for (const row of ready) collected.push(row.id)
    }
    expect(collected).toHaveLength(50)
    expect(collected[0]).toBe(0)
    expect(collected[49]).toBe(49)
    expect(queue.getStats(500).depth).toBe(0)
  })
})

describe('createStreamQueue pullReady and flush', () => {
  it('lets callers dequeue without consulting the current mode', () => {
    const queue: StreamQueue<TestRow> = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 2,
      exitDepth: 1,
    })
    queue.push(rows(1, 2, 3), 0)
    expect(ids(queue.pullReady(2))).toEqual([1, 2])
    expect(queue.getMode()).toBe('smooth')
  })

  it('returns an empty array when pullReady exceeds the queue depth', () => {
    const queue = createStreamQueue<TestRow>()
    queue.push(rows(1), 0)
    expect(queue.pullReady(0)).toEqual([])
    expect(ids(queue.pullReady(5))).toEqual([1])
    expect(ids(queue.pullReady(5))).toEqual([])
  })

  it('flushes every buffered row and resets the recovery timer', () => {
    const queue = createStreamQueue<TestRow>({
      smoothRowsPerFrame: 1,
      catchUpRowsPerFrame: 4,
      entryDepth: 2,
      exitDepth: 1,
      exitOldestAgeMs: 1_000,
      drainBackpressureMs: 50,
      exitDrainBackpressureMs: 20,
      recoveryDebounceMs: 100,
    })
    queue.push(rows(1, 2, 3, 4, 5), 0)
    queue.noteDrain(100)
    queue.tick(0) // catch-up; dequeue 4 rows; queue = [5]
    expect(queue.getMode()).toBe('catch-up')
    queue.noteDrain(0)
    queue.tick(10) // recovery starts at t=10; dequeues remaining row
    queue.tick(60) // 50ms past start
    expect(queue.getStats(60).recoveringForMs).toBe(50)
    queue.push(rows(6), 100) // add a row that survives no ticks before flush
    const drained = queue.flush()
    expect(ids(drained)).toEqual([6])
    expect(queue.getStats(1_000).depth).toBe(0)
    expect(queue.getStats(1_000).recoveringForMs).toBe(0)
    expect(queue.getMode()).toBe('catch-up')
  })
})

describe('createStreamQueue default constants', () => {
  it('uses the documented defaults for smooth rows per frame', () => {
    const queue = createStreamQueue<TestRow>()
    queue.push(rows(1, 2, 3, 4), 0)
    expect(ids(queue.tick(0))).toEqual([1, 2])
  })
})
