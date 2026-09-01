/**
 * Stable physical-line store for the transcript renderer.
 *
 * The store owns one row/byte-budgeted LRU cache of physical-line
 * snapshots indexed by stable block id. Settled blocks expose frozen,
 * immutable line arrays whose references stay stable until eviction or
 * scope change. Active blocks expose a single mutable revision handle
 * that the projector grows via {@link MutableRevision.append} and
 * atomically transfers to settled ownership through
 * {@link MutableRevision.settle}: the active array reference becomes the
 * settled one without copy, so React reconciliation can rely on
 * referential equality to skip unchanged rows.
 *
 * The store keeps authoritative source per block even after the derived
 * physical lines have been evicted; eviction therefore never damages the
 * session projection. Re-entering the viewport on a missing block calls
 * the owner-injected {@link RebuildLines} callback with the latest source
 * and scope so the line array is reconstructed before render.
 *
 * The store tracks five counters: hits, evictions, rebuilds, stable
 * rows reused, and tail rows rerendered. The channel names mirror the
 * frame-stats extension introduced by the same change but the store
 * does not import frame-stats — the two surfaces remain independent so
 * the line store can run without React mounted.
 * @module @deepseek-ai/dsh-tui-render/transcript-line-store
 */

import {
  type PhysicalLine,
  physicalLineByteSize,
} from './physical-line.ts'

/**
 * Owner-injected line-builder. The store calls it after a miss to
 * rebuild a block's physical lines from the authoritative source under
 * the current scope.
 */
export type RebuildLines = (input: {
  /** Stable block identity. */
  blockId: string
  /** Authoritative source retained through eviction. */
  source: string
  /** Scope identifier (typically `width:theme:fold`). */
  scopeKey: string
  /** Source revision after upsertSource/acquireActive. */
  revision: number
}) => readonly PhysicalLine[]

/** Cache budgets and the rebuild factory. */
export interface TranscriptRenderStoreConfig {
  /** Maximum total physical rows retained across settled blocks. */
  readonly maxRows: number
  /** Maximum total bytes retained across settled blocks. */
  readonly maxBytes: number
  /** Rebuild callback invoked on a miss after eviction. */
  readonly rebuild: RebuildLines
}

/** Observable counters (independent of frame-stats). */
export interface TranscriptRenderStoreStats {
  /** Cached reads that returned settled lines without rebuild. */
  readonly hits: number
  /** Settled blocks dropped from the cache. */
  readonly evictions: number
  /** Reads that triggered a rebuild after eviction. */
  readonly rebuilds: number
  /** Rows returned across hits and rebuilds (settled rows reused). */
  readonly stableRowsReused: number
  /** Rows added or replaced through active-tail mutation. */
  readonly tailRowsRerendered: number
  /** Currently cached settled blocks. */
  readonly cachedBlocks: number
  /** Total physical rows currently cached. */
  readonly cachedRows: number
  /** Total bytes currently cached. */
  readonly cachedBytes: number
}

/** Pin set: block ids the LRU must not evict. */
export interface TranscriptRenderStorePins {
  /** Block ids that must remain resident. */
  readonly pinned: readonly string[]
}

/** Active-tail mutable revision. Only one per block at a time. */
export interface MutableRevision {
  /** Stable owning block identity. */
  readonly blockId: string
  /** Source revision after each append/reset. */
  readonly revision: number
  /** Scope in effect when this revision was acquired. */
  readonly scopeKey: string
  /** Current line buffer; not yet frozen. */
  readonly lines: readonly PhysicalLine[]
  /**
   * Append lines to the active tail. Bumps the revision and counts the
   * added rows toward `tailRowsRerendered`.
   * @param lines - physical lines to append.
   */
  append(lines: readonly PhysicalLine[]): void
  /**
   * Replace the active tail entirely. Bumps the revision and counts the
   * new line count toward `tailRowsRerendered`.
   * @param lines - physical lines that make up the new tail.
   */
  reset(lines: readonly PhysicalLine[]): void
  /**
   * Replace canonical active source and its complete projected rows in one
   * revision. Streaming owners use this when one delta can change the final
   * Markdown block or table width rather than append rows verbatim.
   * @param input - latest canonical source and presentation rows.
   */
  replace(input: { source: string; lines: readonly PhysicalLine[] }): void
  /**
   * Atomically transfer the active tail to settled ownership. The same
   * array reference becomes the store's settled snapshot; no copy, no
   * row loss.
   * @returns the settled snapshot.
   */
  settle(): BlockSnapshot
  /**
   * Drop the active revision without settling. The block remains
   * resident but with its previous settled snapshot (or none, if no
   * settle had occurred yet).
   */
  discard(): void
}

