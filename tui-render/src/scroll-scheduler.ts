/**
 * Latest-target physical-row scroll scheduler.
 *
 * The viewport reducer remains the single source of truth for measured
 * coordinates and stable block anchors; this module only decides how a
 * `presented` row approaches the latest `target` row on a configurable frame
 * clock. Intermediate input events are not preserved — every new target
 * overwrites any stale intermediate value, so wheel bursts, PageUp/PageDown
 * and direction reversals all share one coherent latest target.
 *
 * Semantics:
 *  - `setTarget` starts animated catch-up; `snapTo` moves both positions
 *    instantly and stops further motion.
 *  - Home/End/`G`/`latest-message` are explicit edge commands — they call
 *    `snapTo` to land immediately.
 *  - Rail drag is "latest pointer, no easing" — callers invoke `snapTo`
 *    on every pointer move and never `setTarget`, so the visible position
 *    tracks the pointer without after-release drift.
 *  - Single-line `↑/↓/j/k` and continuous wheel share the same `setTarget`
 *    path; the smooth step (`stepPerFrame`) gives a one-row key one frame.
 *
 * Distance-adaptive catch-up:
 *  - Each new target selects `stepPerFrame` or `maxCatchUpStep` from its
 *    initial distance to the presented row and `catchUpThreshold`.
 *  - That pace remains selected until the target is reached or replaced;
 *    the final step is capped to the remaining distance.
 *
 * Disposal:
 *  - `dispose` clears the internal frame timer and ignores further input.
 *  - After dispose no advance is scheduled and no timer is owned.
 *
 * Pure data: no I/O, no persistence, no event-loop coupling beyond the
 * injected interval handles. Test builds inject `setInterval` and
 * `clearInterval` so fake timers can drive the cadence deterministically.
 *
 * @module @deepseek-ai/dsh-tui-render/scroll-scheduler
 */

/** Default frame cadence (≈60Hz) used when no `frameIntervalMs` is supplied. */
export const SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS = 16
/** Default rows-per-tick in the smooth band; a single-line key moves one row per frame. */
export const SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME = 1
/** Default distance threshold that switches from smooth to catch-up steps. */
export const SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD = 10
/** Default maximum rows-per-tick when the target is far from the presented row. */
export const SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP = 8

/** Construction options for {@link createScrollScheduler}. */
export interface ScrollSchedulerOptions {
  /** Frame cadence in milliseconds; defaults to {@link SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS}. */
  readonly frameIntervalMs?: number
  /** Rows advanced per tick in the smooth band; defaults to {@link SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME}. */
  readonly stepPerFrame?: number
  /** Distance threshold switching from smooth to catch-up steps; defaults to {@link SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD}. */
  readonly catchUpThreshold?: number
  /** Upper bound on rows-per-tick in catch-up mode; defaults to {@link SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP}. */
  readonly maxCatchUpStep?: number
  /** Initial presented row (also the initial target); defaults to 0. */
  readonly initialPosition?: number
  /** Whether the scheduler owns an interval; false lets a shared arbiter call `tick()`. */
  readonly autoSchedule?: boolean
  /** Optional `setInterval` injection for deterministic tests; defaults to the Node global. */
  readonly setInterval?: typeof setInterval
  /** Optional `clearInterval` injection for deterministic tests; defaults to the Node global. */
  readonly clearInterval?: typeof clearInterval
}

