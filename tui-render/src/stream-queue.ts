/**
 * Pure-data smooth/catch-up presentation queue.
 *
 * The presentation scheduler decides how many complete rows to expose to
 * the viewport each frame based on three pressure signals:
 *   1. queue depth (rows waiting to be presented);
 *   2. oldest row age (how long the head row has been waiting);
 *   3. stdout drain pressure (externally reported via {@link StreamQueue.noteDrain}).
 *
 * Mode transitions use hysteresis: entry uses one threshold set, exit uses
 * a stricter set, and exit waits for a debounce period so a single low
 * sample does not flap the queue back to smooth. Per-frame work is bounded
 * and configurable in both modes.
 *
 * Pure data: no I/O, no persistence, no model-lifecycle coupling. The
 * caller supplies time as a parameter so the queue never reads a clock;
 * rows are opaque so the queue does not know their content. Authority over
 * canonical source, session events and provider deltas stays with the
 * controller; this module only meters presentation.
 *
 * @module @deepseek-ai/dsh-tui-render/stream-queue
 */

/** Default per-frame cadence hint (informational; the queue is externally driven). */
export const STREAM_QUEUE_DEFAULT_FRAME_INTERVAL_MS = 16
/** Default rows published per frame in smooth mode. */
export const STREAM_QUEUE_DEFAULT_SMOOTH_ROWS_PER_FRAME = 2
/** Default rows published per frame in catch-up mode. */
export const STREAM_QUEUE_DEFAULT_CATCH_UP_ROWS_PER_FRAME = 16
/** Default depth threshold that triggers catch-up entry. */
export const STREAM_QUEUE_DEFAULT_ENTRY_DEPTH = 64
/** Default depth threshold that counts as "low" for catch-up exit. */
export const STREAM_QUEUE_DEFAULT_EXIT_DEPTH = 32
/** Default oldest-row-age threshold that triggers catch-up entry (milliseconds). */
export const STREAM_QUEUE_DEFAULT_MAX_OLDEST_AGE_MS = 500
/** Default oldest-row-age threshold that counts as "low" for catch-up exit (milliseconds). */
export const STREAM_QUEUE_DEFAULT_EXIT_OLDEST_AGE_MS = 250
/** Default drain-pressure threshold that triggers catch-up entry (milliseconds). */
export const STREAM_QUEUE_DEFAULT_DRAIN_BACKPRESSURE_MS = 100
/** Default drain-pressure threshold that counts as "low" for catch-up exit (milliseconds). */
export const STREAM_QUEUE_DEFAULT_EXIT_DRAIN_BACKPRESSURE_MS = 50
/** Default continuous low-pressure duration required to exit catch-up (milliseconds). */
export const STREAM_QUEUE_DEFAULT_RECOVERY_DEBOUNCE_MS = 100

/** Construction options for {@link createStreamQueue}. */
export interface StreamQueueOptions {
  /** Per-frame cadence hint (informational; the queue is externally driven). */
  readonly frameIntervalMs?: number
  /** Rows published per frame in smooth mode; defaults to {@link STREAM_QUEUE_DEFAULT_SMOOTH_ROWS_PER_FRAME}. */
  readonly smoothRowsPerFrame?: number
  /** Rows published per frame in catch-up mode; defaults to {@link STREAM_QUEUE_DEFAULT_CATCH_UP_ROWS_PER_FRAME}. */
  readonly catchUpRowsPerFrame?: number
  /** Depth threshold that triggers catch-up entry; defaults to {@link STREAM_QUEUE_DEFAULT_ENTRY_DEPTH}. */
  readonly entryDepth?: number
  /** Depth threshold that counts as "low" for catch-up exit; defaults to {@link STREAM_QUEUE_DEFAULT_EXIT_DEPTH}. */
  readonly exitDepth?: number
  /** Oldest-row-age threshold that triggers catch-up entry; defaults to {@link STREAM_QUEUE_DEFAULT_MAX_OLDEST_AGE_MS}. */
  readonly maxOldestAgeMs?: number
  /** Oldest-row-age threshold that counts as "low" for catch-up exit; defaults to {@link STREAM_QUEUE_DEFAULT_EXIT_OLDEST_AGE_MS}. */
  readonly exitOldestAgeMs?: number
  /** Drain-pressure threshold that triggers catch-up entry; defaults to {@link STREAM_QUEUE_DEFAULT_DRAIN_BACKPRESSURE_MS}. */
  readonly drainBackpressureMs?: number
  /** Drain-pressure threshold that counts as "low" for catch-up exit. */
  readonly exitDrainBackpressureMs?: number
  /** Continuous low-pressure duration required to exit catch-up; defaults to {@link STREAM_QUEUE_DEFAULT_RECOVERY_DEBOUNCE_MS}. */
  readonly recoveryDebounceMs?: number
  /** Optional hard presentation backlog bound; oldest obsolete rows drop first. */
  readonly maxDepth?: number
}

