/** Renderer-owned history primitives. Canonical session objects are never mutated. */

/** Read-through active overlay. Construction never enumerates the settled map. */
export function overlayMap<K, V>(settled: ReadonlyMap<K, V>, active: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return new HistoryOverlay(settled, active)
}

class HistoryOverlay<K, V> implements ReadonlyMap<K, V> {
  constructor(private readonly settled: ReadonlyMap<K, V>, private readonly active: ReadonlyMap<K, V>) {}
  get size(): number {
    let size = this.settled.size
    for (const key of this.active.keys()) if (!this.settled.has(key)) size++
    return size
  }
  has(key: K): boolean { return this.active.has(key) || this.settled.has(key) }
  get(key: K): V | undefined { return this.active.has(key) ? this.active.get(key) : this.settled.get(key) }
  *entries(): MapIterator<[K, V]> {
    for (const pair of this.settled) if (!this.active.has(pair[0])) yield pair
    yield* this.active
  }
  *keys(): MapIterator<K> { for (const [key] of this.entries()) yield key }
  *values(): MapIterator<V> { for (const [, value] of this.entries()) yield value }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.entries() }
  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this)
  }
}

/** Exact suffix directory. Unknown prefix has no fabricated row heights. */
export class ExactHistoryWindow<T> {
  private source: readonly T[] | undefined
  private scope = ''
  start = 0
  generation = 0
  get complete(): boolean { return this.start === 0 }

  /** Replace the source/scope and invalidate every callback from the previous revision. */
  update(source: readonly T[], scope: string, initialEntries: number): void {
    if (this.source === source && this.scope === scope) return
    // Preserve the prepared suffix boundary on append to the same immutable history.
    const appended = this.scope === scope && this.source !== undefined
      && source.length >= this.source.length && this.source.length > 0
      && this.source.every((entry, index) => entry === source[index])
    this.start = appended ? this.start : Math.max(0, source.length - initialEntries)
    this.source = source
    this.scope = scope
    this.generation++
  }

  /** Advance only the admitted revision; old work cannot repopulate a replaced scope. */
  advance(generation: number, entries: number): boolean {
    if (generation !== this.generation || this.complete) return false
    this.start = Math.max(0, this.start - entries)
    return true
  }
}

/** Counts are layered; physical cache bytes are deliberately not a whole-heap claim. */
export interface HistoryWorkStats {
  readonly generation: number
  readonly canonicalEntries: number
  readonly indexedEntries: number
  readonly pendingEntries: number
  readonly settledSignatures: number
  readonly descriptorVisits: number
  readonly settledMapCopies: number
  readonly projectedActiveRequests: number
  readonly projectionOwners: number
  readonly rebuildDescriptors: number
  readonly revisionOwners: number
  readonly signatures: number
  readonly projectorStates: number
  readonly projectorSources: number
  readonly lineEntries: number
  readonly projectionCache: ReturnType<HistoryRowCache['stats']>
  readonly cachedRows: number
  readonly cachedBytes: number
  readonly pinnedRows: number
  readonly pinnedBytes: number
  readonly overBudgetRows: number
  readonly overBudgetBytes: number
  readonly toolCache: { entries: number; rows: number; materialized: number; evictions: number }
  readonly pinnedBlocks: number
  readonly pendingPresentations: number
  readonly firstInteractive: boolean
}

import { indexedRows, type RowSource } from './row-source.ts'
import type { MarkdownRenderLine } from './markdown-projector.ts'

interface CachedHistoryRows {
  readonly owner: string
  readonly block: string
  readonly rows: RowSource<MarkdownRenderLine>
  readonly bytes: number
}

/** Row/byte bounded materialized projections behind an exact, source-backed directory. */
export class HistoryRowCache {
  private readonly entries = new Map<number, CachedHistoryRows>()
  private readonly pins = new Set<string>()
  private next = 0
  private rows = 0
  private bytes = 0
  private transient: number | undefined
  rebuilds = 0
  constructor(private readonly maxRows: number, private readonly maxBytes: number) {}

  /** Retain exact height independently of evictable materialization and its parser state. */
  wrap(owner: string, block: string, rows: RowSource<MarkdownRenderLine>, rebuild: () => RowSource<MarkdownRenderLine>): RowSource<MarkdownRenderLine> {
    const key = ++this.next
    const length = rows.length
    this.put(key, owner, block, rows)
    return indexedRows(length, index => {
      let cached = this.entries.get(key)
      if (cached === undefined) {
        const rebuilt = rebuild()
        if (rebuilt.length !== length) throw new Error(`HistoryRowCache: inexact rebuild for ${block}`)
        this.transient = key
        this.put(key, owner, block, rebuilt)
        cached = this.entries.get(key)!
        this.rebuilds++
      } else {
        this.entries.delete(key)
        this.entries.set(key, cached)
      }
      return cached.rows.at(index)!
    })
  }

  private put(key: number, owner: string, block: string, rows: RowSource<MarkdownRenderLine>): void {
    // Count materialized row records conservatively; source UTF-16 is accounted separately.
    let bytes = 128
    // Lazy tool/plain sources must stay lazy. The budget charges their exact height conservatively.
    if (Array.isArray(rows)) {
      for (const line of rows as MarkdownRenderLine[]) bytes += line.text.length * 2 + line.spans.length * 48 + 128
    } else bytes += rows.length * 256
    this.entries.set(key, { owner, block, rows, bytes })
    this.rows += rows.length
    this.bytes += bytes
    this.enforce()
  }

  private drop(key: number, cached: CachedHistoryRows): void {
    this.entries.delete(key)
    this.rows -= cached.rows.length
    this.bytes -= cached.bytes
  }
  private enforce(): void {
    if (this.rows <= this.maxRows && this.bytes <= this.maxBytes) return
    for (const [key, cached] of this.entries) {
      if (this.rows <= this.maxRows && this.bytes <= this.maxBytes) break
      if (key === this.transient || this.pins.has(cached.owner)) continue
      this.drop(key, cached)
    }
  }
  setPins(owners: ReadonlySet<string>): void {
    this.pins.clear()
    for (const owner of owners) this.pins.add(owner)
    this.transient = undefined
    this.enforce()
  }
  retainOwners(owners: ReadonlySet<string>): void {
    for (const [key, cached] of this.entries) if (!owners.has(cached.owner)) this.drop(key, cached)
    for (const owner of this.pins) if (!owners.has(owner)) this.pins.delete(owner)
  }
  clear(): void { this.entries.clear(); this.pins.clear(); this.rows = 0; this.bytes = 0; this.transient = undefined }
  stats(): { entries: number; rows: number; estimatedBytes: number; pinnedRows: number; overBudgetRows: number; overBudgetBytes: number; rebuilds: number } {
    let pinnedRows = 0
    for (const [key, cached] of this.entries) if (key === this.transient || this.pins.has(cached.owner)) pinnedRows += cached.rows.length
    return { entries: this.entries.size, rows: this.rows, estimatedBytes: this.bytes, pinnedRows,
      overBudgetRows: Math.max(0, this.rows - this.maxRows), overBudgetBytes: Math.max(0, this.bytes - this.maxBytes), rebuilds: this.rebuilds }
  }
}