/** Immutable, shareable block snapshot returned by reads/settle. */
export interface BlockSnapshot {
  /** Stable owning block identity. */
  readonly blockId: string
  /** Authoritative source retained by the store. */
  readonly source: string
  /** Scope in effect when the snapshot was settled or last rebuilt. */
  readonly scopeKey: string
  /** Source revision after the latest upsert. */
  readonly revision: number
  /** Frozen physical lines; stable reference while cached. */
  readonly lines: readonly PhysicalLine[]
  /** Exact physical row count for this block. */
  readonly rowCount: number
}

/** Cumulative exact row range for a block given the caller's order. */
export interface TranscriptBlockRowRange {
  /** Zero-based inclusive start row inside the cumulative layout. */
  readonly start: number
  /** Exclusive end row inside the cumulative layout. */
  readonly end: number
}

/** Public store API. */
export interface TranscriptRenderStore {
  /**
   * Upsert authoritative source for a settled block. Bumps the source
   * revision; the next read rebuilds because scope or content changed.
   * @param input - block identity, source, and scope.
   */
  upsertSource(input: { blockId: string; source: string; scopeKey: string }): void
  /**
   * Acquire the active-tail mutable revision for a block. One revision
   * per block at a time; a second acquire without an intermediate
   * settle/discard throws. Creates the entry if it does not exist.
   * @param input - block identity, source, and scope for the new tail.
   * @returns the mutable revision handle.
   */
  acquireActive(input: {
    blockId: string
    source: string
    scopeKey: string
  }): MutableRevision
  /**
   * Read the current snapshot for a block. Rebuilds via the injected
   * callback when the settled lines have been evicted.
   * @param input - block identity.
   * @returns the snapshot, or undefined when the block is unknown.
   */
  readBlock(input: { blockId: string }): BlockSnapshot | undefined
  /**
   * Update the pin set. The store evicts unpinned settled blocks when
   * the new pin set drops below the row/byte budgets.
   * @param pins - block ids that must remain resident.
   */
  setPins(pins: TranscriptRenderStorePins): void
  /** Clear every pin. Triggers eviction when over budget. */
  clearPins(): void
  /** Drop every retained snapshot, source, pin, and counter. */
  reset(): void
  /**
   * Cumulative exact row range for a block, given the caller's block
   * order. The end equals `start + rowCount`; together they describe
   * the block's slice of the global transcript. Unresolved blocks in
   * the order are rebuilt on demand so the range stays exact.
   * @param input - block identity and caller's full block order.
   * @returns the cumulative range, or undefined when the block is unknown.
   */
  blockRowRange(input: {
    blockId: string
    blockOrder: readonly string[]
  }): TranscriptBlockRowRange | undefined
  /** Total physical rows across every cached block (no ordering). */
  totalRows(): number
  /** Read the current counters and cache sizes. */
  stats(): TranscriptRenderStoreStats
}

/**
 * Default settled-row budget. Tuned for one full viewport on a typical
 * terminal (60–80 rows) plus headroom for one detached anchor and its
 * neighborhood; the TUI Config layer overrides this on load.
 */
export const DEFAULT_TRANSCRIPT_CACHE_MAX_ROWS = 4096

/**
 * Default settled-byte budget. Tuned to keep a full pre-rendered
 * transcript of ~4 KiB lines resident; the TUI Config layer overrides
 * this on load.
 */
export const DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES = 4 * 1024 * 1024

interface BlockEntry {
  blockId: string
  source: string
  scopeKey: string
  revision: number
  /** Frozen settled lines; null after eviction, undefined before any settle. */
  settledLines: readonly PhysicalLine[] | null | undefined
  /**
   * Prior settled lines snapshot taken when an active revision was
   * acquired. Restored on {@link MutableRevision.discard} so a cancelled
   * tail does not destroy the previous render.
   */
  priorSettled: readonly PhysicalLine[] | null | undefined
  /** Mutable revision while the block owns the active tail. */
  activeRevision: MutableRevisionImpl | null
  /** Monotonic LRU access counter; lower is colder. */
  lastAccess: number
}

interface CounterState {
  hits: number
  evictions: number
  rebuilds: number
  stableRowsReused: number
  tailRowsRerendered: number
}

class MutableRevisionImpl implements MutableRevision {
  readonly blockId: string
  revision: number
  readonly scopeKey: string
  private readonly store: TranscriptRenderStoreImpl
  private buffer: PhysicalLine[]
  private alive: boolean

