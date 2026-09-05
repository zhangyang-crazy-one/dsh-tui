/**
 * Renders the current dynamic conversation window and active turn. History rows
 * use stable event ids; the physical-row viewport preserves a measured anchor
 * while detached and always paints a bottom-navigation notice, with an unseen
 * row count when output arrives.
 *
 * One turn paints as a timeline in retained event order: consecutive text and
 * reasoning merge into parts, and each tool call becomes one card that already
 * carries its matching result (no flattened reasoning-then-body-then-tools
 * dump). A closed tool stack retains three representative cards and replaces
 * older calls with one expandable summary; adjacent cards share a compact
 * stack. Settled and streaming text share {@link MarkdownBlock} so a finishing
 * turn never reflows; the `● ` marker is the first row's painted prefix, and
 * enabled reasoning retains its full body, and only its final run has a live
 * duration while generating. Disabled reasoning occupies no transcript rows.
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
import { formatTurnTailStats, producedPathsForTurn } from './turn-tail.ts'
import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'
import { currentTier, inkColor, paintBackgroundRow, paintRow, styled } from './theme.ts'
import type { StyleToken } from './theme.ts'
import { MarkdownBlock } from './markdown.tsx'
import { formatSeconds, ReasoningBlock } from './reasoning.tsx'
import { ToolCard } from './tool-card.tsx'
import { ToolRowCache } from './tool-rows.ts'
import { ToolPresenterCache } from './tool-presenter-cache.ts'
import { DisplayRevisionIndex } from './display-revision.ts'
import { PlainTextRowCache } from './plain-rows.ts'
import { RowSequence, type RowSource } from './row-source.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'
import {
  attachPresenterViews,
  cardsFrom,
  cardsFromActiveTurn,
  toolCardDisplayStatus,
  truncateDisplay,
} from './tool-cards.ts'
import type { ToolCardModel, ToolCardStatus, ToolPresenterLookup } from './tool-cards.ts'
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
import { releaseFrameRail, setFrameRail, writePublishedFrameSnapshot } from './frame-fill.ts'
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
import type { PhysicalLine, PhysicalLineSpan } from './physical-line.ts'
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

/** Speaker inset, mirrored on the right to center the Markdown body. */
const ASSISTANT_PROSE_PREFIX_COLUMNS = displayWidth('● ')

/** The one-decimal duration label changes at most once per 100 ms. */
const LIVE_DURATION_TICK_MS = 100

/**
 * Derive the Markdown body scope from the complete conversation-row budget.
 * Active and settled prose use the same prefix width, so ownership can
 * transfer to history without reflow.
 * @param scope - complete conversation-row scope.
 * @returns a scope whose width excludes assistant-owned row affixes.
 */
function assistantProseScope(scope: BlockRowsScope): BlockRowsScope {
  const width = Math.max(1, scope.width - ASSISTANT_PROSE_PREFIX_COLUMNS * 2)
  const fold = { reasoning: false, tools: false }
  return {
    ...scope,
    width,
    fold,
    scopeKey: computeBlockRowsScopeKey(
      width,
      scope.theme,
      fold,
      scope.renderMode,
    ),
  }
}

/** Conversation projection inputs. */
export interface StreamViewProps {
  /** Locale for tool previews and their detail entry. */
  locale?: TuiLocale
  /** Changes when sibling chrome can change the measured transcript height. */
  layoutKey?: object
  /** Folded view model containing stable history rows, the active turn, and reasoning-display state. */
  model: ViewModel
  /** Optional tools-registry lookup for presenter titles; omitted stays generic. */
  presenters?: ToolPresenterLookup | undefined
  /** Strongest generated FishLogo glyph tier supported by the terminal. */
  brandTier?: BrandRenderTier | undefined
  /** Whether the current loop state permits the one-shot brand reveal. */
  brandAnimation?: boolean | undefined
  /** Show the overflow scrollbar; hiding it preserves the reading width and scroll position. */
  scrollbar?: boolean | undefined
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
  /**
   * Interactive mode ('agent' | 'plan' | 'focus').
   * In 'focus' mode, intermediate tool cards are excluded from the transcript
   * so conclusions dominate.
   */
  mode?: 'agent' | 'plan' | 'focus' | undefined
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
  if (part.kind === 'card' || part.kind === 'tool-summary') return true
  return part.text !== ''
}

/** Remove disabled reasoning before allocating rows or inter-module spacing. */
function displayedParts(parts: readonly TurnPart[], reasoningExpanded: boolean): TurnPart[] {
  return parts.filter(part => isVisiblePart(part) && (part.kind !== 'reasoning' || reasoningExpanded))
}

/** Maximum individual cards retained while the tool fold is closed. */
const COLLAPSED_TOOL_CARD_LIMIT = 3

interface ToolStackSummary {
  readonly hiddenCount: number
  readonly okCount: number
  readonly errorCount: number
  readonly runningCount: number
}

function toolSummaryStatus(summary: ToolStackSummary): ToolCardStatus {
  if (summary.errorCount > 0) return 'error'
  return summary.runningCount > 0 ? 'running' : 'ok'
}

