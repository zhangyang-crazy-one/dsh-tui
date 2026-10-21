/**
 * ApprovalPane: the composer-slot dialog for one in-flight tool approval.
 * Presentational only — keys route through {@link mapKeyEvent} in the loop
 * owner, and the runtime (not this module) answers `ctx.approval`.
 * @module @deepseek-ai/dsh-tui-render/approval-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import { useMemo, type ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'
import { useDialogTextRows, useDialogWindow } from './dialog-window.ts'

/** Next-step copy after a delivery failure (S5: ✗ with Chinese). */
const DELIVERY_NEXT = '当前工具未执行 · 可重试该轮'

/** ApprovalPane props. */
export interface ApprovalPaneProps {
  /** Tool name from the pending request. */
  toolName: string
  /** Host-supplied reason string (untrusted). */
  reason: string
  /** Raw tool arguments JSON (untrusted). */
  arguments: string
  /** When true, paint the escaped reason and command/arguments lines. */
  detailsOpen: boolean
  /** Delivery-failure reason; when set, paints the ✗ pair instead of details. */
  deliveryError?: string | undefined
  maxRows?: number
  maxCols?: number
  offset?: number
  onOffsetChange?: (offset: number) => void
}

/** Controller snapshot backing the approval composer slot. */
export interface ApprovalPaneState {
  /** Whether the slot currently occupies the composer. */
  open: boolean
  /** FIFO request identity; stable while this approval is being read. */
  requestId?: number
  /** Tool name from the pending request. */
  toolName: string
  /** Host-supplied reason string (untrusted). */
  reason: string
  /** Raw tool arguments JSON (untrusted). */
  arguments: string
  /** Whether the details body is visible. */
  detailsOpen: boolean
  /** Delivery-failure reason, when the answer did not reach the host. */
  deliveryError?: string
}

/** Closed snapshot: TuiLoop keeps the ordinary composer. */
export const EMPTY_APPROVAL_PANE: ApprovalPaneState = {
  open: false,
  toolName: '',
  reason: '',
  arguments: '',
  detailsOpen: false,
}

/** Decode once at the tool-argument boundary; show multiline commands once with every other field. */
function approvalArguments(raw: string): { command: string | undefined; details: string } {
  if (raw.trim() === '') return { command: undefined, details: '' }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'command' in parsed && typeof parsed.command === 'string') {
      const details = Object.entries(parsed).map(([key, value]) => key === 'command'
        ? `command:\n${parsed.command}` : `${JSON.stringify(key)}: ${JSON.stringify(value, null, 2)}`).join('\n\n')
      return { command: parsed.command, details }
    }
    return { command: undefined, details: JSON.stringify(parsed, null, 2) }
  } catch {
    return { command: raw, details: raw }
  }
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
 * The approval strip: inline question, tool/command name, single-key action prompt,
 * and optional expandable details or delivery failure.
 * @param props - pending request fields and detail/delivery flags.
 * @returns the element tree.
 */
export function ApprovalPane({
  toolName, reason, arguments: rawArguments, detailsOpen, deliveryError,
  maxRows, maxCols, offset = 0, onOffsetChange,
}: ApprovalPaneProps): ReactNode {
  const size = useWindowSize()
  const width = Math.max(1, maxCols ?? (size.columns || 80))
  const height = Math.max(4, maxRows ?? (size.rows || 24) - 6)
  const argumentsView = useMemo(() => approvalArguments(rawArguments), [rawArguments])
  const extra = argumentsView.command
  const detailSource = useMemo(() => {
    if (deliveryError !== undefined) return deliveryError
    if (!detailsOpen) return ''
    return [...new Set([reason, argumentsView.details].filter(value => value !== ''))].join('\n\n')
  }, [reason, argumentsView, detailsOpen, deliveryError])
  const rows = useDialogTextRows(detailSource, width)
  const window = useDialogWindow(rows, offset, height - (deliveryError === undefined ? 4 : 2), onOffsetChange)
  const position = window.total > 0 ? ` ${window.start + 1}–${window.start + window.visible.length}/${window.total}` : ''
  if (deliveryError !== undefined) {
    return (
      <Box flexDirection="column" width="100%" flexShrink={0}>
        {line('✗ 审批未能送达', 'error', true)}
        {window.visible.map((text, index) => <Text key={window.start + index} wrap="truncate">{paintRow([styled(text || ' ', 'error')])}</Text>)}
        {line(DELIVERY_NEXT, 'fgDim')}
      </Box>
    )
  }
  const target = extra === undefined ? toolName : `${toolName} "${extra}"`
  const heading = truncateDisplay(escapeContent(`允许执行 ${target} 吗？`).replace(/\n/g, ' ↵ '), width)
  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      <Text wrap="truncate">{paintRow([styled(heading, 'fg', undefined, true)])}</Text>
      {window.visible.map((text, index) => <Text key={window.start + index} wrap="truncate">{paintRow([styled(text || ' ', 'fg')])}</Text>)}
      <Box flexDirection="column" width="100%" flexShrink={0}>
        <Text wrap="truncate">{paintRow([styled('  [Y] ', 'success', undefined, true), styled('允许', 'fg', undefined, true), styled(' (执行一次)', 'fgDim')])}</Text>
        <Text wrap="truncate">{paintRow([styled('  [n] ', 'error', undefined, true), styled('拒绝', 'fg', undefined, true), styled(' (Esc 取消)', 'fgDim')])}</Text>
        <Text wrap="truncate">{paintRow([styled('  [i] ', 'accent', undefined, true), styled(detailsOpen ? `收起 · ↑↓/PgUp/PgDn${position}` : '详情 (查看完整参数)', 'fgDim')])}</Text>
      </Box>
    </Box>
  )
}
