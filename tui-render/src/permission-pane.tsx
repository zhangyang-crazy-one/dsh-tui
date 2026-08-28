/**
 * PermissionPane: the overlay list of host permission presets. Presentational
 * only — keys route through {@link mapKeyEvent} in the loop owner, and the
 * runtime (not this module) calls `ctx.commands.execute`.
 * @module @deepseek-ai/dsh-tui-render/permission-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Exact overlay heading (bold fg, never accent). */
const TITLE = '权限预设'
/** Exact key footnote for the three-row list. */
const FOOTNOTE = '↑↓/jk 选择 · 1-3 直达 · Enter 应用 · Esc 关闭'
/** Exact danger-confirm question; replaces the list in the same overlay. */
const CONFIRM = '确认切换到 danger-full-access？'
/** Exact danger-confirm footnote. */
const CONFIRM_FOOTNOTE = '再按 Enter 确认 · Esc 取消'
/** Next-step copy after a switch failure (S5: ✗ with Chinese). */
const FAIL_NEXT = '当前预设保持不变 · 可重试'
/** Reason shown when the host table is empty (not a welcome home). */
const EMPTY_TABLE_REASON = '无可用预设'

/** PermissionPane props. */
export interface PermissionPaneProps {
  /** Host table keys, in table order. */
  names: readonly string[]
  /** Highlighted row index. */
  selectedIndex: number
  /** Currently applied preset key. */
  currentName: string
  /** When true, the overlay shows the danger confirm instead of the list. */
  confirmDanger: boolean
  /** Optional per-row descriptions, aligned with `names`. */
  descriptions?: readonly (string | undefined)[] | undefined
  /** Switch-failure reason; when set, paints the ✗ pair. */
  switchError?: string | undefined
}

/** Controller snapshot backing the permission overlay. */
export interface PermissionPaneState {
  /** Whether the overlay currently replaces the conversation column. */
  open: boolean
  /** Host table keys, in table order. */
  names: readonly string[]
  /** Highlighted row index. */
  selectedIndex: number
  /** Currently applied preset key. */
  currentName: string
  /** Whether the overlay is on the danger confirm. */
  confirmDanger: boolean
  /** Optional per-row descriptions, aligned with `names`. */
  descriptions?: readonly (string | undefined)[] | undefined
  /** Switch-failure reason, when the last apply did not land. */
  switchError?: string | undefined
}

/** Closed snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_PERMISSION_PANE: PermissionPaneState = {
  open: false,
  names: [],
  selectedIndex: 0,
  currentName: '',
  confirmDanger: false,
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
  token: 'fg' | 'fgDim' | 'error' | 'accent',
  bold = false,
): ReactNode {
  return (
    <Text>
      {paintRow([styled(escapeContent(text), token, undefined, bold)])}
    </Text>
  )
}

/**
 * The permission overlay: heading and host rows, or the danger confirm, or
 * the switch-failure pair. Does not call `ctx.commands.execute`.
 * @param props - host names, selection, current preset, and confirm/error flags.
 * @returns the element tree.
 */
export function PermissionPane({
  names,
  selectedIndex,
  currentName,
  confirmDanger,
  descriptions,
  switchError,
}: PermissionPaneProps): ReactNode {
  if (confirmDanger) {
    return (
      <Box flexDirection="column" width="100%">
        {line(CONFIRM, 'fg', true)}
        {line(CONFIRM_FOOTNOTE, 'fgDim')}
      </Box>
    )
  }
  const errorReason = switchError ?? (names.length === 0 ? EMPTY_TABLE_REASON : undefined)
  return (
    <Box flexDirection="column" width="100%">
      {line(TITLE, 'fg', true)}
      {names.map((name, index) => {
        const selected = index === selectedIndex
        const current = name === currentName
        const description = descriptions?.[index]
        const label = current ? `${name} · 当前` : name
        return (
          <Box key={name} flexDirection="column" width="100%">
            <Box width="100%">
              <Text>
                {selected
                  ? styled(escapeContent('› '), 'accent', undefined, true)
                  : '  '}
              </Text>
              <Text>{paintRow([styled(escapeContent(label), selected ? 'fg' : 'fgDim')])}</Text>
            </Box>
            {description !== undefined && description !== ''
              ? line(description, 'fgDim')
              : null}
          </Box>
        )
      })}
      {errorReason !== undefined ? (
        <Box flexDirection="column" width="100%">
          {line(`✗ 切换权限失败：${errorReason}`, 'error')}
          {line(FAIL_NEXT, 'fgDim')}
        </Box>
      ) : null}
      {line(FOOTNOTE, 'fgDim')}
    </Box>
  )
}
