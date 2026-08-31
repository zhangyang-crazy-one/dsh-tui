/**
 * Renders the current dynamic conversation window and active turn. History rows
 * use stable event ids; the physical-row viewport preserves a measured anchor
 * while detached and paints a fixed latest-message notice for appended rows.
 *
 * One turn paints as a timeline in retained event order: consecutive text and
 * reasoning merge into parts, and each tool call becomes one card that already
 * carries its matching result (no flattened reasoning-then-body-then-tools
 * dump). Settled and streaming text share {@link MarkdownBlock} so a finishing
 * turn never reflows; the `● ` marker is the first row's painted prefix (a
 * sibling span would leave unstyled gap cells), and only the last reasoning
 * run stays live while generating.
 *
 * The conversation uses the full width on narrow terminals and otherwise
 * reserves two columns on each side. The rail owns the terminal's rightmost
 * control column outside that content width. An empty idle window paints
 * the DeepSeek home in the vertical center of that slot; a transcript packs
 * rows to the bottom so the latest message sits above the status and composer
 * rows.
 * @module @deepseek-ai/dsh-tui-render/stream-view
 */

import { Box, Text, measureElement, useStdout, useWindowSize } from 'ink'
import type { DOMElement } from 'ink'
import { memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  ActiveTurn,
  CompactionDivider,
  FrozenMessage,
  ProjectedTurnContent,
  ViewModel,
} from './projection.ts'
import { displayColumnSlice, displayWidth, escapeContent } from './content.ts'
import { hyperlinksEnabled, isOsc8Href, wrapOsc8 } from './hyperlink.ts'
import { producedPathsForTurn } from './turn-tail.ts'
import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'
import { currentTier, paintRow, styled } from './theme.ts'
import type { StyleToken } from './theme.ts'
import { MarkdownBlock } from './markdown.tsx'
import { ReasoningBlock } from './reasoning.tsx'
import { ToolCard } from './tool-card.tsx'
import {
  attachPresenterViews,
  cardsFrom,
  cardsFromActiveTurn,
} from './tool-cards.ts'
import type { ToolCardModel, ToolPresenterLookup } from './tool-cards.ts'
import { PixelFishHome } from './pixel-fish-home.tsx'
import type { BrandRenderTier } from './terminal-capabilities.ts'
import type { FrameProbeHandle } from './frame-stats.ts'
import { conversationLeft, conversationWidth } from './conversation-layout.ts'
import {
  EMPTY_TRANSCRIPT_VIEWPORT,
  physicalScrollRailGeometry,
  reduceTranscriptViewport,
} from './transcript-viewport.ts'
import type {
  TranscriptBlockLayout,
  TranscriptViewportCommand,
} from './transcript-viewport.ts'
import { TranscriptLayoutCache } from './transcript-layout-cache.ts'
import { setMouseRailRegion } from './mouse-io.ts'
import { setFrameRail, writePublishedFrameRail } from './frame-fill.ts'
import {
  type BlockRowsMeta,
  type BlockRowsScope,
  computeBlockRowsScopeKey,
  createMarkdownProjectorState,
  projectBlockRows,
} from './block-rows.ts'
import type {
  MarkdownProjectorState,
} from './block-rows.ts'
import type { MarkdownRenderLine } from './markdown-projector.ts'
import {
  createTranscriptRenderStore,
} from './transcript-line-store.ts'
import type { TranscriptRenderStore } from './transcript-line-store.ts'
import type { MutableRevision } from './transcript-line-store.ts'
import { createPhysicalLine } from './physical-line.ts'
import type { PhysicalLine } from './physical-line.ts'
import type { FrameMetricsHandle } from './frame-metrics.ts'
import { markDeltaIngress } from './frame-metrics.ts'
import {
  type RenderPolicy,
  renderPolicyDefaults,
} from './render-policy.ts'
import { paintLineFromRenderLine } from './painted-line.ts'
import { createScrollScheduler } from './scroll-scheduler.ts'
import type { ScrollScheduler } from './scroll-scheduler.ts'
import { createStreamQueue } from './stream-queue.ts'
import type { StreamQueue } from './stream-queue.ts'
import { createFrameArbiter } from './frame-arbiter.ts'
import type { FrameArbiter } from './frame-arbiter.ts'
import {
  createFrameSnapshotRow,
  setVisibleFrameSnapshot,
} from './frame-snapshot.ts'
import type { VisibleFrameSnapshot } from './frame-snapshot.ts'

/** Speaker marker plus optional streaming cursor reserved from prose rows. */
const ASSISTANT_PROSE_AFFIX_COLUMNS = displayWidth('● ') + displayWidth('▌')

/**
 * Derive the Markdown body scope from the complete conversation-row budget.
 * Settled prose keeps the cursor column reserved so active rows do not reflow
 * when ownership transfers to history.
 * @param scope - complete conversation-row scope.
 * @returns a scope whose width excludes assistant-owned row affixes.
 */
function assistantProseScope(scope: BlockRowsScope): BlockRowsScope {
  const width = Math.max(1, scope.width - ASSISTANT_PROSE_AFFIX_COLUMNS)
  return {
    ...scope,
    width,
    scopeKey: computeBlockRowsScopeKey(
      width,
      scope.theme,
      scope.fold,
      scope.renderMode,
    ),
  }
}

/** Conversation projection inputs. */
export interface StreamViewProps {
  /** Folded view model containing stable history rows, the active turn, and reasoning-display state. */
  model: ViewModel
  /** Optional tools-registry lookup for presenter titles; omitted stays generic. */
  presenters?: ToolPresenterLookup | undefined
  /** Strongest generated FishLogo glyph tier supported by the terminal. */
  brandTier?: BrandRenderTier | undefined
  /** Whether the current loop state permits the one-shot brand reveal. */
  brandAnimation?: boolean | undefined
  /** Optional dedicated render-cost probe for the generated home subtree. */
  brandFrameProbe?: FrameProbeHandle | undefined
  /** Latest loop-owned physical-row navigation command. */
  viewportCommand?: TranscriptViewportCommand | undefined
  /**
   * Resolved render policy; absent falls back to {@link renderPolicyDefaults}.
   * `transcriptOverscan` defines how many extra physical rows around the
   * visible viewport mount at a time, replacing the legacy one-viewport
   * overscan heuristic.
   */
  renderPolicy?: RenderPolicy | undefined
  /**
   * Optional renderer-metric handle from {@link createFrameMetrics}. When
   * present the StreamView reports the rows it actually mounts (the
   * `mountedRows` counter) into the probe for the order-1.1 RED lane; a
   * missing probe keeps the rendering path side-effect free.
   */
  frameMetrics?: FrameMetricsHandle | undefined
  /** Overlay/modal state cancels pending transcript motion while true. */
  motionPaused?: boolean | undefined
}

/** Fixed-width scroll-rail cells for one transcript viewport. */
export interface ScrollRailGeometry {
  /** Total rail rows. */
  readonly rows: number
  /** First thumb row, zero based. */
  readonly thumbStart: number
  /** Thumb height; never below three rows. */
  readonly thumbRows: number
}

/**
 * Derive a bottom-relative one-column rail. The live edge places the thumb at
 * the bottom; the oldest window places it at the top.
 * @param contentRows - total projected transcript rows.
 * @param viewportRows - available physical rail rows.
 * @param scrollOffset - bottom-relative projection offset.
 * @returns rail geometry, or undefined while the transcript does not overflow.
 */
export function scrollRailGeometry(
  contentRows: number,
  viewportRows: number,
  scrollOffset: number,
): ScrollRailGeometry | undefined {
  return physicalScrollRailGeometry(contentRows, viewportRows, scrollOffset)
}

/**
 * The conversation column width: full width below 40 columns; otherwise two
 * terminal columns inset per side.
 * @param columns - the current terminal width in columns.
 * @returns the column width, at least one column.
 */
export { conversationWidth } from './conversation-layout.ts'

function isVisiblePart(part: TurnPart): boolean {
  if (part.kind === 'card') return true
  return part.text !== ''
}

interface DenseDigest {
  readonly suffixStart: number
  readonly textCount: number
  readonly reasoningCount: number
  readonly toolCount: number
}

function denseDigestForParts(
  parts: readonly TurnPart[],
  generating: boolean,
  reasoningExpanded: boolean,
  toolCardsExpanded: boolean,
): DenseDigest | undefined {
  if (reasoningExpanded || toolCardsExpanded || parts.length < 20) return undefined
  const suffixStart = generating
    ? parts.length - 1
    : parts.findLastIndex(part => part.kind === 'text' && part.text.trim() !== '')
  if (suffixStart <= 0) return undefined
  let textCount = 0
  let reasoningCount = 0
  let toolCount = 0
  for (const part of parts.slice(0, suffixStart)) {
    if (part.kind === 'text' && part.text.trim() !== '') textCount += 1
    if (part.kind === 'reasoning') reasoningCount += 1
    if (part.kind === 'card' && part.card.status !== 'running') toolCount += 1
  }
  return { suffixStart, textCount, reasoningCount, toolCount }
}

function digestRowText(digest: DenseDigest, maxCols: number): string {
  const full = `● 过程摘要 · 已折叠 ${String(digest.textCount)} 段叙述 · ${String(digest.reasoningCount)} 段思考 · ${String(digest.toolCount)} 个已完成工具 · Ctrl+O 推理 · Ctrl+E 工具卡`
  if (displayWidth(full) <= maxCols) return full
  const compact = `● 过程摘要 · ${String(digest.textCount)} 叙述 · ${String(digest.reasoningCount)} 思考 · ${String(digest.toolCount)} 工具`
  const compactWithHints = `${compact} · Ctrl+O 推理 · Ctrl+E 工具卡`
  return displayWidth(compactWithHints) <= maxCols ? compactWithHints : compact
}

/**
 * One ordered piece of a turn timeline: merged prose, one reasoning run, or
 * one paired tool card. Text carries its own marker when painted.
 */
type TurnPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string; durationMs: number }
  | { kind: 'card'; card: ToolCardModel }