/** Presentation mode selected by the hysteresis check on each tick. */
export type StreamQueueMode = 'smooth' | 'catch-up'

/** Snapshot of queue state for observability and test assertions. */
export interface StreamQueueStats {
  /** Current presentation mode. */
  readonly mode: StreamQueueMode
  /** Rows currently buffered (waiting to be presented). */
  readonly depth: number
  /** Age of the oldest buffered row in milliseconds; 0 when the queue is empty. */
  readonly oldestAgeMs: number
  /** Latest reported stdout drain pressure in milliseconds. */
  readonly drainPressureMs: number
  /** Time spent continuously below the exit thresholds; 0 when not recovering. */
  readonly recoveringForMs: number
}

/** One buffered row plus the time it was enqueued. */
interface StreamQueueEntry<T> {
  readonly row: T
  readonly enqueuedAtMs: number
}

/** Pure-data smooth/catch-up presentation queue handle. */
export interface StreamQueue<T> {
  /**
   * Append new rows to the back of the queue. Callers feed deltas here as
   * soon as they are produced; presentation is metered by `tick`.
   * @param rows - rows to enqueue (preserves order).
   * @param nowMs - current time in milliseconds; stamps `oldestAgeMs`.
   */
  push(rows: readonly T[], nowMs: number): void
  /**
   * Remove and return up to `max` rows from the front. Does not consult the
   * current mode; callers normally use {@link tick} instead so the mode
   * also advances and the per-frame budget is enforced.
   * @param max - maximum rows to dequeue.
   * @returns the dequeued rows in FIFO order.
   */
  pullReady(max: number): readonly T[]
  /**
   * Report the current stdout drain pressure. The queue treats the value
   * as "how long the sink has been backed up" and compares it against the
   * configured drain thresholds.
   * @param pressureMs - drain pressure in milliseconds (clamped to ≥ 0).
   */
  noteDrain(pressureMs: number): void
  /** Current presentation mode. */
  getMode(): StreamQueueMode
  /**
   * Snapshot of queue state for observability and test assertions.
   * @param nowMs - current time in milliseconds.
   */
  getStats(nowMs: number): StreamQueueStats
  /**
   * Advance the mode and dequeue the rows to present this frame.
   * @param nowMs - current time in milliseconds; drives age and hysteresis.
   * @returns the rows to publish this frame (length is mode-bounded).
   */
  tick(nowMs: number): readonly T[]
  /** Discard all buffered rows without publishing them. */
  flush(): readonly T[]
}

/**
 * Create a pure-data smooth/catch-up presentation queue.
 * @param options - per-frame budgets, entry/exit thresholds and recovery debounce.
 * @returns the queue handle.
 */
