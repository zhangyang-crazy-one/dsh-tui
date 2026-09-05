/** Rebuildable plain-text wrap indexes; styled rows are created only for requested offsets. */
import { displayWidth, escapeContent, wrapDisplayLines } from './content.ts'
import type { MarkdownRenderLine } from './markdown-projector.ts'
import type { RenderPolicyCache } from './render-policy.ts'
import { indexedRows, type RowSource } from './row-source.ts'

interface CachedText {
  readonly source: string
  readonly rows: RowSource<MarkdownRenderLine>
  readonly bytes: number
  readonly naturalWidth: number
  readonly width: number
}

/** Bounded wrap indexes for complete reasoning text, independent of unrelated fold state. */
export class PlainTextRowCache {
  private readonly entries = new Map<string, CachedText>()
  private bytes = 0
  private count = 0

  /** @param policy - host-validated row and byte budgets for derived text. */
  constructor(private readonly policy: RenderPolicyCache) {}

  /**
   * Index complete source lines while deferring styled row creation to viewport reads.
   * @param id - stable owning text id.
   * @param source - canonical, unabridged reasoning text.
   * @param width - body width excluding its two-column indentation.
   * @returns every physical body row; the main transcript owns clipping and scrolling.
   */
  rows(id: string, source: string, width: number): RowSource<MarkdownRenderLine> {
    const key = `${id}\u0000${width}`
    const cached = this.entries.get(key)
    if (cached?.source === source) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached.rows
    }
    if (cached !== undefined) this.remove(key, cached)
    for (const entry of this.entries.values()) {
      if (entry.source === source && entry.naturalWidth <= Math.min(width, entry.width)) {
        this.remember(key, entry)
        return entry.rows
      }
    }
    const wrapped: string[] = []
    let naturalWidth = 0
    for (const line of escapeContent(source).replace(/\t/gu, '\\t').split('\n')) {
      const columns = displayWidth(line)
      naturalWidth = Math.max(naturalWidth, columns)
      if (columns <= width) wrapped.push(line)
      else wrapped.push(...wrapDisplayLines(line, width))
    }
    const materialized = new Map<number, MarkdownRenderLine>()
    const rows = indexedRows(wrapped.length, (index) => {
      const hit = materialized.get(index)
      if (hit !== undefined) return hit
      const text = `  ${wrapped[index] as string}`
      const columns = displayWidth(text)
      const row: MarkdownRenderLine = { text, displayWidth: columns, spans: [{ start: 0, end: columns, token: 'fgDim', bold: false }], rowInBlock: index + 1, sourceStart: -1, sourceEnd: -1, rawTail: false }
      materialized.set(index, row)
      return row
    })
    this.remember(key, { source, rows, naturalWidth, width, bytes: Buffer.byteLength(source) + wrapped.length * 128 })
    return rows
  }

  private remember(key: string, entry: CachedText): void {
    this.entries.set(key, entry)
    this.bytes += entry.bytes
    this.count += entry.rows.length
    while (this.bytes > this.policy.maxBytes || this.count > this.policy.maxRows) {
      const [oldKey, oldEntry] = this.entries.entries().next().value as [string, CachedText]
      this.remove(oldKey, oldEntry)
    }
  }

  /** Release derived data without modifying the owning session's text. */
  clear(): void { this.entries.clear(); this.bytes = 0; this.count = 0 }

  private remove(key: string, entry: CachedText): void {
    this.entries.delete(key)
    this.bytes -= entry.bytes
    this.count -= entry.rows.length
  }
}
