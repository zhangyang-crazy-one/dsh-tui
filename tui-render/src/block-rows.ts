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
 * compactions, turn tails, tool summaries, the active-turn placeholder —
 * is reduced to one ordered array of {@link MarkdownRenderLine} records
 * whose row count is exact. Markdown blocks reuse the existing
 * {@link createMarkdownProjector} (Decision 2) so the projector cache and
 * table scanner stay in one place; non-markdown blocks assemble their
 * own rows from the immutable projection records that own their shape
 * (tool card / divider / turn tail / tool summary / reasoning fold marker).
 * Parsed top-level Markdown blocks contribute one physical spacer row; an
 * unfinished raw tail remains attached to its current block while streaming.
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
  type MarkdownStyleToken,
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
import type {
  ToolCardCallView,
  ToolCardModel,
  ToolCardResultView,
  ToolCardStatus,
} from './tool-cards.ts'
import { ToolRowCache, truncateMiddleDisplay } from './tool-rows.ts'
import { toolPolicyDefaults } from './render-policy.ts'
import type { TuiLocale } from './ui-copy.ts'
import type { BackgroundToken } from './theme.ts'

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
   * summaries, dividers, and tails hold a precomputed string the
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
  | 'tool-summary'
  | 'active-placeholder'
  | 'markdown'

/** Per-kind metadata; fields outside the active kind are ignored. */
export interface BlockRowsMeta {
  /** Whether the complete reasoning block is visible. */
  readonly reasoningExpanded?: boolean
  /** Reasoning duration stamp (the `1.2s`/`48.8s` label). */
  readonly reasoningDurationMs?: number
  /** Whether this reasoning run's duration is still advancing. */
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
  /** Highest-priority status represented by a collapsed tool summary. */
  readonly toolSummaryStatus?: ToolCardStatus
  /** Active-turn placeholder row text (`● 正在思考…`). */
  readonly activePlaceholder?: string
  /** Whether the user entry is followed by another turn and should emit the two-row message gap. */
  readonly userMessageGap?: boolean
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
  readonly meta?: ToolCardModel['meta']
  /** Stable internal failure identity, when the tool supplied one. */
  readonly error?: ToolCardModel['error']
  /** Presenter call view, when the registry supplies one. */
  readonly callView?: ToolCardCallView
  /** Presenter result view, when the registry supplies one. */
  readonly resultView?: ToolCardResultView
}

/** Inputs that change the projected row output for any block. */
export interface BlockRowsScope {
  /** Locale for tool status and detail copy. */
  readonly locale?: TuiLocale
  /** Conversation column width in columns (after gutter). */
  readonly width: number
  /** Theme tier identifier; matches {@link MarkdownRenderScope.theme}. */
  readonly theme: 'truecolor' | '256' | '16' | 'none'
  /** Fold mode (drives the reasoning fold and tool card collapse). */
  readonly fold: BlockRowsFold
  /** Render mode used by the streaming and settled Markdown projections. */
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
      return projectDividerEntry(entry, scope)
    case 'compaction':
      return projectCompactionEntry(entry)
    case 'turn-tail':
      return projectTurnTailEntry(entry, scope)
    case 'tool-summary':
      return projectToolSummaryEntry(entry, scope)
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
    const lines: MarkdownRenderLine[] = []
    for (const [blockIndex, block] of root.children.entries()) {
      appendMarkdownBlock(lines, renderer.renderBlock(
        block,
        {
          width: Math.max(1, scope.width),
          theme: scope.theme,
          fold: 'expanded',
          renderMode: scope.renderMode,
        },
        blockIndex,
      ))
    }
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
      appendMarkdownBlock(out, rendered.lines)
      previous = rendered.cache
      continue
    }
    appendMarkdownBlock(out, block.lines)
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
    appendMarkdownBlock(out, block.lines)
  }
  if (projection.tail !== undefined) out.push(...wrapRawTailRows(projection.tail, width))
  return out
}

/** Shared physical spacer between parsed top-level Markdown blocks. */
const MARKDOWN_BLOCK_GAP_LINE: MarkdownRenderLine = Object.freeze({
  text: ' ',
  displayWidth: 1,
  spans: Object.freeze([{ start: 0, end: 1, token: 'fg' as const, bold: false }]),
  rowInBlock: 0,
  sourceStart: -1,
  sourceEnd: -1,
  rawTail: false,
})

/** Append one non-empty Markdown block with one stable inter-block spacer. */
function appendMarkdownBlock(
  out: MarkdownRenderLine[],
  lines: readonly MarkdownRenderLine[],
): void {
  if (lines.length === 0) return
  if (out.length > 0) out.push(MARKDOWN_BLOCK_GAP_LINE)
  out.push(...lines)
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
      ...(line.backgroundColumns === undefined
        ? {}
        : { backgroundColumns: line.backgroundColumns }),
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
    surfaceLine([
      { text: '> ', token: 'fgDim', bold: false },
      { text: row, token: 'fgSoft', bold: false },
    ], blockRow, 'messageBg', scope.width))
  if (entry.meta?.userMessageGap === true) {
    lines.push(...messageGapLines(scope.width, lines.length))
  }
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/* ============================================================================
 * Non-markdown row builders
 * ========================================================================== */

