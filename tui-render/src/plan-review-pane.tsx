/**
 * PlanReviewPane: Dialog occupying the composer slot for an exit_plan_mode
 * ask-user batch. Not OverlayShell. Keys stay on {@link mapKeyEvent}; the
 * runtime answers with host option labels, never chrome 批准 / 继续规划.
 * @module @deepseek-ai/dsh-tui-render/plan-review-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { MarkdownBlock } from './markdown.tsx'
import { paintRow, styled } from './theme.ts'

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
    <Text>
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
  plan = '',
  offset = 0,
  deliveryError,
}: PlanReviewPaneProps): ReactNode {
  const empty = plan.trim() === ''
  const lines = plan.split('\n')
  const safeOffset = Math.max(0, offset)
  const windowed = lines.slice(safeOffset, safeOffset + PLAN_REVIEW_WINDOW).join('\n')
  return (
    <Box flexDirection="column" width="100%">
      {line(TITLE, 'fg', true)}
      {deliveryError !== undefined && deliveryError !== '' ? (
        <Box flexDirection="column" width="100%">
          {line(`✗ 计划评审未能送达：${deliveryError}`, 'error')}
          {line(DELIVERY_NEXT, 'fgDim')}
        </Box>
      ) : empty ? (
        line(EMPTY_BODY, 'fg')
      ) : (
        <MarkdownBlock source={windowed} />
      )}
      {line('批准', 'fg')}
      {line('继续规划', 'fg')}
      {line(FOOTNOTE, 'fgDim')}
    </Box>
  )
}
