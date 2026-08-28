/**
 * Reasoning fold: a labeled dim block. While the turn generates, only a short
 * live tail is painted so the thinking channel cannot overflow later rows.
 * After the turn settles the block collapses to one marker and expands on
 * Ctrl+O.
 * @module @deepseek-ai/dsh-tui-render/reasoning
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Fold state for one reasoning block. */
export interface ReasoningBlockProps {
  /** The assembled reasoning text. */
  text: string
  /** One fold marker when true; body (or live tail) when false. */
  collapsed: boolean
  /** Milliseconds the turn has run; the fold label. */
  durationMs: number
  /**
   * Generating live tail: header plus the last {@link REASONING_LIVE_TAIL}
   * wrapped rows, not the full essay. Ignored when `collapsed` is true.
   */
  live?: boolean
}

/** Wrapped rows kept on screen while reasoning is still streaming. */
export const REASONING_LIVE_TAIL = 4

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
 * The reasoning row: a live tail while generating, a dim fold marker once
 * settled, and the full indented body on toggle. The collapsed row carries
 * the ▸ glyph and an explicit expansion hint so the fold is discoverable
 * without trial (L4: `▸`/`▾` + title; A3: glyph + copy, not color alone).
 * @param props - fold state.
 * @returns the element tree.
 */
export function ReasoningBlock({
  text,
  collapsed,
  durationMs,
  live = false,
}: ReasoningBlockProps): ReactNode {
  const { columns } = useWindowSize()
  const maxCols = Math.max(1, columns - 2)
  if (collapsed && text === '') return null
  if (collapsed) {
    return (
      <Text>
        {paintRow([
          styled(
            `▸ ✻ 思考 (${formatSeconds(durationMs)}s) · ${escapeContent(text).split('\n').length} 行 · Ctrl+O 展开`,
            'fgDim',
          ),
        ])}
      </Text>
    )
  }
  const escaped = escapeContent(text)
  const wrapped = wrapDisplayLines(escaped, maxCols)
  const body = live && wrapped.length > REASONING_LIVE_TAIL
    ? wrapped.slice(-REASONING_LIVE_TAIL)
    : wrapped
  return (
    <Box flexDirection="column" width="100%">
      <Text>{thinkingHeader(durationMs, !live)}</Text>
      {live && wrapped.length > REASONING_LIVE_TAIL
        ? (
          <Text key="tail-ellipsis">
            {paintRow([styled('  …', 'fgDim')])}
          </Text>
        )
        : null}
      {body.map((line, index) => bodyRow(line, index))}
    </Box>
  )
}
