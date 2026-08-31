/**
 * Resolved render-policy types and fallback defaults.
 *
 * Every field below describes a deployment-time tunable that the TUI plugin
 * validates through its Config schema. Defaults here are the "if the host
 * passes nothing and the schema has no `.default()`" fallback — the source of
 * truth for visible values is the plugin Config, not these constants. The
 * render-side helpers (stream-queue, scroll-scheduler, transcript line store)
 * keep their own module-local constants for the same fallback role; this file
 * exists so the host and the renderer can share one shape, with the host
 * always owning the validated value.
 *
 * Validation rules (enforced by the plugin Config):
 *  - frame intervals > 0
 *  - overscan >= 0, bounded by `RENDER_POLICY_MAX_OVERSCAN`
 *  - cache budgets bounded by `RENDER_POLICY_MAX_CACHE_ROWS` / `..._BYTES`
 *  - exit thresholds < entry thresholds
 *
 * @module @deepseek-ai/dsh-tui-render/render-policy
 */

/** Default stream frame cadence (≈60Hz). */
export const RENDER_POLICY_DEFAULT_STREAM_FRAME_INTERVAL_MS = 16
/** Default catch-up entry depth (rows waiting before catch-up engages). */
export const RENDER_POLICY_DEFAULT_STREAM_ENTRY_DEPTH = 64
/** Default catch-up exit depth (must stay strictly below the entry depth). */
export const RENDER_POLICY_DEFAULT_STREAM_EXIT_DEPTH = 32
/** Default catch-up entry oldest-row age in milliseconds. */
export const RENDER_POLICY_DEFAULT_STREAM_ENTRY_OLDEST_AGE_MS = 500
/** Default catch-up exit oldest-row age (strictly below the entry value). */
export const RENDER_POLICY_DEFAULT_STREAM_EXIT_OLDEST_AGE_MS = 250
/** Default catch-up entry stdout drain backpressure in milliseconds. */
export const RENDER_POLICY_DEFAULT_STREAM_ENTRY_DRAIN_BACKPRESSURE_MS = 100
/** Default catch-up exit stdout drain backpressure (strictly below entry). */
export const RENDER_POLICY_DEFAULT_STREAM_EXIT_DRAIN_BACKPRESSURE_MS = 50
/** Default rows published per frame in catch-up mode. */
export const RENDER_POLICY_DEFAULT_STREAM_CATCH_UP_ROWS_PER_FRAME = 16

/** Default scroll frame cadence (≈60Hz). */
export const RENDER_POLICY_DEFAULT_SCROLL_FRAME_INTERVAL_MS = 16
/** Default rows-per-frame in the smooth band; one-line keys move one row each. */
export const RENDER_POLICY_DEFAULT_SCROLL_STEP_PER_FRAME = 1
/** Default physical rows requested by one mouse-wheel report. */
export const RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS = 3
/** Default distance threshold switching from smooth to catch-up steps. */
export const RENDER_POLICY_DEFAULT_SCROLL_CATCH_UP_THRESHOLD = 10
/** Default maximum rows-per-frame in catch-up mode. */
export const RENDER_POLICY_DEFAULT_SCROLL_MAX_CATCH_UP_STEP = 8

/** Default settled-row cache budget; one full viewport plus neighborhood headroom. */
export const RENDER_POLICY_DEFAULT_CACHE_MAX_ROWS = 4096
/** Default settled-byte cache budget; one full pre-rendered transcript. */
export const RENDER_POLICY_DEFAULT_CACHE_MAX_BYTES = 4 * 1024 * 1024

/** Default transcript overscan; one viewport's worth of pre-rendered rows. */
export const RENDER_POLICY_DEFAULT_TRANSCRIPT_OVERSCAN = 16
/** Hard upper bound on overscan; the design caps defaults at one viewport. */
export const RENDER_POLICY_MAX_OVERSCAN = 50
/** Hard upper bound on settled-row cache budget. */
export const RENDER_POLICY_MAX_CACHE_ROWS = 1_000_000
/** Hard upper bound on settled-byte cache budget (32 MiB). */
export const RENDER_POLICY_MAX_CACHE_BYTES = 32 * 1024 * 1024

