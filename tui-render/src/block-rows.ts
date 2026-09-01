/**
 * Ink-free physical-row projection for transcript blocks.
 *
 * `optimize-tui-streaming-renderer` Decision 1 states that the renderer
 * must virtualize the transcript at the physical-row level: the visible
 * viewport (plus a bounded overscan) determines which rows mount, and the
 * row counts come from a pure-data projector so Ink never has to
 * re-measure a block to know its height. This module owns that projection.
 *
 * Each transcript block — user/assistant prose, reasoning, tool cards,
 * compactions, turn tails, dense digests, the active-turn placeholder —
 * is reduced to one ordered array of {@link MarkdownRenderLine} records
 * whose row count is exact. Markdown blocks reuse the existing
 * {@link createMarkdownProjector} (Decision 2) so the projector cache and
 * table scanner stay in one place; non-markdown blocks assemble their
 * own rows from the immutable projection records that own their shape
 * (tool card / divider / turn tail / digest / reasoning fold marker).
 *
 * The projection is pure: it never reads from Ink, React, the
 * `TranscriptRenderStore`, or the `useStdout` / `useWindowSize` hooks.
 * The renderer can call it from a `useMemo` (or from a non-React worker)
 * to know how many rows a block contributes before any JSX mounts, and
 * the same call repeated with the same inputs returns the same rows so
 * settled blocks keep stable line references until content or scope
 * changes. The `BlockScope.scopeKey` captures every input that affects
 * rendering (width, theme tier, fold, hyperlink flag) so the
 * projector-side caching strategies — mdast cache, line-store
 * reconstruction, per-block output references — all key on the same
 * string.
 *
 * The module owns one {@link MarkdownProjectorState} per block per
 * scope; the renderer hands that state to {@link projectBlockRows} so
 * callers do not leak projector instances into the garbage collector.
 *
 * @module @deepseek-ai/dsh-tui-render/block-rows
 */

import { displayWidth, escapeContent, wrapDisplayLines } from './content.ts'
import {
  type MarkdownProjection,
  type MarkdownRenderScope,
  type MarkdownRenderLine,
  type MarkdownRenderSpan,
  type MarkdownProjector as MarkdownProjectorHandle,
  type MarkdownCollector as MarkdownCollectorHandle,
  type SafeFullRecomputeReason,
  type MarkdownProjectorStats,
  type MarkdownBlockRenderer,
  createMarkdownCollector,
  createMarkdownProjector,
} from './markdown-projector.ts'
import {
  createStyledMarkdownBlockRenderer,
  renderStreamingTableCells,
} from './markdown-render.ts'
import type { StreamingTableRenderCache } from './markdown-render.ts'
import { parseMarkdownSource } from './markdown-parse.ts'
import { parsePipeTableCells, TableScanner } from './table-scanner.ts'
import { collapsedCardSummary, truncateDisplay } from './tool-cards.ts'
import type {
  ToolCardCallView,
  ToolCardResultView,
  ToolCardStatus,
} from './tool-cards.ts'

/**
 * Identity of the visible-row-projection entry. Stable across re-renders so
 * the renderer's per-row React keys and the line-store's per-block cache
 * key stay comparable.
 */
export interface BlockRowsEntry {
  /** Stable owning block identity (matches {@link TranscriptLineStore}). */
  readonly id: string
  /** Block kind; selects the row-builder strategy. */
  readonly kind: BlockRowsKind
  /**
   * Source owned by the entry. Markdown-bearing blocks (`markdown`,
   * `user`, `assistant-prose`) hold the markdown source; reasoning holds
   * the raw reasoning text; tool cards hold either a JSON-encoded
   * representation (preferred) or the result text (fallback); the
   * digests, dividers, and tailers hold a precomputed string the
   * projector joins literally.
   */
  readonly source: string
  /** Kind-specific metadata the projector reads. */
  readonly meta?: BlockRowsMeta
}

/** Classification used by the projector to dispatch to a row builder. */
export type BlockRowsKind =
  | 'user'
  | 'assistant-prose'
  | 'reasoning'
  | 'tool-card'
  | 'divider'
  | 'compaction'
  | 'turn-tail'
  | 'dense-digest'
  | 'active-placeholder'
  | 'markdown'

/** Per-kind metadata; fields outside the active kind are ignored. */
export interface BlockRowsMeta {
  /** Reasoning block. */
  readonly reasoningExpanded?: boolean
  /** Reasoning duration stamp (the `1.2s`/`48.8s` label). */
  readonly reasoningDurationMs?: number
  /** Reasoning live-tail: header plus the last tail rows when generating. */
  readonly reasoningLive?: boolean
  /** Tool-card collapsed summary overrides; placeholder while we still
   * re-render via the JSX components — future task will move to lines. */
  readonly toolCard?: ToolCardProjection | undefined
  /** Compaction summary text (only painted when `compactionExpanded`). */
  readonly compactionSummary?: string
  /** Whether the compaction divider is currently expanded (Ctrl+K). */
  readonly compactionExpanded?: boolean
  /** Compaction shadowed count (`已压缩 N 条`). */
  readonly compactionShadowedCount?: number
  /** Turn-tail produced paths array for the `产物` row. */
  readonly turnTailProduced?: readonly string[]
  /** Turn-tail stats string (`turn N · M tok · Mms`); undefined hides the row. */
  readonly turnTailStats?: string
  /** Whether the turn tail shows the `── 已完成 ──` separator. */
  readonly turnTailCompletionBoundary?: boolean
  /** Dense-digest row text (if non-empty). */
  readonly denseDigestText?: string
  /** Active-turn placeholder row text (`● 正在思考…`). */
  readonly activePlaceholder?: string
}

