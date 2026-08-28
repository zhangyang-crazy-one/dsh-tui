/**
 * Renders the current dynamic conversation window and active turn. History rows
 * use stable event ids; a nonzero scroll offset replaces the visible rows,
 * preserves the caller-managed anchor, and shows the projection's unread marker.
 *
 * One turn paints as a timeline in retained event order: consecutive text and
 * reasoning merge into parts, and each tool call becomes one card that already
 * carries its matching result (no flattened reasoning-then-body-then-tools
 * dump). Settled and streaming text share {@link MarkdownBlock} so a finishing
 * turn never reflows; the `● ` marker is the first row's painted prefix (a
 * sibling span would leave unstyled gap cells), and only the last reasoning
 * run stays live while generating.
 *
 * The conversation column stays full width only on narrow terminals; at 80
 * columns and above it follows the 72%/88-column cap while remaining
 * left-aligned inside the AppShell content slot. An empty idle window paints
 * the DeepSeek home in the vertical center of that slot; a transcript packs
 * rows to the bottom so the latest message sits above the status and composer
 * rows.
 * @module @deepseek-ai/dsh-tui-render/stream-view
 */

import { Box, Text, useWindowSize } from 'ink'
import { memo } from 'react'
import type { ReactNode } from 'react'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { HISTORY_WINDOW_SIZE } from './projection.ts'
import type {
  ActiveTurn,
  CompactionDivider,
  FrozenMessage,
  ProjectedTurnContent,
  ViewModel,
} from './projection.ts'
import { displayWidth, escapeContent } from './content.ts'
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

/** Conversation projection inputs. */
export interface StreamViewProps {
  /** Folded view model containing stable history rows, the active turn, viewport offset, unread count, and reasoning-display state. */
  model: ViewModel
  /** Optional tools-registry lookup for presenter titles; omitted stays generic. */
  presenters?: ToolPresenterLookup | undefined
  /** Strongest generated FishLogo glyph tier supported by the terminal. */
  brandTier?: BrandRenderTier | undefined
  /** Whether the current loop state permits the one-shot brand reveal. */
  brandAnimation?: boolean | undefined
  /** Optional dedicated render-cost probe for the generated home subtree. */
  brandFrameProbe?: FrameProbeHandle | undefined
  /**
   * Extra bottom margin rows that shift a tall transcript up inside the
   * overflow-hidden, flex-end column. Omitted means 0 (pinned to the live edge).
   */
  viewShift?: number
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
  if (contentRows <= HISTORY_WINDOW_SIZE) return undefined
  const rows = Math.max(3, viewportRows)
  const thumbRows = Math.min(
    rows,
    Math.max(3, Math.floor(rows * HISTORY_WINDOW_SIZE / contentRows)),
  )
  const travel = rows - thumbRows
  const maxOffset = contentRows - HISTORY_WINDOW_SIZE
  const fromBottom = maxOffset === 0
    ? 0
    : Math.round(Math.min(maxOffset, Math.max(0, scrollOffset)) / maxOffset * travel)
  return { rows, thumbStart: travel - fromBottom, thumbRows }
}

/**
 * The conversation column width: full width below 80 columns; otherwise a
 * left-aligned 72% column capped at 88 columns.
 * @param columns - the current terminal width in columns.
 * @returns the column width, at least one column.
 */
export function conversationWidth(columns: number): number {
  if (columns < 80) return Math.max(1, columns)
  return Math.max(1, Math.min(Math.floor(columns * 0.72), 88))
}

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
 * user rows by the `>` marker in the same left-aligned conversation column
 * as assistant rows, not by right alignment or a background plate.
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
 * Render at most {@link HISTORY_WINDOW_SIZE} historical rows ending at the
 * supplied bottom-relative offset, followed by any unread marker and active
 * turn. Rows use stable projection ids, historical reasoning is collapsed by
 * default, tool cards are collapsed, and the viewport is dynamic rather than
 * append-only.
 *
 * The caller owns key routing and projection updates. Terminal scroll and
 * reasoning-toggle keys bypass this presentation component.
 * Overflow clips from the top of the slot (oldest of the current window)
 * because the stack is bottom-packed against the composer.
 * @param props - projected conversation state and interaction callbacks.
 * @returns the full-width Ink element tree for the current window.
 */