type TranscriptRow =
  | { readonly kind: 'message'; readonly id: number; readonly message: FrozenMessage }
  | { readonly kind: 'compaction'; readonly id: number; readonly divider: CompactionDivider }

/** Stable empty default so memoized transcript projections do not churn. */
const EMPTY_COMPACTION_DIVIDERS: readonly CompactionDivider[] = Object.freeze([])

function transcriptBlockId(row: TranscriptRow): string {
  if (row.kind === 'compaction') return `compaction-${row.divider.compactionId}`
  if (row.message.kind === 'assistant' && row.message.turnOrdinal !== undefined) {
    return `assistant-turn-${String(row.message.turnOrdinal)}`
  }
  return `message-${String(row.message.id)}`
}


function transcriptBlockVersion(row: TranscriptRow): string {
  if (row.kind === 'compaction') {
    return `${String(row.divider.shadowedCount ?? '')}:${row.divider.summary}`
  }
  return row.message.kind === 'user'
    ? row.message.text
    : `${row.message.text}\u0000${row.message.reasoningText ?? ''}\u0000${String(row.message.content?.length ?? 0)}`
}

function activeTurnVersion(turn: ActiveTurn): string {
  const toolVersion = turn.content?.map((item) => {
    switch (item.kind) {
      case 'text':
      case 'reasoning':
        return `${item.kind}:${item.text}`
      case 'tool-call':
        return `${item.kind}:${item.callId}:${item.name}:${item.arguments}`
      case 'tool-result':
        return `${item.kind}:${item.callId}:${item.text}:${String(item.isError)}`
    }
  }).join('\u0000') ?? ''
  return `${turn.assistantText}\u0000${turn.reasoningText}\u0000${toolVersion}`
}
// Decision 1/3.4: row counts now come from the block-rows projector; the
// legacy estimate helpers were removed because every internal caller now
// reads `entry.lines.length` directly. The optional export below stays
// available for downstream plugins that import the symbol for diagnostics.

/**
 * Locked non-accent divider label for one compaction marker.
 * @param divider - durable compaction projection.
 * @param expanded - whether Ctrl+K exposes its summary.
 * @returns the exact collapsed/expanded Chinese row.
 */
export function compactionDividerLabel(
  divider: CompactionDivider,
  expanded: boolean,
): string {
  const count = divider.shadowedCount === undefined
    ? ''
    : ` ${String(divider.shadowedCount)} 条`
  return `──── ✂ 已压缩${count} · Ctrl+K ${expanded ? '折叠' : '展开'} ────`
}

/**
 * Walk retained turn content in event order: consecutive text items merge,
 * consecutive reasoning items merge (durations sum), each `tool-call` becomes
 * one card part at its own position, and a `tool-result` folds into the open
 * card with the same `callId`. Orphan results drop, matching {@link cardsFrom}.
 * @param content - ordered projected turn records.
 * @returns the interleaved text/reasoning/card timeline.
 */
function partsFrom(content: readonly ProjectedTurnContent[]): TurnPart[] {
  const parts: TurnPart[] = []
  const pending = new Map<ToolCallId, ToolCardModel>()
  for (const item of content) {
    if (item.kind === 'text') {
      const last = parts[parts.length - 1]
      if (last !== undefined && last.kind === 'text') {
        last.text += item.text
        continue
      }
      parts.push({ kind: 'text', text: item.text })
      continue
    }
    if (item.kind === 'reasoning') {
      const last = parts[parts.length - 1]
      if (last !== undefined && last.kind === 'reasoning') {
        last.text += item.text
        last.durationMs += item.durationMs ?? 0
        continue
      }
      parts.push({
        kind: 'reasoning',
        text: item.text,
        durationMs: item.durationMs ?? 0,
      })
      continue
    }
    if (item.kind === 'tool-call') {
      const card: ToolCardModel = {
        callId: item.callId,
        name: item.name,
        arguments: item.arguments,
        status: 'running',
      }
      pending.set(item.callId, card)
      parts.push({ kind: 'card', card })
      continue
    }
    const card = pending.get(item.callId)
    if (card === undefined) continue
    card.status = item.isError ? 'error' : 'ok'
    card.resultText = item.text
    if (item.meta !== undefined) card.meta = item.meta
    if (item.error !== undefined) card.error = item.error
  }
  return parts
}

/**
 * Give the last reasoning part the turn-level duration when its own items
 * never recorded one; the field documents the last run, so earlier runs keep
 * their own (possibly zero) stamps.
 * @param parts - timeline being painted.
 * @param durationMs - turn-level last-run milliseconds.
 */
function stampLastRun(parts: TurnPart[], durationMs: number | undefined): void {
  if (durationMs === undefined) return
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part === undefined || part.kind !== 'reasoning') continue
    if (part.durationMs === 0) part.durationMs = durationMs
    return
  }
}

/**
 * Timeline for one frozen history message. Messages without retained content
 * (older logs and test fixtures) synthesize the reasoning-then-text order the
 * projector would have produced.
 * @param message - frozen history row.
 * @returns the interleaved timeline.
 */
function partsFromFrozen(message: FrozenMessage): TurnPart[] {
  if (message.content === undefined) {
    const parts: TurnPart[] = []
    if (message.reasoningText !== undefined && message.reasoningText !== '') {
      parts.push({
        kind: 'reasoning',
        text: message.reasoningText,
        durationMs: message.reasoningDurationMs ?? 0,
      })
    }
    parts.push({ kind: 'text', text: message.text })
    return parts
  }
  const parts = partsFrom(message.content)
  stampLastRun(parts, message.reasoningDurationMs)
  return parts
}

/**
 * Timeline for the live turn. Streamed calls that have not reached `content`
 * yet still appear (paired with any result already in the fold), and fixtures
 * without ordered content synthesize reasoning-then-text-then-cards.
 * @param turn - the active turn snapshot.
 * @returns the interleaved timeline.
 */
function partsFromTurn(turn: ActiveTurn): TurnPart[] {
  if (turn.content === undefined) {
    const parts: TurnPart[] = []
    if (turn.reasoningText !== '') {
      parts.push({
        kind: 'reasoning',
        text: turn.reasoningText,
        durationMs: turn.reasoningDurationMs,
      })
    }
    parts.push({ kind: 'text', text: turn.assistantText })
    for (const card of cardsFromActiveTurn(turn.toolCalls)) {
      parts.push({ kind: 'card', card })
    }
    return parts
  }
  const parts = partsFrom(turn.content)
  const seen = new Set<ToolCallId>()
  for (const item of turn.content) {
    if (item.kind === 'tool-call') seen.add(item.callId)
  }
  const missing = turn.toolCalls.filter(call => !seen.has(call.callId))
  for (const card of cardsFromActiveTurn(missing, turn.content)) {
    parts.push({ kind: 'card', card })
  }
  return parts
}

/**
 * One painted row prefix: the kind glyph plus a bg strip, against the accent
 * brightness matrix. History marks the assistant `●` in plain accent and the
 * user `>` in fgDim; the active turn (the current item) takes the strong
 * accent bold tier and its streaming cursor takes accentDim (PITFALLS C3:
 * bold/普通/dim 三档 all in real use). The marker rides the markdown row as
 * its prefix so no sibling span leaves unstyled gap cells.
 * @param glyph - the kind marker, e.g. `● ` or `> `.
 * @param token - theme token for the marker (accent or fgDim; the active
 *   turn's bold accent uses {@link activeMarker}).
 * @returns the escaped, painted marker run.
 */
function kindMarker(glyph: string, token: 'accent' | 'fgDim'): string {
  return paintRow([styled(escapeContent(glyph), token)])
}

/**
 * The two-column continuation indent for markdown rows after the first:
 * painted on the frame `bg` so the gap never surfaces the terminal default.
 * @returns the painted indent run.
 */
function restIndent(): string {
  return paintRow([styled('  ', 'bg')])
}

interface SettledMarkdownBlockProps {
  readonly source: string
  readonly maxCols: number
  /** Theme changes invalidate the memo even though MarkdownBlock reads the installed tier. */
  readonly themeTier: ReturnType<typeof currentTier>
}

/** Immutable history prose that skips parent-only viewport commits. */
const SettledMarkdownBlock = memo(function SettledMarkdownBlock(
  props: SettledMarkdownBlockProps,
): ReactNode {
  return (
    <MarkdownBlock
      source={props.source}
      maxCols={props.maxCols}
      prefix={{ first: kindMarker('● ', 'accent'), rest: restIndent() }}
      settled
    />
  )
})

/**
 * User transcript glyphs: fgDim marker plus fg body, painted through the
 * frame `bg` so the run matches the black frame. 02-UI-SPEC C5 distinguishes
 * user rows by the `>` marker in the same centered conversation column as
 * assistant rows, with both bodies left-aligned inside that column.
 * @param text - unescaped user body.
 * @returns the painted marker and body.
 */
function userRun(text: string): string {
  return paintRow([
    styled(escapeContent('> '), 'fgDim'),
    styled(escapeContent(text), 'fg'),
  ])
}

/**
 * The streaming cursor: the current-turn low-light cue in accentDim.
 * @returns the painted accentDim run.
 */
function cursorRun(): string {
  return paintRow([styled('▌', 'accentDim')])
}

/**
 * The active-turn marker: the current item gets the strong tier (bold
 * accent) per the brightness matrix (PITFALLS C3).
 * @returns the painted bold accent run.
 */
function activeMarker(): string {
  return paintRow([styled(escapeContent('● '), 'accent', undefined, true)])
}

/**
 * Return the id of the latest settled assistant row, or undefined if the
 * active turn is still streaming. Mirrors the `latestSettledAssistantId`
 * derivation the existing render branches rely on.
 * @param history - frozen history rows.
 * @param activeTurn - the live turn snapshot, when one exists.
 * @returns the latest assistant id, or undefined.
 */
function latestAssistantId(
  history: readonly FrozenMessage[],
  activeTurn: ActiveTurn | undefined,
): number | undefined {
  if (activeTurn !== undefined) return undefined
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message === undefined) continue
    if (message.kind === 'assistant') return message.id
  }
  return undefined
}