/** Pre-paired tool-card data the row builder needs. */
export interface ToolCardProjection {
  /** Tool-call name shown in the heading. */
  readonly name: string
  /** Tool-call arguments JSON for the collapsed summary. */
  readonly arguments: string
  /** Whether the result has arrived and whether it failed. */
  readonly status: ToolCardStatus
  /** Concatenated result text or undefined for running cards. */
  readonly resultText?: string
  /** Tool-private JSON presentation metadata. */
  readonly meta?: unknown
  /** Presenter call view, when the registry supplies one. */
  readonly callView?: ToolCardCallView
  /** Presenter result view, when the registry supplies one. */
  readonly resultView?: ToolCardResultView
}

/** Inputs that change the projected row output for any block. */
export interface BlockRowsScope {
  /** Conversation column width in columns (after gutter). */
  readonly width: number
  /** Theme tier identifier; matches {@link MarkdownRenderScope.theme}. */
  readonly theme: 'truecolor' | '256' | '16' | 'none'
  /** Fold mode (drives the reasoning fold and tool card collapse). */
  readonly fold: BlockRowsFold
  /** Render mode — settled blocks lose the streaming cursor. */
  readonly renderMode: 'settled' | 'streaming'
  /** Pre-built composite scope key for caching; see {@link computeBlockRowsScopeKey}. */
  readonly scopeKey: string
}

/** Three-axis fold state; legacy `reasoningExpanded` / `toolCardsExpanded`. */
export interface BlockRowsFold {
  readonly reasoning: boolean
  readonly tools: boolean
}

/**
 * Compute a stable scope key for {@link BlockRowsScope}. Captures every
 * field that affects physical-row output so the projector and the
 * line-store agree on when a cached snapshot is still valid.
 * @param width - conversation column width.
 * @param theme - theme tier identifier.
 * @param fold - reasoning/tools fold modes.
 * @param renderMode - settled vs streaming.
 * @returns the canonical scope key.
 */
export function computeBlockRowsScopeKey(
  width: number,
  theme: 'truecolor' | '256' | '16' | 'none',
  fold: BlockRowsFold,
  renderMode: 'settled' | 'streaming',
): string {
  return `${width}|${theme}|${fold.reasoning ? 'r1' : 'r0'}|${fold.tools ? 't1' : 't0'}|${renderMode}`
}

/**
 * One projection result for a single block entry.
 *
 * The line array is frozen by definition — settled entries return the
 * same line references on repeated projections; the line-store hands the
 * very same array to callers when it has been settled. Streaming entries
 * always allocate a fresh array; React keys and per-row paint caches
 * key on `(entry.id, rowInBlock)` to skip unchanged rows.
 */
export interface BlockRowsProjection {
  /** Source revision the projector consumed (matches the collector). */
  readonly revision: number
  /** Block's source length (committed + raw tail) after projection. */
  readonly sourceLength: number
  /** Stable ordered lines for the block. */
  readonly lines: readonly MarkdownRenderLine[]
}

/**
 * Mutable projector/scanner state the renderer owns per block per scope.
 *
 * The projector and scanner pair stay alive across renders so the
 * incremental parsing + table-holdback analytics persist; a new scope
 * (resize, fold toggle, theme swap) discards the previous pair by
 * asking the renderer to allocate a fresh `MarkdownProjectorState`.
 */
export interface MarkdownProjectorState {
  readonly blockId: string
  readonly scopeKey: string
  readonly projector: MarkdownProjectorHandle
  readonly collector: MarkdownCollectorHandle
  readonly scanner: TableScanner
  /** Last source fed; mirrors the collector's committed state. */
  lastSource: string
  /** Stats accessor — exposed for {@link BlockRowsProjection}. */
  stats(): MarkdownProjectorStats
  /** Reason this block last took the safe-recompute path. */
  lastSafeRecompute: SafeFullRecomputeReason | undefined
  /** Last projection cached so unchanged-source re-renders skip reprojection. */
  cachedProjection: BlockRowsProjection | undefined
  /**
   * Last (source, scope-key) tuple the cached projection was emitted for.
   * Mismatch invalidates the cache.
   */
  cachedSignature: string
  /** Reusable committed rows for the currently confirmed streaming table. */
  tableRenderCache: StreamingTableRenderCache | undefined
  /** Last projector result containing the active table's held-back mdast block. */
  activeTableProjection: MarkdownProjection | undefined
  /** Source offset paired with {@link activeTableProjection}. */
  activeTableStart: number | undefined
  /** Last closed streaming table rows reused by the mdast renderer. */
  readonly closedTableRows: {
    current: { readonly start: number; readonly lines: readonly MarkdownRenderLine[] } | undefined
  }
}

/**
 * Create one fresh projector/scanner pair for a single block.
 * The renderer keeps it across re-renders until scope or block changes.
 * @param blockId - stable block identity the state belongs to.
 * @param scope - rendering scope the projector was created for.
 * @returns a fresh mutable state handle.
 */