export function StreamView({
  model,
  presenters,
  brandTier = 'plain',
  brandAnimation = false,
  brandFrameProbe,
  viewShift = 0,
}: StreamViewProps): ReactNode {
  const { columns, rows } = useWindowSize()
  const contentWidth = conversationWidth(columns)
  const {
    history,
    compactionDividers = [],
    expandedCompactionId,
    activeTurn,
    status,
    scrollOffset,
    follow,
    unseenCount,
    reasoningExpanded,
    toolCardsExpanded,
  } = model
  const transcript: TranscriptRow[] = [
    ...history.map(message => ({ kind: 'message' as const, id: message.id, message })),
    ...compactionDividers.map(divider => ({
      kind: 'compaction' as const,
      id: divider.id,
      divider,
    })),
  ].sort((left, right) => left.id - right.id)
  const end = Math.min(
    transcript.length,
    Math.max(0, transcript.length - scrollOffset),
  )
  const start = Math.max(0, end - HISTORY_WINDOW_SIZE)
  const windowed = transcript.slice(start, end)
  const rail = scrollRailGeometry(transcript.length, Math.max(3, rows - 6), scrollOffset)
  const idleHome = windowed.length === 0 && activeTurn === undefined
  const generating = status === 'generating'
  const latestSettledAssistantId = activeTurn === undefined
    ? [...history].reverse().find(message => message.kind === 'assistant')?.id
    : undefined

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
    const tailWidth = Math.min(columns, 88)
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

  const transcriptColumn = (
    <Box
      flexDirection="column"
      width="100%"
      flexGrow={1}
      overflow="hidden"
      justifyContent={idleHome ? 'center' : 'flex-end'}
    >
      {idleHome
        ? (
          <PixelFishHome
            tier={brandTier}
            animate={brandAnimation}
            visible
            maxColumns={contentWidth}
            maxRows={Math.max(0, rows - 4)}
            frameProbe={brandFrameProbe}
          />
        )
        : (
          <Box
            flexDirection="column"
            width="100%"
            flexShrink={0}
            marginBottom={viewShift}
          >
            {windowed.map(row => (
              <Box
                key={`${row.kind}-${String(row.id)}`}
                flexDirection="column"
                width="100%"
                marginBottom={2}
                flexShrink={0}
              >
                {row.kind === 'compaction'
                  ? renderCompaction(row.divider)
                  : row.message.kind === 'user'
                    ? <Text wrap="wrap">{userRun(row.message.text)}</Text>
                    : renderFrozenMessage(row.message)}
              </Box>
            ))}
            {!follow && unseenCount > 0 ? (
              <Box width="100%">
                <Text>{styled(`↓ 最新消息 · ${String(unseenCount)}`, 'accent')}</Text>
              </Box>
            ) : null}
            {activeTurn !== undefined ? renderActiveTurn(activeTurn) : null}
          </Box>
        )}
    </Box>
  )

  if (rail === undefined) return transcriptColumn
  return (
    <Box flexDirection="row" width="100%" flexGrow={1} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {transcriptColumn}
      </Box>
      <Box flexDirection="column" width={1} flexShrink={0}>
        {Array.from({ length: rail.rows }, (_unused, index) => {
          const thumb = index >= rail.thumbStart
            && index < rail.thumbStart + rail.thumbRows
          return <Text key={index}>{styled(thumb ? '█' : '·', thumb ? 'accent' : 'fgDim')}</Text>
        })}
      </Box>
    </Box>
  )
}
