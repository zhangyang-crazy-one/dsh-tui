/**
 * TimelineView: the read-only conversation timeline (SRCH-01 lite). Each row
 * shows the dim relative age and the first line of one frozen message,
 * escaped before the theme layer. The pane is purely presentational — Ctrl+T
 * toggles it through the loop owner's keymap.
 * @module @deepseek-ai/dsh-tui-render/timeline-view
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { styled } from './theme.ts'
import type { FrozenMessage } from './projection.ts'
import { relativeTime } from './session-pane.tsx'

/** TimelineView props. */
export interface TimelineViewProps {
  /** Frozen conversation rows, oldest first. */
  history: readonly FrozenMessage[]
  /** Clock for relative timestamps; defaults to Date.now(). */
  now?: number
  /** Rows scrolled back from the newest message (j/k). */
  offset?: number
}

/** Longest first line shown before the truncation marker. */
const FIRST_LINE_MAX = 120

/** Maximum visible rows before the truncation hint (K3). */
export const TIMELINE_WINDOW = 60

/**
 * The conversation timeline: only the newest {@link TIMELINE_WINDOW} rows
 * render; j/k scroll the window back through older history.
 * @param props - frozen history rows and the scroll offset.
 * @returns the element tree.
 */
export function TimelineView({
  history,
  now,
  offset = 0,
}: TimelineViewProps): ReactNode {
  const clock = now ?? Date.now()
  const maxOffset = Math.max(0, history.length - TIMELINE_WINDOW)
  const safeOffset = Math.min(offset, maxOffset)
  const end = history.length - safeOffset
  const start = Math.max(0, end - TIMELINE_WINDOW)
  const visible = history.slice(start, end)
  // The current (newest) message is the last visible row only when the window
  // shows the log tail; scrolled back, it is off-screen and nothing is accented.
  const current = end >= history.length ? visible.length - 1 : -1
  return (
    <Box flexDirection="column" width="100%">
      {history.length === 0 ? <Text dimColor>（无历史消息）</Text> : null}
      {start > 0 ? <Text dimColor>… 还有 {start} 条</Text> : null}
      {visible.map((message, index) => (
        <Box key={start + index} width="100%">
          <Text dimColor>{relativeTime(message.timestamp, clock)}</Text>
          <Text dimColor> {message.kind === 'user' ? '> ' : '● '}</Text>
          <Text>
            {index === current
              ? styled(escapeContent(firstLine(message.text)), 'accent')
              : escapeContent(firstLine(message.text))}
          </Text>
        </Box>
      ))}
      <Text>{styled(escapeContent('↑↓/jk 滚动 · Esc 关闭'), 'fgDim')}</Text>
    </Box>
  )
}

/**
 * The message's first line, bounded for one-row display.
 * @param text - the full message text.
 * @returns the first line, truncated to {@link FIRST_LINE_MAX} code units.
 */
function firstLine(text: string): string {
  const line = text.split('\n')[0] as string
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX)}…` : line
}
