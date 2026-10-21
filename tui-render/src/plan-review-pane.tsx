/**
 * PlanReviewPane: Dialog occupying the composer slot for an exit_plan_mode
 * ask-user batch. Not OverlayShell. Keys stay on {@link mapKeyEvent}; the
 * runtime answers with host option labels, never chrome 批准 / 继续规划.
 * @module @deepseek-ai/dsh-tui-render/plan-review-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import { useMemo, type ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { useDialogTextRows, useDialogWindow } from './dialog-window.ts'
import { parseMarkdownSource } from './markdown-parse.ts'
import { createStyledMarkdownBlockRenderer } from './markdown-render.ts'
import { paintLineFromRenderLine } from './painted-line.ts'
import { hyperlinksEnabled } from './hyperlink.ts'
import type { MarkdownRenderLine, MarkdownRenderScope } from './markdown-projector.ts'

/** Exact dialog heading (bold fg, never accent). */
const TITLE = '计划评审'
/** Exact key footnote; chrome 批准 / 继续规划 live here, not as submit labels. */
const FOOTNOTE = 'y 批准 · n 继续规划 · Esc 取消'
/** Empty-plan heading; footnote stays the same. */
const EMPTY_BODY = '计划正文为空'
/** Next-step copy after a delivery failure. */
const DELIVERY_NEXT = '当前计划未批准 · 可重试该轮'
/** Visible markdown window for j/k scrolling. */
export const PLAN_REVIEW_WINDOW = 12

/** Controller snapshot backing the plan-review composer slot. */
export interface PlanReviewPaneState {
  /** Whether the slot currently occupies the composer. */
  open: boolean
  requestId?: number
  /** Plan markdown under review (untrusted). */
  plan?: string
  /** Delivery-failure reason without the `✗ ` prefix. */
  deliveryError?: string
}

/** PlanReviewPane props. Presentational; the owner submits host labels. */
export interface PlanReviewPaneProps {
  /** Plan markdown under review (untrusted). */
  plan?: string | undefined
  /** Line offset for j/k scrolling. */
  offset?: number | undefined
  /** Delivery-failure reason without the `✗ ` prefix. */
  deliveryError?: string | undefined
  maxRows?: number
  maxCols?: number
  onOffsetChange?: (offset: number) => void
}

/** Closed snapshot: TuiLoop keeps the ordinary composer. */
export const EMPTY_PLAN_REVIEW_PANE: PlanReviewPaneState = {
  open: false,
}

/**
 * One painted, escaped row in the composer slot.
 * @param text - untrusted or static copy.
 * @param token - theme token.
 * @param bold - heading uses the fg bold tier.
 * @returns the Text element.
 */
function line(
  text: string,
  token: 'fg' | 'fgDim' | 'error',
  bold = false,
): ReactNode {
  return (
    <Text wrap="truncate">
      {paintRow([styled(escapeContent(text), token, undefined, bold)])}
    </Text>
  )
}

/**
 * The plan-review dialog: heading, markdown or empty copy, delivery error,
 * and the y/n/Esc footnote. Does not wrap OverlayShell.
 * @param props - plan markdown, scroll offset, and delivery error.
 * @returns the element tree.
 */
export function PlanReviewPane({
  plan = '', offset = 0, deliveryError, maxRows, maxCols, onOffsetChange,
}: PlanReviewPaneProps): ReactNode {
  const size = useWindowSize()
  const width = Math.max(1, maxCols ?? (size.columns || 80))
  const height = Math.max(4, maxRows ?? (size.rows || 24) - 6)
  const limit = Math.max(0, Math.min(PLAN_REVIEW_WINDOW, height - 4))
  const links = hyperlinksEnabled()
  const physicalRows = useMemo(() => {
    const scope: MarkdownRenderScope = { width, theme: 'truecolor', fold: 'expanded', renderMode: 'settled' }
    const renderer = createStyledMarkdownBlockRenderer({ width, hyperlinks: links })
    const rows: MarkdownRenderLine[] = []
    for (const [index, block] of parseMarkdownSource(plan, true).children.entries()) {
      const lines = renderer.renderBlock(block, scope, index)
      if (rows.length > 0 && lines.length > 0) rows.push(renderer.renderRawTail('', 0, scope))
      rows.push(...lines)
    }
    return rows
  }, [plan, width, links])
  const failed = deliveryError !== undefined && deliveryError !== ''
  const errorRows = useDialogTextRows(failed ? `✗ 计划评审未能送达：${deliveryError}\n${DELIVERY_NEXT}` : '', width)
  const planView = useDialogWindow(physicalRows, offset, limit, failed ? undefined : onOffsetChange)
  const errorView = useDialogWindow(errorRows, offset, limit, failed ? onOffsetChange : undefined)
  const view = failed ? errorView : planView
  const position = view.total > 0 ? ` ${view.start + 1}–${view.start + view.visible.length}/${view.total}` : ''
  let body: ReactNode
  if (failed) body = errorView.visible.map((text, index) => <Text key={errorView.start + index} wrap="truncate">{paintRow([styled(text || ' ', 'error')])}</Text>)
  else if (plan.trim() === '') body = line(EMPTY_BODY, 'fg')
  else body = planView.visible.map((row, index) => <Text key={planView.start + index} wrap="truncate">{row.spans.length === 0 ? ' ' : paintLineFromRenderLine(row, links)}</Text>)
  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      <Text wrap="truncate">{paintRow([styled(TITLE, 'fg', undefined, true), styled(position, 'fgDim')])}</Text>
      {body}
      <Text wrap="truncate">{paintRow([styled('  [y] ', 'success', undefined, true), styled('批准', 'fg', undefined, true), styled(' (开始执行计划)', 'fgDim')])}</Text>
      <Text wrap="truncate">{paintRow([styled('  [n] ', 'warning', undefined, true), styled('继续规划', 'fg', undefined, true), styled(' (返回调整方案)', 'fgDim')])}</Text>
      {line(width < 70 ? '↑↓/PgUp/PgDn · Home/End · Esc 取消' : `${FOOTNOTE} · ↑↓/PgUp/PgDn 浏览`, 'fgDim')}
    </Box>
  )
}