  constructor(store: TranscriptRenderStoreImpl, entry: BlockEntry, source: string, scopeKey: string) {
    this.store = store
    this.blockId = entry.blockId
    entry.source = source
    entry.scopeKey = scopeKey
    entry.revision += 1
    entry.priorSettled = entry.settledLines ?? null
    this.revision = entry.revision
    this.scopeKey = scopeKey
    this.buffer = []
    this.alive = true
  }

  get lines(): readonly PhysicalLine[] {
    return this.buffer
  }

  append(lines: readonly PhysicalLine[]): void {
    this.requireAlive()
    this.buffer.push(...lines)
    this.revision += 1
    this.store.recordTailRerender(lines.length)
    this.store.touchActiveBlock(this.blockId)
  }

  reset(lines: readonly PhysicalLine[]): void {
    this.requireAlive()
    this.buffer = [...lines]
    this.revision += 1
    this.store.recordTailRerender(lines.length)
    this.store.touchActiveBlock(this.blockId)
  }

  replace(input: { source: string; lines: readonly PhysicalLine[] }): void {
    this.requireAlive()
    this.store.replaceActiveSource(this.blockId, input.source)
    this.buffer = [...input.lines]
    this.revision += 1
    this.store.recordTailRerender(input.lines.length)
    this.store.touchActiveBlock(this.blockId)
  }

  settle(): BlockSnapshot {
    this.requireAlive()
    Object.freeze(this.buffer)
    const snapshot = this.store.commitSettle(this.blockId, this.buffer, this.scopeKey)
    this.alive = false
    return snapshot
  }

  discard(): void {
    this.requireAlive()
    this.store.commitDiscard(this.blockId)
    this.buffer = []
    this.alive = false
  }

  private requireAlive(): void {
    if (!this.alive) {
      throw new Error(`MutableRevision(${this.blockId}): handle already settled/discarded`)
    }
  }
}

class TranscriptRenderStoreImpl implements TranscriptRenderStore {
  private readonly config: TranscriptRenderStoreConfig
  private readonly entries = new Map<string, BlockEntry>()
  private readonly pins = new Set<string>()
  private accessCounter = 0
  private readonly counters: CounterState = {
    hits: 0,
    evictions: 0,
    rebuilds: 0,
    stableRowsReused: 0,
    tailRowsRerendered: 0,
  }

  constructor(config: TranscriptRenderStoreConfig) {
    if (!Number.isInteger(config.maxRows) || config.maxRows <= 0) {
      throw new Error('createTranscriptRenderStore: maxRows must be a positive integer')
    }
    if (!Number.isInteger(config.maxBytes) || config.maxBytes <= 0) {
      throw new Error('createTranscriptRenderStore: maxBytes must be a positive integer')
    }
    this.config = config
  }

  upsertSource(input: { blockId: string; source: string; scopeKey: string }): void {
    this.assertBlockId(input.blockId)
    this.assertScopeKey(input.scopeKey)
    const existing = this.entries.get(input.blockId)
    if (existing === undefined) {
      this.entries.set(input.blockId, {
        blockId: input.blockId,
        source: input.source,
        scopeKey: input.scopeKey,
        revision: 0,
        settledLines: undefined,
        priorSettled: null,
        activeRevision: null,
        lastAccess: this.nextAccess(),
      })
      this.enforceBudget()
      return
    }
    if (existing.activeRevision !== null) {
      throw new Error(
        `upsertSource(${input.blockId}): cannot mutate source while an active revision is held`,
      )
    }
    const scopeChanged = existing.scopeKey !== input.scopeKey
    const sourceChanged = existing.source !== input.source
    existing.source = input.source
    existing.scopeKey = input.scopeKey
    existing.lastAccess = this.nextAccess()
    if (scopeChanged || sourceChanged) {
      existing.revision += 1
      existing.settledLines = null
    }
    this.enforceBudget()
  }

  acquireActive(input: { blockId: string; source: string; scopeKey: string }): MutableRevision {
    this.assertBlockId(input.blockId)
    this.assertScopeKey(input.scopeKey)
    let entry = this.entries.get(input.blockId)
    if (entry === undefined) {
      entry = {
        blockId: input.blockId,
        source: input.source,
        scopeKey: input.scopeKey,
        revision: 0,
        settledLines: undefined,
        priorSettled: null,
        activeRevision: null,
        lastAccess: this.nextAccess(),
      }
      this.entries.set(input.blockId, entry)
    }
    if (entry.activeRevision !== null) {
      throw new Error(
        `acquireActive(${input.blockId}): another revision is already active for this block`,
      )
    }
    const owned = entry
    const revision = new MutableRevisionImpl(this, owned, input.source, input.scopeKey)
    owned.activeRevision = revision
    return revision
  }