/**
 * Convert one projected {@link MarkdownRenderLine} into a {@link PhysicalLine}
 * the line-store owns. The spans are re-encoded as `{ text, token, bold }`
 * tuples (the column-based spans on `MarkdownRenderSpan` collapse into a
 * single text for the line-store surface; the column geometry can be
 * regenerated from the line text downstream if ever needed).
 * @param blockId - stable block identity to stamp on every line.
 * @param line - the projected row.
 * @returns the converted physical line.
 */
function markdownLineToPhysicalLine(
  blockId: string,
  line: MarkdownRenderLine,
): PhysicalLine {
  const segments: { text: string; token: StyleToken; bold: boolean; href?: string }[] = []
  for (const span of line.spans) {
    const text = displayColumnSlice(line.text, span.start, span.end)
    if (text === '') continue
    segments.push({
      text,
      token: span.token,
      bold: span.bold,
      ...(span.href === undefined ? {} : { href: span.href }),
    })
  }
  const sourceStart = Math.max(0, line.sourceStart)
  const sourceEnd = Math.max(sourceStart, line.sourceEnd < 0 ? sourceStart : line.sourceEnd)
  return createPhysicalLine({
    blockId,
    spans: segments.length === 0 ? [{ text: '', token: 'fg', bold: false }] : segments,
    sourceStart,
    sourceEnd,
    blockRow: Math.max(0, line.rowInBlock),
    ...(line.background === undefined ? {} : { background: line.background }),
  })
}

/** Add transcript marker/indent and cursor cells to a snapshot-owned row. */
function framePhysicalLine(
  blockId: string,
  line: MarkdownRenderLine,
  lead: string,
  tail: string,
  active: boolean,
): PhysicalLine {
  const base = markdownLineToPhysicalLine(blockId, line)
  return createPhysicalLine({
    blockId,
    spans: [
      ...(lead === ''
        ? []
        : [{
          text: lead,
          token: lead.trim() === '' ? 'bg' as const : 'accent' as const,
          bold: active && lead.trim() !== '',
        }]),
      ...base.spans,
      ...(tail === ''
        ? []
        : [{ text: tail, token: 'accentDim' as const, bold: false }]),
    ],
    sourceStart: base.sourceStart,
    sourceEnd: base.sourceEnd,
    blockRow: base.blockRow,
    ...(base.background === undefined ? {} : { background: base.background }),
  })
}

/** Get or create the projector state for one (blockId, scopeKey) pair. */
function projectorStateFor(
  cache: Map<string, MarkdownProjectorState>,
  blockId: string,
  scope: BlockRowsScope,
  aliases: readonly string[] = [],
  source?: string,
): MarkdownProjectorState {
  const projectorScope = scope.scopeKey.replace(/\|(streaming|settled)$/u, '')
  const key = `${blockId}|${projectorScope}`
  let state = cache.get(key)
  if (state === undefined) {
    for (const alias of aliases) {
      state = cache.get(`${alias}|${projectorScope}`)
      if (state !== undefined) break
    }
  }
  if (state === undefined && source !== undefined) {
    for (const candidate of cache.values()) {
      const candidateScope = candidate.scopeKey.replace(/\|(streaming|settled)$/u, '')
      if (candidateScope === projectorScope && candidate.lastSource === source) {
        state = candidate
        break
      }
    }
  }
  if (state === undefined) {
    state = createMarkdownProjectorState(blockId, scope)
  }
  cache.set(key, state)
  return state
}

/**
 * Per-row painted children for blocks that exceed the small-block
 * threshold (e.g. a 10,000-line streaming Markdown or a 500-row table).
 * Renders exactly `[sliceStart, sliceEnd)` lines from the precomputed
 * {@link MarkdownRenderLine} array so the Ink subtree only contains the
 * rows the user can see plus the bounded overscan.
 *
 * Marketing comparison: the legacy per-block subtree mounted every row
 * of an active Markdown even when Ink was only painting ~30 of them,
 * so a 10,000-line reply cost 10,000 React children per frame. The
 * slice path caps mounted children at `sliceEnd - sliceStart` regardless
 * of the block's total row count.
 */

/** One prose run inside a block's flat row list. */
interface BlockTextRange {
  /** First row of the run (carries the block marker). */
  readonly start: number
  /** One past the last row of the run. */
  readonly end: number
}

/** Source-backed row projection retained by the renderer line store. */
interface StoredBlockRows {
  readonly ownerId: string
  readonly entry: Parameters<typeof projectBlockRows>[0]
  readonly scope: BlockRowsScope
  readonly lines: readonly MarkdownRenderLine[]
  readonly active: boolean
}

/** One canonical physical-row projection eligible for queued presentation. */
interface ProjectedEntryRows {
  readonly rows: ReadonlyMap<string, readonly MarkdownRenderLine[]>
  readonly textRanges: ReadonlyMap<string, readonly BlockTextRange[]>
  readonly storeBlocks: ReadonlyMap<string, StoredBlockRows>
}

/** Affix-free range list shared by entries whose rows are self-contained. */
const EMPTY_TEXT_RANGES: readonly BlockTextRange[] = []

/** Blank row matching the one-row margin the JSX path puts between parts. */
const GAP_LINE: MarkdownRenderLine = Object.freeze({
  text: '',
  displayWidth: 0,
  spans: Object.freeze([{ start: 0, end: 0, token: 'fg' as const, bold: false }]),
  rowInBlock: 0,
  sourceStart: -1,
  sourceEnd: -1,
  rawTail: false,
})

/** Lead affix for one absolute row: marker on prose-run starts, continuation
 *  indent inside prose runs, nothing on bare rows (reasoning folds, tool
 *  cards, digest rows carry their own content). */
function slicedLead(
  prefix: { first: string; rest: string },
  textRanges: readonly BlockTextRange[],
  index: number,
): string {
  for (const range of textRanges) {
    if (index === range.start) {
      return prefix.first
    }
    if (index > range.start && index < range.end) {
      return prefix.rest
    }
  }
  return ''
}

/** Plain marker/indent counterpart used by the shared frame snapshot. */
function snapshotLead(
  textRanges: readonly BlockTextRange[],
  index: number,
): string {
  for (const range of textRanges) {
    if (index === range.start) return '● '
    if (index > range.start && index < range.end) return '  '
  }
  return ''
}

/** Exact visible-plus-overscan row window inside one block. */
function sliceWindow(
  lineCount: number,
  layoutTop: number,
  overscanTop: number,
  overscanBottom: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(overscanTop - layoutTop))
  return {
    start,
    end: Math.max(start, Math.min(lineCount, Math.ceil(overscanBottom - layoutTop))),
  }
}

/** Locate cumulative layouts intersecting one absolute row interval. */
function intersectingLayoutIndexes(
  layouts: readonly TranscriptBlockLayout[],
  start: number,
  end: number,
): number[] {
  let low = 0
  let high = layouts.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const layout = layouts[middle] as TranscriptBlockLayout
    if (layout.top + layout.rows <= start) low = middle + 1
    else high = middle
  }
  const indexes: number[] = []
  for (let index = low; index < layouts.length; index += 1) {
    const layout = layouts[index] as TranscriptBlockLayout
    if (layout.top >= end) break
    indexes.push(index)
  }
  return indexes
}

/**
 * Per-row painted children for blocks that exceed the small-block
 * threshold (e.g. a 10,000-line streaming Markdown or a 500-row table).
 * Renders exactly `[sliceStart, sliceEnd)` lines from the precomputed
 * {@link MarkdownRenderLine} array so the Ink subtree only contains the
 * rows the user can see plus the bounded overscan. The caller compensates
 * the unmounted rows above and below the slice with spacer boxes so the
 * painted geometry still matches the viewport reducer's row math.
 *
 * The slice path caps mounted children at `sliceEnd - sliceStart` regardless
 * of the block's total row count.
 */
interface SlicedLinesBlockProps {
  readonly lines: readonly MarkdownRenderLine[]
  readonly sliceStart: number
  readonly sliceEnd: number
  readonly prefix: { first: string; rest: string }
  /** Prose runs inside `lines`; an empty list keeps self-contained rows bare. */
  readonly textRanges: readonly BlockTextRange[]
  /** Absolute row carrying the tail run; defaults to the last line. */
  readonly tailRow?: number | undefined
  readonly tail?: string | undefined
}

const SlicedLinesBlock = memo(function SlicedLinesBlock(props: SlicedLinesBlockProps): ReactNode {
  const { lines, sliceStart, sliceEnd, prefix, textRanges, tailRow, tail } = props
  const end = Math.min(lines.length, Math.max(0, sliceEnd))
  const start = Math.max(0, Math.min(end, sliceStart))
  const effectiveTailRow = tailRow ?? lines.length - 1
  const out: ReactNode[] = []
  for (let index = start; index < end; index += 1) {
    const line = lines[index]
    if (line === undefined) {
      continue
    }
    const painted = paintLineFromRenderLine(line, hyperlinksEnabled())
    const lead = slicedLead(prefix, textRanges, index)
    const trailing = index === effectiveTailRow ? tail : undefined
    out.push(
      <Text key={index} wrap="truncate">
        {lead}
        {painted}
        {trailing}
      </Text>,
    )
  }
  if (out.length === 0) {
    return null
  }
  return (
    <Box flexDirection="column" width="100%">
      {out}
    </Box>
  )
})


/**
 * Render the measured transcript inside one fixed physical-row viewport.
 * Stable block refs feed the viewport reducer after each Ink layout; navigation
 * moves only the absolutely positioned transcript inside the clipped slot.
 * Historical reasoning and tool cards remain collapsed by default.
 * @param props - projected conversation state and interaction callbacks.
 * @returns the centered Ink element tree for the current physical viewport.
 */
