/**
 * The throttled render loop: every frame is a snapshot, never an event
 * stream. A bounded queue (capacity 2) plus a fixed flush interval keeps the
 * terminal from re-rendering per token (P1) and drops stale frames under
 * backpressure (P13). Render-cost measurement lives in the FrameProbe
 * (commit-driven, per-commit renderMs), not here: interval cadence is pacing,
 * not per-commit render cost, so this loop records no frame times.
 * @module @deepseek-ai/dsh-tui-render/render-loop
 */

/** Handle for a running render loop. */
export interface RenderLoop {
  /** Queue the latest model for rendering; stale frames are dropped. */
  enqueue(model: unknown): void
  /** Flush once immediately, then keep the timer stopped. */
  stop(): void
}

/**
 * Create a throttled render loop.
 * @param render - the frame renderer (idempotent snapshot painter).
 * @param intervalMs - flush interval (default 20ms, the P1 budget).
 * @returns the loop handle.
 */
export function createRenderLoop(
  render: (model: unknown) => void,
  intervalMs = 20,
): RenderLoop {
  let latest: unknown
  let hasPending = false
  let timer: ReturnType<typeof setInterval> | undefined

  const flush = () => {
    if (!hasPending) return
    hasPending = false
    render(latest)
  }

  timer = setInterval(flush, intervalMs)

  return {
    enqueue(model: unknown) {
      latest = model
      hasPending = true
    },
    stop() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      flush()
    },
  }
}

/**
 * Wrap a renderer so only the newest call within one tick interval runs.
 * @param fn - the renderer to throttle.
 * @param intervalMs - throttle window.
 * @returns the throttled wrapper.
 */
export function withThrottle<T extends unknown[]>(
  fn: (...args: T) => void,
  intervalMs = 20,
): (...args: T) => void {
  let lastRun = 0
  let pending: T | undefined
  return (...args: T) => {
    const now = Date.now()
    if (now - lastRun >= intervalMs) {
      lastRun = now
      fn(...args)
      pending = undefined
    } else {
      pending = args
      setTimeout(
        () => {
          if (pending !== undefined) {
            fn(...pending)
            pending = undefined
          }
        },
        intervalMs - (now - lastRun),
      )
    }
  }
}