  readBlock(input: { blockId: string }): BlockSnapshot | undefined {
    this.assertBlockId(input.blockId)
    const entry = this.entries.get(input.blockId)
    if (entry === undefined) return undefined
    entry.lastAccess = this.nextAccess()
    const active = entry.activeRevision
    if (active !== null) {
      this.counters.stableRowsReused += active.lines.length
      return snapshotFromEntry(entry, active.lines)
    }
    if (entry.settledLines !== undefined && entry.settledLines !== null) {
      this.counters.hits += 1
      this.counters.stableRowsReused += entry.settledLines.length
      return snapshotFromEntry(entry, entry.settledLines)
    }
    const rebuilt = this.config.rebuild({
      blockId: entry.blockId,
      source: entry.source,
      scopeKey: entry.scopeKey,
      revision: entry.revision,
    })
    const frozen = Object.freeze([...rebuilt])
    entry.settledLines = frozen
    this.counters.rebuilds += 1
    this.counters.stableRowsReused += frozen.length
    this.enforceBudget()
    return snapshotFromEntry(entry, frozen)
  }

  setPins(pins: TranscriptRenderStorePins): void {
    this.pins.clear()
    for (const id of pins.pinned) {
      this.assertBlockId(id)
      this.pins.add(id)
    }
    this.enforceBudget()
  }

  clearPins(): void {
    this.pins.clear()
    this.enforceBudget()
  }

  reset(): void {
    this.entries.clear()
    this.pins.clear()
    this.accessCounter = 0
    this.counters.hits = 0
    this.counters.evictions = 0
    this.counters.rebuilds = 0
    this.counters.stableRowsReused = 0
    this.counters.tailRowsRerendered = 0
  }

  blockRowRange(input: { blockId: string; blockOrder: readonly string[] }): TranscriptBlockRowRange | undefined {
    this.assertBlockId(input.blockId)
    const index = input.blockOrder.indexOf(input.blockId)
    if (index < 0) return undefined
    // Force resolution of every block in the prefix so the cumulative
    // range is exact, not estimated.
    let start = 0
    for (let i = 0; i < index; i += 1) {
      const id = input.blockOrder[i] as string
      const snapshot = this.readBlock({ blockId: id })
      if (snapshot === undefined) {
        // The block was missing entirely; its slot is zero rows so the
        // cumulative range can still advance.
        continue
      }
      start += snapshot.rowCount
    }
    const target = this.readBlock({ blockId: input.blockId })
    if (target === undefined) return undefined
    return { start, end: start + target.rowCount }
  }

