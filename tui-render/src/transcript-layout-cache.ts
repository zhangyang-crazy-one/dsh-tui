/** Incremental physical-row estimates for a virtualized transcript. */

import type { TranscriptBlockLayout } from './transcript-viewport.ts'

/** One stable block handed to the physical-layout cache. */
export interface TranscriptLayoutCacheInput {
  /** Stable block identity. */
  readonly id: string
  /** Immutable-content or active-tail version. */
  readonly version: string
  /** Conservative physical rows before this version has been measured. */
  readonly estimatedRows: number
}

interface CachedMeasurement {
  readonly version: string
  readonly rows: number
}

/**
 * Cache measured block heights under one width/theme/fold scope. Unmeasured
 * history uses bounded estimates, allowing the renderer to mount only the
 * blocks around the physical viewport while preserving total-row geometry.
 */
export class TranscriptLayoutCache {
  private scopeKey = ''
  private readonly measured = new Map<string, CachedMeasurement>()

  private ensureScope(scopeKey: string): void {
    if (scopeKey === this.scopeKey) return
    this.scopeKey = scopeKey
    this.measured.clear()
  }

  /** Clear every retained measurement. */
  clear(): void {
    this.scopeKey = ''
    this.measured.clear()
  }

  /**
   * Build cumulative physical layouts from measured rows or estimates.
   * @param scopeKey - width/theme/fold identity shared by every input.
   * @param inputs - ordered stable block versions and initial estimates.
   * @returns ordered physical block layouts for the complete transcript.
   */
  layouts(
    scopeKey: string,
    inputs: readonly TranscriptLayoutCacheInput[],
  ): readonly TranscriptBlockLayout[] {
    this.ensureScope(scopeKey)
    let top = 0
    return inputs.map((input) => {
      const cached = this.measured.get(input.id)
      const rows = Math.max(
        1,
        cached?.version === input.version ? cached.rows : input.estimatedRows,
      )
      const layout = { id: input.id, top, rows }
      top += rows
      return layout
    })
  }

  /**
   * Commit one rendered block's measured height.
   * @param scopeKey - width/theme/fold identity used by {@link layouts}.
   * @param id - stable block identity.
   * @param version - current block version.
   * @param rows - measured physical rows.
   * @returns whether the effective cached height changed.
   */
  record(scopeKey: string, id: string, version: string, rows: number): boolean {
    this.ensureScope(scopeKey)
    const normalized = Math.max(1, rows)
    const current = this.measured.get(id)
    if (current?.version === version && current.rows === normalized) return false
    this.measured.set(id, { version, rows: normalized })
    return true
  }
}
