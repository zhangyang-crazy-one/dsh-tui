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
import { memo, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  ActiveTurn,
  CompactionDivider,
  FrozenMessage,
  ProjectedTurnContent,
  ViewModel,
} from './projection.ts'
import { displayWidth, escapeContent, wrapDisplayLines } from './content.ts'
import { hyperlinksEnabled, isOsc8Href, wrapOsc8 } from './hyperlink.ts'
import { producedPathsForTurn } from './turn-tail.ts'
import { pathToFileURL } from 'node:url'
import { isAbsolute } from 'node:path'
import { currentTier, paintRow, styled } from './theme.ts'
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

function estimatedWrappedRows(text: string, maxCols: number, prefixCols = 0): number {
  return Math.max(1, wrapDisplayLines(
    escapeContent(text),
    Math.max(1, maxCols - prefixCols),
  ).length)
}

function estimatedMessageRows(
  message: FrozenMessage,
  maxCols: number,
  reasoningExpanded: boolean,
  toolCardsExpanded: boolean,
): number {
  if (message.kind === 'user') return estimatedWrappedRows(message.text, maxCols, 2)
  let rows = estimatedWrappedRows(message.text, maxCols, 2)
  const reasoning = message.content?.filter(item => item.kind === 'reasoning') ?? []
  rows += reasoning.reduce((total, item) => total + (
    reasoningExpanded ? 1 + estimatedWrappedRows(item.text, maxCols, 2) : 1
  ), 0)
  const tools = message.content?.filter(item => item.kind === 'tool-call').length ?? 0
  rows += tools * (toolCardsExpanded ? 4 : 2)
  if (
    message.usageOutputTokens !== undefined
    || message.stepWallMs !== undefined
    || message.turnOrdinal !== undefined
  ) rows += 1
  return Math.max(1, rows)
}

