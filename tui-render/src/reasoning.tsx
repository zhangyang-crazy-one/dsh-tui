/**
 * Optional dim reasoning in the main transcript. Hidden blocks occupy no rows;
 * visible blocks retain their complete text during streaming and settlement.
 * @module @deepseek-ai/dsh-tui-render/reasoning
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { inkColor, paintBackgroundRow, styled } from './theme.ts'
import { getBrailleSpinnerFrame } from './ui-copy.ts'

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

/** Header for the live or expanded thinking block with accent title. */
function thinkingHeader(durationMs: number, expanded: boolean, live = false, width?: number): string {
  const mark = expanded ? '▾ ' : ''
  const icon = live ? getBrailleSpinnerFrame(durationMs) : '✻'
  const parts = [
    ...(mark !== '' ? [styled(mark, 'accentText')] : []),
    styled(`${icon} 思考`, 'accentText'),
    styled(` (${formatSeconds(durationMs)}s)`, 'fgDim'),
  ]
  return paintBackgroundRow(parts, 'toolBg', width !== undefined && width > 0 ? width : 0)
}

/** One dim wrapped body row with an accent-colored left border bar on card background. */
function bodyRow(line: string, key: number, width?: number): ReactNode {
  return (
    <Text key={key} wrap="truncate">
      {paintBackgroundRow([styled('│ ', 'accentText'), styled(escapeContent(line), 'fgDim')], 'toolBg', width !== undefined && width > 0 ? width : 0)}
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
  const width = maxCols ?? columns
  const escaped = escapeContent(text)
  const body = wrapDisplayLines(escaped, Math.max(1, width - 4))
  return (
    <Box flexDirection="column" width="100%" backgroundColor={inkColor('toolBg')}>
      <Text wrap="truncate">{thinkingHeader(durationMs, !live, live, width)}</Text>
      {body.map((line, index) => bodyRow(line, index, width))}
    </Box>
  )
}
