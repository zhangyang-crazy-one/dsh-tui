/**
 * ApprovalPane: the composer-slot dialog for one in-flight tool approval.
 * Presentational only — keys route through {@link mapKeyEvent} in the loop
 * owner, and the runtime (not this module) answers `ctx.approval`.
 * @module @deepseek-ai/dsh-tui-render/approval-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Exact composer-slot heading (bold fg, never accent). */
const TITLE = '等待审批'
/** Exact key footnote; also carries the CTA words 允许一次 / 拒绝 / 详情. */
const FOOTNOTE = 'y 允许一次 · n 拒绝 · i 详情'
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
}

/** Controller snapshot backing the approval composer slot. */
export interface ApprovalPaneState {
  /** Whether the slot currently occupies the composer. */
  open: boolean
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

/**
 * Extra details line after the escaped reason: the bash `command` string when
 * `arguments` parses as JSON with that field, otherwise the raw payload when
 * parse fails. Valid JSON without a string `command` adds no line.
 * @param raw - untrusted tool arguments.
 * @returns the unescaped extra line, or undefined when the reason stands alone.
 */
function extraArgumentLine(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'command' in parsed
      && typeof parsed.command === 'string'
    ) {
      return parsed.command
    }
    return undefined
  } catch {
    // Invalid JSON: show the escaped raw payload instead of a command line.
    return raw
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
    <Text>
      {paintRow([styled(escapeContent(text), token, undefined, bold)])}
    </Text>
  )
}

/**
 * The approval dialog: heading, tool name, optional details or delivery
 * failure, and the y/n/i footnote. Does not call `ctx.approval`.
 * @param props - pending request fields and detail/delivery flags.
 * @returns the element tree.
 */
export function ApprovalPane({
  toolName,
  reason,
  arguments: rawArguments,
  detailsOpen,
  deliveryError,
}: ApprovalPaneProps): ReactNode {
  const extra =
    detailsOpen && deliveryError === undefined
      ? extraArgumentLine(rawArguments)
      : undefined
  return (
    <Box flexDirection="column" width="100%">
      {line(TITLE, 'fg', true)}
      {line(toolName, 'fg')}
      {deliveryError !== undefined ? (
        <Box flexDirection="column" width="100%">
          {line(`✗ 审批未能送达：${deliveryError}`, 'error')}
          {line(DELIVERY_NEXT, 'fgDim')}
        </Box>
      ) : detailsOpen ? (
        <Box flexDirection="column" width="100%">
          {line(reason, 'fg')}
          {extra !== undefined ? line(extra, 'fg') : null}
        </Box>
      ) : null}
      {line(FOOTNOTE, 'fgDim')}
    </Box>
  )
}