  totalRows(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      total += this.linesFor(entry.blockId).length
    }
    return total
  }

  stats(): TranscriptRenderStoreStats {
    let cachedBlocks = 0
    let cachedRows = 0
    let cachedBytes = 0
    for (const entry of this.entries.values()) {
      const lines = this.linesFor(entry.blockId)
      if (lines.length === 0 && entry.settledLines === undefined && entry.activeRevision === null) {
        continue
      }
      cachedBlocks += 1
      cachedRows += lines.length
      for (const line of lines) cachedBytes += physicalLineByteSize(line)
    }
    return {
      hits: this.counters.hits,
      evictions: this.counters.evictions,
      rebuilds: this.counters.rebuilds,
      stableRowsReused: this.counters.stableRowsReused,
      tailRowsRerendered: this.counters.tailRowsRerendered,
      cachedBlocks,
      cachedRows,
      cachedBytes,
    }
  }

  /** Internal: called by MutableRevisionImpl on settle. */
  commitSettle(blockId: string, frozen: readonly PhysicalLine[], scopeKey: string): BlockSnapshot {
    const entry = this.entries.get(blockId)
    if (entry === undefined) {
      throw new Error(`commitSettle(${blockId}): missing entry`)
    }
    // v8 ignore next -- MutableRevisionImpl.requireAlive() guards against double settle/discard
    // before reaching this path; the check stays as a defensive catch for future callers that bypass it.
    if (entry.activeRevision === null) {
      throw new Error(`commitSettle(${blockId}): no active revision to settle`)
    }
    entry.activeRevision = null
    entry.scopeKey = scopeKey
    entry.settledLines = frozen
    entry.priorSettled = null
    entry.lastAccess = this.nextAccess()
    this.enforceBudget()
    return snapshotFromEntry(entry, frozen)
  }

  /** Internal: called by MutableRevisionImpl on discard. */
  commitDiscard(blockId: string): void {
    const entry = this.entries.get(blockId)
    if (entry === undefined) {
      throw new Error(`commitDiscard(${blockId}): missing entry`)
    }
    entry.activeRevision = null
    entry.settledLines = entry.priorSettled ?? null
    entry.priorSettled = null
    entry.lastAccess = this.nextAccess()
    this.enforceBudget()
  }

  /** Internal: called from the revision to bump tail counters. */
  recordTailRerender(rowCount: number): void {
    this.counters.tailRowsRerendered += rowCount
  }

  /** Internal: called from the revision to refresh LRU access on the owning block. */
  touchActiveBlock(blockId: string): void {
    const entry = this.entries.get(blockId)
    if (entry !== undefined) entry.lastAccess = this.nextAccess()
  }

  /** Internal: keep source authority current while an active handle lives. */
  replaceActiveSource(blockId: string, source: string): void {
    const entry = this.entries.get(blockId)
    if (entry === undefined || entry.activeRevision === null) {
      throw new Error(`replaceActiveSource(${blockId}): no active revision`)
    }
    entry.source = source
    entry.revision += 1
  }

  private linesFor(blockId: string): readonly PhysicalLine[] {
    const entry = this.entries.get(blockId)
    // v8 ignore next -- callers (totalRows, stats) iterate entries.values() so the entry is always
    // defined; the check stays as a safety net.
    if (entry === undefined) return EMPTY_LINES
    if (entry.activeRevision !== null) return entry.activeRevision.lines
    if (entry.settledLines !== undefined && entry.settledLines !== null) return entry.settledLines
    return EMPTY_LINES
  }

  private assertBlockId(blockId: string): void {
    if (typeof blockId !== 'string' || blockId === '') {
      throw new Error('TranscriptRenderStore: blockId must be a non-empty string')
    }
  }

  private assertScopeKey(scopeKey: string): void {
    if (typeof scopeKey !== 'string' || scopeKey === '') {
      throw new Error('TranscriptRenderStore: scopeKey must be a non-empty string')
    }
  }

  private nextAccess(): number {
    this.accessCounter += 1
    return this.accessCounter
  }

  /** Evict unpinned settled blocks until both row and byte budgets fit. */
  private enforceBudget(): void {
    const totals = this.computeTotals()
    if (totals.rows <= this.config.maxRows && totals.bytes <= this.config.maxBytes) return
    const candidates: BlockEntry[] = []
    for (const entry of this.entries.values()) {
      if (this.pins.has(entry.blockId)) continue
      if (entry.activeRevision !== null) continue
      if (entry.settledLines === null || entry.settledLines === undefined) continue
      candidates.push(entry)
    }
    candidates.sort((a, b) => a.lastAccess - b.lastAccess)
    for (const entry of candidates) {
      if (totals.rows <= this.config.maxRows && totals.bytes <= this.config.maxBytes) break
      const settled = entry.settledLines as readonly PhysicalLine[]
      const rowCount = settled.length
      let byteCount = 0
      for (const line of settled) byteCount += physicalLineByteSize(line)
      entry.settledLines = null
      entry.lastAccess = 0
      this.counters.evictions += 1
      totals.rows -= rowCount
      totals.bytes -= byteCount
    }
  }

  private computeTotals(): { rows: number; bytes: number } {
    let rows = 0
    let bytes = 0
    for (const entry of this.entries.values()) {
      const lines = entry.activeRevision === null
        ? (entry.settledLines ?? EMPTY_LINES)
        : entry.activeRevision.lines
      for (const line of lines) {
        rows += 1
        bytes += physicalLineByteSize(line)
      }
    }
    return { rows, bytes }
  }
}

const EMPTY_LINES: readonly PhysicalLine[] = Object.freeze([])

function snapshotFromEntry(
  entry: BlockEntry,
  lines: readonly PhysicalLine[],
): BlockSnapshot {
  return Object.freeze({
    blockId: entry.blockId,
    source: entry.source,
    scopeKey: entry.scopeKey,
    revision: entry.revision,
    lines,
    rowCount: lines.length,
  })
}

/**
 * Create a renderer-owned transcript line store. The store owns no
 * timers or listeners and stays usable across remounts; pass the same
 * instance to multiple render-loop hooks so the LRU state outlives
 * individual frames.
 * @param config - row/byte budgets and the rebuild callback.
 * @returns the store handle.
 */
export function createTranscriptRenderStore(
  config: TranscriptRenderStoreConfig,
): TranscriptRenderStore {
  return new TranscriptRenderStoreImpl(config)
}
