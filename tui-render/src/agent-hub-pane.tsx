/**
 * AgentHubPane: K2 overlay listing subagent children and a nested inspect
 * transcript. Composes {@link OverlayShell}; does not share a tree with
 * PlanReviewPane. Keys stay on {@link mapKeyEvent}.
 * @module @deepseek-ai/dsh-tui-render/agent-hub-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { escapeContent } from './content.ts'
import { OverlayShell } from './overlay-shell.tsx'
import type { OverlayPaneState } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'

/** One Hub table row: escaped at render. */
export interface AgentHubRow {
  /** Durable child session id. */
  id: SessionId
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
}

/** Hub subview: the child table, or a nested inspect transcript. */
export type AgentHubView = 'table' | 'transcript'

/** Controller snapshot for the Agent Hub overlay. */
export interface AgentHubPaneState extends OverlayPaneState {
  /** Direct (or expanded) child rows. */
  rows?: readonly AgentHubRow[]
  /** Highlighted table index. */
  selectedIndex?: number
  /** Table vs nested transcript. */
  view?: AgentHubView
  /** List or inspect failure copy (OverlayShell prefixes `✗ `). */
  error?: string
  /** Inspected transcript body when `view` is `transcript`. */
  transcript?: string
  /** True when ctx.get('subagents') is undefined (S19). */
  missing?: boolean
}

/** AgentHubPane props. Presentational; the owner owns listing and inspect. */
export interface AgentHubPaneProps {
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
  const label = [row.label, row.activity === '' ? undefined : row.activity, ...metricSegments(row)]
    .filter((value): value is string => value !== undefined)
    .join(' · ')
  return (
    <Box key={row.id} width="100%" flexDirection="column">
      <Box width="100%">
        <Text>
          {selected
            ? styled(escapeContent('› '), 'accent', undefined, true)
            : '  '}
        </Text>
        <Text>
          {paintRow([styled(escapeContent(label), selected ? 'fg' : 'fgDim')])}
        </Text>
      </Box>
      <Text>{paintRow([styled(escapeContent(`子会话 ID · ${row.id}`), 'fgDim')])}</Text>
    </Box>
  )
}

/**
 * Agent Hub overlay: title `子代理`, child table or inspect transcript,
 * empty/missing/error copy from the UI contract.
 * @param props - rows, selection, view, and failure flags.
 * @returns the element tree.
 */
export function AgentHubPane({
  rows = [],
  selectedIndex = 0,
  view = 'table',
  error,
  transcript,
  missing = false,
}: AgentHubPaneProps): ReactNode {
  if (missing) {
    return (
      <OverlayShell
        title="子代理"
        error="子代理服务未组合"
        footnote="Esc 关闭"
      />
    )
  }
  if (view === 'transcript') {
    if (error !== undefined && error !== '') {
      return (
        <OverlayShell
          title="子代理"
          error={error}
          footnote="Esc 返回列表"
        />
      )
    }
    const lines = (transcript ?? '').split('\n').filter(line => line !== '')
    return (
      <OverlayShell title="子代理" footnote="Esc 返回">
        {lines.map((line, index) => (
          <Text key={index}>
            {paintRow([styled(escapeContent(line), 'fg')])}
          </Text>
        ))}
      </OverlayShell>
    )
  }
  if (error !== undefined && error !== '') {
    return (
      <OverlayShell
        title="子代理"
        error={error}
        footnote="Esc 关闭 · 可重试"
      />
    )
  }
  if (rows.length === 0) {
    return (
      <OverlayShell
        title="子代理"
        body="暂无子代理"
        footnote="Esc 关闭 · 有运行中的子代理时再打开"
      />
    )
  }
  const clamped = Math.min(Math.max(selectedIndex, 0), rows.length - 1)
  return (
    <OverlayShell
      title="子代理"
      footnote="j/k 选择 · Enter 查看 · Esc 关闭"
    >
      {rows.map((row, index) => hubRow(row, index === clamped))}
      <Text>{paintRow([styled(escapeContent(aggregateLine(rows)), 'fgDim')])}</Text>
    </OverlayShell>
  )
}