export function createStreamQueue<T>(
  options: StreamQueueOptions = {},
): StreamQueue<T> {
  const smoothRowsPerFrame = options.smoothRowsPerFrame
    ?? STREAM_QUEUE_DEFAULT_SMOOTH_ROWS_PER_FRAME
  const catchUpRowsPerFrame = options.catchUpRowsPerFrame
    ?? STREAM_QUEUE_DEFAULT_CATCH_UP_ROWS_PER_FRAME
  const entryDepth = options.entryDepth ?? STREAM_QUEUE_DEFAULT_ENTRY_DEPTH
  const exitDepth = options.exitDepth ?? STREAM_QUEUE_DEFAULT_EXIT_DEPTH
  const maxOldestAgeMs = options.maxOldestAgeMs ?? STREAM_QUEUE_DEFAULT_MAX_OLDEST_AGE_MS
  const exitOldestAgeMs = options.exitOldestAgeMs
    ?? STREAM_QUEUE_DEFAULT_EXIT_OLDEST_AGE_MS
  const drainBackpressureMs = options.drainBackpressureMs
    ?? STREAM_QUEUE_DEFAULT_DRAIN_BACKPRESSURE_MS
  const exitDrainBackpressureMs = options.exitDrainBackpressureMs
    ?? STREAM_QUEUE_DEFAULT_EXIT_DRAIN_BACKPRESSURE_MS
  const recoveryDebounceMs = options.recoveryDebounceMs
    ?? STREAM_QUEUE_DEFAULT_RECOVERY_DEBOUNCE_MS
  const maxDepth = options.maxDepth

  const queue: StreamQueueEntry<T>[] = []
  let mode: StreamQueueMode = 'smooth'
  let drainPressureMs = 0
  let recoveringSinceMs: number | undefined

  /**
   * Age of the head row in milliseconds.
   * @param nowMs - current time in milliseconds.
   * @returns 0 when the queue is empty, otherwise `nowMs - head.enqueuedAtMs`.
   */
  function ageMs(nowMs: number): number {
    const head = queue[0]
    if (head === undefined) return 0
    return Math.max(0, nowMs - head.enqueuedAtMs)
  }

  /**
   * Whether any pressure signal exceeds its entry threshold.
   * @param nowMs - current time in milliseconds (for age).
   * @returns `true` when catch-up should engage.
   */
  function inCatchUp(nowMs: number): boolean {
    return queue.length > entryDepth
      || ageMs(nowMs) > maxOldestAgeMs
      || drainPressureMs > drainBackpressureMs
  }

  /**
   * Whether every pressure signal is at or below its exit threshold.
   * @param nowMs - current time in milliseconds (for age).
   * @returns `true` when all signals are quiet enough to consider recovery.
   */
  function underExit(nowMs: number): boolean {
    return queue.length <= exitDepth
      && ageMs(nowMs) <= exitOldestAgeMs
      && drainPressureMs <= exitDrainBackpressureMs
  }

  /**
   * Advance the hysteresis state machine one step.
   * @param nowMs - current time in milliseconds (for recovery debounce).
   */
  function updateMode(nowMs: number): void {
    if (mode === 'smooth') {
      if (inCatchUp(nowMs)) {
        mode = 'catch-up'
        recoveringSinceMs = undefined
      }
      return
    }
    if (underExit(nowMs)) {
      if (recoveringSinceMs === undefined) {
        recoveringSinceMs = nowMs
      } else if (nowMs - recoveringSinceMs >= recoveryDebounceMs) {
        mode = 'smooth'
        recoveringSinceMs = undefined
      }
    } else {
      recoveringSinceMs = undefined
    }
  }

  /** Per-frame work budget for the current mode. */
  function budget(): number {
    return mode === 'catch-up' ? catchUpRowsPerFrame : smoothRowsPerFrame
  }

  /**
   * Remove and return up to `max` rows from the front of the queue.
   * @param max - cap on rows to dequeue.
   * @returns dequeued rows in FIFO order.
   */
  function dequeue(max: number): T[] {
    if (max <= 0 || queue.length === 0) return []
    const count = Math.min(max, queue.length)
    return queue.splice(0, count).map(entry => entry.row)
  }

  return {
    push(rows, nowMs) {
      for (const row of rows) {
        queue.push({ row, enqueuedAtMs: nowMs })
      }
      if (maxDepth !== undefined && queue.length > maxDepth) {
        queue.splice(0, queue.length - maxDepth)
      }
    },
    pullReady(max) {
      return dequeue(max)
    },
    noteDrain(pressureMs) {
      drainPressureMs = Math.max(0, pressureMs)
    },
    getMode() {
      return mode
    },
    getStats(nowMs) {
      return {
        mode,
        depth: queue.length,
        oldestAgeMs: ageMs(nowMs),
        drainPressureMs,
        recoveringForMs: recoveringSinceMs === undefined
          ? 0
          : nowMs - recoveringSinceMs,
      }
    },
    tick(nowMs) {
      updateMode(nowMs)
      return dequeue(budget())
    },
    flush() {
      recoveringSinceMs = undefined
      return dequeue(queue.length)
    },
  }
}