function estimatedActiveRows(
  turn: ActiveTurn,
  maxCols: number,
  reasoningExpanded: boolean,
  toolCardsExpanded: boolean,
): number {
  const textRows = estimatedWrappedRows(turn.assistantText, maxCols, 3)
  const reasoningRows = turn.reasoningText === ''
    ? 0
    : reasoningExpanded
      ? 1 + estimatedWrappedRows(turn.reasoningText, maxCols, 2)
      : Math.min(5, 1 + estimatedWrappedRows(turn.reasoningText, maxCols, 2))
  const toolRows = (turn.content?.filter(item => item.kind === 'tool-call').length
    ?? turn.toolCalls.length) * (toolCardsExpanded ? 4 : 2)
  return Math.max(1, textRows + reasoningRows + toolRows)
}

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
}: StreamViewProps): ReactNode {
  const { columns, rows } = useWindowSize()
  const { stdout } = useStdout()
  const physicalViewport = stdout.isTTY
  const contentWidth = conversationWidth(columns)
  const contentLeft = conversationLeft(columns, contentWidth)
  const viewportRef = useRef<DOMElement | null>(null)
  const blockRefs = useRef(new Map<string, DOMElement>())
  const layoutCache = useRef(new TranscriptLayoutCache())
  const lastCommandSequence = useRef(-1)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [viewport, dispatchViewport] = useReducer(
    reduceTranscriptViewport,
    EMPTY_TRANSCRIPT_VIEWPORT,
  )
  const {
    history,
    compactionDividers = [],
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
  const renderEntries = useMemo(() => [
    ...transcript.map((row, index) => {
      const gapRows = index < transcript.length - 1 || activeTurn !== undefined ? 2 : 0
      return {
        kind: 'row' as const,
        id: transcriptBlockId(row),
        version: `${transcriptBlockVersion(row)}\u0000${gapRows === 0 ? 'tail' : 'gap'}`,
        gapRows,
        estimatedRows: estimatedMessageRows(
          row.kind === 'message'
            ? row.message
            : {
              id: row.id,
              kind: 'assistant' as const,
              text: row.divider.summary,
              timestamp: 0,
            },
          contentWidth,
          reasoningExpanded,
          toolCardsExpanded,
        ) + gapRows,
        row,
      }
    }),
    ...(activeTurn === undefined
      ? []
      : [{
        kind: 'active' as const,
        id: `assistant-turn-${String(activeTurn.turn)}`,
        version: activeVersion,
        gapRows: 0,
        estimatedRows: estimatedActiveRows(
          activeTurn,
          contentWidth,
          reasoningExpanded,
          toolCardsExpanded,
        ),
        turn: activeTurn,
      }]),
  ], [
    activeTurn,
    activeVersion,
    contentWidth,
    reasoningExpanded,
    toolCardsExpanded,
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
  const overscanTop = Math.max(0, visibleTop - effectiveViewportRows)
  const overscanBottom = Math.min(
    virtualContentRows,
    visibleBottom + effectiveViewportRows,
  )
  const visibleIndexes = physicalViewport
    ? virtualLayouts.flatMap((layout, index) => (
      layout.top + layout.rows > overscanTop && layout.top < overscanBottom ? [index] : []
    ))
    : renderEntries.map((_entry, index) => index)
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
  const visibleEntries = visibleIndexes.flatMap((index) => {
    const entry = renderEntries[index]
    return entry === undefined ? [] : [entry]
  })
  const idleHome = transcript.length === 0 && activeTurn === undefined
  const generating = status === 'generating'
  const latestSettledAssistantId = activeTurn === undefined
    ? history.findLast(message => message.kind === 'assistant')?.id
    : undefined

  useLayoutEffect(() => {
    if (viewportCommand === undefined) return
    if (viewportCommand.sequence === lastCommandSequence.current) return
    lastCommandSequence.current = viewportCommand.sequence
    switch (viewportCommand.kind) {
      case 'scroll':
        dispatchViewport({ kind: 'scroll', delta: viewportCommand.delta })
        return
      case 'page':
        dispatchViewport({
          kind: 'scroll',
          delta: viewportCommand.delta * Math.max(1, viewport.viewportRows - 1),
        })
        return
      case 'position':
        dispatchViewport({ kind: 'position', fraction: viewportCommand.fraction })
        return
      case 'edge':
        dispatchViewport({ kind: 'edge', edge: viewportCommand.edge })
        return
      case 'reset':
        dispatchViewport({ kind: 'reset' })
    }
  }, [viewport.viewportRows, viewportCommand])

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current
    if (viewportElement === null) return
    const viewportBox = measureElement(viewportElement)
    let changed = false
    for (const entry of visibleEntries) {
      const element = blockRefs.current.get(entry.id)
      if (element === undefined) continue
      const measured = measureElement(element)
      changed = layoutCache.current.record(
        layoutScope,
        entry.id,
        entry.version,
        measured.height,
      ) || changed
    }
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
    if (changed) setLayoutRevision(revision => revision + 1)
  })

  const rail = physicalScrollRailGeometry(
    viewport.contentRows,
    viewport.viewportRows,
    viewport.offsetFromBottom,
  )

  useLayoutEffect(() => {
    if (!physicalViewport || rail === undefined) {
      setMouseRailRegion(undefined)
      return
    }
    setMouseRailRegion({ col: columns, topRow: 3, rows: rail.rows })
    return () => { setMouseRailRegion(undefined) }
  }, [columns, physicalViewport, rail?.rows])

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
            {visibleEntries.map((entry) => {
              const blockId = entry.id
              if (entry.kind === 'active') {
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
      {rail === undefined ? null : (
        <Box position="absolute" right={0} top={0} flexDirection="column" width={1}>
          {Array.from({ length: rail.rows }, (_unused, index) => {
            const thumb = index >= rail.thumbStart
              && index < rail.thumbStart + rail.thumbRows
            return (
              <Text key={index}>
                {styled(thumb ? '█' : '·', thumb ? 'accent' : 'fgDim')}
              </Text>
            )
          })}
        </Box>
      )}
    </Box>
  )

  return (
    transcriptViewport
  )
}