function toolSummaryText(summary: ToolStackSummary, maxCols: number): string {
  const status = [
    summary.okCount > 0 && (summary.errorCount > 0 || summary.runningCount > 0)
      ? `完成 ${String(summary.okCount)}`
      : undefined,
    summary.errorCount > 0 ? `失败 ${String(summary.errorCount)}` : undefined,
    summary.runningCount > 0 ? `运行中 ${String(summary.runningCount)}` : undefined,
  ].filter((value): value is string => value !== undefined)
  const full = [
    `▸ 工具记录 · 已收起 ${String(summary.hiddenCount)} 个`,
    ...status,
    'Ctrl+E 展开',
  ].join(' · ')
  if (displayWidth(full) <= maxCols) return full
  const compactStatus = [
    summary.errorCount > 0 ? `失败${String(summary.errorCount)}` : undefined,
    summary.runningCount > 0 ? `运行${String(summary.runningCount)}` : undefined,
  ].filter((value): value is string => value !== undefined)
  const compact = [`▸ 工具 ${String(summary.hiddenCount)}`, ...compactStatus, 'Ctrl+E'].join(' · ')
  if (displayWidth(compact) <= maxCols) return compact
  const suffix = ' · Ctrl+E'
  const prefixBudget = maxCols - displayWidth(suffix)
  if (prefixBudget <= 0) return truncateDisplay('Ctrl+E', maxCols)
  return `${truncateDisplay(`▸ ${String(summary.hiddenCount)} 工具`, prefixBudget)}${suffix}`
}

/**
 * Bound the closed tool stack while keeping the most recent running card,
 * failure, and calls available without expansion. Non-tool parts retain their
 * order; Ctrl+E returns the complete card list.
 */
function compactToolParts(
  parts: readonly TurnPart[],
  toolCardsExpanded: boolean,
  presenters: ToolPresenterLookup | undefined,
  mode?: 'agent' | 'plan' | 'focus',
  cache?: ToolPresenterCache,
): TurnPart[] {
  if (mode === 'focus') {
    return parts.filter(part => part.kind !== 'card' && part.kind !== 'tool-summary')
  }
  const presentedParts = parts.map(part => part.kind === 'card'
    ? { kind: 'card' as const, card: cache === undefined ? attachPresenterViews(presenters, part.card) : cache.present(presenters, part.card) }
    : part)
  const cards = presentedParts.flatMap((part, index) => part.kind === 'card'
    ? [{ index, status: toolCardDisplayStatus(part.card) }]
    : [])
  if (toolCardsExpanded || cards.length <= COLLAPSED_TOOL_CARD_LIMIT) return presentedParts

  const retained = new Set<number>()
  const retainLatest = (status: ToolCardStatus): void => {
    const match = cards.findLast(card => card.status === status)
    if (match !== undefined) retained.add(match.index)
  }
  retainLatest('running')
  retainLatest('error')
  for (let index = cards.length - 1; index >= 0 && retained.size < COLLAPSED_TOOL_CARD_LIMIT; index -= 1) {
    const card = cards[index]
    if (card !== undefined) retained.add(card.index)
  }

  const hidden = cards.filter(card => !retained.has(card.index))
  const firstHiddenIndex = hidden[0]?.index
  const summary: ToolStackSummary = {
    hiddenCount: hidden.length,
    okCount: hidden.filter(card => card.status === 'ok').length,
    errorCount: hidden.filter(card => card.status === 'error').length,
    runningCount: hidden.filter(card => card.status === 'running').length,
  }
  return presentedParts.flatMap((part, index): TurnPart[] => {
    if (part.kind !== 'card' || retained.has(index)) return [part]
    return index === firstHiddenIndex ? [{ kind: 'tool-summary', summary }] : []
  })
}

/**
 * One ordered piece of a turn timeline: merged prose, one reasoning run, or
 * one paired tool card. Text carries its own marker when painted.
 */
type TurnPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string; durationMs: number }
  | { kind: 'card'; card: ToolCardModel }
  | { kind: 'tool-summary'; summary: ToolStackSummary }

function turnPartGap(parts: readonly TurnPart[], index: number): number {
  if (index === 0) return 0
  const previous = parts[index - 1]
  const current = parts[index]
  const previousIsTool = previous?.kind === 'card' || previous?.kind === 'tool-summary'
  const currentIsTool = current?.kind === 'card' || current?.kind === 'tool-summary'
  return previousIsTool && currentIsTool ? 0 : 1
}

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


function transcriptBlockVersion(row: TranscriptRow, revisions: DisplayRevisionIndex): string {
  return revisions.revision(row.kind === 'compaction' ? row.divider : row.message)
}