export function StreamView({
  model,
  presenters,
  brandTier = 'plain',
  brandAnimation = false,
  brandFrameProbe,
  viewportCommand,
  renderPolicy,
  frameMetrics,
  motionPaused = false,
}: StreamViewProps): ReactNode {
  const policy = renderPolicy ?? renderPolicyDefaults()
  const transcriptOverscan = policy.transcriptOverscan
  const { columns, rows } = useWindowSize()
  const { stdout } = useStdout()
  const physicalViewport = stdout.isTTY
  const contentWidth = conversationWidth(columns)
  const contentLeft = conversationLeft(columns, contentWidth)
  const viewportRef = useRef<DOMElement | null>(null)
  const blockRefs = useRef(new Map<string, DOMElement>())
  const layoutCache = useRef(new TranscriptLayoutCache())
  /** Per-scope projector/scanner pair the markdown entries delegate to. */
  const projectorStates = useRef(new Map<string, MarkdownProjectorState>())
  /** Canonical source descriptors used to rebuild an evicted derived block. */
  const rebuildBlocks = useRef(new Map<string, StoredBlockRows>())
  /**
   * Renderer-owned line store for projected physical rows. Decision 1/6
   * pin the line storage to the renderer itself; the budget defaults come
   * from {@link ./render-policy.ts} (the production host hands the
   * validated value via `renderPolicy.cache`, but tests skip the host and
   * fall back here so the storage is always available).
   */
  const lineStore = useRef<TranscriptRenderStore | undefined>(undefined)
  if (lineStore.current === undefined) {
    lineStore.current = createTranscriptRenderStore({
      maxRows: policy.cache.maxRows,
      maxBytes: policy.cache.maxBytes,
      rebuild: ({ blockId }) => {
        const descriptor = rebuildBlocks.current.get(blockId)
        if (descriptor === undefined) {
          throw new Error(`TranscriptRenderStore: missing source descriptor for ${blockId}`)
        }
        const state = descriptor.entry.kind === 'markdown'
          || descriptor.entry.kind === 'assistant-prose'
          ? createMarkdownProjectorState(blockId, descriptor.scope)
          : undefined
        return projectBlockRows(descriptor.entry, descriptor.scope, state).lines
          .map(line => markdownLineToPhysicalLine(blockId, line))
      },
    })
  }
  /** Active block id currently held by the active revision (when there is one). */
  const lastCommandSequence = useRef(-1)
  const layoutRevision = 0
  const [viewport, dispatchViewport] = useReducer(
    reduceTranscriptViewport,
    EMPTY_TRANSCRIPT_VIEWPORT,
  )
  const scrollScheduler = useRef<ScrollScheduler | undefined>(undefined)
  const presentationQueue = useRef<StreamQueue<ProjectedEntryRows> | undefined>(undefined)
  const frameArbiter = useRef<FrameArbiter<ProjectedEntryRows> | undefined>(undefined)
  const pendingScrollInputAt = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const scroll = createScrollScheduler({
      frameIntervalMs: policy.scroll.frameIntervalMs,
      stepPerFrame: policy.scroll.stepPerFrame,
      catchUpThreshold: policy.scroll.catchUpThreshold,
      maxCatchUpStep: policy.scroll.maxCatchUpStep,
      initialPosition: viewport.offsetFromBottom,
      autoSchedule: false,
    })
    const stream = createStreamQueue<ProjectedEntryRows>({
      frameIntervalMs: policy.stream.frameIntervalMs,
      entryDepth: policy.stream.entryDepth,
      exitDepth: policy.stream.exitDepth,
      maxOldestAgeMs: policy.stream.entryOldestAgeMs,
      exitOldestAgeMs: policy.stream.exitOldestAgeMs,
      drainBackpressureMs: policy.stream.entryDrainBackpressureMs,
      exitDrainBackpressureMs: policy.stream.exitDrainBackpressureMs,
      catchUpRowsPerFrame: policy.stream.catchUpRowsPerFrame,
      maxDepth: policy.stream.entryDepth + policy.stream.catchUpRowsPerFrame,
    })
    const arbiter = createFrameArbiter({
      frameIntervalMs: Math.min(
        policy.scroll.frameIntervalMs,
        policy.stream.frameIntervalMs,
      ),
      scroll,
      stream,
      drivesScrollScheduler: true,
      now: () => performance.now(),
    })
    const unsubscribe = arbiter.onPublish((snapshot) => {
      const presented = snapshot.stream.at(-1)
      if (presented !== undefined) setPresentedEntryRows(presented)
      dispatchViewport({
        kind: 'offset',
        offsetFromBottom: snapshot.scroll.presented,
      })
      if (pendingScrollInputAt.current !== undefined && frameMetrics !== undefined) {
        frameMetrics.recordScrollInputToPaint(
          Math.max(0, performance.now() - pendingScrollInputAt.current),
        )
        pendingScrollInputAt.current = undefined
      }
      if (frameMetrics !== undefined) {
        const queue = stream.getStats(snapshot.nowMs)
        frameMetrics.recordRenderQueue(queue.depth, queue.oldestAgeMs)
      }
    })
    scrollScheduler.current = scroll
    presentationQueue.current = stream
    frameArbiter.current = arbiter
    return () => {
      unsubscribe()
      arbiter.dispose()
      if (scrollScheduler.current === scroll) scrollScheduler.current = undefined
      if (presentationQueue.current === stream) presentationQueue.current = undefined
      if (frameArbiter.current === arbiter) frameArbiter.current = undefined
    }
  }, [
    frameMetrics,
    policy.scroll.catchUpThreshold,
    policy.scroll.frameIntervalMs,
    policy.scroll.maxCatchUpStep,
    policy.scroll.stepPerFrame,
    policy.stream.catchUpRowsPerFrame,
    policy.stream.entryDepth,
    policy.stream.entryDrainBackpressureMs,
    policy.stream.entryOldestAgeMs,
    policy.stream.exitDepth,
    policy.stream.exitDrainBackpressureMs,
    policy.stream.exitOldestAgeMs,
  ])
  const {
    history,
    compactionDividers = EMPTY_COMPACTION_DIVIDERS,
    expandedCompactionId,
    activeTurn,
    status,
    reasoningExpanded,
    toolCardsExpanded,
  } = model
  const compactionVersion = compactionDividers.map(divider => (
    `${divider.id}:${String(divider.shadowedCount ?? '')}:${divider.summary}`
  )).join('\u0000')
  const transcript = useMemo<TranscriptRow[]>(() => [
    ...history.map(message => ({ kind: 'message' as const, id: message.id, message })),
    ...compactionDividers.map(divider => ({
      kind: 'compaction' as const,
      id: divider.id,
      divider,
    })),
  ].sort((left, right) => left.id - right.id), [
    compactionDividers,
    compactionDividers.length,
    compactionVersion,
    history,
    history.length,
  ])
  const activeVersion = activeTurn === undefined ? '' : activeTurnVersion(activeTurn)
  useLayoutEffect(() => {
    if (frameMetrics !== undefined && activeTurn !== undefined) {
      markDeltaIngress(frameMetrics)
    }
  }, [activeTurn, activeVersion, frameMetrics])
  /** Theme tier the projector paths reuse; the stream-view reads the same
   * value at render time so the projector scope key matches the JSX path. */
  const themeTier = currentTier()
  const blockRowsScope = useMemo<BlockRowsScope>(() => {
    const theme = themeTier === 'truecolor'
      ? 'truecolor'
      : themeTier === '256'
        ? '256'
        : themeTier === '16'
          ? '16'
          : 'none'
    const renderMode = status === 'generating' ? 'streaming' : 'settled'
    return {
      width: contentWidth,
      theme,
      fold: {
        reasoning: reasoningExpanded,
        tools: toolCardsExpanded,
      },
      renderMode,
      scopeKey: computeBlockRowsScopeKey(
        contentWidth,
        theme,
        { reasoning: reasoningExpanded, tools: toolCardsExpanded },
        renderMode,
      ),
    }
  }, [
    contentWidth,
    reasoningExpanded,
    status,
    themeTier,
    toolCardsExpanded,
  ])
  const settledBlockRowsScope = useMemo<BlockRowsScope>(() => ({
    ...blockRowsScope,
    renderMode: 'settled',
    scopeKey: computeBlockRowsScopeKey(
      blockRowsScope.width,
      blockRowsScope.theme,
      blockRowsScope.fold,
      'settled',
    ),
  }), [blockRowsScope])
  const assistantBlockRowsScope = useMemo<BlockRowsScope>(
    () => assistantProseScope(blockRowsScope),
    [blockRowsScope],
  )
  const settledAssistantBlockRowsScope = useMemo<BlockRowsScope>(
    () => assistantProseScope(settledBlockRowsScope),
    [settledBlockRowsScope],
  )
  /**
   * Compute per-entry rows via the row projector. Decision 1/3.4 fixes the
   * row count to match exactly what the projector emits; `lines.length`
   * below is therefore the authoritative height for the layout cache.
   */
  const entryRows = useMemo<ProjectedEntryRows>(() => {
    const map = new Map<string, readonly MarkdownRenderLine[]>()
    const textRanges = new Map<string, readonly BlockTextRange[]>()
    const storeBlocks = new Map<string, StoredBlockRows>()
    const projectorCache = projectorStates.current
    const project = (
      ownerId: string,
      entry: Parameters<typeof projectBlockRows>[0],
      scope: BlockRowsScope,
      state: MarkdownProjectorState | undefined,
      active: boolean,
    ) => {
      const projection = projectBlockRows(entry, scope, state)
      storeBlocks.set(entry.id, {
        ownerId,
        entry,
        scope,
        lines: projection.lines,
        active,
      })
      return projection
    }
    for (const row of transcript) {
      const id = transcriptBlockId(row)
      if (row.kind === 'compaction') {
        const meta: BlockRowsMeta = {
          compactionSummary: row.divider.summary,
          compactionExpanded: expandedCompactionId === row.divider.compactionId,
          ...(row.divider.shadowedCount === undefined
            ? {}
            : { compactionShadowedCount: row.divider.shadowedCount }),
        }
        const projection = project(id, {
          id,
          kind: 'compaction',
          source: row.divider.compactionId,
          meta,
        }, settledBlockRowsScope, undefined, false)
        map.set(id, projection.lines)
        continue
      }
      if (row.message.kind === 'user') {
        const projection = project(id, {
          id,
          kind: 'user',
          source: row.message.text,
        }, settledBlockRowsScope, undefined, false)
        map.set(id, projection.lines)
        continue
      }
      const parts = partsFromFrozen(row.message)
      const digest = denseDigestForParts(parts, false, reasoningExpanded, toolCardsExpanded)
      const visibleParts = digest === undefined ? parts : parts.slice(digest.suffixStart)
      const rows: MarkdownRenderLine[] = []
      const ranges: BlockTextRange[] = []
      if (digest !== undefined) {
        rows.push(...project(id, {
          id: `${id}-digest`,
          kind: 'dense-digest',
          source: '',
          meta: { denseDigestText: digestRowText(digest, contentWidth) },
        }, settledBlockRowsScope, undefined, false).lines)
      }
      for (const [partIndex, part] of visibleParts.entries()) {
        if (partIndex > 0) rows.push(GAP_LINE)
        if (part.kind === 'reasoning') {
          rows.push(...project(id, {
            id: `${id}-r-${String(partIndex)}`,
            kind: 'reasoning',
            source: part.text,
            meta: {
              reasoningDurationMs: part.durationMs,
              reasoningExpanded,
              reasoningLive: false,
            },
          }, settledBlockRowsScope, undefined, false).lines)
          continue
        }
        if (part.kind === 'card') {
          const card = attachPresenterViews(presenters, part.card)
          rows.push(...project(id, {
            id: `${id}-c-${String(partIndex)}`,
            kind: 'tool-card',
            source: '',
            meta: {
              toolCard: {
                name: card.name,
                arguments: card.arguments,
                status: card.status,
                ...(card.resultText === undefined
                  ? {}
                  : { resultText: card.resultText }),
                ...(card.meta === undefined ? {} : { meta: card.meta }),
                ...(card.callView === undefined ? {} : { callView: card.callView }),
                ...(card.resultView === undefined ? {} : { resultView: card.resultView }),
              },
            },
          }, settledBlockRowsScope, undefined, false).lines)
          continue
        }
        const start = rows.length
        const partId = `${id}-t-${String(partIndex)}`
        rows.push(...project(id, {
          id: partId,
          kind: 'assistant-prose',
          source: part.text,
        }, settledAssistantBlockRowsScope, projectorStateFor(
          projectorCache,
          partId,
          settledAssistantBlockRowsScope,
          row.message.turnOrdinal === undefined
            ? []
            : [`assistant-turn-${String(row.message.turnOrdinal)}-t-${String(partIndex)}`],
          part.text,
        ), false).lines)
        ranges.push({ start, end: rows.length })
      }
      const tailMeta: BlockRowsMeta = {
        ...(latestAssistantId(history, activeTurn) === row.message.id
          ? { turnTailCompletionBoundary: true }
          : {}),
        ...(row.message.usageOutputTokens !== undefined
          && row.message.stepWallMs !== undefined
          && row.message.turnOrdinal !== undefined
          ? {
            turnTailStats: `turn ${String(row.message.turnOrdinal)} · ${String(row.message.usageOutputTokens)} tok · ${String(row.message.stepWallMs)} ms`,
          }
          : {}),
        ...((() => {
          const cards = cardsFrom(row.message.content ?? []).map(card =>
            attachPresenterViews(presenters, card),
          )
          const produced = producedPathsForTurn(cards)
          return produced.length === 0 ? {} : { turnTailProduced: produced }
        })()),
      }
      if (Object.keys(tailMeta).length > 0) {
        rows.push(GAP_LINE)
        rows.push(...project(id, {
          id: `${id}-tail`,
          kind: 'turn-tail',
          source: '',
          meta: tailMeta,
        }, settledBlockRowsScope, undefined, false).lines)
      }
      map.set(id, rows)
      if (ranges.length > 0) textRanges.set(id, ranges)
    }
    if (activeTurn !== undefined) {
      const id = `assistant-turn-${String(activeTurn.turn)}`
      const parts = partsFromTurn(activeTurn)
      const visibleParts = parts.filter(isVisiblePart)
      if (status === 'generating' && visibleParts.length === 0) {
        map.set(id, project(id, {
          id,
          kind: 'active-placeholder',
          source: '',
          meta: { activePlaceholder: '● 正在思考…' },
        }, blockRowsScope, undefined, true).lines)
      } else {
        const rows: MarkdownRenderLine[] = []
        const ranges: BlockTextRange[] = []
        const digest = denseDigestForParts(parts, status === 'generating', reasoningExpanded, toolCardsExpanded)
        if (digest !== undefined) {
          rows.push(...project(id, {
            id: `${id}-digest`,
            kind: 'dense-digest',
            source: '',
            meta: { denseDigestText: digestRowText(digest, contentWidth) },
          }, blockRowsScope, undefined, status === 'generating').lines)
        }
        const renderedParts = digest === undefined ? parts : parts.slice(digest.suffixStart)
        let lastReasoning = -1
        for (const [partIndex, part] of renderedParts.entries()) {
          if (part.kind === 'reasoning') {
            lastReasoning = partIndex
          }
        }
        for (const [partIndex, part] of renderedParts.entries()) {
          if (partIndex > 0) {
            rows.push(GAP_LINE)
          }
          if (part.kind === 'reasoning') {
            const live = status === 'generating' && partIndex === lastReasoning
            rows.push(...project(id, {
              id: `${id}-r-${String(partIndex)}`,
              kind: 'reasoning',
              source: part.text,
              meta: {
                reasoningDurationMs: part.durationMs,
                reasoningExpanded: reasoningExpanded || live,
                reasoningLive: live,
              },
            }, blockRowsScope, undefined, status === 'generating').lines)
            continue
          }
          if (part.kind === 'card') {
            const card = attachPresenterViews(presenters, part.card)
            rows.push(...project(id, {
              id: `${id}-c-${String(partIndex)}`,
              kind: 'tool-card',
              source: '',
              meta: {
                toolCard: {
                  name: card.name,
                  arguments: card.arguments,
                  status: card.status,
                  ...(card.resultText === undefined
                    ? {}
                    : { resultText: card.resultText }),
                  ...(card.meta === undefined ? {} : { meta: card.meta }),
                  ...(card.callView === undefined ? {} : { callView: card.callView }),
                  ...(card.resultView === undefined ? {} : { resultView: card.resultView }),
                },
              },
            }, blockRowsScope, undefined, status === 'generating').lines)
            continue
          }
          const start = rows.length
          const partId = `${id}-t-${String(partIndex)}`
          rows.push(...project(id, {
            id: partId,
            kind: 'assistant-prose',
            source: part.text,
          }, assistantBlockRowsScope, projectorStateFor(
            projectorStates.current,
            partId,
            assistantBlockRowsScope,
          ), status === 'generating').lines)
          ranges.push({ start, end: rows.length })
        }
        map.set(id, rows)
        if (ranges.length > 0) {
          textRanges.set(id, ranges)
        }
      }
    }
    return { rows: map, textRanges, storeBlocks }
  }, [
    activeVersion,
    activeTurn,
    assistantBlockRowsScope,
    blockRowsScope,
    contentWidth,
    expandedCompactionId,
    history,
    presenters,
    reasoningExpanded,
    status,
    settledAssistantBlockRowsScope,
    settledBlockRowsScope,
    toolCardsExpanded,
    transcript,
  ])
  const [presentedEntryRows, setPresentedEntryRows] = useState(entryRows)
  useLayoutEffect(() => {
    const queue = presentationQueue.current
    const arbiter = frameArbiter.current
    if (queue === undefined || arbiter === undefined) {
      setPresentedEntryRows(entryRows)
      return
    }
    if (status !== 'generating') {
      queue.flush()
      setPresentedEntryRows(entryRows)
      if (frameMetrics !== undefined) frameMetrics.recordRenderQueue(0, 0)
      return
    }
    const now = performance.now()
    if (frameMetrics !== undefined) {
      queue.noteDrain(frameMetrics.snapshot().deltaIngressToStdoutDrainMs.max)
    }
    queue.push([entryRows], now)
    const stats = queue.getStats(now)
    frameMetrics?.recordRenderQueue(stats.depth, stats.oldestAgeMs)
    arbiter.requestStream()
  }, [entryRows, frameMetrics, status])
  const activeLineRevisions = useRef(new Map<string, {
    readonly handle: MutableRevision
    signature: string
    scopeKey: string
  }>())
  const storedLineSignatures = useRef(new Map<string, string>())
  const physicalLineCache = useRef(new WeakMap<MarkdownRenderLine, Map<string, PhysicalLine>>())
  const lastLineStoreMetrics = useRef({ bytes: 0, evictions: 0 })
  useEffect(() => () => {
    for (const active of activeLineRevisions.current.values()) {
      active.handle.settle()
    }
    activeLineRevisions.current.clear()
    lineStore.current?.clearPins()
  }, [])
  useLayoutEffect(() => {
    const store = lineStore.current
    if (store === undefined) return
    const currentActive = new Set<string>()
    for (const descriptor of entryRows.storeBlocks.values()) {
      rebuildBlocks.current.set(descriptor.entry.id, descriptor)
      const signature = [
        descriptor.scope.scopeKey,
        descriptor.entry.source,
        JSON.stringify(descriptor.entry.meta ?? {}),
        String(descriptor.lines.length),
      ].join('\u0000')
      const physical = descriptor.lines.map((line) => {
        let byBlock = physicalLineCache.current.get(line)
        if (byBlock === undefined) {
          byBlock = new Map<string, PhysicalLine>()
          physicalLineCache.current.set(line, byBlock)
        }
        let cached = byBlock.get(descriptor.entry.id)
        if (cached === undefined) {
          cached = markdownLineToPhysicalLine(descriptor.entry.id, line)
          byBlock.set(descriptor.entry.id, cached)
        }
        return cached
      })
      const active = activeLineRevisions.current.get(descriptor.entry.id)
      if (descriptor.active) {
        currentActive.add(descriptor.entry.id)
        if (active !== undefined && active.scopeKey === descriptor.scope.scopeKey) {
          if (active.signature !== signature) {
            active.handle.replace({ source: descriptor.entry.source, lines: physical })
            active.signature = signature
          }
          continue
        }
        if (active !== undefined) {
          active.handle.settle()
          activeLineRevisions.current.delete(descriptor.entry.id)
        }
        const handle = store.acquireActive({
          blockId: descriptor.entry.id,
          source: descriptor.entry.source,
          scopeKey: descriptor.scope.scopeKey,
        })
        handle.replace({ source: descriptor.entry.source, lines: physical })
        activeLineRevisions.current.set(descriptor.entry.id, {
          handle,
          signature,
          scopeKey: descriptor.scope.scopeKey,
        })
        continue
      }
      if (active !== undefined) {
        active.handle.settle()
        activeLineRevisions.current.delete(descriptor.entry.id)
      }
      if (storedLineSignatures.current.get(descriptor.entry.id) === signature) continue
      store.upsertSource({
        blockId: descriptor.entry.id,
        source: descriptor.entry.source,
        scopeKey: descriptor.scope.scopeKey,
      })
      const handle = store.acquireActive({
        blockId: descriptor.entry.id,
        source: descriptor.entry.source,
        scopeKey: descriptor.scope.scopeKey,
      })
      handle.replace({ source: descriptor.entry.source, lines: physical })
      handle.settle()
      storedLineSignatures.current.set(descriptor.entry.id, signature)
    }
    for (const [blockId, active] of activeLineRevisions.current) {
      if (currentActive.has(blockId)) continue
      active.handle.settle()
      activeLineRevisions.current.delete(blockId)
    }
    const stats = store.stats()
    if (frameMetrics !== undefined) {
      frameMetrics.addCacheBytes(stats.cachedBytes - lastLineStoreMetrics.current.bytes)
      frameMetrics.addCacheEvictions(Math.max(
        0,
        stats.evictions - lastLineStoreMetrics.current.evictions,
      ))
    }
    lastLineStoreMetrics.current = {
      bytes: stats.cachedBytes,
      evictions: stats.evictions,
    }
  }, [entryRows, frameMetrics])
  const lastProjectorMetrics = useRef({
    parsedBytes: 0,
    stableRowsReused: 0,
    tailRowsRerendered: 0,
    cacheEvictions: 0,
  })
  useLayoutEffect(() => {
    if (frameMetrics === undefined) return
    const totals = {
      parsedBytes: 0,
      stableRowsReused: 0,
      tailRowsRerendered: 0,
      cacheEvictions: 0,
    }
    for (const state of projectorStates.current.values()) {
      const stats = state.stats()
      totals.parsedBytes += stats.parsedBytes
      totals.stableRowsReused += stats.stableRowsReused
      totals.tailRowsRerendered += stats.tailLinesPainted
      totals.cacheEvictions += stats.cacheEvictions
    }
    const previous = lastProjectorMetrics.current
    frameMetrics.addMarkdownParseBytes(Math.max(0, totals.parsedBytes - previous.parsedBytes))
    frameMetrics.addStableRowsReused(Math.max(
      0,
      totals.stableRowsReused - previous.stableRowsReused,
    ))
    frameMetrics.addTailRowsRerendered(Math.max(
      0,
      totals.tailRowsRerendered - previous.tailRowsRerendered,
    ))
    frameMetrics.addCacheEvictions(Math.max(
      0,
      totals.cacheEvictions - previous.cacheEvictions,
    ))
    lastProjectorMetrics.current = totals
  }, [entryRows, frameMetrics])
  const renderEntries = useMemo(() => [
    ...transcript.flatMap((row, index) => {
      const gapRows = index < transcript.length - 1 || activeTurn !== undefined ? 2 : 0
      const id = transcriptBlockId(row)
      if (activeTurn !== undefined && id === `assistant-turn-${String(activeTurn.turn)}`) {
        return []
      }
      const lines = presentedEntryRows.rows.get(id) ?? []
      return [{
        kind: 'row' as const,
        id,
        version: `${transcriptBlockVersion(row)}\u0000${gapRows === 0 ? 'tail' : 'gap'}`,
        gapRows,
        estimatedRows: lines.length + gapRows,
        lines,
        row,
      }]
    }),
    ...(activeTurn === undefined
      ? []
      : [{
        kind: 'active' as const,
        id: `assistant-turn-${String(activeTurn.turn)}`,
        version: activeVersion,
        gapRows: 0,
        estimatedRows: (presentedEntryRows.rows.get(`assistant-turn-${String(activeTurn.turn)}`)?.length ?? 0),
        lines: presentedEntryRows.rows.get(`assistant-turn-${String(activeTurn.turn)}`) ?? [],
        turn: activeTurn,
      }]),
  ], [
    activeTurn,
    activeVersion,
    presentedEntryRows,
    transcript,
  ])
  const layoutScope = [
    contentWidth,
    currentTier(),
    reasoningExpanded ? 'reasoning-open' : 'reasoning-closed',
    toolCardsExpanded ? 'tools-open' : 'tools-closed',
    expandedCompactionId ?? '',
  ].join(':')
  const layoutInputs = useMemo(
    () => renderEntries.map(({ id, version, estimatedRows }) => ({
      id,
      version,
      estimatedRows,
    })),
    [renderEntries],
  )
  const contentRevision = renderEntries.length === 0
    ? 'empty'
    : `${String(renderEntries.length)}:${renderEntries.at(-1)?.id ?? ''}:${renderEntries.at(-1)?.version ?? ''}`
  const lastContentRevision = useRef(contentRevision)
  const virtualLayouts = useMemo(
    () => layoutCache.current.layouts(layoutScope, layoutInputs),
    [layoutInputs, layoutRevision, layoutScope],
  )
  const virtualContentRows = virtualLayouts.at(-1) === undefined
    ? 0
    : (virtualLayouts.at(-1) as TranscriptBlockLayout).top
      + (virtualLayouts.at(-1) as TranscriptBlockLayout).rows
  const effectiveViewportRows = viewport.viewportRows > 0
    ? viewport.viewportRows
    : Math.max(1, rows - 7)
  const effectiveOffset = viewport.follow
    ? 0
    : Math.min(
      viewport.offsetFromBottom,
      Math.max(0, virtualContentRows - effectiveViewportRows),
    )
  const visibleTop = Math.max(
    0,
    virtualContentRows - effectiveViewportRows - effectiveOffset,
  )
  const visibleBottom = visibleTop + effectiveViewportRows
  /**
   * Overscan now comes from the resolved render policy: the host plugin
   * owns the validated `transcriptOverscan` value (default 16 rows) and the
   * renderer treats one viewport rows as the absolute hard ceiling.
   */
  const overscanRows = Math.max(
    0,
    Math.min(
      effectiveViewportRows,
      Math.max(0, transcriptOverscan),
    ),
  )
  const overscanTop = Math.max(0, visibleTop - overscanRows)
  const overscanBottom = Math.min(
    virtualContentRows,
    visibleBottom + overscanRows,
  )
  const visibleIndexes = useMemo(
    () => physicalViewport
      ? intersectingLayoutIndexes(virtualLayouts, overscanTop, overscanBottom)
      : renderEntries.map((_entry, index) => index),
    [overscanBottom, overscanTop, physicalViewport, renderEntries, virtualLayouts],
  )
  const firstVisibleIndex = visibleIndexes[0]
  const lastVisibleIndex = visibleIndexes.at(-1)
  const leadingRows = firstVisibleIndex === undefined
    ? 0
    : (virtualLayouts[firstVisibleIndex]?.top ?? 0)
  const lastVisibleLayout = lastVisibleIndex === undefined
    ? undefined
    : virtualLayouts[lastVisibleIndex]
  const trailingRows = lastVisibleLayout === undefined
    ? 0
    : Math.max(
      0,
      virtualContentRows - lastVisibleLayout.top - lastVisibleLayout.rows,
    )
  const visibleEntryPairs = useMemo(
    () => visibleIndexes.flatMap((index) => {
      const entry = renderEntries[index]
      return entry === undefined ? [] : [{ index, entry }]
    }),
    [renderEntries, visibleIndexes],
  )
  const visibleEntries = useMemo(
    () => visibleEntryPairs.map(pair => pair.entry),
    [visibleEntryPairs],
  )
  const pinIndex = useMemo(() => {
    const byOwner = new Map<string, string[]>()
    const active: string[] = []
    for (const descriptor of entryRows.storeBlocks.values()) {
      let blockIds = byOwner.get(descriptor.ownerId)
      if (blockIds === undefined) {
        blockIds = []
        byOwner.set(descriptor.ownerId, blockIds)
      }
      blockIds.push(descriptor.entry.id)
      if (descriptor.active) active.push(descriptor.entry.id)
    }
    return { byOwner, active }
  }, [entryRows])
  useLayoutEffect(() => {
    const store = lineStore.current
    if (store === undefined) return
    const owners = new Set(visibleEntries.map(entry => entry.id))
    if (viewport.anchor !== undefined) owners.add(viewport.anchor.blockId)
    const pinned = [...pinIndex.active]
    for (const ownerId of owners) {
      pinned.push(...(pinIndex.byOwner.get(ownerId) ?? []))
    }
    store.setPins({ pinned })
  }, [pinIndex, viewport.anchor, visibleEntries])
  const idleHome = transcript.length === 0 && activeTurn === undefined
  const generating = status === 'generating'
  const latestSettledAssistantId = activeTurn === undefined
    ? history.findLast(message => message.kind === 'assistant')?.id
    : undefined

  useLayoutEffect(() => {
    if (viewportCommand === undefined) return
    if (viewportCommand.sequence === lastCommandSequence.current) return
    if (viewportCommand.kind !== 'reset' && viewport.viewportRows === 0) return
    lastCommandSequence.current = viewportCommand.sequence
    const scheduler = scrollScheduler.current
    const arbiter = frameArbiter.current
    if (scheduler === undefined || arbiter === undefined) return
    const maximum = Math.max(0, viewport.contentRows - viewport.viewportRows)
    const clamp = (value: number): number => Math.max(0, Math.min(maximum, value))
    pendingScrollInputAt.current = performance.now()
    switch (viewportCommand.kind) {
      case 'scroll':
        scheduler.setTarget(clamp(scheduler.getTarget() + viewportCommand.delta))
        scheduler.tick()
        break
      case 'page':
        scheduler.setTarget(clamp(
          scheduler.getTarget()
          + viewportCommand.delta * Math.max(1, viewport.viewportRows - 1),
        ))
        scheduler.tick()
        break
      case 'position':
        scheduler.snapTo(clamp(Math.round(
          maximum * (1 - Math.max(0, Math.min(1, viewportCommand.fraction))),
        )))
        break
      case 'edge':
        scheduler.snapTo(viewportCommand.edge === 'latest' ? 0 : maximum)
        break
      case 'reset':
        scheduler.snapTo(0)
        pendingScrollInputAt.current = undefined
        dispatchViewport({ kind: 'reset' })
        return
    }
    dispatchViewport({
      kind: 'offset',
      offsetFromBottom: scheduler.getPresented(),
    })
    arbiter.requestScroll()
  }, [
    viewport.contentRows,
    viewport.viewportRows,
    effectiveViewportRows,
    virtualContentRows,
    viewportCommand,
  ])

  useLayoutEffect(() => {
    const scheduler = scrollScheduler.current
    if (scheduler === undefined) return
    const maximum = Math.max(0, viewport.contentRows - viewport.viewportRows)
    const presented = scheduler.getPresented()
    if (presented === viewport.offsetFromBottom) return
    if (scheduler.isAnimating()) {
      scheduler.rebase(viewport.offsetFromBottom - presented, maximum)
    } else {
      scheduler.snapTo(Math.max(0, Math.min(maximum, viewport.offsetFromBottom)))
    }
  }, [
    viewport.contentRows,
    viewport.offsetFromBottom,
    viewport.viewportRows,
  ])

  useLayoutEffect(() => {
    scrollScheduler.current?.snapTo(viewport.offsetFromBottom)
  }, [columns, rows])

  useLayoutEffect(() => {
    if (!motionPaused) return
    const scheduler = scrollScheduler.current
    if (scheduler === undefined) return
    scheduler.snapTo(viewport.offsetFromBottom)
  }, [motionPaused, viewport.offsetFromBottom])

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current
    if (viewportElement === null) return
    const viewportBox = measureElement(viewportElement)
    // Decision 1/3.4: per-block heights now come from the line-store rows
    // (computed via the block-rows projector), not from `measureElement`.
    // We keep the viewport-height measurement as the single Ink layout
    // input so the viewport reducer can clamp to the available rows.
    const layouts = layoutCache.current.layouts(layoutScope, layoutInputs)
    const contentRows = layouts.at(-1) === undefined
      ? 0
      : (layouts.at(-1) as TranscriptBlockLayout).top
        + (layouts.at(-1) as TranscriptBlockLayout).rows
    const contentChanged = contentRevision !== lastContentRevision.current
    lastContentRevision.current = contentRevision
    dispatchViewport({
      kind: 'layout',
      contentRows,
      viewportRows: viewportBox.height,
      blocks: layouts,
      unseenRowsAdded: contentChanged
        ? Math.max(0, contentRows - viewport.contentRows)
        : 0,
    })
    if (frameMetrics !== undefined) {
      let mounted = 0
      for (const layoutIndex of visibleIndexes) {
        const entry = renderEntries[layoutIndex]
        if (entry === undefined) continue
        const layout = virtualLayouts[layoutIndex]
        if (layout === undefined) {
          continue
        }
        let window: { start: number; end: number } | undefined
        if (physicalViewport) {
          window = sliceWindow(
            entry.lines.length,
            layout.top,
            overscanTop,
            overscanBottom,
          )
        }
        mounted += window === undefined
          ? entry.lines.length
          : Math.max(0, window.end - window.start)
      }
      frameMetrics.addMountedRows(mounted)
    }
  }, [
    effectiveViewportRows,
    frameMetrics,
    layoutInputs,
    layoutScope,
    overscanBottom,
    overscanRows,
    overscanTop,
    physicalViewport,
    renderEntries,
    virtualLayouts,
    visibleEntries,
  ])

  const rail = physicalScrollRailGeometry(
    viewport.contentRows,
    viewport.viewportRows,
    viewport.offsetFromBottom,
  )

  const publishedRail = physicalViewport && rail !== undefined
    ? {
      col: columns,
      topRow: 3,
      rows: rail.rows,
      thumbStart: rail.thumbStart,
      thumbRows: rail.thumbRows,
    }
    : undefined
  const visibleFrame = useMemo<VisibleFrameSnapshot>(() => {
    const snapshotRows = []
    const verticalBase = Math.max(0, effectiveViewportRows - virtualContentRows)
    for (const { entry, index: layoutIndex } of visibleEntryPairs) {
      const layout = virtualLayouts[layoutIndex]
      if (layout === undefined) continue
      const start = Math.max(0, Math.floor(visibleTop - layout.top))
      const end = Math.min(entry.lines.length, Math.ceil(visibleBottom - layout.top))
      const assistant = entry.kind === 'active'
        || (entry.row.kind === 'message' && entry.row.message.kind === 'assistant')
      const ranges = assistant
        ? presentedEntryRows.textRanges.get(entry.id) ?? EMPTY_TEXT_RANGES
        : EMPTY_TEXT_RANGES
      const tailRange = entry.kind === 'active' ? ranges.at(-1) : undefined
      for (let index = start; index < end; index += 1) {
        const line = entry.lines[index]
        if (line === undefined) continue
        const absoluteRow = 3 + verticalBase + layout.top + index - visibleTop
        if (absoluteRow < 3 || absoluteRow >= 3 + effectiveViewportRows) continue
        const lead = assistant ? snapshotLead(ranges, index) : ''
        const tail = entry.kind === 'active'
          && generating
          && tailRange !== undefined
          && index === tailRange.end - 1
          ? '▌'
          : ''
        snapshotRows.push(createFrameSnapshotRow({
          id: `${entry.id}:${String(index)}`,
          row: absoluteRow,
          col: contentLeft + 1,
          line: framePhysicalLine(entry.id, line, lead, tail, entry.kind === 'active'),
        }))
      }
    }
    return Object.freeze({
      revision: [
        contentRevision,
        String(viewport.offsetFromBottom),
        String(columns),
        String(rows),
        themeTier,
        snapshotRows.map(row => `${row.id}:${row.identity}`).join('|'),
      ].join('\u0000'),
      geometry: Object.freeze({
        columns,
        rows,
        transcriptTop: 3,
        transcriptLeft: contentLeft + 1,
        transcriptWidth: contentWidth,
        transcriptRows: effectiveViewportRows,
        ...(publishedRail === undefined ? {} : { rail: publishedRail }),
      }),
      rows: Object.freeze(snapshotRows),
    })
  }, [
    columns,
    contentLeft,
    contentRevision,
    contentWidth,
    effectiveViewportRows,
    generating,
    presentedEntryRows,
    publishedRail,
    renderEntries,
    rows,
    themeTier,
    viewport.offsetFromBottom,
    virtualContentRows,
    virtualLayouts,
    visibleBottom,
    visibleEntryPairs,
    visibleTop,
  ])
  setVisibleFrameSnapshot(visibleFrame)
  setFrameRail(publishedRail)
  setMouseRailRegion(publishedRail === undefined
    ? undefined
    : {
      col: publishedRail.col,
      topRow: publishedRail.topRow,
      rows: publishedRail.rows,
    })
  useLayoutEffect(() => {
    if (physicalViewport) writePublishedFrameRail(stdout)
  }, [
    columns,
    physicalViewport,
    rail?.rows,
    rail?.thumbRows,
    rail?.thumbStart,
    stdout,
  ])
  useEffect(() => () => {
    setVisibleFrameSnapshot(undefined)
    setFrameRail(undefined)
    setMouseRailRegion(undefined)
  }, [])

  const renderReasoning = (
    part: Extract<TurnPart, { kind: 'reasoning' }>,
    key: number,
    gap: number,
    live: boolean,
  ): ReactNode => (
    <Box key={key} marginTop={gap} width="100%">
      <ReasoningBlock
        text={part.text}
        collapsed={live ? false : !reasoningExpanded}
        durationMs={part.durationMs}
        live={live}
      />
    </Box>
  )
  const renderCard = (
    part: Extract<TurnPart, { kind: 'card' }>,
    key: number,
    gap: number,
  ): ReactNode => (
    <Box key={key} marginTop={gap} width="100%">
      <ToolCard
        card={attachPresenterViews(presenters, part.card)}
        expanded={toolCardsExpanded}
        maxCols={contentWidth}
      />
    </Box>
  )

  const renderFrozenTail = (message: FrozenMessage): ReactNode => {
    const showCompletionBoundary = message.id === latestSettledAssistantId
    const cards = cardsFrom(message.content ?? []).map(card =>
      attachPresenterViews(presenters, card),
    )
    const produced = producedPathsForTurn(cards)
    const stats =
      message.usageOutputTokens !== undefined
      && message.stepWallMs !== undefined
      && message.turnOrdinal !== undefined
        ? `turn ${String(message.turnOrdinal)} · ${String(message.usageOutputTokens)} tok · ${String(message.stepWallMs)} ms`
        : undefined
    if (produced.length === 0 && stats === undefined && !showCompletionBoundary) return undefined
    const producedRows: string[][] = []
    let rowRuns = [styled('产物 · ', 'fg')]
    let rowWidth = displayWidth('产物 · ')
    let pathsInRow = 0
    const tailWidth = contentWidth
    for (const path of produced) {
      let prefix = pathsInRow === 0 && producedRows.length === 0 ? '' : ' · '
      if (pathsInRow > 0 && rowWidth + displayWidth(`${prefix}${path}`) > tailWidth) {
        producedRows.push(rowRuns)
        rowRuns = []
        rowWidth = 0
        pathsInRow = 0
        prefix = '  · '
      }
      const segment = styled(escapeContent(`${prefix}${path}`), 'fgDim')
      const href = isAbsolute(path) ? pathToFileURL(path).href : undefined
      const run = hyperlinksEnabled() && href !== undefined && isOsc8Href(href)
        ? wrapOsc8(segment, href)
        : segment
      rowRuns.push(run)
      rowWidth += displayWidth(`${prefix}${path}`)
      pathsInRow += 1
    }
    if (pathsInRow > 0) producedRows.push(rowRuns)
    return (
      <Box key="turn-tail" marginTop={1} flexDirection="column" width="100%">
        {showCompletionBoundary ? (
          <Text>{paintRow([styled('── 已完成 ──', 'fgDim')])}</Text>
        ) : null}
        {producedRows.map((runs, index) => (
          <Text key={`produced-${String(index)}`}>{paintRow(runs)}</Text>
        ))}
        {stats !== undefined ? (
          <Text>{paintRow([styled(escapeContent(stats), 'fgDim')])}</Text>
        ) : null}
      </Box>
    )
  }

  const renderFrozenMessage = (message: FrozenMessage): ReactNode => {
    const parts = partsFromFrozen(message)
    const digest = denseDigestForParts(parts, false, reasoningExpanded, toolCardsExpanded)
    const visibleParts = digest === undefined ? parts : parts.slice(digest.suffixStart)
    const blocks = visibleParts.map((part, index) => {
      const gap = index > 0 ? 1 : 0
      if (part.kind === 'reasoning') {
        return (
          <Box key={index} marginTop={gap} width="100%">
            <ReasoningBlock
              text={part.text}
              collapsed={!reasoningExpanded}
              durationMs={part.durationMs}
            />
          </Box>
        )
      }
      if (part.kind === 'card') return renderCard(part, index, gap)
      return (
        <Box key={index} marginTop={gap} width="100%">
          <SettledMarkdownBlock
            source={part.text}
            maxCols={contentWidth}
            themeTier={currentTier()}
          />
        </Box>
      )
    })
    const tail = renderFrozenTail(message)
    const rows: ReactNode[] = []
    if (digest !== undefined) {
      rows.push(
        <Text key="dense-digest">
          {paintRow([styled(escapeContent(digestRowText(digest, contentWidth)), 'fgDim')])}
        </Text>,
      )
    }
    rows.push(...blocks)
    if (tail !== undefined) rows.push(tail)
    return rows
  }

  const renderCompaction = (divider: CompactionDivider): ReactNode => {
    const expanded = divider.compactionId === expandedCompactionId
    return (
      <Box flexDirection="column" width="100%">
        <Text>{paintRow([styled(escapeContent(compactionDividerLabel(divider, expanded)), 'fgDim')])}</Text>
        {expanded && divider.summary !== '' ? (
          <Text>
            {paintRow([
              styled('摘要 ', 'fgDim'),
              styled(escapeContent(divider.summary), 'fg'),
            ])}
          </Text>
        ) : null}
      </Box>
    )
  }

  const renderActiveTurn = (turn: ActiveTurn): ReactNode => {
    const parts = partsFromTurn(turn)
    const visibleParts = parts.filter(isVisiblePart)
    if (generating && visibleParts.length === 0) {
      return (
        <Box flexDirection="column" width="100%" flexShrink={0}>
          <Text>
            {paintRow([
              styled('● ', 'accent', undefined, true),
              styled('正在思考…', 'fg'),
            ])}
          </Text>
        </Box>
      )
    }
    const digest = denseDigestForParts(parts, generating, reasoningExpanded, toolCardsExpanded)
    const renderedParts = digest === undefined ? parts : parts.slice(digest.suffixStart)
    let lastText = -1
    let lastReasoning = -1
    renderedParts.forEach((part, index) => {
      if (part.kind === 'text') lastText = index
      if (part.kind === 'reasoning') lastReasoning = index
    })
    return (
      <Box flexDirection="column" width="100%" flexShrink={0}>
        {digest === undefined ? null : (
          <Text>{paintRow([styled(escapeContent(digestRowText(digest, contentWidth)), 'fgDim')])}</Text>
        )}
        {renderedParts.map((part, index) => {
          const gap = index > 0 ? 1 : 0
          if (part.kind === 'reasoning') {
            // While generating only the last run stays live; earlier runs and
            // every settled run collapse to their own stamped fold.
            const live = generating && index === lastReasoning
            return renderReasoning(part, index, gap, live)
          }
          if (part.kind === 'card') return renderCard(part, index, gap)
          return (
            <Box key={index} marginTop={gap} width="100%">
              <MarkdownBlock
                source={part.text}
                maxCols={contentWidth}
                prefix={{ first: activeMarker(), rest: restIndent() }}
                tail={
                  generating && index === lastText ? cursorRun() : undefined
                }
              />
            </Box>
          )
        })}
      </Box>
    )
  }

  const transcriptViewport = (
    <Box
      ref={viewportRef}
      flexDirection="column"
      position="relative"
      width="100%"
      flexGrow={1}
      overflow="hidden"
      justifyContent={idleHome ? 'center' : 'flex-start'}
      alignItems={idleHome ? 'center' : 'flex-start'}
    >
      {idleHome
        ? (
          <PixelFishHome
            tier={brandTier}
            animate={brandAnimation}
            visible
            maxColumns={contentWidth}
            maxRows={viewport.viewportRows > 0
              ? viewport.viewportRows
              : Math.max(0, rows - 7)}
            frameProbe={brandFrameProbe}
          />
        )
        : (
          <Box
            flexDirection="column"
            position={physicalViewport ? 'absolute' : 'relative'}
            bottom={physicalViewport ? -effectiveOffset : undefined}
            left={physicalViewport ? contentLeft : undefined}
            marginLeft={physicalViewport ? undefined : contentLeft}
            width={contentWidth}
            flexShrink={0}
          >
            {leadingRows > 0 ? <Box height={leadingRows} flexShrink={0} /> : null}
            {visibleEntryPairs.map(({ entry, index: layoutIndex }) => {
              const blockId = entry.id
              const entryLines = entry.lines
              const layout = virtualLayouts[layoutIndex]
              let window: { start: number; end: number } | undefined
              if (physicalViewport) {
                window = sliceWindow(
                  entryLines.length,
                  layout?.top ?? 0,
                  overscanTop,
                  overscanBottom,
                )
              }
              if (entry.kind === 'active') {
                if (window !== undefined) {
                  const ranges = presentedEntryRows.textRanges.get(blockId) ?? EMPTY_TEXT_RANGES
                  const tailRange = ranges.at(-1)
                  return (
                    <Box
                      key={blockId}
                      ref={(element) => {
                        if (element === null) blockRefs.current.delete(blockId)
                        else blockRefs.current.set(blockId, element)
                      }}
                      flexDirection="column"
                      width="100%"
                      flexShrink={0}
                    >
                      {window.start > 0 ? <Box height={window.start} flexShrink={0} /> : null}
                      <SlicedLinesBlock
                        lines={entryLines}
                        sliceStart={window.start}
                        sliceEnd={window.end}
                        prefix={{ first: activeMarker(), rest: restIndent() }}
                        textRanges={ranges}
                        tailRow={tailRange === undefined ? -1 : tailRange.end - 1}
                        tail={generating ? cursorRun() : undefined}
                      />
                      {window.end < entryLines.length
                        ? <Box height={entryLines.length - window.end} flexShrink={0} />
                        : null}
                    </Box>
                  )
                }
                return (
                  <Box
                    key={blockId}
                    ref={(element) => {
                      if (element === null) blockRefs.current.delete(blockId)
                      else blockRefs.current.set(blockId, element)
                    }}
                    flexDirection="column"
                    width="100%"
                    flexShrink={0}
                  >
                    {renderActiveTurn(entry.turn)}
                  </Box>
                )
              }
              const row = entry.row
              if (window !== undefined) {
                const assistant = row.kind === 'message' && row.message.kind === 'assistant'
                const ranges = assistant
                  ? presentedEntryRows.textRanges.get(blockId) ?? EMPTY_TEXT_RANGES
                  : EMPTY_TEXT_RANGES
                return (
                  <Box
                    key={blockId}
                    ref={(element) => {
                      if (element === null) blockRefs.current.delete(blockId)
                      else blockRefs.current.set(blockId, element)
                    }}
                    flexDirection="column"
                    width="100%"
                    paddingBottom={entry.gapRows}
                    flexShrink={0}
                  >
                    {window.start > 0 ? <Box height={window.start} flexShrink={0} /> : null}
                    <SlicedLinesBlock
                      lines={entryLines}
                      sliceStart={window.start}
                      sliceEnd={window.end}
                      prefix={{
                        first: kindMarker('● ', 'accent'),
                        rest: restIndent(),
                      }}
                      textRanges={ranges}
                    />
                    {window.end < entryLines.length
                      ? <Box height={entryLines.length - window.end} flexShrink={0} />
                      : null}
                  </Box>
                )
              }
              return (
                <Box
                  key={blockId}
                  ref={(element) => {
                    if (element === null) blockRefs.current.delete(blockId)
                    else blockRefs.current.set(blockId, element)
                  }}
                  flexDirection="column"
                  width="100%"
                  paddingBottom={entry.gapRows}
                  flexShrink={0}
                >
                  {row.kind === 'compaction'
                    ? renderCompaction(row.divider)
                    : row.message.kind === 'user'
                      ? <Text wrap="wrap">{userRun(row.message.text)}</Text>
                      : renderFrozenMessage(row.message)}
                </Box>
              )
            })}
            {trailingRows > 0 ? <Box height={trailingRows} flexShrink={0} /> : null}
          </Box>
        )}
      {!viewport.follow && viewport.unseenRows > 0 ? (
        <Box position="absolute" right={rail === undefined ? 0 : 2} bottom={0}>
          <Text>{styled(`↓ 最新消息 · ${String(viewport.unseenRows)}`, 'accent')}</Text>
        </Box>
      ) : null}
    </Box>
  )

  return (
    transcriptViewport
  )
}
