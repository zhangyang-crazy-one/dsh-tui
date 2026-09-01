/**
 * Single-frame arbiter shared by the stream presentation queue and the
 * scroll scheduler.
 *
 * Tasks 2.3 + 2.4 of `openspec/changes/optimize-tui-streaming-renderer`:
 * the renderer owns exactly one frame arbiter that
 *  - coalesces stream-tail requests and scroll requests onto one shared
 *    frame clock (Decision 4 + Decision 5: "render scheduler 与流式
 *    render scheduler 共用一个帧仲裁器");
 *  - lets user scroll / input requests take priority over the background
 *    stream tail ("用户滚动优先于后台 stream tail"): a pending scroll
 *    request forces the next frame to publish even when the stream queue
 *    is empty and scroll is not yet animating;
 *  - publishes at most one consistent transcript snapshot per frame, with
 *    the latest scroll state and the rows dequeued from the stream queue
 *    in that same frame ("同一帧只发布一个一致的 transcript snapshot");
 *  - releases every owned timer and listener on teardown.
 *
 * The arbiter owns no scroll or stream logic. The two collaborators come
 * from other lanes:
 *  - `scroll-scheduler.ts`: latest-target physical-row catch-up. It
 *    self-drives on its own `setInterval`; the arbiter only reads its
 *    state each frame.
 *  - `stream-queue.ts`: smooth/catch-up presentation queue. The arbiter
 *    calls `stream.tick(nowMs)` once per frame to advance presentation
 *    and consumes the rows the queue decides to publish.
 *
 * Disposal: the arbiter clears its own frame timer, drops every
 * registered listener, and (when `ownsScrollScheduler` is `true` at
 * construction) also disposes the injected scroll scheduler. The
 * injected stream queue is pure data and needs no disposal.
 *
 * @module @deepseek-ai/dsh-tui-render/frame-arbiter
 */

import type { ScrollScheduler } from './scroll-scheduler.ts'
import type { StreamQueue } from './stream-queue.ts'

/** Default shared frame cadence (≈60Hz) used when no `frameIntervalMs` is supplied. */
export const FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS = 16

