/**
 * HelpPane: the in-terminal `/help` sheet. The controller renders the merged
 * command directory plus the key-binding cheat sheet into plain lines; the
 * pane displays them through {@link escapeContent} (descriptions and hints
 * are external command metadata, P5) and windows to {@link HELP_WINDOW} rows.
 * j/k scroll the window through the loop owner, Esc/Enter close. The pane is
 * purely presentational.
 * @module @deepseek-ai/dsh-tui-render/help-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { styled } from './theme.ts'

/** HelpPane props. */
export interface HelpPaneProps {
  /** Rendered help lines, one terminal row each. */
  lines: readonly string[]
  /** Rows scrolled forward from the top (j/k). */
  offset: number
}

/** Controller snapshot backing the help panel. */
export interface HelpPaneState {
  /** Rendered help lines, one terminal row each. */
  lines: readonly string[]
  /** Whether the panel is open. */
  open: boolean
}

/** Maximum visible rows before the truncation hint. */
export const HELP_WINDOW = 20

/**
 * The help sheet panel: the newest {@link HELP_WINDOW} lines render, j/k
 * scroll the window through the loop-owned offset, Esc/Enter close.
 * @param props - help lines and the scroll offset.
 * @returns the element tree.
 */
export function HelpPane({ lines, offset }: HelpPaneProps): ReactNode {
  const maxOffset = Math.max(0, lines.length - HELP_WINDOW)
  const safeOffset = Math.min(offset, maxOffset)
  const visible = lines.slice(safeOffset, safeOffset + HELP_WINDOW)
  return (
    <Box flexDirection="column" width="100%">
      {safeOffset > 0 ? <Text dimColor>… 还有 {safeOffset} 行</Text> : null}
      {visible.map((line, index) => (
        <Text key={safeOffset + index}>{escapeContent(line)}</Text>
      ))}
      <Text>{styled(escapeContent('↑↓/jk 滚动 · Esc/Enter 关闭'), 'fgDim')}</Text>
    </Box>
  )
}