/** Stream-pacing knobs validated together (entry thresholds > exit thresholds). */
export interface RenderPolicyStream {
  /** Frame cadence in milliseconds; must be > 0. */
  readonly frameIntervalMs: number
  /** Catch-up entry queue depth; must be > exit depth. */
  readonly entryDepth: number
  /** Catch-up exit queue depth; must be > 0 and < entry depth. */
  readonly exitDepth: number
  /** Catch-up entry oldest-row age (ms); must be > exit value. */
  readonly entryOldestAgeMs: number
  /** Catch-up exit oldest-row age (ms); must be > 0 and < entry value. */
  readonly exitOldestAgeMs: number
  /** Catch-up entry stdout drain pressure (ms); must be > exit value. */
  readonly entryDrainBackpressureMs: number
  /** Catch-up exit stdout drain pressure (ms); must be > 0 and < entry value. */
  readonly exitDrainBackpressureMs: number
  /** Rows published per frame in catch-up mode; must be > 0. */
  readonly catchUpRowsPerFrame: number
}

/** Scroll-scheduler knobs validated together. */
export interface RenderPolicyScroll {
  /** Frame cadence in milliseconds; must be > 0. */
  readonly frameIntervalMs: number
  /** Rows advanced per tick in the smooth band; must be > 0. */
  readonly stepPerFrame: number
  /** Physical rows requested by one mouse-wheel report; must be > 0. */
  readonly wheelRows: number
  /** Distance threshold switching from smooth to catch-up; must be >= 0. */
  readonly catchUpThreshold: number
  /** Upper bound on rows-per-tick in catch-up mode; must be > 0. */
  readonly maxCatchUpStep: number
}

/** Cache-budget knobs (must stay bounded). */
export interface RenderPolicyCache {
  /** Maximum settled rows cached; must be > 0 and <= max cap. */
  readonly maxRows: number
  /** Maximum settled bytes cached; must be > 0 and <= max cap. */
  readonly maxBytes: number
}

/** Resolved render policy the TUI plugin passes to the renderer at mount. */
export interface RenderPolicy {
  /** Extra pre-rendered rows around the visible window; 0..max. */
  readonly transcriptOverscan: number
  /** Stream-pacing knobs. */
  readonly stream: RenderPolicyStream
  /** Scroll-scheduler knobs. */
  readonly scroll: RenderPolicyScroll
  /** Cache-budget knobs. */
  readonly cache: RenderPolicyCache
}

/**
 * Build the fallback {@link RenderPolicy} used when no host value is supplied.
 * Renderer helpers receive this object only as a default; the host owns the
 * validated value at runtime and renderer modules keep their own constants
 * for the same fallback role.
 * @returns the default render policy.
 */
export function renderPolicyDefaults(): RenderPolicy {
  return {
    transcriptOverscan: RENDER_POLICY_DEFAULT_TRANSCRIPT_OVERSCAN,
    stream: {
      frameIntervalMs: RENDER_POLICY_DEFAULT_STREAM_FRAME_INTERVAL_MS,
      entryDepth: RENDER_POLICY_DEFAULT_STREAM_ENTRY_DEPTH,
      exitDepth: RENDER_POLICY_DEFAULT_STREAM_EXIT_DEPTH,
      entryOldestAgeMs: RENDER_POLICY_DEFAULT_STREAM_ENTRY_OLDEST_AGE_MS,
      exitOldestAgeMs: RENDER_POLICY_DEFAULT_STREAM_EXIT_OLDEST_AGE_MS,
      entryDrainBackpressureMs: RENDER_POLICY_DEFAULT_STREAM_ENTRY_DRAIN_BACKPRESSURE_MS,
      exitDrainBackpressureMs: RENDER_POLICY_DEFAULT_STREAM_EXIT_DRAIN_BACKPRESSURE_MS,
      catchUpRowsPerFrame: RENDER_POLICY_DEFAULT_STREAM_CATCH_UP_ROWS_PER_FRAME,
    },
    scroll: {
      frameIntervalMs: RENDER_POLICY_DEFAULT_SCROLL_FRAME_INTERVAL_MS,
      stepPerFrame: RENDER_POLICY_DEFAULT_SCROLL_STEP_PER_FRAME,
      wheelRows: RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS,
      catchUpThreshold: RENDER_POLICY_DEFAULT_SCROLL_CATCH_UP_THRESHOLD,
      maxCatchUpStep: RENDER_POLICY_DEFAULT_SCROLL_MAX_CATCH_UP_STEP,
    },
    cache: {
      maxRows: RENDER_POLICY_DEFAULT_CACHE_MAX_ROWS,
      maxBytes: RENDER_POLICY_DEFAULT_CACHE_MAX_BYTES,
    },
  }
}
