/**
 * PlanDirectoryPane: K2 overlay with fixed 开启/关闭 rows. Composes
 * {@link OverlayShell}. Keys stay on {@link mapKeyEvent}; the runtime
 * calls `ctx.commands.execute`.
 * @module @deepseek-ai/dsh-tui-render/plan-directory-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { OverlayShell } from './overlay-shell.tsx'
import type { OverlayPaneState } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'

/** Exact overlay heading (bold fg, never accent). */
const TITLE = '计划'
/** Exact key footnote for the two-row list. */
const FOOTNOTE = 'j/k 选择 · Enter 切换 · Esc 关闭'
/** Next-step copy after a switch failure (S5: ✗ with Chinese). */
const SWITCH_NEXT = '当前模式保持不变 · 可重试'
/** Next-step copy when plan status cannot be read. */
const STATUS_FOOTNOTE = 'Esc 关闭 · 可重试'
/** Fixed rows: index 0 enables plan mode, index 1 leaves it. */
const ROWS = ['开启', '关闭'] as const

/** Controller snapshot for the plan-directory overlay. */
export interface PlanDirectoryPaneState extends OverlayPaneState {
  /** Highlighted row: 0 = 开启, 1 = 关闭. */
  selectedIndex?: number
  /** True when the host mode is active (开启 · 当前). */
  currentActive?: boolean
  /** Switch-failure reason without the `✗ ` prefix. */
  switchError?: string
  /** Unreadable-status reason without the `✗ ` prefix. */
  statusError?: string
}

/** PlanDirectoryPane props. Presentational; the owner owns execute. */
export interface PlanDirectoryPaneProps {
  /** Highlighted row: 0 = 开启, 1 = 关闭. */
  selectedIndex?: number | undefined
  /** True when the host mode is active. */
  currentActive?: boolean | undefined
  /** Switch-failure reason without the `✗ ` prefix. */
  switchError?: string | undefined
  /** Unreadable-status reason without the `✗ ` prefix. */
  statusError?: string | undefined
}

/** Closed snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_PLAN_DIRECTORY_PANE: PlanDirectoryPaneState = {
  open: false,
  selectedIndex: 0,
  currentActive: false,
}

/**
 * One painted directory row: accent `› ` on the selection, then
 * `{开启|关闭}` or `{开启|关闭} · 当前`.
 * @param label - 开启 or 关闭.
 * @param selected - whether this is the highlighted row.
 * @param current - whether this row is the host mode.
 * @returns the row element.
 */
function directoryRow(
  label: string,
  selected: boolean,
  current: boolean,
): ReactNode {
  const text = current ? `${label} · 当前` : label
  return (
    <Box key={label} width="100%">
      <Text>
        {selected
          ? styled(escapeContent('› '), 'accent', undefined, true)
          : '  '}
      </Text>
      <Text>
        {paintRow([styled(escapeContent(text), selected ? 'fg' : 'fgDim')])}
      </Text>
    </Box>
  )
}

/**
 * One painted, escaped row.
 * @param text - untrusted or static copy.
 * @param token - theme token.
 * @returns the Text element.
 */
function line(text: string, token: 'fgDim' | 'error'): ReactNode {
  return (
    <Text>
      {paintRow([styled(escapeContent(text), token)])}
    </Text>
  )
}

/**
 * Plan-directory overlay: title `计划`, 开启/关闭 rows, switch or status
 * error copy from the UI contract.
 * @param props - selection, current mode, and failure flags.
 * @returns the element tree.
 */
export function PlanDirectoryPane({
  selectedIndex = 0,
  currentActive = false,
  switchError,
  statusError,
}: PlanDirectoryPaneProps): ReactNode {
  if (statusError !== undefined && statusError !== '') {
    return (
      <OverlayShell
        title={TITLE}
        error={`无法读取计划状态：${statusError}`}
        footnote={STATUS_FOOTNOTE}
      />
    )
  }
  return (
    <OverlayShell title={TITLE} footnote={FOOTNOTE}>
      {ROWS.map((label, index) =>
        directoryRow(
          label,
          index === selectedIndex,
          label === '开启' ? currentActive : !currentActive,
        ),
      )}
      {switchError !== undefined && switchError !== '' ? (
        <Box flexDirection="column" width="100%">
          {line(`✗ 切换计划失败：${switchError}`, 'error')}
          {line(SWITCH_NEXT, 'fgDim')}
        </Box>
      ) : null}
    </OverlayShell>
  )
}
