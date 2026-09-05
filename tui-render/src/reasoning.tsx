/**
 * Optional dim reasoning in the main transcript. Hidden blocks occupy no rows;
 * visible blocks retain their complete text during streaming and settlement.
 * @module @deepseek-ai/dsh-tui-render/reasoning
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Display state for one reasoning block. */
export interface ReasoningBlockProps {
  /** The assembled reasoning text. */
  text: string
  /** Hide the entire block when true. */
  collapsed: boolean
  /** Milliseconds the turn has run; the fold label. */
  durationMs: number
  /** Whether the duration is still advancing. Does not limit body rows. */
  live?: boolean
  /** Reading-area width including the mirrored two-column body insets. */
  maxCols?: number
}

/** Format a millisecond duration as one decimal second. */
export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/** Dim header for the live or expanded thinking block. */
function thinkingHeader(durationMs: number, expanded: boolean): string {
  const mark = expanded ? '▾ ' : ''
  return paintRow([
    styled(
      `${mark}✻ 思考 (${formatSeconds(durationMs)}s)`,
      'fgDim',
    ),
  ])
}

/** One dim wrapped body row, indented two columns. */
function bodyRow(line: string, key: number): ReactNode {
  return (
    <Text key={key}>
      {paintRow([styled(`  ${escapeContent(line)}`, 'fgDim')])}
    </Text>
  )
}

/**
 * Render complete reasoning under a dim header, or nothing when hidden.
 * The containing transcript owns clipping and scrolling.
 * @param props - display state and available width.
 * @returns the element tree.
 */
export function ReasoningBlock({
  text,
  collapsed,
  durationMs,
  live = false,
  maxCols,
}: ReasoningBlockProps): ReactNode {
  const { columns } = useWindowSize()
  if (collapsed || text === '') return null
  const escaped = escapeContent(text)
  const body = wrapDisplayLines(escaped, Math.max(1, (maxCols ?? columns) - 4))
  return (
    <Box flexDirection="column" width="100%">
      <Text>{thinkingHeader(durationMs, !live)}</Text>
      {body.map((line, index) => bodyRow(line, index))}
    </Box>
  )
}
