/**
 * OverlayShell: shared K2 overlay chrome — bold fg title, optional body,
 * optional children, optional `✗` error, and an fgDim footnote. Presentational
 * only; keys stay on {@link mapKeyEvent}. Titles use fg, never accent.
 * @module @deepseek-ai/dsh-tui-render/overlay-shell
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Product overlay titles (bold fg). Plan-review is a Dialog, not this shell. */
export type OverlayShellTitle = '子代理' | '计划' | '工作区' | '反馈' | '工作流'

/** Controller snapshot for one K2 overlay (or the plan-review dialog flag). */
export interface OverlayPaneState {
  /** Whether this overlay currently replaces the conversation column. */
  open: boolean
}

/** Closed overlay snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_OVERLAY_PANE: OverlayPaneState = { open: false }

/** OverlayShell props. Untrusted title/body/error/footnote are escaped. */
export interface OverlayShellProps {
  /** Overlay heading; product copy is one of {@link OverlayShellTitle}. */
  title: string
  /** Empty-state or body copy; omitted when the overlay has no body row. */
  body?: string | undefined
  /** Key footnote (fgDim). */
  footnote: string
  /** Failure reason; when set, paints `✗ {error}` in the error token. */
  error?: string | undefined
  /** Recovery copy painted fgDim directly under the error line (FAIL_NEXT analog). */
  errorNext?: string | undefined
  /** Optional table or transcript rows painted between body/error and the footnote. */
  children?: ReactNode
}

/**
 * One painted, escaped row.
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
 * Shared overlay chrome: bold-fg title, optional body, optional children,
 * optional `✗` error, fgDim footnote. Does not wrap PlanReviewPane (Dialog occupancy).
 * @param props - title, optional body/error, and footnote.
 * @returns the element tree.
 */
export function OverlayShell({
  title,
  body,
  footnote,
  error,
  errorNext,
  children,
}: OverlayShellProps): ReactNode {
  return (
    <Box flexDirection="column" width="100%">
      {line(title, 'fg', true)}
      {body !== undefined && body !== '' ? line(body, 'fg') : null}
      {children}
      {error !== undefined && error !== '' ? line(`✗ ${error}`, 'error') : null}
      {error !== undefined && error !== '' && errorNext !== undefined && errorNext !== ''
        ? line(errorNext, 'fgDim')
        : null}
      {line(footnote, 'fgDim')}
    </Box>
  )
}
