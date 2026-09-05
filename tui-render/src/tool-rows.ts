/** Bounded, rebuildable tool previews; body rows materialize only on viewport reads. */

import { displayWidth, escapeContent } from './content.ts'
import type { MarkdownRenderLine, MarkdownStyleToken } from './markdown-projector.ts'
import type { RenderPolicyTools } from './render-policy.ts'
import { indexedRows, type RowSource } from './row-source.ts'
import { createToolBodyDocument, materializeToolBodyRow, planToolBodyWindow } from './tool-body.ts'
import type { ToolBodyCard, ToolBodyLine, ToolBodyWindow } from './tool-body.ts'
import { collapsedToolCardSummary, fileUrlFromToolArguments, tokenizeCommandHeading, toolCardDisplayStatus, truncateDisplay } from './tool-cards.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Retain an action prefix and identifying suffix within a display-column budget.
 * @param text - escaped single-line text.
 * @param maxCols - available terminal columns.
 * @param leadingShare - fraction of retained columns assigned to the prefix.
 * @returns a width-safe string with one middle ellipsis when needed.
 */
export function truncateMiddleDisplay(text: string, maxCols: number, leadingShare = 0.5): string {
  if (maxCols <= 0) return ''
  if (displayWidth(text) <= maxCols) return text
  if (maxCols === 1) return '…'
  const budget = maxCols - 1
  const headBudget = Math.max(1, Math.min(budget, Math.ceil(budget * leadingShare)))
  const parts = Array.from(graphemes.segment(text), part => part.segment)
  const take = (items: readonly string[], available: number): string[] => {
    const out: string[] = []
    let used = 0
    for (const item of items) {
      used += displayWidth(item)
      if (used > available) break
      out.push(item)
    }
    return out
  }
  return `${take(parts, headBudget).join('')}…${take(parts.reverse(), budget - headBudget).reverse().join('')}`
}

function toolRow(parts: readonly { text: string; token: MarkdownStyleToken; href?: string }[], index: number, width: number, background: 'toolBg' | 'codeBg'): MarkdownRenderLine {
  let column = 0
  const spans = parts.map((part) => {
    const start = column
    column += displayWidth(part.text)
    return { start, end: column, token: part.token, bold: false, ...(part.href === undefined ? {} : { href: part.href }) }
  })
  return { text: parts.map(part => part.text).join(''), displayWidth: column, spans,
    rowInBlock: index, sourceStart: -1, sourceEnd: -1, rawTail: false, background, backgroundColumns: width }
}

/**
 * Render one tool's action, status, and concise result summary.
 * @param card - paired canonical fields and presenter views.
 * @param width - available terminal columns.
 * @param expanded - preview disclosure state.
 * @param locale - display-copy locale.
 * @returns a single width-bounded heading row.
 */
export function toolHeadingRow(card: ToolBodyCard, width: number, expanded: boolean, locale: TuiLocale): MarkdownRenderLine {
  const status = toolCardDisplayStatus(card)
  const label = status === 'ok' ? '✓' : tuiCopy(status === 'error' ? 'failed' : 'running', locale)
  const glyph = expanded ? '▾' : '▸'
  if (width < displayWidth(`${glyph} … · ${label}`)) return toolRow([{ text: truncateDisplay(`${glyph} ${label}`, width), token: status === 'error' ? 'error' : 'fgDim' }], 0, width, 'toolBg')
  const heading = escapeContent(card.resultView?.title ?? card.callView?.title ?? card.name).replace(/[\n\t]/gu, ' ')
  const terminal = card.callView?.card === 'terminal' || card.resultView?.card === 'terminal'
  const fitted = truncateMiddleDisplay(heading, Math.max(1, width - displayWidth(`${glyph}  · ${label}`)), terminal ? 0.72 : 0.5)
  const parts: { text: string; token: MarkdownStyleToken; href?: string }[] = expanded && terminal
    ? [{ text: `${glyph} `, token: 'fgDim' }, ...tokenizeCommandHeading(fitted), { text: ' · ', token: 'fgDim' }]
    : [{ text: `${glyph} ${fitted} · `, token: 'fgSoft' }]
  parts.push({ text: label, token: status === 'error' ? 'error' : status === 'running' ? 'accentText' : 'fgDim' })
  const summary = !expanded || status === 'error' ? collapsedToolCardSummary(card) : undefined
  const available = width - parts.reduce((sum, part) => sum + displayWidth(part.text), 0) - 1
  const href = fileUrlFromToolArguments(card.arguments)
  if (summary !== undefined && available >= 2) parts.push({ text: ` ${truncateDisplay(summary, available)}`, token: 'fgDim', ...(href === undefined ? {} : { href }) })
  return toolRow(parts, 0, width, 'toolBg')
}

/**
 * Indent one already-escaped detail fragment without traversing other source rows.
 * @param line - one fragment from materializeToolBodyRow.
 * @param index - physical row index inside the card.
 * @param width - full card width, including the two-column indent.
 * @returns a semantic tool/code surface row.
 */