function activeTurnVersion(turn: ActiveTurn, revisions: DisplayRevisionIndex): string {
  return revisions.revision(turn, [
    turn.assistantText, turn.reasoningText, turn.reasoningDurationMs, turn.reason,
    ...turn.toolCalls.flatMap(call => [call.callId, call.name, call.arguments]),
    ...(turn.content ?? []),
  ])
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

/** One active elapsed-time label that advances between model events. */
interface LiveDurationTarget {
  /** Stable identity of the pending turn or current reasoning run. */
  readonly identity: string
  /** Latest event-derived elapsed duration. */
  readonly durationMs: number
}

/** Select the pending or reasoning duration that remains live while generating. */
function liveDurationTarget(
  turn: ActiveTurn | undefined,
  status: ViewModel['status'],
): LiveDurationTarget | undefined {
  if (turn === undefined || status !== 'generating') return undefined
  const parts = partsFromTurn(turn)
  const visibleParts = parts.filter(isVisiblePart)
  if (visibleParts.length === 0) {
    return {
      identity: `turn-${String(turn.turn)}-pending`,
      durationMs: turn.reasoningDurationMs,
    }
  }
  const index = parts.findLastIndex(isVisiblePart)
  const part = parts[index]
  if (part?.kind !== 'reasoning') return undefined
  return {
    identity: `turn-${String(turn.turn)}-reasoning-${String(index)}`,
    durationMs: part.durationMs,
  }
}

/** Advance one live duration without allowing a newer event sample to move it backwards. */
function useLiveDuration(target: LiveDurationTarget | undefined): number | undefined {
  const [clock, setClock] = useState(() => Date.now())
  const sample = useRef<{
    identity: string
    observedMs: number
    baseMs: number
    sampledAt: number
  } | undefined>(undefined)
  const sampledAt = Date.now()
  if (target === undefined) {
    sample.current = undefined
  } else if (sample.current === undefined || sample.current.identity !== target.identity) {
    sample.current = {
      identity: target.identity,
      observedMs: target.durationMs,
      baseMs: target.durationMs,
      sampledAt,
    }
  } else if (sample.current.observedMs !== target.durationMs) {
    const advancedMs = sample.current.baseMs
      + Math.max(0, sampledAt - sample.current.sampledAt)
    sample.current = {
      identity: target.identity,
      observedMs: target.durationMs,
      baseMs: Math.max(target.durationMs, advancedMs),
      sampledAt,
    }
  }
  const identity = target?.identity
  useEffect(() => {
    if (identity === undefined) return
    const timer = setInterval(() => {
      setClock(Date.now())
    }, LIVE_DURATION_TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [identity])
  const current = sample.current
  if (current === undefined) return undefined
  return current.baseMs + Math.max(0, Math.max(clock, sampledAt) - current.sampledAt)
}

/**
 * One painted row prefix: the kind glyph plus a bg strip, against the accent
 * brightness matrix. History marks the assistant `●` in plain accent and the
 * user `>` in fgDim; the active turn (the current item) takes the strong
 * accent bold tier. The marker rides the markdown row as its prefix so no
 * sibling span leaves unstyled gap cells; the composer alone owns the cursor.
 * @param glyph - the kind marker, e.g. `● ` or `> `.
 * @param token - theme token for the marker (accent or fgDim; the active
 *   turn's bold accent uses {@link activeMarker}).
 * @returns the escaped, painted marker run.
 */
function kindMarker(glyph: string, token: 'accentText' | 'fgDim'): string {
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
      prefix={{ first: kindMarker('● ', 'accentText'), rest: restIndent() }}
      settled
    />
  )
})

/**
 * User transcript glyphs: fgDim marker plus soft foreground body, painted
 * through the full-width message surface. 02-UI-SPEC C5 distinguishes
 * user rows by the `>` marker in the same centered conversation column as
 * assistant rows, with both bodies left-aligned inside that column.
 * @param text - unescaped user body.
 * @param columns - conversation surface width in terminal cells.
 * @returns the painted marker, body, and remaining message-surface cells.
 */
function userRun(text: string, columns: number): string {
  return paintBackgroundRow([
    styled(escapeContent('> '), 'fgDim'),
    styled(escapeContent(text), 'fgSoft'),
  ], 'messageBg', columns)
}

/**
 * The active-turn marker: the current item gets the strong tier (bold
 * accent) per the brightness matrix (PITFALLS C3).
 * @returns the painted bold accent run.
 */
function activeMarker(): string {
  return paintRow([styled(escapeContent('● '), 'accentText', undefined, true)])
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
    ...(line.backgroundColumns === undefined
      ? {}
      : { backgroundColumns: line.backgroundColumns }),
  })
}

interface PromptOverlay {
  readonly text: string
  readonly startCol: number
}

function overlayPromptOnSpans(
  spans: ReadonlyArray<PhysicalLineSpan>,
  prompt: PromptOverlay,
): ReadonlyArray<PhysicalLineSpan> {
  const result: PhysicalLineSpan[] = []
  let col = 0
  for (const span of spans) {
    const spanWidth = displayWidth(span.text)
    if (col + spanWidth <= prompt.startCol) {
      result.push(span)
      col += spanWidth
    } else if (col < prompt.startCol) {
      const budget = prompt.startCol - col
      const truncated = truncateDisplay(span.text, budget)
      if (truncated !== '') {
        result.push({ ...span, text: truncated })
      }
      col = prompt.startCol
      break
    } else {
      break
    }
  }
  if (col < prompt.startCol) {
    result.push({
      text: ' '.repeat(prompt.startCol - col),
      token: 'bg',
      bold: false,
    })
  }
  result.push({
    text: prompt.text,
    token: 'accentText',
    bold: false,
  })
  return result
}

