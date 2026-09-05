/**
 * Renders the in-terminal session directory. Persisted titles are escaped before
 * styling. Equal titles receive an inline unique id hint, and the absolute
 * selection remains visible inside the measured content-row budget.
 *
 * The component is presentational: the loop owner routes keys and drives selection, rename, and delete callbacks.
 * @module @deepseek-ai/dsh-tui-render/session-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { displayWidth, escapeContent } from './content.ts'
import { styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'

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
  /** Available content columns supplied by the shell. */
  columns: number
  /** Available content rows, including identity and controls. */
  maxRows: number
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

/** Minimum identity fragment shown only when several rows share one title. */
const SESSION_ID_HINT_MIN_LENGTH = 8

/** Drop the conventional prefix so the useful identity bytes remain visible. */
function compactSessionId(id: SessionId): string {
  return id.startsWith('session-') ? id.slice('session-'.length) : id
}

/**
 * Resolve the shortest stable id hints, starting at eight characters, needed
 * to distinguish rows whose persisted titles are equal.
 */
function duplicateTitleHints(rows: readonly SessionRow[]): ReadonlyMap<SessionId, string> {
  const byTitle = new Map<string, SessionRow[]>()
  for (const row of rows) {
    const peers = byTitle.get(row.title)
    if (peers === undefined) byTitle.set(row.title, [row])
    else peers.push(row)
  }

  const hints = new Map<SessionId, string>()
  for (const peers of byTitle.values()) {
    if (peers.length < 2) continue
    const compactIds = peers.map(row => compactSessionId(row.id))
    const candidates = new Set(compactIds).size === compactIds.length
      ? compactIds
      : peers.map(row => row.id)
    for (const [index, row] of peers.entries()) {
      const candidate = candidates[index] as string
      let length = Math.min(SESSION_ID_HINT_MIN_LENGTH, candidate.length)
      while (
        length < candidate.length
        && candidates.some((other, otherIndex) => (
          otherIndex !== index && other.startsWith(candidate.slice(0, length))
        ))
      ) {
        length += 1
      }
      hints.set(row.id, candidate.slice(0, length))
    }
  }
  return hints
}

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
 * Render the session directory around the clamped absolute selection. The
 * content-row budget reserves room for identity and controls; the selected row
 * stays near the window center. Titles shorten before age and identity hints.
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
  columns,
  maxRows,
}: SessionPaneProps): ReactNode {
  const width = Math.max(1, columns)
  const budget = Math.max(1, maxRows)
  const clock = now ?? Date.now()
  const showControls = budget >= 2
  const showIdentity = budget >= 3 && rows.some(row => row.id === currentId)
  const reserved = Number(showControls) + Number(showIdentity)
  const showOverflow = budget >= 4 && rows.length > budget - reserved
  const size = Math.min(rows.length, Math.max(1, budget - reserved - Number(showOverflow)))
  const clampedSelectedIndex = Math.min(
    Math.max(selectedIndex, 0),
    Math.max(0, rows.length - 1),
  )
  const start = Math.min(
    Math.max(clampedSelectedIndex - Math.floor(size / 2), 0),
    rows.length - size,
  )
  const visible = rows.slice(start, start + size)
  const titleHints = duplicateTitleHints(rows)
  const localSelectedIndex = clampedSelectedIndex - start
  const selected = rows[clampedSelectedIndex]
  return (
    <Box flexDirection="column" width={width}>
      {rows.length === 0 ? (
        <Text dimColor>无会话</Text>
      ) : (
        visible.map((row, index) => {
          const highlighted = index === localSelectedIndex
          const titleHint = titleHints.get(row.id)
          const hint = titleHint === undefined ? '' : ` · ${escapeContent(titleHint)}`
          const marker = row.id === currentId ? ' · 当前' : ''
          const age = relativeTime(row.updatedAt, clock)
          const title = truncateDisplay(
            escapeContent(row.title).replace(/\n/gu, ' '),
            width - 3 - displayWidth(hint + age + marker),
          )
          const displayTitle = title + hint
          const gap = Math.max(1, width - 2 - displayWidth(displayTitle + age + marker))
          return (
            <Box key={row.id} width="100%" flexDirection="column">
              <Text wrap="truncate">
                {highlighted ? styled('› ', 'accent', undefined, true) : '  '}
                {styled(displayTitle, highlighted ? 'fg' : 'fgDim')}
                {' '.repeat(gap)}
                {styled(age, 'fgDim')}
                {styled(marker, 'accentDim')}
              </Text>
              {showIdentity && row.id === currentId ? (
                <Text dimColor wrap="truncate">{escapeContent(`会话 ID · ${row.id}`)}</Text>
              ) : null}
            </Box>
          )
        })
      )}
      {showOverflow ? (
        <Text dimColor wrap="truncate">… 还有 {rows.length - size} 个会话</Text>
      ) : null}
      {!showControls ? null : confirmDelete ? (
        <Text wrap="truncate">
          {styled(
            `再按 d 确认删除「${escapeContent(selected?.title ?? '')}」`,
            'error',
          )}
        </Text>
      ) : deleteUnavailable ? (
        <Text wrap="truncate">{styled(escapeContent('删除不可用（后端能力缺失）'), 'error')}</Text>
      ) : (
        <Text wrap="truncate">{styled(escapeContent('↑↓/jk 选择 · Enter 切换 · r 重命名 · d 删除 · g s 关闭'), 'fgDim')}</Text>
      )}
    </Box>
  )
}