export function toolBodyRenderRow(line: ToolBodyLine, index: number, width: number): MarkdownRenderLine {
  return toolRow([{ text: `  ${line.text}`, token: line.token === 'codeBg' ? 'fgSoft' : 'fgDim' }], index, width, line.token === 'codeBg' ? 'codeBg' : 'toolBg')
}

/**
 * Explain the remainder and its working per-item detail entry.
 * @param remaining - logical source rows not completely displayed.
 * @param width - full card width.
 * @param index - row index inside the card.
 * @param locale - display-copy locale.
 * @returns a bounded hint whose command survives narrow layouts.
 */
export function toolRemainingRow(remaining: number, width: number, index: number, locale: TuiLocale): MarkdownRenderLine {
  const action = tuiCopy('toolDetails', locale)
  const hint = `  ${action} · ${remaining} ${tuiCopy('remaining', locale)}`
  return toolRow([{ text: truncateDisplay(hint, width), token: 'fgDim' }], index, width, 'toolBg')
}

interface CachedPreview {
  readonly card: ToolBodyCard
  readonly document: RowSource<ToolBodyLine> | undefined
  readonly window: ToolBodyWindow | undefined
  readonly rows: Map<number, MarkdownRenderLine>
  readonly length: number
}

function sameCard(left: ToolBodyCard, right: ToolBodyCard): boolean {
  return left.name === right.name && left.arguments === right.arguments && left.resultText === right.resultText
    && left.status === right.status && left.callView === right.callView && left.resultView === right.resultView
    && left.meta === right.meta && left.error === right.error
}

/** Cache of bounded preview measurements and only the rows requested by the viewport. */
export class ToolRowCache {
  private readonly entries = new Map<string, CachedPreview>()
  private rowCount = 0
  private materialized = 0
  private evictions = 0

  /** @param policy - host-validated per-document and total cache budgets. */
  constructor(private readonly policy: RenderPolicyTools) {}

  /**
   * Publish a known-height preview without materializing its body.
   * @param id - stable tool id, independent of neighboring hidden parts.
   * @param card - immutable canonical revision and presenter views.
   * @param width - full card width.
   * @param expanded - global disclosure intent.
   * @param locale - display-copy locale.
   * @returns random-access rows whose evicted data can be rebuilt from canonical fields.
   */
  rows(id: string, card: ToolBodyCard, width: number, expanded: boolean, locale: TuiLocale): RowSource<MarkdownRenderLine> {
    const key = `${id}\u0000${width}\u0000${expanded}\u0000${locale}`
    const ensure = (): CachedPreview => {
      const cached = this.entries.get(key)
      if (cached !== undefined && sameCard(cached.card, card)) {
        this.entries.delete(key)
        this.entries.set(key, cached)
        return cached
      }
      if (cached !== undefined) this.remove(key, cached)
      const document = expanded ? createToolBodyDocument(card, { diagnostics: false, includeArguments: false, locale }) : undefined
      const window = document === undefined ? undefined
        : planToolBodyWindow(document, { line: 0, offset: 0 }, Math.max(1, width - 2), this.policy.previewRows)
      const entry: CachedPreview = {
        card, document, window, rows: new Map(),
        length: 1 + (window?.fragments.length ?? 0) + (window?.next === undefined ? 0 : 1),
      }
      this.entries.set(key, entry)
      this.trim()
      return entry
    }
    const length = ensure().length
    // The descriptor retains source fields, not an evictable document or formatted row array.
    return indexedRows(length, (index) => {
      const entry = ensure()
      const cached = entry.rows.get(index)
      if (cached !== undefined) return cached
      const fragment = entry.window?.fragments[index - 1]
      const row = index === 0 ? toolHeadingRow(card, width, expanded, locale)
        : fragment === undefined ? toolRemainingRow(entry.window?.remainingLines ?? 0, width, index, locale)
          : toolBodyRenderRow(materializeToolBodyRow(entry.document as NonNullable<CachedPreview['document']>, fragment), index, width)
      entry.rows.set(index, row)
      this.rowCount += 1
      this.materialized += 1
      this.trim()
      return row
    })
  }

  /** Release derived documents and rows; canonical session data belongs to the caller. */
  clear(): void { this.entries.clear(); this.rowCount = 0 }

  /**
   * Read current cache occupancy and lifetime construction work.
   * @returns cache occupancy and cumulative materialization/eviction counts.
   */
  stats(): { entries: number; rows: number; materialized: number; evictions: number } {
    return { entries: this.entries.size, rows: this.rowCount, materialized: this.materialized, evictions: this.evictions }
  }

  private remove(key: string, entry: CachedPreview): void {
    this.entries.delete(key)
    this.rowCount -= entry.rows.size
    this.evictions += 1
  }

  private trim(): void {
    while (this.entries.size > this.policy.cacheEntries || this.rowCount > this.policy.cacheRows) {
      const [key, entry] = this.entries.entries().next().value as [string, CachedPreview]
      this.remove(key, entry)
    }
  }
}
