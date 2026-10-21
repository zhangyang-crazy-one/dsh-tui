/**
 * AgentHubPane: K2 overlay listing subagent children and a nested inspect
 * transcript. Composes {@link OverlayShell}; does not share a tree with
 * PlanReviewPane. Keys stay on {@link mapKeyEvent}.
 * @module @deepseek-ai/dsh-tui-render/agent-hub-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { OverlayShell } from './overlay-shell.tsx'
import type { OverlayPaneState } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'
import { InputBar } from './input-bar.tsx'

/** One Hub table row: escaped at render. */
export interface AgentHubRow {
  /** Durable child session id. */
  id: SessionId
  /** Exact catalog address; older read-only fixtures may omit these fields. */
  parentSessionId?: SessionId | undefined
  mode?: 'continuable' | 'one-shot' | 'external' | undefined
  /** Continuable label, else one-shot label or id. */
  label: string
  /** Host activity key (`running` / `inactive`). */
  activity: string
  /** Whether Enter drills into nested children instead of inspect. */
  hasChildren: boolean
  /** Provider-measured context occupancy, as an integer percentage. */
  contextPercent?: number | undefined
  /** Sum of the four disjoint durable provider-usage buckets. */
  tokens?: number | undefined
  /** Settled plus active child duration in milliseconds. */
  durationMs?: number | undefined
  /** Durable child model when a registered projection provides it. */
  model?: string | undefined
  /** Public task and latest observable work; never private reasoning. */
  task?: string | undefined
  summary?: string | undefined
  execution?: string | undefined
}

/** Hub subview: the child table, or a nested inspect transcript. */
export type AgentHubView = 'table' | 'transcript'

/** Controller snapshot for the Agent Hub overlay. */
export interface AgentHubPaneState extends OverlayPaneState {
  prompt?: string | undefined
  caretIndex?: number | undefined
  busy?: boolean | undefined
  notice?: string | undefined
  split?: boolean | undefined
  /** Direct (or expanded) child rows. */
  rows?: readonly AgentHubRow[]
  /** Highlighted table index. */
  selectedIndex?: number
  /** Table vs nested transcript. */
  view?: AgentHubView
  /** List or inspect failure copy (OverlayShell prefixes `✗ `). */
  error?: string | undefined
  /** Inspected transcript body when `view` is `transcript`. */
  transcript?: string
  /** True when ctx.get('subagents') is undefined (S19). */
  missing?: boolean
  /** Currently running continuable children in this Hub table. */
  liveContinuable?: number
  /** Live settings max for continuable children; default 8. */
  maxActiveSubagents?: number
  /** Live settings max delegation depth; default 1. */
  /** Live settings max delegation depth; default 1. */
  maxDepth?: number
  /** Scroll offset in transcript view. */
  scrollOffset?: number
}

export interface AgentHubViewport {
  offset: number
  maxOffset: number
  pageRows: number
}

/** AgentHubPane props. Presentational; the owner owns listing and inspect. */
export interface AgentHubPaneProps {
  prompt?: string | undefined
  caretIndex?: number | undefined
  busy?: boolean | undefined
  notice?: string | undefined
  split?: boolean | undefined
  renderEditor?: boolean | undefined
  maxCols?: number | undefined
  maxRows?: number | undefined
  /** Child rows; empty paints 暂无子代理. */
  rows?: readonly AgentHubRow[] | undefined
  /** Highlighted row index. */
  selectedIndex?: number | undefined
  /** Table vs transcript subview. */
  view?: AgentHubView | undefined
  /** Failure reason without the `✗ ` prefix. */
  error?: string | undefined
  /** Inspected child transcript. */
  transcript?: string | undefined
  /** Missing-service chrome. */
  missing?: boolean | undefined
  /** Currently running continuable children in this Hub table. */
  liveContinuable?: number | undefined
  /** Live settings max for continuable children; default 8. */
  maxActiveSubagents?: number | undefined
  /** Live settings max delegation depth; default 1. */
  /** Live settings max delegation depth; default 1. */
  maxDepth?: number | undefined
  /** Scroll offset in transcript view. */
  scrollOffset?: number | undefined
  onViewportChange?: (viewport: AgentHubViewport) => void
}

/**
 * One painted Hub table row: accent `› ` on the selection, then
 * `{label} · {activity}`.
 * @param row - untrusted label/activity.
 * @param selected - whether this is the highlighted row.
 * @returns the row element.
 */