export function createMarkdownProjectorState(
  blockId: string,
  scope: BlockRowsScope,
): MarkdownProjectorState {
  const scanner = new TableScanner()
  const closedTableRows: MarkdownProjectorState['closedTableRows'] = { current: undefined }
  const baseRenderer = createStyledMarkdownBlockRenderer({
    width: Math.max(1, scope.width),
    hyperlinks: false,
  })
  const renderer: MarkdownBlockRenderer = {
    renderBlock(node, renderScope, blockIndex) {
      const scannerState = scanner.snapshot()
      const sourceStart = node.position?.start.offset
      const closedTable = closedTableRows.current
      if (
        node.type === 'table'
        && closedTable !== undefined
        && sourceStart === closedTable.start
      ) return closedTable.lines
      if (
        node.type === 'table'
        && scannerState.state.kind === 'confirmed-table'
        && sourceStart === scannerState.mutableStart
      ) {
        return []
      }
      return baseRenderer.renderBlock(node, renderScope, blockIndex)
    },
    renderRawTail(text, width, renderScope) {
      return baseRenderer.renderRawTail(text, width, renderScope)
    },
  }
  const projector = createMarkdownProjector(renderer, { cacheLimit: 1024 })
  return {
    blockId,
    scopeKey: scope.scopeKey,
    projector,
    collector: projector.collector,
    scanner,
    lastSource: '',
    stats: () => projector.stats(),
    lastSafeRecompute: undefined,
    cachedProjection: undefined,
    cachedSignature: '',
    tableRenderCache: undefined,
    activeTableProjection: undefined,
    activeTableStart: undefined,
    closedTableRows,
  }
}

/**
 * Project one block entry to its ordered physical rows. Pure data: no
 * React, no Ink, no shared state. The caller controls how the result is
 * cached or stored.
 *
 * Markdown-bearing entries delegate to a renderer-owned
 * {@link MarkdownProjectorState} so the existing parser cache and table
 * scanner stay authoritative. Non-markdown entries (and user rows, which
 * use a one-line-per-`\n` wrap rather than markdown soft-break collapse)
 * assemble their rows directly from the entry's source and metadata; the
 * math is deterministic and never touches measurement.
 *
 * @param entry - the stable block identity, kind, and payload.
 * @param scope - the resolved rendering scope (width, theme, fold, mode).
 * @param markdownState - mutable projector state for markdown entries;
 *   ignored by non-markdown entries. The caller owns its lifecycle.
 * @returns the rendered rows plus a revision/source-length pair.
 */
export function projectBlockRows(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
  markdownState: MarkdownProjectorState | undefined,
): BlockRowsProjection {
  switch (entry.kind) {
    case 'markdown':
    case 'assistant-prose':
      if (markdownState === undefined) {
        throw new Error('projectBlockRows: markdown entries require a non-undefined markdown state')
      }
      return projectMarkdownEntry(entry, scope, markdownState)
    case 'user':
      return projectUserEntry(entry, scope)
    case 'reasoning':
      return projectReasoningEntry(entry, scope)
    case 'tool-card':
      return projectToolCardEntry(entry, scope)
    case 'divider':
      return projectDividerEntry(entry)
    case 'compaction':
      return projectCompactionEntry(entry)
    case 'turn-tail':
      return projectTurnTailEntry(entry, scope)
    case 'dense-digest':
      return projectDenseDigestEntry(entry)
    case 'active-placeholder':
      return projectActivePlaceholderEntry(entry)
  }
}

/* ============================================================================
 * Markdown projection path
 * ========================================================================== */

/** Sentinel line for an empty source; reused so consecutive empties stay equal. */
const EMPTY_MARKDOWN_LINE: MarkdownRenderLine = Object.freeze({
  text: '',
  displayWidth: 0,
  spans: Object.freeze([
    { start: 0, end: 0, token: 'fg', bold: false },
  ] as readonly MarkdownRenderSpan[]),
  rowInBlock: 0,
  sourceStart: 0,
  sourceEnd: 0,
  rawTail: false,
})

/**
 * Internal: project a markdown-bearing entry by routing it through the
 * existing {@link createMarkdownProjector} so the parser cache and the
 * table scanner remain authoritative.
 * @param entry - markdown-bearing entry.
 * @param scope - rendering scope.
 * @param state - mutable projector state owned by the renderer.
 * @returns the projected rows.
 */
function projectMarkdownEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
  state: MarkdownProjectorState,
): BlockRowsProjection {
  let scannerSnapshot
  if (entry.source !== state.lastSource) {
    if (!entry.source.startsWith(state.lastSource)) {
      state.collector.reset()
      state.projector.reset()
      state.scanner.reset()
      state.tableRenderCache = undefined
      state.closedTableRows.current = undefined
      state.activeTableProjection = undefined
      state.activeTableStart = undefined
      state.lastSource = ''
    }
    const delta = entry.source.slice(state.lastSource.length)
    state.collector.append(delta)
    scannerSnapshot = state.scanner.feed(delta)
    state.lastSource = entry.source
    state.cachedProjection = undefined
    if (scope.renderMode === 'settled') {
      state.collector.finalize()
      scannerSnapshot = state.scanner.finalize()
    }
  }
  // Short-circuit when the (source, scope) signature is unchanged: the
  // cached rows stay valid and we skip both the projector.project() call
  // and the shared mdast parse cache lookup it would otherwise fire.
  const signature = `${entry.source.length}|${scope.scopeKey}|${scope.renderMode}`
  if (
    state.cachedProjection !== undefined
    && state.cachedSignature === signature
    && state.lastSource === entry.source
  ) {
    return state.cachedProjection
  }
  if (scope.renderMode === 'settled' && !entry.source.endsWith('\n')) {
    const root = parseMarkdownSource(entry.source, true)
    const renderer = createStyledMarkdownBlockRenderer({
      width: Math.max(1, scope.width),
      hyperlinks: false,
    })
    const lines = root.children.flatMap((block, blockIndex) => renderer.renderBlock(
      block,
      {
        width: Math.max(1, scope.width),
        theme: scope.theme,
        fold: 'expanded',
        renderMode: scope.renderMode,
      },
      blockIndex,
    ))
    const next: BlockRowsProjection = {
      revision: state.collector.revision(),
      sourceLength: entry.source.length,
      lines,
    }
    state.cachedProjection = next
    state.cachedSignature = signature
    return next
  }
  const renderScope: MarkdownRenderScope = {
    width: Math.max(1, scope.width),
    theme: scope.theme,
    fold: 'expanded',
    renderMode: scope.renderMode,
  }
  scannerSnapshot ??= state.scanner.snapshot()
  if (scannerSnapshot.closedTable !== null && state.tableRenderCache !== undefined) {
    const closed = scannerSnapshot.closedTable
    const rendered = renderStreamingTableCells(
      [closed.header.cells, ...closed.body.map(row => row.cells)],
      undefined,
      Math.max(1, scope.width),
      0,
      closed.headerStart,
      state.tableRenderCache,
    )
    state.tableRenderCache = rendered.cache
    state.closedTableRows.current = {
      start: closed.headerStart,
      lines: rendered.lines,
    }
  }
  const canReuseActiveTableProjection = scannerSnapshot.state.kind === 'confirmed-table'
    && state.activeTableProjection !== undefined
    && state.activeTableStart === scannerSnapshot.mutableStart
  const projection = canReuseActiveTableProjection
    ? updateProjectionTail(
      state.activeTableProjection as MarkdownProjection,
      entry.source,
      renderScope,
      state.collector.revision(),
    )
    : state.projector.project(renderScope)
  if (scannerSnapshot.state.kind === 'confirmed-table') {
    state.activeTableProjection = projection
    state.activeTableStart = scannerSnapshot.mutableStart
  } else {
    state.activeTableProjection = undefined
    state.activeTableStart = undefined
    if (state.closedTableRows.current === undefined) state.tableRenderCache = undefined
  }
  state.lastSafeRecompute = projection.safeRecompute
  const activeTable = scannerSnapshot.state.kind === 'confirmed-table'
    ? flattenProjectionWithActiveTable(
      projection,
      scannerSnapshot.mutableStart,
      [
        scannerSnapshot.state.header.cells,
        ...scannerSnapshot.state.body.map(row => row.cells),
      ],
      scope.width,
      state.tableRenderCache,
    )
    : undefined
  state.tableRenderCache = activeTable?.cache
  const next: BlockRowsProjection = {
    revision: projection.revision,
    sourceLength: projection.sourceLength,
    lines: activeTable?.lines ?? flattenMarkdownProjection(projection, scope.width),
  }
  state.cachedProjection = next
  state.cachedSignature = signature
  return next
}

/**
 * Reuse the held-back active-table mdast projection while updating only its
 * unfinished logical line. Completed table rows come from TableScanner, so
 * reparsing the whole growing table cannot change the retained pre-table
 * blocks.
 */
function updateProjectionTail(
  base: MarkdownProjection,
  source: string,
  scope: MarkdownRenderScope,
  revision: number,
): MarkdownProjection {
  const rawTail = source.endsWith('\n')
    ? ''
    : source.slice(source.lastIndexOf('\n') + 1)
  const escaped = escapeContent(rawTail)
  const renderer = createStyledMarkdownBlockRenderer({
    width: Math.max(1, scope.width),
    hyperlinks: false,
  })
  return {
    ...base,
    revision,
    scope,
    tail: escaped === ''
      ? undefined
      : renderer.renderRawTail(escaped, displayWidth(escaped), scope),
    sourceLength: source.length,
    safeRecompute: undefined,
  }
}

/**
 * Replace the projector's held-back active table with the scanner's rows.
 * The table mdast block deliberately emits no rows while confirmed, so this
 * function inserts it exactly once at its source position. A matching raw
 * tail is treated as the newest table row without promoting it into canonical
 * committed source; malformed or column-mismatched tails remain ordinary raw
 * Markdown after the table.
 * @param projection - projector output containing the held-back table block.
 * @param tableStart - source offset of the table header.
 * @param committedCells - header plus complete body rows, without delimiter.
 * @param width - available display columns.
 * @returns ordered physical rows with one active-table presentation.
 */
function flattenProjectionWithActiveTable(
  projection: MarkdownProjection,
  tableStart: number,
  committedCells: readonly (readonly string[])[],
  width: number,
  previous: StreamingTableRenderCache | undefined,
): { readonly lines: readonly MarkdownRenderLine[]; readonly cache: StreamingTableRenderCache | undefined } {
  const out: MarkdownRenderLine[] = []
  const expectedColumns = committedCells[0]?.length ?? 0
  const tailCells = projection.tail === undefined
    ? undefined
    : parsePipeTableCells(projection.tail.text)
  const consumesTail = tailCells !== undefined && tailCells.length === expectedColumns
  for (const block of projection.blocks) {
    if (block.range.start === tableStart && block.node.type === 'table') {
      const rendered = renderStreamingTableCells(
        committedCells,
        consumesTail ? tailCells : undefined,
        Math.max(1, width),
        0,
        tableStart,
        previous,
      )
      out.push(...rendered.lines)
      previous = rendered.cache
      continue
    }
    out.push(...block.lines)
  }
  if (projection.tail !== undefined && !consumesTail) {
    out.push(...wrapRawTailRows(projection.tail, width))
  }
  return { lines: out, cache: previous }
}