/** Construction options for {@link createFrameArbiter}. */
export interface FrameArbiterOptions<T> {
  /** Shared frame cadence in milliseconds; defaults to {@link FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS}. */
  readonly frameIntervalMs?: number
  /** Injected latest-target scroll scheduler. Self-drives on its own frame interval. */
  readonly scroll: ScrollScheduler
  /** Injected presentation queue; the arbiter calls `stream.tick(nowMs)` once per frame. */
  readonly stream: StreamQueue<T>
  /**
   * Whether `dispose()` should also dispose the injected scroll scheduler
   * (clearing its internal timer). Defaults to `true`; set `false` when
   * another component owns the scheduler lifecycle.
   */
  readonly ownsScrollScheduler?: boolean
  /** Call the injected scheduler's `tick()` on this shared frame clock. */
  readonly drivesScrollScheduler?: boolean
  /** Optional `setInterval` injection for deterministic tests; defaults to the Node global. */
  readonly setInterval?: typeof setInterval
  /** Optional `clearInterval` injection for deterministic tests; defaults to the Node global. */
  readonly clearInterval?: typeof clearInterval
  /** Optional time source for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number
}

/** Snapshot of the scroll subsystem read at frame time. */
export interface ScrollFrameState {
  /** Latest presented row the viewport reducer should consume this frame. */
  readonly presented: number
  /** Latest target row requested by user input. */
  readonly target: number
  /** Whether the scheduler's internal timer is currently scheduled. */
  readonly isAnimating: boolean
}

/** One consistent transcript snapshot emitted by the arbiter each frame. */
export interface FrameSnapshot<T> {
  /** Scroll subsystem state read for this frame (priority read by consumers). */
  readonly scroll: ScrollFrameState
  /** Rows the stream queue decided to publish this frame (may be empty). */
  readonly stream: readonly T[]
  /** Current time in milliseconds as the arbiter saw it. */
  readonly nowMs: number
  /**
   * `true` when a pending request flag forced this frame to publish even
   * though no natural scroll motion or stream rows were available;
   * `false` when scroll or stream work triggered the publication.
   */
  readonly forced: boolean
}

/** Listener signature for frame publishes. */
export type FrameListener<T> = (snapshot: FrameSnapshot<T>) => void

/** Frame arbiter handle. */
export interface FrameArbiter<T> {
  /**
   * Subscribe to one published snapshot per frame. The returned function
   * removes the subscription; calling it twice is a no-op.
   * @param listener - snapshot consumer; invoked synchronously from the arbiter's frame tick.
   * @returns an unsubscribe callback.
   */
  onPublish(listener: FrameListener<T>): () => void
  /**
   * Coalesce a stream-tail request into the next frame tick. Multiple
   * calls inside the same frame interval collapse to exactly one publish.
   * No-op after `dispose`.
   */
  requestStream(): void
  /**
   * Coalesce a user-interaction request (scroll / input) into the next
   * frame tick. Multiple calls inside the same frame interval collapse
   * to exactly one publish. When this flag is the only signal in a
   * frame, the arbiter still publishes — user input takes priority over
   * the background stream tail. No-op after `dispose`.
   */
  requestScroll(): void
  /** Read the latest scroll state without waiting for a frame. */
  getScrollState(): ScrollFrameState
  /** Whether the arbiter's frame timer is currently scheduled. */
  isRunning(): boolean
  /** Whether at least one request flag (`stream` or `scroll`) is pending in the current frame. */
  hasPendingRequest(): boolean
  /**
   * Release the internal frame timer, drop every listener, and (when
   * the scheduler is owned) also dispose the injected scroll scheduler.
   * Idempotent; subsequent calls are no-ops.
   */
  dispose(): void
}

/**
 * Create a single-frame arbiter shared by stream presentation and scroll
 * scheduling. One arbiter per TUI session.
 * @param options - injections and tunables.
 * @returns the arbiter handle.
 */
export function createFrameArbiter<T>(
  options: FrameArbiterOptions<T>,
): FrameArbiter<T> {
  const frameIntervalMs = options.frameIntervalMs
    ?? FRAME_ARBITER_DEFAULT_FRAME_INTERVAL_MS
  const ownsScrollScheduler = options.ownsScrollScheduler ?? true
  const drivesScrollScheduler = options.drivesScrollScheduler ?? false
  const setIntervalFn = options.setInterval ?? setInterval
  const clearIntervalFn = options.clearInterval ?? clearInterval
  const nowFn = options.now ?? Date.now

  const scroll: ScrollScheduler = options.scroll
  const stream: StreamQueue<T> = options.stream

  const listeners = new Set<FrameListener<T>>()
  let timer: ReturnType<typeof setInterval> | undefined
  let pendingStream = false
  let pendingScroll = false
  let disposed = false

  /**
   * Read the scroll subsystem's current state. The injected scheduler
   * self-drives on its own `setInterval`; on a shared fake-clock tick the
   * arbiter's timer and the scheduler's timer both fire and the
   * scheduler advances `presented` on its own callback. This read
   * captures the value the next-rendered frame should consume.
   * @returns a {@link ScrollFrameState} snapshot.
   */
  function readScrollState(): ScrollFrameState {
    return {
      presented: scroll.getPresented(),
      target: scroll.getTarget(),
      isAnimating: scroll.isAnimating(),
    }
  }

  /**
   * Advance the stream queue for this frame and, if any work was
   * produced or requested, publish one snapshot. The forced flag is set
   * only when no natural scroll motion / stream rows forced the
   * publication — i.e. when the publish exists purely to honor a
   * pending user-interaction or stream-tail request.
   *
   * Defense: the shared frame timer is cleared in `dispose`, so this
   * callback cannot fire after teardown; no extra guard is needed.
   */
  function tickFrame(): void {
    const nowMs = nowFn()
    if (drivesScrollScheduler && scroll.getPresented() !== scroll.getTarget()) {
      scroll.tick()
    }
    const streamRows = stream.tick(nowMs)
    const scrollState = readScrollState()
    const naturalWork = streamRows.length > 0 || scrollState.isAnimating
    const shouldPublish = pendingStream || pendingScroll || naturalWork
    if (shouldPublish) {
      publish({
        scroll: scrollState,
        stream: streamRows,
        nowMs,
        forced: !naturalWork && (pendingStream || pendingScroll),
      })
    }
    pendingStream = false
    pendingScroll = false
  }

  /**
   * Dispatch one snapshot to every registered listener.
   * @param snapshot - the snapshot emitted this frame.
   */
  function publish(snapshot: FrameSnapshot<T>): void {
    for (const listener of listeners) listener(snapshot)
  }

  // Start the shared frame clock eagerly so subscribers join an already
  // running loop. The dispose path still owns this timer via the
  // `ownsScrollScheduler` argument only controlling whether the injected
  // scroll scheduler's lifecycle is co-owned.
  timer = setIntervalFn(tickFrame, frameIntervalMs)

  return {
    onPublish(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      let disposedSubscription = false
      return () => {
        if (disposedSubscription) return
        disposedSubscription = true
        listeners.delete(listener)
      }
    },
    requestStream() {
      if (disposed) return
      pendingStream = true
    },
    requestScroll() {
      if (disposed) return
      pendingScroll = true
    },
    getScrollState: readScrollState,
    isRunning: () => timer !== undefined,
    hasPendingRequest: () => pendingStream || pendingScroll,
    dispose() {
      // Always clear the frame timer first so subsequent calls also
      // exercise the no-timer branch. The `disposed` early-return then
      // turns repeated disposes into a true no-op without leaking work.
      if (timer !== undefined) {
        clearIntervalFn(timer)
        timer = undefined
      }
      if (disposed) return
      disposed = true
      pendingStream = false
      pendingScroll = false
      listeners.clear()
      if (ownsScrollScheduler) scroll.dispose()
    },
  }
}
