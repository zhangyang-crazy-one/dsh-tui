/**
 * Renders the in-terminal session directory. Persisted titles are escaped before
 * styling, and the absolute selection remains visible inside a centered, clamped
 * {@link LIST_WINDOW}-row window.
 *
 * The component is presentational: the loop owner routes keys and drives selection, rename, and delete callbacks.
 * @module @deepseek-ai/dsh-tui-render/session-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { escapeContent } from './content.ts'
import { styled } from './theme.ts'

/** One session directory row. */
export interface SessionRow {
  /** Persisted session id. */
  id: SessionId
  /** Display title folded from the session log (escaped at render). */
  title: string
  /** Unix epoch milliseconds of the latest logged activity. */
  updatedAt: number
}

/** SessionPane props. */
export interface SessionPaneProps {
  /** Directory rows, newest activity first. */
  rows: readonly SessionRow[]
  /** Index of the highlighted row. */
  selectedIndex: number
  /** Id of the live session, or undefined before one exists. */
  currentId: SessionId | undefined
  /** True while the delete confirmation is armed for the selected row. */
  confirmDelete: boolean
  /** True when the backend delete capability is missing (d is inert). */
  deleteUnavailable?: boolean
  /** Clock for relative timestamps; defaults to Date.now(). */
  now?: number
}

/** Controller snapshot backing the pane view. */
export interface SessionPaneState {
  /** Directory rows, newest activity first. */
  rows: readonly SessionRow[]
  /** Index of the highlighted row. */
  selectedIndex: number
  /** Whether the list is open. */
  open: boolean
  /** Whether the delete confirmation is armed for the selected row. */
  confirmDelete: boolean
  /** True when the backend delete capability is missing (d is inert). */
  deleteUnavailable: boolean
  /** Id of the live session, or undefined before one exists. */
  currentId: SessionId | undefined
}

/** Maximum visible rows before the truncation hint. */
export const LIST_WINDOW = 50

/**
 * One-line relative age of a session.
 * @param updatedAt - Unix epoch milliseconds of the latest logged activity.
 * @param now - current clock, Unix epoch milliseconds.
 * @returns a compact Chinese relative-time label.
 */
export function relativeTime(updatedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * Render the session directory around the clamped absolute selection. At most
 * {@link LIST_WINDOW} rows are shown, the selected row stays visible near the
 * window center where possible, and persisted titles are escaped before output.
 *
 * The caller owns directory persistence and key routing.
 * @param props - ordered rows, absolute selection, live-session marker, delete state, and optional clock.
 * @returns the Ink element tree for the current centered directory window.
 */
export function SessionPane({
  rows,
  selectedIndex,
  currentId,
  confirmDelete,
  deleteUnavailable = false,
  now,
}: SessionPaneProps): ReactNode {
  const clock = now ?? Date.now()
  const size = Math.min(LIST_WINDOW, rows.length)
  const clampedSelectedIndex = Math.min(
    Math.max(selectedIndex, 0),
    Math.max(0, rows.length - 1),
  )
  const start = Math.min(
    Math.max(clampedSelectedIndex - Math.floor(size / 2), 0),
    rows.length - size,
  )
  const visible = rows.slice(start, start + size)
  const localSelectedIndex = clampedSelectedIndex - start
  const selected = rows[clampedSelectedIndex]
  return (
    <Box flexDirection="column" width="100%">
      {rows.length === 0 ? (
        <Text dimColor>无会话</Text>
      ) : (
        visible.map((row, index) => {
          const highlighted = index === localSelectedIndex
          return (
            <Box key={row.id} width="100%" flexDirection="column">
              <Box width="100%">
                <Text>{highlighted ? styled(escapeContent('› '), 'accent', undefined, true) : '  '}</Text>
                <Text dimColor={!highlighted}>{escapeContent(row.title)}</Text>
                <Box flexGrow={1} />
                <Text dimColor>{relativeTime(row.updatedAt, clock)}</Text>
                {row.id === currentId ? (
                  <Text>{styled(escapeContent(' · 当前'), 'accentDim')}</Text>
                ) : null}
              </Box>
              {row.id === currentId ? (
                <Text dimColor>{escapeContent(`会话 ID · ${row.id}`)}</Text>
              ) : null}
            </Box>
          )
        })
      )}
      {rows.length > LIST_WINDOW ? (
        <Text dimColor>… 还有 {rows.length - LIST_WINDOW} 个会话</Text>
      ) : null}
      {confirmDelete ? (
        <Text>
          {styled(
            `再按 d 确认删除「${escapeContent(selected?.title ?? '')}」`,
            'error',
          )}
        </Text>
      ) : deleteUnavailable ? (
        <Text>{styled(escapeContent('删除不可用（后端能力缺失）'), 'error')}</Text>
      ) : (
        <Text>{styled(escapeContent('↑↓/jk 选择 · Enter 切换 · r 重命名 · d 删除 · g s 关闭'), 'fgDim')}</Text>
      )}
    </Box>
  )
}