function formatTokens(value: number): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Compact whole-second duration for a Hub row or aggregate. */
function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1_000)
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m${String(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${String(hours)}h${String(minutes % 60)}m`
}

/** Optional authoritative display segments for one child row. */
function metricSegments(row: AgentHubRow): string[] {
  return [
    row.contextPercent === undefined ? undefined : `ctx ${String(row.contextPercent)}%`,
    row.tokens === undefined ? undefined : `${formatTokens(row.tokens)} tok`,
    row.durationMs === undefined ? undefined : formatDuration(row.durationMs),
    row.model,
  ].filter((value): value is string => value !== undefined)
}

/** Omission-safe aggregate over the rows whose projection values are known. */
function aggregateLine(rows: readonly AgentHubRow[]): string {
  const tokenRows = rows.filter((row): row is AgentHubRow & { tokens: number } => row.tokens !== undefined)
  const durationRows = rows.filter((row): row is AgentHubRow & { durationMs: number } => row.durationMs !== undefined)
  const known = rows.filter(row => metricSegments(row).length > 0).length
  const segments = [
    `Σ 子代理 ${String(rows.length)}`,
    tokenRows.length === 0
      ? undefined
      : `tokens ${formatTokens(tokenRows.reduce((sum, row) => sum + row.tokens, 0))}`,
    durationRows.length === 0
      ? undefined
      : `耗时 ${formatDuration(durationRows.reduce((sum, row) => sum + row.durationMs, 0))}`,
    `已知 ${String(known)}/${String(rows.length)}`,
  ]
  return segments.filter((value): value is string => value !== undefined).join(' · ')
}

function hubRow(row: AgentHubRow, selected: boolean): ReactNode {
  const label = [row.label, row.execution ?? (row.activity === '' ? undefined : row.activity), ...metricSegments(row)]
    .filter((value): value is string => value !== undefined)
    .join(' · ')
  return (
    <Box key={row.id} width="100%" flexDirection="column">
      <Text wrap="truncate">
        {selected
          ? styled(escapeContent('› '), 'accent', undefined, true)
          : '  '}
        {paintRow([styled(escapeContent(label), selected ? 'fg' : 'fgSoft', undefined, selected)])}
      </Text>
      {row.task !== undefined && <Text wrap="truncate">{paintRow([styled(`  任务 · ${escapeContent(row.task)}`, 'fgSoft')])}</Text>}
      {row.summary !== undefined && row.summary !== '' && <Text wrap="truncate">{paintRow([styled(`  当前 · ${escapeContent(row.summary)}`, 'accent')])}</Text>}
      <Text wrap="truncate">{paintRow([styled(`  ${escapeContent(`子会话 ID · ${row.id}`)}`, 'fgDim')])}</Text>
    </Box>
  )
}

function hubLimitsFootnote(
  liveContinuable: number | undefined,
  maxActiveSubagents: number | undefined,
  maxDepth: number | undefined,
): string | undefined {
  if (maxActiveSubagents === undefined && maxDepth === undefined) {
    return undefined
  }
  const live = liveContinuable ?? 0
  const max = maxActiveSubagents ?? 8
  const depth = maxDepth ?? 1
  const base = `可继续 ${String(live)}/${String(max)} live · 深度 ${String(depth)}`
  return live >= max ? `${base} · 已达上限` : base
}

/**
 * Agent Hub overlay: title `子代理`, child table or inspect transcript,
 * empty/missing/error copy from the UI contract.
 * @param props - rows, selection, view, and failure flags.
 * @returns the element tree.
 */
function AgentHubBody({
  rows = [],
  selectedIndex = 0,
  view = 'table',
  error,
  transcript,
  missing = false,
  liveContinuable,
  maxActiveSubagents,
  maxDepth,
  scrollOffset,
  onViewportChange,
  prompt, caretIndex, busy, notice, split, maxCols, maxRows, renderEditor = true,
}: AgentHubPaneProps): ReactNode {
  const size = useWindowSize()
  const columns = Math.max(1, maxCols ?? size.columns ?? 80)
  const height = Math.max(1, maxRows ?? (size.rows > 0 ? size.rows : 24))
  const limits = hubLimitsFootnote(liveContinuable, maxActiveSubagents, maxDepth)
  const lines = useMemo(() => view === 'transcript'
    ? wrapDisplayLines(escapeContent(transcript ?? ''), Math.max(1, (columns || 80) - 4)).filter(line => line !== '') : [], [view, transcript, columns])
  const pageSize = Math.max(1, height - (prompt === undefined ? 14 : 18))
  const maximum = Math.max(0, lines.length - pageSize)
  const start = Math.max(0, Math.min(scrollOffset ?? 0, maximum))
  useLayoutEffect(() => {
    if (view === 'transcript') onViewportChange?.({ offset: start, maxOffset: maximum, pageRows: pageSize })
  }, [view, start, maximum, pageSize, onViewportChange])
  if (missing) {
    return (
      <OverlayShell
        title="子代理"
        error="子代理服务未组合"
        footnote="Esc 关闭"
      />
    )
  }
  const clamped = Math.min(Math.max(selectedIndex, 0), Math.max(0, rows.length - 1))
  const selected = rows[clamped]
  const addressable = selected?.parentSessionId !== undefined && selected.parentSessionId !== selected.id && selected.mode !== undefined
  const controls = prompt === undefined
    ? [addressable && selected.mode === 'continuable' ? 'c 续聊' : '', addressable ? 's 请求停止' : '', 'v 并排'].filter(Boolean).join(' · ')
    : `Enter 排队 · Ctrl+Enter 引导 · Esc 取消${busy ? ' · 发送中' : ''}`
  const editor = <>
    {notice !== undefined && <Text wrap="truncate">{paintRow([styled(escapeContent(notice), 'fgDim')])}</Text>}
    {renderEditor && prompt !== undefined && <InputBar text={prompt} caretIndex={caretIndex} commandMode={false} mentionMode={false} />}
  </>
  if (view === 'transcript') {
    if (error !== undefined && error !== '' && prompt === undefined) {
      return (
        <OverlayShell
          title="子代理"
          error={error}
          footnote="Esc 返回列表"
        />
      )
    }
    const selectedRow = rows[clamped]
    const headerSegments = selectedRow === undefined ? [] : [
      `[子代理] ${selectedRow.label}`,
      `状态: ${selectedRow.execution ?? selectedRow.activity}`,
      ...metricSegments(selectedRow),
    ].filter((s): s is string => s !== undefined)

    const total = lines.length
    const slice = lines.slice(start, start + pageSize)
    const scrollInfo = total > pageSize ? ` (${String(start + 1)}-${String(Math.min(start + slice.length, total))}/${String(total)})` : ''

    return (
      <OverlayShell
        title="子代理"
        error={error}
        footnote={`↑↓/jk · PgUp/PgDn · Home/End\n${controls}\nEsc 返回 · ${scrollOffset === Number.MAX_SAFE_INTEGER ? '跟随最新' : '阅读中'}${scrollInfo}\n${split ? '并排查看' : '只读查看'}，主会话继续运行`}
      >
        {headerSegments.length > 0 && (
          <Box width="100%" flexDirection="column" marginY={0}>
            <Text wrap="truncate">{paintRow([styled(escapeContent(headerSegments.join(' · ')), 'accent', undefined, true)])}</Text>
            {selectedRow?.id && <Text wrap="truncate">{paintRow([styled(escapeContent(`子会话 ID · ${selectedRow.id}`), 'fgDim')])}</Text>}
            <Text>{paintRow([styled(escapeContent('─── 执行情况 ───'), 'fgDim')])}</Text>
          </Box>
        )}
        {slice.map((lineText, index) => {
          const isUser = lineText.startsWith('> ')
          const isTool = lineText.startsWith('▸ ')
          const isResult = lineText.startsWith('  └─ ') || lineText.startsWith('└─ ')
          const isTurn = lineText.startsWith('── ')
          let token: Parameters<typeof styled>[1] = 'fg'
          if (isUser) token = 'accent'
          else if (isTool) token = 'codeKeyword'
          else if (isResult || isTurn) token = 'fgDim'
          return (
            <Text key={start + index}>
              {paintRow([styled(escapeContent(lineText), token)])}
            </Text>
          )
        })}
        {editor}
      </OverlayShell>
    )
  }
  if (error !== undefined && error !== '' && prompt === undefined) {
    return (
      <OverlayShell
        title="子代理"
        error={error}
        footnote={limits === undefined ? 'Esc 关闭 · 可重试' : `${limits} · Esc 关闭 · 可重试`}
      />
    )
  }
  if (rows.length === 0) {
    return (
      <OverlayShell
        title="子代理"
        body="暂无子代理"
        footnote={limits === undefined ? 'Esc 关闭 · 有运行中的子代理时再打开' : `${limits} · Esc 关闭`}
      />
    )
  }
  let footnote = 'j/k 选择 · Enter 查看 · → 子任务 · Esc 返回/关闭'
  if ((columns || 80) < 70) footnote = '↑↓/jk 选择 · Enter 查看\n→ 子任务 · Esc 返回/关闭'
  else if (limits !== undefined) footnote = `${limits} · ${footnote}`
  footnote += `\n${controls}`
  const footerRows = wrapDisplayLines(footnote, columns || 80).length
  const windowSize = Math.max(1, Math.floor((height - 9 - footerRows) / 4))
  const rowStart = Math.max(0, Math.min(rows.length - windowSize, clamped - Math.floor(windowSize / 2)))
  return (
    <OverlayShell
      title="子代理"
      error={error}
      footnote={footnote}
    >
      {rows.slice(rowStart, rowStart + windowSize).map(row => hubRow(row, row.id === rows[clamped]?.id))}
      <Text wrap="truncate">{paintRow([styled(escapeContent(aggregateLine(rows)), 'fgDim')])}</Text>
      {editor}
    </OverlayShell>
  )
}

/** Bound the Ink layout as well as transcript wrapping when used in a split pane. */
export function AgentHubPane(props: AgentHubPaneProps): ReactNode {
  return <Box width={props.maxCols ?? '100%'} flexDirection="column"><AgentHubBody {...props} /></Box>
}