/**
 * Hidden reasoning emits no rows. Visible reasoning retains its complete
 * body under a dim header; only the main transcript viewport clips it.
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
  if (!expanded || entry.source === '') {
    return { revision: 0, sourceLength: entry.source.length, lines: [] }
  }
  const headerText = `${live ? '' : '▾ '}✻ 思考 (${secondsLabel}s)`
  const lines: MarkdownRenderLine[] = [
    lineForText(headerText, 'fgDim', false, 0),
  ]
  const escaped = escapeContent(entry.source)
  const body = wrapDisplayLines(escaped, Math.max(1, scope.width - 4))
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
  const cache = new ToolRowCache(toolPolicyDefaults())
  const lines = cache.rows(entry.id, card, scope.width, scope.fold.tools, scope.locale ?? 'zh-CN').slice()
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/**
 * Render a divider line; the only row is a single fg-dim string.
 * @param entry - divider entry.
 * @returns a single-row projection.
 */
function projectDividerEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
): BlockRowsProjection {
  if (entry.source === '' || entry.source === '─') {
    return { revision: 0, sourceLength: entry.source.length, lines: [messageSeparatorLine(scope.width)] }
  }
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
 * Render the turn tail. The produced-paths row, stats row, and closing
 * completion boundary are independent lines; an empty tail yields
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
  if (entry.meta?.turnTailCompletionBoundary === true) {
    lines.push(lineForText('── 已完成 ──', 'fgDim', false, lines.length))
  }
  return { revision: 0, sourceLength: entry.source.length, lines }
}

/** Render one collapsed tool-history summary on the tool-card surface. */
function projectToolSummaryEntry(
  entry: BlockRowsEntry,
  scope: BlockRowsScope,
): BlockRowsProjection {
  const status = entry.meta?.toolSummaryStatus
  const token = status === 'error' ? 'error' : status === 'running' ? 'accentText' : 'fgDim'
  const line = lineForText(entry.source, token, false, 0, 'toolBg', scope.width)
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
      { text: '● ', token: 'accentText' as const, bold: true },
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
 * @param background - optional surface token painted behind the row.
 * @param backgroundColumns - optional full surface width in terminal cells.
 * @returns the frozen row record.
 */
export function lineForText(
  text: string,
  token: MarkdownStyleToken,
  bold: boolean,
  blockRow: number,
  background?: BackgroundToken,
  backgroundColumns?: number,
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
    ...(background === undefined ? {} : { background }),
    ...(backgroundColumns === undefined ? {} : { backgroundColumns }),
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
    readonly token: MarkdownStyleToken
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

/** Build a mixed foreground row on one full-width Soft Slate surface. */
function surfaceLine(
  segments: ReadonlyArray<{
    readonly text: string
    readonly token: MarkdownStyleToken
    readonly bold: boolean
  }>,
  blockRow: number,
  background: BackgroundToken,
  backgroundColumns: number,
): MarkdownRenderLine {
  return {
    ...mixedLine(segments, blockRow),
    background,
    backgroundColumns: Math.max(1, backgroundColumns),
  }
}

/* ============================================================================
 * Spacing, separator, and turn part helpers
 * ========================================================================== */

/** Blank row matching the one-row margin between semantic modules. */
export const GAP_LINE: MarkdownRenderLine = MARKDOWN_BLOCK_GAP_LINE

/**
 * Create a single physical row separator with token 'line' across the width.
 * Used between semantic modules such as user and assistant turns.
 * @param width - available content columns.
 * @param rowInBlock - row index within owning block (defaults to 0).
 * @returns physical row with '─' repeated across width.
 */
export function messageSeparatorLine(
  width: number,
  rowInBlock = 0,
): MarkdownRenderLine {
  const cols = Math.max(1, width)
  const text = '─'.repeat(cols)
  return {
    text,
    displayWidth: cols,
    spans: Object.freeze([{ start: 0, end: cols, token: 'line' as const, bold: false }]),
    rowInBlock,
    sourceStart: -1,
    sourceEnd: -1,
    rawTail: false,
  }
}

/**
 * Two-row gap between message turns: one 'line' token separator row followed
 * by one blank row.
 * @param width - available content columns.
 * @param startRowInBlock - starting row index for the gap.
 * @returns array containing the separator row and a blank row.
 */
export function messageGapLines(
  width: number,
  startRowInBlock = 0,
): readonly MarkdownRenderLine[] {
  return Object.freeze([
    messageSeparatorLine(width, startRowInBlock),
    {
      ...MARKDOWN_BLOCK_GAP_LINE,
      rowInBlock: startRowInBlock + 1,
    },
  ])
}

/** Semantic turn component classification for inter-module spacing. */
export type TurnPartKind = 'text' | 'reasoning' | 'card' | 'tool-summary'

/**
 * Physical row gap between turn components.
 * Adjacent tool cards/summaries remain gapless (0 rows); different semantic
 * modules (reasoning, tool stack, prose) keep a 1-row blank gap.
 * @param previous - kind of the preceding part.
 * @param current - kind of the succeeding part.
 * @returns number of blank spacer rows (0 or 1).
 */
export function turnPartGap(
  previous: TurnPartKind | undefined,
  current: TurnPartKind,
): number {
  if (previous === undefined) return 0
  const previousIsTool = previous === 'card' || previous === 'tool-summary'
  const currentIsTool = current === 'card' || current === 'tool-summary'
  return previousIsTool && currentIsTool ? 0 : 1
}

/* ============================================================================
 * Markdown collector re-export so the renderer can re-feed the projector
 * without violating the "Ink-free" rule on the projector side.
 * ========================================================================== */

export { createMarkdownCollector, EMPTY_MARKDOWN_LINE }