/** Add transcript marker or indent cells to a snapshot-owned row. */
function framePhysicalLine(
  blockId: string,
  line: MarkdownRenderLine,
  lead: string,
  active: boolean,
  prompt?: PromptOverlay,
): PhysicalLine {
  const base = markdownLineToPhysicalLine(blockId, line)
  const initialSpans: PhysicalLineSpan[] = [
    ...(lead === ''
      ? []
      : [{
        text: lead,
        token: lead.trim() === '' ? 'bg' as const : 'accentText' as const,
        bold: active && lead.trim() !== '',
      }]),
    ...base.spans,
  ]
  const spans = prompt !== undefined
    ? overlayPromptOnSpans(initialSpans, prompt)
    : initialSpans
  return createPhysicalLine({
    blockId,
    spans,
    sourceStart: base.sourceStart,
    sourceEnd: base.sourceEnd,
    blockRow: base.blockRow,
    ...(base.background === undefined ? {} : { background: base.background }),
    ...(base.backgroundColumns === undefined
      ? {}
      : { backgroundColumns: base.backgroundColumns }),
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
  readonly rows: ReadonlyMap<string, RowSource<MarkdownRenderLine>>
  readonly textRanges: ReadonlyMap<string, readonly BlockTextRange[]>
  readonly storeBlocks: ReadonlyMap<string, StoredBlockRows>
}

/** Affix-free range list shared by entries whose rows are self-contained. */
const EMPTY_TEXT_RANGES: readonly BlockTextRange[] = []

/** Blank row matching the one-row margin the JSX path puts between parts. */
const GAP_LINE: MarkdownRenderLine = Object.freeze({
  text: ' ',
  displayWidth: 1,
  spans: Object.freeze([{ start: 0, end: 1, token: 'fg' as const, bold: false }]),
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

const paintedRenderLineCache = new WeakMap<MarkdownRenderLine, Map<string, string>>()

/** Reuse terminal bytes for immutable projected rows across viewport shifts. */
function cachedPaintedRenderLine(
  line: MarkdownRenderLine,
  cacheKey: string,
  hyperlinks: boolean,
): string {
  let variants = paintedRenderLineCache.get(line)
  if (variants === undefined) {
    variants = new Map<string, string>()
    paintedRenderLineCache.set(line, variants)
  }
  const cached = variants.get(cacheKey)
  if (cached !== undefined) return cached
  const painted = paintLineFromRenderLine(line, hyperlinks)
  variants.set(cacheKey, painted)
  return painted
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
  readonly lines: RowSource<MarkdownRenderLine>
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
  const hyperlinks = hyperlinksEnabled()
  const paintCacheKey = `${currentTier()}:${hyperlinks ? 'links' : 'plain'}`
  for (let index = start; index < end; index += 1) {
    const line = lines.at(index)
    if (line === undefined) {
      continue
    }
    const painted = cachedPaintedRenderLine(line, paintCacheKey, hyperlinks)
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
 * Reasoning stays hidden and tool cards remain compact by default.
 * @param props - projected conversation state and interaction callbacks.
 * @returns the centered Ink element tree for the current physical viewport.
 */
export function StreamView({
  model,
  presenters,
  brandTier = 'plain',
  brandAnimation = false,
  scrollbar = true,
  brandFrameProbe,
  viewportCommand,
  renderPolicy,
  frameMetrics,
  motionPaused = false,
  mode = 'agent',
  layoutKey,
  locale = 'zh-CN',
}: StreamViewProps): ReactNode {
  const policy = renderPolicy ?? renderPolicyDefaults()
  const toolRows = useMemo(() => new ToolRowCache(policy.tools), [
    policy.tools.previewRows, policy.tools.cacheEntries, policy.tools.cacheRows,
  ])
  const presenterCache = useMemo(() => new ToolPresenterCache(policy.tools.cacheEntries), [policy.tools.cacheEntries])
  const plainRows = useMemo(() => new PlainTextRowCache(policy.cache), [policy.cache.maxRows, policy.cache.maxBytes])
  useEffect(() => () =>{  plainRows.clear() }, [plainRows])
  useEffect(() => () =>{  presenterCache.clear() }, [presenterCache])
  useEffect(() => () =>{  toolRows.clear() }, [toolRows])
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
  const [measuredGeometry, setMeasuredGeometry] = useState<{
    columns: number
    rows: number
    height: number
    key: object | undefined
  }>()
  const geometryMeasured = measuredGeometry !== undefined
    && measuredGeometry.columns === columns && measuredGeometry.rows === rows
    && measuredGeometry.key === layoutKey
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
      demandDriven: true,
    })
    let lastDispatchedOffset = -1
    const unsubscribe = arbiter.onPublish((snapshot) => {
      const presented = snapshot.stream.at(-1)
      if (presented !== undefined) setPresentedEntryRows(presented)
      if (snapshot.scroll.presented !== lastDispatchedOffset) {
        lastDispatchedOffset = snapshot.scroll.presented
        dispatchViewport({
          kind: 'offset',
          offsetFromBottom: snapshot.scroll.presented,
        })
      }
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
  const liveDurationMs = useLiveDuration(liveDurationTarget(activeTurn, status))
  const revisions = useRef(new DisplayRevisionIndex()).current
  const compactionVersion = compactionDividers.map(divider => (
    revisions.revision(divider)
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
  const activeVersion = activeTurn === undefined ? '' : activeTurnVersion(activeTurn, revisions)
  useLayoutEffect(() => {
    if (frameMetrics !== undefined && activeTurn !== undefined) {
      markDeltaIngress(frameMetrics)
    }
  }, [activeTurn, activeVersion, frameMetrics])
  /** Theme tier the projector paths reuse; the stream-view reads the same
   * value at render time so the projector scope key matches the JSX path. */
  const themeTier = currentTier()
  const blockRowsScope = useMemo<BlockRowsScope>(() => {
    const theme = themeTier === 'truecolor' || themeTier === '256' || themeTier === '16'
      ? themeTier
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
    const definitions = new Map<string, ReturnType<ToolPresenterLookup['get']>>()
    const batchPresenters: ToolPresenterLookup | undefined = presenters === undefined ? undefined : { get(name) {
      if (!definitions.has(name)) definitions.set(name, presenters.get(name))
      return definitions.get(name)
    } }
    const map = new Map<string, RowSource<MarkdownRenderLine>>()
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
      if (entry.kind === 'tool-card' && entry.meta?.toolCard !== undefined) {
        return { lines: toolRows.rows(entry.id, entry.meta.toolCard, scope.width, scope.fold.tools, locale) }
      }
      if (entry.kind === 'reasoning' && entry.meta?.reasoningExpanded === true && entry.source !== '') {
        const rows = new RowSequence<MarkdownRenderLine>()
        const header = `${entry.meta.reasoningLive === true ? '' : '▾ '}✻ ${tuiCopy('reasoning', locale)} (${((entry.meta.reasoningDurationMs ?? 0) / 1000).toFixed(1)}s)`
        rows.push({ ...GAP_LINE, text: header, displayWidth: displayWidth(header), spans: [{ start: 0, end: displayWidth(header), token: 'fgDim', bold: false }] })
        rows.append(plainRows.rows(entry.id, entry.source, Math.max(1, scope.width - 4)))
        return { lines: rows.build() }
      }
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
    for (const [index, row] of transcript.entries()) {
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
        const hasSubsequent = index < transcript.length - 1 || activeTurn !== undefined
        const projection = project(id, {
          id,
          kind: 'user',
          source: row.message.text,
          ...(hasSubsequent ? { meta: { userMessageGap: true } } : {}),
        }, settledBlockRowsScope, undefined, false)
        map.set(id, projection.lines)
        continue
      }
      const parts = displayedParts(
        compactToolParts(partsFromFrozen(row.message), toolCardsExpanded, batchPresenters, mode, presenterCache),
        reasoningExpanded,
      )
      const rows = new RowSequence<MarkdownRenderLine>()
      const ranges: BlockTextRange[] = []
      let textIndex = 0
      for (const [partIndex, part] of parts.entries()) {
        if (turnPartGap(parts, partIndex) > 0) rows.push(GAP_LINE)
        if (part.kind === 'reasoning') {
          rows.append(project(id, {
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
        if (part.kind === 'tool-summary') {
          rows.append(project(id, {
            id: `${id}-tool-summary`,
            kind: 'tool-summary',
            source: toolSummaryText(part.summary, contentWidth),
            meta: { toolSummaryStatus: toolSummaryStatus(part.summary) },
          }, settledBlockRowsScope, undefined, false).lines)
          continue
        }
        if (part.kind === 'card') {
          const card = part.card
          rows.append(project(id, {
            id: `${id}-c-${card.callId}`,
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
                ...(card.error === undefined ? {} : { error: card.error }),
                ...(card.callView === undefined ? {} : { callView: card.callView }),
                ...(card.resultView === undefined ? {} : { resultView: card.resultView }),
              },
            },
          }, settledBlockRowsScope, undefined, false).lines)
          continue
        }
        const start = rows.length
        const partId = `${id}-t-${String(textIndex++)}`
        rows.append(project(id, {
          id: partId,
          kind: 'assistant-prose',
          source: part.text,
        }, settledAssistantBlockRowsScope, projectorStateFor(
          projectorCache,
          partId,
          settledAssistantBlockRowsScope,
          row.message.turnOrdinal === undefined
            ? []
            : [`assistant-turn-${String(row.message.turnOrdinal)}-t-${String(textIndex - 1)}`],
          part.text,
        ), false).lines)
        ranges.push({ start, end: rows.length })
      }
      const tailMeta: BlockRowsMeta = {
        ...(latestAssistantId(history, activeTurn) === row.message.id
          ? { turnTailCompletionBoundary: true }
          : {}),
        ...((() => {
          const stats = formatTurnTailStats({
            turnOrdinal: row.message.turnOrdinal,
            turnUsage: row.message.turnUsage,
            legacyOutputTokens: row.message.usageOutputTokens,
            elapsedMs: row.message.stepWallMs,
          })
          return stats === undefined ? {} : { turnTailStats: stats }
        })()),
        ...((() => {
          const cards = cardsFrom(row.message.content ?? []).map(card =>
            presenterCache.present(batchPresenters, card),
          )
          const produced = producedPathsForTurn(cards)
          return produced.length === 0 ? {} : { turnTailProduced: produced }
        })()),
      }
      if (Object.keys(tailMeta).length > 0) {
        rows.push(GAP_LINE)
        rows.append(project(id, {
          id: `${id}-tail`,
          kind: 'turn-tail',
          source: '',
          meta: tailMeta,
        }, settledBlockRowsScope, undefined, false).lines)
      }
      map.set(id, rows.build())
      if (ranges.length > 0) textRanges.set(id, ranges)
    }
    if (activeTurn !== undefined) {
      const id = `assistant-turn-${String(activeTurn.turn)}`
      const rawParts = partsFromTurn(activeTurn)
      const visibleParts = displayedParts(rawParts, reasoningExpanded)
      if (status === 'generating' && visibleParts.length === 0) {
        map.set(id, project(id, {
          id,
          kind: 'active-placeholder',
          source: '',
          meta: {
            activePlaceholder: `● 正在处理… (${formatSeconds(
              liveDurationMs ?? activeTurn.reasoningDurationMs,
            )}s)`,
          },
        }, blockRowsScope, undefined, true).lines)
      } else {
        const parts = displayedParts(
          compactToolParts(rawParts, toolCardsExpanded, batchPresenters, mode, presenterCache), reasoningExpanded,
        )
        const rows = new RowSequence<MarkdownRenderLine>()
        const ranges: BlockTextRange[] = []
        let textIndex = 0
        let lastVisiblePart = -1
        for (const [partIndex, part] of parts.entries()) {
          if (isVisiblePart(part)) lastVisiblePart = partIndex
        }
        for (const [partIndex, part] of parts.entries()) {
          if (turnPartGap(parts, partIndex) > 0) rows.push(GAP_LINE)
          if (part.kind === 'reasoning') {
            const live = status === 'generating' && partIndex === lastVisiblePart
            rows.append(project(id, {
              id: `${id}-r-${String(partIndex)}`,
              kind: 'reasoning',
              source: part.text,
              meta: {
                reasoningDurationMs: live
                  ? liveDurationMs ?? part.durationMs
                  : part.durationMs,
                reasoningExpanded,
                reasoningLive: live,
              },
            }, blockRowsScope, undefined, status === 'generating').lines)
            continue
          }
          if (part.kind === 'tool-summary') {
            rows.append(project(id, {
              id: `${id}-tool-summary`,
              kind: 'tool-summary',
              source: toolSummaryText(part.summary, contentWidth),
              meta: { toolSummaryStatus: toolSummaryStatus(part.summary) },
            }, blockRowsScope, undefined, status === 'generating').lines)
            continue
          }
          if (part.kind === 'card') {
            const card = part.card
            rows.append(project(id, {
              id: `${id}-c-${card.callId}`,
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
                  ...(card.error === undefined ? {} : { error: card.error }),
                  ...(card.callView === undefined ? {} : { callView: card.callView }),
                  ...(card.resultView === undefined ? {} : { resultView: card.resultView }),
                },
              },
            }, blockRowsScope, undefined, status === 'generating').lines)
            continue
          }
          const start = rows.length
          const partId = `${id}-t-${String(textIndex++)}`
          rows.append(project(id, {
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
        map.set(id, rows.build())
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
    liveDurationMs,
    presenters,
    reasoningExpanded,
    status,
    settledAssistantBlockRowsScope,
    settledBlockRowsScope,
    toolCardsExpanded,
    toolRows,
    plainRows,
    presenterCache,
    locale,
    transcript,
    mode,
  ])
  const [presentedEntryRows, setPresentedEntryRows] = useState(entryRows)
  const activeEntryRows = status === 'generating' ? presentedEntryRows : entryRows
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
    // Each entry is complete; an unpresented predecessor is already obsolete.
    queue.flush()
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
  const lineRevisionOwners = useRef(new Map<string, object>())
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
      let revisionOwner = lineRevisionOwners.current.get(descriptor.entry.id)
      if (revisionOwner === undefined) {
        revisionOwner = {}
        lineRevisionOwners.current.set(descriptor.entry.id, revisionOwner)
      }
      const signature = revisions.revision(revisionOwner, [
        descriptor.scope.scopeKey,
        descriptor.entry.source,
        JSON.stringify(descriptor.entry.meta ?? {}),
        String(descriptor.lines.length),
      ])
      if (!descriptor.active && !activeLineRevisions.current.has(descriptor.entry.id)
        && storedLineSignatures.current.get(descriptor.entry.id) === signature) continue
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
      const hasSubsequent = index < transcript.length - 1 || activeTurn !== undefined
      const isUserWithGap = row.kind === 'message' && row.message.kind === 'user' && hasSubsequent
      const gapRows = isUserWithGap ? 0 : (hasSubsequent ? 2 : 0)
      const id = transcriptBlockId(row)
      if (activeTurn !== undefined && id === `assistant-turn-${String(activeTurn.turn)}`) {
        return []
      }
      const lines = activeEntryRows.rows.get(id) ?? []
      return [{
        kind: 'row' as const,
        id,
        version: `${transcriptBlockVersion(row, revisions)}\u0000${hasSubsequent ? 'gap' : 'tail'}`,
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
        estimatedRows: (activeEntryRows.rows.get(`assistant-turn-${String(activeTurn.turn)}`)?.length ?? 0),
        lines: activeEntryRows.rows.get(`assistant-turn-${String(activeTurn.turn)}`) ?? [],
        turn: activeTurn,
      }]),
  ], [
    activeTurn,
    activeVersion,
    activeEntryRows,
    transcript,
  ])
  const layoutScope = [
    contentWidth,
    currentTier(),
    reasoningExpanded ? 'reasoning-open' : 'reasoning-closed',
    mode === 'focus' ? 'tools-focus' : (toolCardsExpanded ? 'tools-open' : 'tools-closed'),
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
   * Follow mode mounts configured overscan while streaming to avoid viewport
   * clipping jitter at block boundaries when new rows are appended.
   */
  const configuredOverscanRows = Math.max(
    0,
    Math.min(
      effectiveViewportRows,
      Math.max(0, transcriptOverscan),
    ),
  )
  const overscanRows = configuredOverscanRows
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
    if (viewportCommand.kind !== 'reset' && (viewport.viewportRows === 0 || viewport.contentRows === 0)) return
    lastCommandSequence.current = viewportCommand.sequence
    const scheduler = scrollScheduler.current
    const arbiter = frameArbiter.current
    if (scheduler === undefined || arbiter === undefined) return
    const effectiveContentRows = Math.max(viewport.contentRows, virtualContentRows)
    const maximum = Math.max(0, effectiveContentRows - effectiveViewportRows)
    const clamp = (value: number): number => Math.max(0, Math.min(maximum, value))
    const advance = (delta: number): void => {
      const presented = scheduler.getPresented()
      const target = scheduler.getTarget()
      const reversing = delta * (target - presented) < 0
      scheduler.setTarget(clamp((reversing ? presented : target) + delta))
      scheduler.tick()
    }
    if (pendingScrollInputAt.current !== undefined) frameMetrics?.recordCoalescedInput()
    pendingScrollInputAt.current ??= performance.now()
    switch (viewportCommand.kind) {
      case 'scroll':
        advance(viewportCommand.delta)
        break
      case 'page':
        advance(viewportCommand.delta * Math.max(1, viewport.viewportRows - 1))
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
    setMeasuredGeometry(previous => previous?.columns === columns
      && previous.rows === rows && previous.height === viewportBox.height
      && previous.key === layoutKey
      ? previous
      : { columns, rows, height: viewportBox.height, key: layoutKey })
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
    columns,
    rows,
    layoutKey,
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

  const rail = scrollbar ? physicalScrollRailGeometry(
    viewport.contentRows,
    viewport.viewportRows,
    viewport.offsetFromBottom,
  ) : undefined

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
        ? activeEntryRows.textRanges.get(entry.id) ?? EMPTY_TEXT_RANGES
        : EMPTY_TEXT_RANGES
      for (let index = start; index < end; index += 1) {
        const line = entry.lines.at(index)
        if (line === undefined) continue
        const absoluteRow = 3 + verticalBase + layout.top + index - visibleTop
        if (absoluteRow < 3 || absoluteRow >= 3 + effectiveViewportRows) continue
        const isBottomRow = absoluteRow === 3 + effectiveViewportRows - 1
        const promptOverlay = isBottomRow && !viewport.follow
          ? (() => {
            const promptText = viewport.unseenRows > 0
              ? `↓ 最新消息 · ${String(viewport.unseenRows)} · End/G 到底部`
              : '↓ 底部 · End/G'
            const promptCol = columns - 2 - displayWidth(promptText) + 1
            const startCol = promptCol - (contentLeft + 1)
            return startCol > 0 ? { text: promptText, startCol } : undefined
          })()
          : undefined
        const lead = assistant ? snapshotLead(ranges, index) : ''
        snapshotRows.push(createFrameSnapshotRow({
          id: `${entry.id}:${String(index)}`,
          row: absoluteRow,
          col: contentLeft + 1,
          line: framePhysicalLine(entry.id, line, lead, entry.kind === 'active', promptOverlay),
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
      ...(!generating && latestSettledAssistantId !== undefined
        ? {
          repaintKey: [
            latestSettledAssistantId,
            String(columns),
            String(rows),
            themeTier,
          ].join(':'),
        }
        : {}),
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
    latestSettledAssistantId,
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
  const publishTranscript = physicalViewport && geometryMeasured && !idleHome
  setVisibleFrameSnapshot(publishTranscript ? visibleFrame : undefined)
  if (publishTranscript) setFrameRail(publishedRail)
  else releaseFrameRail()
  setMouseRailRegion(!publishTranscript || publishedRail === undefined
    ? undefined
    : {
      col: publishedRail.col,
      topRow: publishedRail.topRow,
      rows: publishedRail.rows,
    })
  useLayoutEffect(() => {
    if (publishTranscript) writePublishedFrameSnapshot(stdout)
  }, [
    columns,
    rows,
    publishTranscript,
    viewport.offsetFromBottom,
    rail?.rows,
    rail?.thumbRows,
    rail?.thumbStart,
    stdout,
  ])
  // Ink can paint a replacement pane before passive effect cleanup runs.
  useLayoutEffect(() => () => {
    setVisibleFrameSnapshot(undefined)
    releaseFrameRail()
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
        collapsed={!reasoningExpanded}
        durationMs={live ? liveDurationMs ?? part.durationMs : part.durationMs}
        live={live}
        maxCols={contentWidth}
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
        card={part.card}
        expanded={toolCardsExpanded}
        maxCols={contentWidth}
      />
    </Box>
  )

  const renderToolSummary = (
    part: Extract<TurnPart, { kind: 'tool-summary' }>,
    key: number,
    gap: number,
  ): ReactNode => {
    const status = toolSummaryStatus(part.summary)
    const token = status === 'error' ? 'error' : status === 'running' ? 'accentText' : 'fgDim'
    const text = toolSummaryText(part.summary, contentWidth)
    const match = text.match(/^(▸\s*)([^\s·]+)(.*)$/)
    const parts = match !== null
      ? [
        styled(match[1] as string, 'fgDim'),
        styled(match[2] as string, 'fgSoft'),
        styled(escapeContent(match[3] as string), token),
      ]
      : [styled(escapeContent(text), token)]
    return (
      <Box
        key={key}
        marginTop={gap}
        width="100%"
        backgroundColor={inkColor('toolBg')}
      >
        <Text wrap="truncate">
          {paintBackgroundRow(parts, 'toolBg', contentWidth)}
        </Text>
      </Box>
    )
  }

  const renderFrozenTail = (message: FrozenMessage): ReactNode => {
    const showCompletionBoundary = message.id === latestSettledAssistantId
    const cards = cardsFrom(message.content ?? []).map(card =>
      presenterCache.present(presenters, card),
    )
    const produced = producedPathsForTurn(cards)
    const stats = formatTurnTailStats({
      turnOrdinal: message.turnOrdinal,
      turnUsage: message.turnUsage,
      legacyOutputTokens: message.usageOutputTokens,
      elapsedMs: message.stepWallMs,
    })
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
        {producedRows.map((runs, index) => (
          <Text key={`produced-${String(index)}`}>{paintRow(runs)}</Text>
        ))}
        {stats === undefined ? null : (
          <Text>{paintRow([styled(escapeContent(stats), 'fgDim')])}</Text>
        )}
        {showCompletionBoundary ? (
          <Text>{paintRow([styled('── 已完成 ──', 'fgDim')])}</Text>
        ) : null}
      </Box>
    )
  }

  const renderFrozenMessage = (message: FrozenMessage): ReactNode => {
    const parts = displayedParts(
      compactToolParts(partsFromFrozen(message), toolCardsExpanded, presenters, mode, presenterCache), reasoningExpanded,
    )
    const blocks = parts.map((part, index) => {
      const gap = turnPartGap(parts, index)
      if (part.kind === 'reasoning') {
        return (
          <Box key={index} marginTop={gap} width="100%">
            <ReasoningBlock
              text={part.text}
              collapsed={!reasoningExpanded}
              durationMs={part.durationMs}
              maxCols={contentWidth}
            />
          </Box>
        )
      }
      if (part.kind === 'tool-summary') return renderToolSummary(part, index, gap)
      if (part.kind === 'card') return renderCard(part, index, gap)
      return (
        <Box key={index} marginTop={gap} width="100%">
          <SettledMarkdownBlock
            source={part.text}
            maxCols={Math.max(1, contentWidth - ASSISTANT_PROSE_PREFIX_COLUMNS)}
            themeTier={currentTier()}
          />
        </Box>
      )
    })
    const tail = renderFrozenTail(message)
    const rows: ReactNode[] = []
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
    const rawParts = partsFromTurn(turn)
    const visibleParts = displayedParts(rawParts, reasoningExpanded)
    if (generating && visibleParts.length === 0) {
      return (
        <Box flexDirection="column" width="100%" flexShrink={0}>
          <Text>
            {paintRow([
              styled('● ', 'accentText', undefined, true),
              styled(
                `正在处理… (${formatSeconds(
                  liveDurationMs ?? turn.reasoningDurationMs,
                )}s)`,
                'fg',
              ),
            ])}
          </Text>
        </Box>
      )
    }
    const parts = displayedParts(compactToolParts(rawParts, toolCardsExpanded, presenters, mode, presenterCache), reasoningExpanded)
    let lastVisiblePart = -1
    parts.forEach((part, index) => {
      if (isVisiblePart(part)) lastVisiblePart = index
    })
    return (
      <Box flexDirection="column" width="100%" flexShrink={0}>
        {parts.map((part, index) => {
          const gap = turnPartGap(parts, index)
          if (part.kind === 'reasoning') {
            const live = generating && index === lastVisiblePart
            return renderReasoning(part, index, gap, live)
          }
          if (part.kind === 'tool-summary') return renderToolSummary(part, index, gap)
          if (part.kind === 'card') return renderCard(part, index, gap)
          return (
            <Box key={index} marginTop={gap} width="100%">
              <MarkdownBlock
                source={part.text}
                maxCols={Math.max(1, contentWidth - ASSISTANT_PROSE_PREFIX_COLUMNS)}
                prefix={{ first: activeMarker(), rest: restIndent() }}
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
                  const ranges = activeEntryRows.textRanges.get(blockId) ?? EMPTY_TEXT_RANGES
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
                  ? activeEntryRows.textRanges.get(blockId) ?? EMPTY_TEXT_RANGES
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
                        first: kindMarker('● ', 'accentText'),
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
              let rowNode: ReactNode
              if (row.kind === 'compaction') {
                rowNode = renderCompaction(row.divider)
              } else if (row.message.kind === 'user') {
                const hasSubsequent = layoutIndex < renderEntries.length - 1 || activeTurn !== undefined
                rowNode = (
                  <Box flexDirection="column" width="100%">
                    <Box width="100%" backgroundColor={inkColor('messageBg')}>
                      <Text wrap="wrap">{userRun(row.message.text, contentWidth)}</Text>
                    </Box>
                    {hasSubsequent ? (
                      <Text>{styled('─'.repeat(contentWidth), 'line')}</Text>
                    ) : null}
                  </Box>
                )
              } else {
                rowNode = renderFrozenMessage(row.message)
              }
              const isUserWithGap = row.kind === 'message' && row.message.kind === 'user'
                && (layoutIndex < renderEntries.length - 1 || activeTurn !== undefined)
              return (
                <Box
                  key={blockId}
                  ref={(element) => {
                    if (element === null) blockRefs.current.delete(blockId)
                    else blockRefs.current.set(blockId, element)
                  }}
                  flexDirection="column"
                  width="100%"
                  paddingBottom={isUserWithGap ? 1 : entry.gapRows}
                  flexShrink={0}
                >
                  {rowNode}
                </Box>
              )
            })}
            {trailingRows > 0 ? <Box height={trailingRows} flexShrink={0} /> : null}
          </Box>
        )}
      {!viewport.follow ? (
        <Box position="absolute" right={2} bottom={0}>
          <Text>{styled(
            viewport.unseenRows > 0
              ? `↓ 最新消息 · ${String(viewport.unseenRows)} · End/G 到底部`
              : '↓ 底部 · End/G',
            'accentText',
          )}</Text>
        </Box>
      ) : null}
    </Box>
  )

  return (
    transcriptViewport
  )
}