/**
 * Flatten one markdown projection (pre-table blocks + active table rows
 * + raw tail) into a single row array. Used by the markdown projector
 * path; non-markdown paths emit their own rows.
 * @param projection - the projector's output.
 * @param width - available body columns for the mutable raw tail.
 * @returns ordered physical rows.
 */
function flattenMarkdownProjection(
  projection: MarkdownProjection,
  width: number,
): readonly MarkdownRenderLine[] {
  const out: MarkdownRenderLine[] = []
  for (const block of projection.blocks) {
    for (const line of block.lines) out.push(line)
  }
  if (projection.tail !== undefined) out.push(...wrapRawTailRows(projection.tail, width))
  return out
}

/**
 * Materialize an unfinished logical line as complete physical rows. The
 * incremental projector retains one mutable raw-tail record, while the
 * viewport requires every visible row to fit its body budget exactly.
 * @param line - projector-owned raw-tail record.
 * @param width - available body columns.
 * @returns one or more bounded raw-tail rows with the original style.
 */
function wrapRawTailRows(
  line: MarkdownRenderLine,
  width: number,
): readonly MarkdownRenderLine[] {
  const pieces = wrapDisplayLines(line.text, Math.max(1, width))
  const style = line.spans[0] ?? {
    start: 0,
    end: line.displayWidth,
    token: 'fg' as const,
    bold: false,
  }
  return pieces.map((text, index) => {
    const row = lineForText(text, style.token, style.bold, line.rowInBlock + index)
    return {
      ...row,
      sourceStart: index === 0 ? line.sourceStart : -1,
      sourceEnd: index === pieces.length - 1 ? line.sourceEnd : -1,
      rawTail: true,
      ...(line.background === undefined ? {} : { background: line.background }),
    }
  })
}

/**
 * Render a user-typed row by wrapping its source on `width - prefixCols`
 * columns and emitting one row per logical (post-`\n`) line. This is the
 * legacy `userRun` shape (one row per wrapped piece, painted with the
 * `>` marker + fg body) preserved exactly so existing visual tests stay
 * equivalent.
 * @param entry - user entry.
 * @param scope - rendering scope; `width` is the conversation column width.
 * @returns ordered rows.
 */
function projectUserEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
): BlockRowsProjection {
  const wrapCols = Math.max(1, scope.width - 2)
  const wrapped = wrapDisplayLines(escapeContent(entry.source), wrapCols)
  const lines: MarkdownRenderLine[] = wrapped.map((row, blockRow) =>
    lineForText(`> ${row}`, 'fg', false, blockRow))
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/* ============================================================================
 * Non-markdown row builders
 * ========================================================================== */

/** Number of body rows the reasoning live tail keeps on screen. */
const REASONING_LIVE_TAIL = 4

/**
 * Render the reasoning block's row list. Collapsed states always emit
 * one row (the dim fold marker); expanded states wrap the reasoning
 * text under a header; live tails under a tight bound.
 * @param entry - reasoning entry (id + source + meta).
 * @param scope - rendering scope.
 * @returns ordered rows.
 */
function projectReasoningEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
): BlockRowsProjection {
  const reasoningDurationMs = entry.meta?.reasoningDurationMs ?? 0
  const expanded = entry.meta?.reasoningExpanded === true
  const live = entry.meta?.reasoningLive === true
  const secondsLabel = (reasoningDurationMs / 1000).toFixed(1)
  if (!expanded) {
    const text = entry.source === ''
      ? ''
      : `▸ ✻ 思考 (${secondsLabel}s) · ${String(entry.source.split('\n').length)} 行 · Ctrl+O 展开`
    const line = lineForText(text, 'fgDim', false, 0)
    return { revision: 0, sourceLength: entry.source.length, lines: [line] }
  }
  const headerText = `▾ ✻ 思考 (${secondsLabel}s)`
  const lines: MarkdownRenderLine[] = [
    lineForText(headerText, 'fgDim', false, 0),
  ]
  const escaped = escapeContent(entry.source)
  const wrapped = wrapDisplayLines(escaped, Math.max(1, scope.width))
  if (live && wrapped.length > REASONING_LIVE_TAIL) {
    lines.push(lineForText('  …', 'fgDim', false, lines.length))
  }
  const body = live && wrapped.length > REASONING_LIVE_TAIL
    ? wrapped.slice(-REASONING_LIVE_TAIL)
    : wrapped
  for (const row of body) {
    lines.push(lineForText(`  ${row}`, 'fgDim', false, lines.length))
  }
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/**
 * Render the tool-card row list. Collapsed cards emit one row
 * (`▸ name · status`); expanded cards emit a heading row followed by a
 * body block whose lines are derived from the card's call/result JSON
 * via the same layout helpers the JSX branch uses today.
 * @param entry - tool-card entry.
 * @param scope - rendering scope.
 * @returns ordered rows.
 */
function projectToolCardEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
): BlockRowsProjection {
  const card = entry.meta?.toolCard
  if (card === undefined) {
    const line = lineForText(entry.source, 'fg', false, 0)
    return { revision: 0, sourceLength: entry.source.length, lines: [line] }
  }
  const heading = escapeContent(card.resultView?.title ?? card.callView?.title ?? card.name)
  const statusLabel = toolCardStatusLabel(card.status)
  const headingBudget = Math.max(
    1,
    scope.width - displayWidth(`${toolCardGlyph(scope.fold.tools)}  · ${statusLabel}`),
  )
  const fittedHeading = card.callView?.card === 'terminal'
    ? truncateMiddleDisplay(heading, headingBudget, 0.72)
    : truncateMiddleDisplay(heading, headingBudget)
  const titlePrefix = `${toolCardGlyph(scope.fold.tools)} ${fittedHeading} · `
  const summary = scope.fold.tools ? undefined : collapsedCardSummaryText(card)
  const summaryBudget = scope.width - displayWidth(`${titlePrefix}${statusLabel} `)
  const clippedSummary = summary === undefined || summaryBudget < 2
    ? undefined
    : truncateDisplay(summary, summaryBudget)
  const lines: MarkdownRenderLine[] = [mixedLine([
    { text: titlePrefix, token: 'fg', bold: false },
    { text: statusLabel, token: toolCardStatusToken(card.status), bold: false },
    ...(clippedSummary === undefined
      ? []
      : [{ text: ` ${clippedSummary}`, token: 'fgDim' as const, bold: false }]),
  ], 0)]
  if (scope.fold.tools) {
    const body = toolCardBodyLines(card, Math.max(1, scope.width - 2))
    for (const row of body) {
      lines.push(lineForText(row.text, row.token, false, lines.length))
    }
  }
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/** Glyph prefix for the heading row. */
function toolCardGlyph(expanded: boolean): string {
  return expanded ? '▾' : '▸'
}

/** Human-readable status label. */
function toolCardStatusLabel(status: ToolCardStatus): string {
  return status === 'running' ? '运行中' : status === 'error' ? '失败' : '完成'
}

/** Semantic status color matching {@link ToolCard}. */
function toolCardStatusToken(status: ToolCardStatus): 'accent' | 'success' | 'error' {
  return status === 'running' ? 'accent' : status === 'error' ? 'error' : 'success'
}

/**
 * Fit a presenter heading while retaining both its action prefix and the
 * identifying tail of a path, URL, or command.
 * @param text - escaped single-line presenter heading.
 * @param maxCols - available display columns.
 * @param leadingShare - fraction of retained columns assigned to the prefix.
 * @returns the original heading or a display-width-safe middle truncation.
 */
function truncateMiddleDisplay(text: string, maxCols: number, leadingShare = 0.5): string {
  if (maxCols <= 0) return ''
  if (displayWidth(text) <= maxCols) return text
  if (maxCols === 1) return '…'
  const contentBudget = maxCols - 1
  const startBudget = Math.max(1, Math.min(contentBudget, Math.ceil(contentBudget * leadingShare)))
  const endBudget = contentBudget - startBudget
  let start = ''
  let startWidth = 0
  for (const grapheme of text) {
    const width = displayWidth(grapheme)
    if (startWidth + width > startBudget) break
    start += grapheme
    startWidth += width
  }
  let end = ''
  let endWidth = 0
  for (const grapheme of Array.from(text).reverse()) {
    const width = displayWidth(grapheme)
    if (endWidth + width > endBudget) break
    end = `${grapheme}${end}`
    endWidth += width
  }
  return `${start}…${end}`
}

/** Get the collapsed-row summary without depending on the JSX branch. */
function collapsedCardSummaryText(card: ToolCardProjection): string | undefined {
  const result = card.resultView
  const kind = result?.card ?? card.callView?.card ?? 'generic'
  switch (kind) {
    case 'terminal':
      if (result?.card === 'terminal' && result.exitCode !== undefined) {
        return `exitCode ${String(result.exitCode)}`
      }
      if (result?.card === 'terminal' && result.signal !== undefined) {
        return `signal ${result.signal}`
      }
      if (result?.card === 'terminal' && result.output !== undefined && result.output !== '') {
        return escapeContent(result.output.replace(/\n/g, ' '))
      }
      return card.callView?.card === 'terminal' && card.callView.cwd !== undefined
        ? escapeContent(card.callView.cwd)
        : undefined
    case 'diff': {
      const paths = card.callView?.card === 'diff'
        ? (card.callView.locations ?? card.callView.diffs.map(diff => ({ path: diff.path })))
        : (result as Extract<ToolCardResultView, { card: 'diff' }>).diffs
          .map(diff => ({ path: diff.path }))
      return paths.length === 0
        ? undefined
        : escapeContent(paths.map(entry => entry.path).join(' · '))
    }
    case 'search':
      return result?.card === 'search' ? `${String(result.total)} matches` : undefined
    case 'read':
      return result?.card === 'read' ? escapeContent(result.path) : undefined
    case 'web':
      if (result?.card !== 'web') return undefined
      if (result.kind === 'fetch') {
        return escapeContent(`${result.url} · ${String(result.statusCode)}`)
      }
      if (result.sources.length === 0) return undefined
      return escapeContent(result.sources.length === 1
        ? (result.sources[0]?.title ?? result.sources[0]?.url as string)
        : `${String(result.sources.length)} sources`)
    default:
      return card.callView === undefined ? collapsedCardSummary(card.arguments) : undefined
  }
}

/** One expanded tool-card row and its paint token. */
interface ToolCardBodyLine {
  readonly text: string
  readonly token: 'fgDim' | 'codeBg'
}

/** Append a labeled expanded payload block, matching the JSX card layout. */
function appendToolCardBody(
  out: ToolCardBodyLine[],
  label: string,
  body: readonly string[],
  width: number,
): void {
  out.push({ text: `  ${label}`, token: 'fgDim' })
  for (const logicalLine of body) {
    for (const line of wrapDisplayLines(escapeContent(logicalLine), width)) {
      out.push({ text: `  ${line}`, token: 'codeBg' })
    }
  }
}

/** Body rows for expanded tool cards, specialized by presenter view. */
function toolCardBodyLines(card: ToolCardProjection, width: number): ToolCardBodyLine[] {
  const out: ToolCardBodyLine[] = []
  const result = card.resultView
  const kind = result?.card ?? card.callView?.card ?? 'generic'
  switch (kind) {
    case 'terminal': {
      const output = result?.card === 'terminal' ? result.output : undefined
      if (output !== undefined && output !== '') {
        appendToolCardBody(out, '结果', output.split('\n'), width)
      }
      if (result?.card === 'terminal' && result.exitCode !== undefined) {
        appendToolCardBody(out, 'meta', [`exitCode ${String(result.exitCode)}`], width)
      } else if (result?.card === 'terminal' && result.signal !== undefined) {
        appendToolCardBody(out, 'meta', [`signal ${result.signal}`], width)
      }
      if (out.length === 0) appendToolCardBody(out, '参数', card.arguments.split('\n'), width)
      return out
    }
    case 'diff': {
      const diffs = result?.card === 'diff'
        ? result.diffs
        : (card.callView as Extract<ToolCardCallView, { card: 'diff' }>).diffs
      if (diffs.length === 0) {
        appendToolCardBody(out, '参数', card.arguments.split('\n'), width)
        return out
      }
      const body: string[] = []
      for (const diff of diffs) {
        body.push(`--- ${diff.path}`)
        if (diff.oldText !== null) {
          for (const line of diff.oldText.split('\n')) body.push(`- ${line}`)
        }
        for (const line of diff.newText.split('\n')) body.push(`+ ${line}`)
      }
      appendToolCardBody(out, 'diff', body, width)
      return out
    }
    case 'search': {
      if (result?.card !== 'search') {
        appendToolCardBody(out, '参数', card.arguments.split('\n'), width)
        return out
      }
      const body: string[] = []
      if (result.shape === 'matches') {
        for (const file of result.files) {
          for (const match of file.matches) {
            body.push(`${file.path}:${String(match.lineNumber)} ${match.line}`)
          }
        }
      } else {
        body.push(...result.paths)
      }
      if (result.truncated) body.push('…')
      appendToolCardBody(out, '结果', body, width)
      return out
    }
    case 'read':
      if (result?.card === 'read') {
        appendToolCardBody(out, '结果', result.lines.map(line => `${String(line.number)} ${line.text}`), width)
      } else {
        appendToolCardBody(out, '参数', card.arguments.split('\n'), width)
      }
      return out
    case 'web':
      if (result?.card !== 'web') {
        appendToolCardBody(out, '参数', card.arguments.split('\n'), width)
        return out
      }
      if (result.kind === 'fetch') {
        appendToolCardBody(out, '结果', [`${result.url} · ${String(result.statusCode)}`], width)
      } else {
        const body = result.sources.map(source => source.title === undefined
          ? source.url
          : `${source.title} · ${source.url}`)
        if (result.truncated) body.push('…')
        appendToolCardBody(out, '结果', body, width)
      }
      return out
    default:
      appendToolCardBody(out, '参数', card.arguments.split('\n'), width)
      if (card.resultText !== undefined) {
        appendToolCardBody(out, '结果', card.resultText.split('\n'), width)
      }
      if (card.meta !== undefined) {
        appendToolCardBody(out, 'meta', [JSON.stringify(card.meta)], width)
      }
      return out
  }
}

/**
 * Render a divider line; the only row is a single fg-dim string.
 * @param entry - divider entry.
 * @returns a single-row projection.
 */
function projectDividerEntry(
  entry: BlockRowsEntry,
): BlockRowsProjection {
  const line = lineForText(entry.source, 'fgDim', false, 0)
  return { revision: 0, sourceLength: entry.source.length, lines: [line] }
}

/**
 * Render the compaction divider. Collapsed emits one row, expanded adds
 * a `摘要 text` row. The collapsible marker (`──── ✂ 已压缩 N 条 · …`)
 * mirrors the locked copy {@link stream-view.compactionDividerLabel}
 * produces.
 * @param entry - compaction entry.
 * @returns the projection.
 */
function projectCompactionEntry(
  entry: BlockRowsEntry,
): BlockRowsProjection {
  const shadowed = entry.meta?.compactionShadowedCount
  const countLabel = shadowed === undefined ? '' : ` ${String(shadowed)} 条`
  const expanded = entry.meta?.compactionExpanded === true
  const marker = `──── ✂ 已压缩${countLabel} · Ctrl+K ${expanded ? '折叠' : '展开'} ────`
  const lines: MarkdownRenderLine[] = [
    lineForText(marker, 'fgDim', false, 0),
  ]
  const summary = entry.meta?.compactionSummary ?? ''
  if (expanded && summary !== '') {
    lines.push(mixedLine([
      { text: '摘要 ', token: 'fgDim', bold: false },
      { text: escapeContent(summary), token: 'fg', bold: false },
    ], lines.length))
  }
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/**
 * Render the turn tail. The completion boundary, the produced-paths
 * row, and the stats row are independent lines; an empty tail yields
 * zero rows so the caller can skip the entry entirely.
 * @param entry - turn-tail entry.
 * @param scope - rendering scope used to fit produced paths.
 * @returns ordered rows; possibly empty.
 */
function projectTurnTailEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
): BlockRowsProjection {
  const lines: MarkdownRenderLine[] = []
  if (entry.meta?.turnTailCompletionBoundary === true) {
    lines.push(lineForText('── 已完成 ──', 'fgDim', false, lines.length))
  }
  const produced = entry.meta?.turnTailProduced ?? []
  if (produced.length > 0) {
    const joined = produced.map(escapeContent).join(' · ')
    const pathBudget = Math.max(1, scope.width - displayWidth('产物 · '))
    lines.push(lineForText(
      `产物 · ${truncateMiddleDisplay(joined, pathBudget, 0.35)}`,
      'fg',
      false,
      lines.length,
    ))
  }
  const stats = entry.meta?.turnTailStats
  if (stats !== undefined) {
    lines.push(lineForText(stats, 'fgDim', false, lines.length))
  }
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/**
 * Render the dense digest row. The collision-detection logic in
 * {@link stream-view.denseDigestForParts} drives whether the digest
 * appears at all; this projector is only invoked when the digest is on
 * screen, so the row is a single fg-dim line.
 * @param entry - dense-digest entry.
 * @returns a single-row projection.
 */
function projectDenseDigestEntry(
  entry: BlockRowsEntry,
): BlockRowsProjection {
  const text = entry.meta?.denseDigestText ?? entry.source
  const line = lineForText(text, 'fgDim', false, 0)
  return { revision: 0, sourceLength: entry.source.length, lines: [line] }
}

/**
 * Render the blank-start generating placeholder (`● 正在思考…`).
 * @param entry - active-placeholder entry.
 * @returns a single-row projection in fg/accent bold pairs.
 */
function projectActivePlaceholderEntry(
  entry: BlockRowsEntry,
): BlockRowsProjection {
  const text = entry.meta?.activePlaceholder ?? '● 正在思考…'
  const segments = text.startsWith('● ')
    ? [
      { text: '● ', token: 'accent' as const, bold: true },
      { text: text.slice(2), token: 'fg' as const, bold: false },
    ]
    : [
      { text, token: 'fg' as const, bold: false },
    ]
  const line = mixedLine(segments, 0)
  return { revision: 0, sourceLength: entry.source.length, lines: [line] }
}

/* ============================================================================
 * Low-level row helpers
 * ========================================================================== */

/**
 * Build one solid-row MarkdownRenderLine from a single styled text run.
 * Used by the row builders above; consumers should not need to construct
 * the frozen record themselves.
 *
 * @param text - the row's visible text (already escaped by the caller).
 * @param token - the theme token the entire row maps to.
 * @param bold - whether the row rides the bold SGR flag.
 * @param blockRow - zero-based row index inside the owning block.
 * @returns the frozen row record.
 */
export function lineForText(
  text: string,
  token: 'fg' | 'fgDim' | 'accent' | 'accentDim' | 'success' | 'error' | 'codeBg',
  bold: boolean,
  blockRow: number,
): MarkdownRenderLine {
  const width = displayWidth(text)
  return {
    text,
    displayWidth: width,
    spans: [{ start: 0, end: width, token, bold }],
    rowInBlock: blockRow,
    sourceStart: blockRow === 0 ? 0 : -1,
    sourceEnd: -1,
    rawTail: false,
  }
}

/**
 * Build a MarkdownRenderLine whose spans cover multiple styled runs.
 * Used for blocks whose row pairs two tokens (e.g. heading marker + dim
 * summary, `产物` + path list).
 * @param segments - ordered styled segments; non-empty.
 * @param blockRow - zero-based row index inside the owning block.
 * @returns the frozen row record.
 */
export function mixedLine(
  segments: ReadonlyArray<{
    readonly text: string
    readonly token: 'fg' | 'fgDim' | 'accent' | 'accentDim' | 'success' | 'error' | 'codeBg'
    readonly bold: boolean
  }>,
  blockRow: number,
): MarkdownRenderLine {
  let text = ''
  let width = 0
  const spans: MarkdownRenderSpan[] = []
  for (const segment of segments) {
    const segWidth = displayWidth(segment.text)
    spans.push({
      start: width,
      end: width + segWidth,
      token: segment.token,
      bold: segment.bold,
    })
    text += segment.text
    width += segWidth
  }
  if (spans.length === 0) {
    spans.push({ start: 0, end: 0, token: 'fg', bold: false })
  }
  return {
    text,
    displayWidth: width,
    spans: Object.freeze(spans),
    rowInBlock: blockRow,
    sourceStart: blockRow === 0 ? 0 : -1,
    sourceEnd: -1,
    rawTail: false,
  }
}

/* ============================================================================
 * Markdown collector re-export so the renderer can re-feed the projector
 * without violating the "Ink-free" rule on the projector side.
 * ========================================================================== */

export { createMarkdownCollector, EMPTY_MARKDOWN_LINE }