/** Latest-target scroll scheduler handle. */
export interface ScrollScheduler {
  /** Latest painted physical row (consumed by the viewport reducer each render). */
  getPresented(): number
  /** Latest target physical row requested by the user input. */
  getTarget(): number
  /** Whether a frame timer is currently scheduled. */
  isAnimating(): boolean
  /**
   * Replace the target. New input overrides any stale target; no event
   * queue is kept. Direction reversal therefore takes effect on the next
   * tick with no warm-up cost.
   * @param row - new target row (integer physical row).
   */
  setTarget(row: number): void
  /**
   * Snap both `presented` and `target` to `row` and stop further motion.
   * Used for Home/End/edge commands and rail drag (latest pointer).
   * @param row - destination row (integer physical row).
   */
  snapTo(row: number): void
  /**
   * Shift presented and target together after anchor-based layout rebasing.
   * @param delta - signed physical-row shift.
   * @param maximum - inclusive upper clamp after rebasing.
   */
  rebase(delta: number, maximum: number): void
  /**
   * Advance presented toward target by exactly one tick. Public so tests
   * can drive the scheduler without fake timers; production code should
   * rely on the internal frame timer. Concurrent use with the internal
   * timer will double-step.
   * @returns the new presented row.
   */
  tick(): number
  /** Release the internal frame timer; subsequent calls are no-ops. */
  dispose(): void
}

/**
 * Create a latest-target scroll scheduler.
 * @param options - frame cadence, step thresholds and interval injection.
 * @returns the scheduler handle.
 */
export function createScrollScheduler(
  options: ScrollSchedulerOptions = {},
): ScrollScheduler {
  const frameIntervalMs = options.frameIntervalMs ?? SCROLL_SCHEDULER_DEFAULT_FRAME_INTERVAL_MS
  const stepPerFrame = options.stepPerFrame ?? SCROLL_SCHEDULER_DEFAULT_STEP_PER_FRAME
  const catchUpThreshold = options.catchUpThreshold
    ?? SCROLL_SCHEDULER_DEFAULT_CATCH_UP_THRESHOLD
  const maxCatchUpStep = options.maxCatchUpStep ?? SCROLL_SCHEDULER_DEFAULT_MAX_CATCH_UP_STEP
  const setIntervalFn = options.setInterval ?? setInterval
  const clearIntervalFn = options.clearInterval ?? clearInterval
  const autoSchedule = options.autoSchedule ?? true

  let presented = options.initialPosition ?? 0
  let target = options.initialPosition ?? 0
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let catchingUp = false

  /**
   * Choose the per-tick step. Smooth band uses `stepPerFrame`; the catch-up
   * band uses `maxCatchUpStep`. The step is always clamped to the remaining
   * distance so the final tick never overshoots.
   * @param delta - signed distance from presented to target.
   * @returns a non-negative integer step.
   */
  function catchUpStep(delta: number): number {
    const abs = Math.abs(delta)
    const base = catchingUp ? maxCatchUpStep : stepPerFrame
    return Math.min(abs, base)
  }

  function stopTimer(): void {
    if (timer === undefined) return
    clearIntervalFn(timer)
    timer = undefined
  }

  function ensureTimer(): void {
    if (!autoSchedule) return
    if (timer !== undefined) return
    timer = setIntervalFn(stepOnce, frameIntervalMs)
  }

  function stepOnce(): number {
    if (presented === target) return presented
    const delta = target - presented
    presented += Math.sign(delta) * catchUpStep(delta)
    if (presented === target) stopTimer()
    return presented
  }

  return {
    getPresented: () => presented,
    getTarget: () => target,
    isAnimating: () => !disposed && presented !== target,
    setTarget(row) {
      if (disposed) return
      target = row
      catchingUp = Math.abs(target - presented) > catchUpThreshold
      if (presented !== target) ensureTimer()
      else stopTimer()
    },
    snapTo(row) {
      if (disposed) return
      presented = row
      target = row
      catchingUp = false
      stopTimer()
    },
    rebase(delta, maximum) {
      if (disposed) return
      const cap = Math.max(0, Math.trunc(maximum))
      presented = Math.max(0, Math.min(cap, presented + Math.trunc(delta)))
      target = Math.max(0, Math.min(cap, target + Math.trunc(delta)))
      if (presented === target) stopTimer()
      else ensureTimer()
    },
    tick() {
      if (disposed) return presented
      return stepOnce()
    },
    dispose() {
      disposed = true
      stopTimer()
    },
  }
}
