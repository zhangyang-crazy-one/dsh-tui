/**
 * SearchPane: the in-terminal full-text search panel. Rows render the folded
 * session title and the strongest matching excerpt, both through
 * {@link escapeContent} (search terms and persisted logs are user/model
 * input, P5), and the list windows to {@link SEARCH_WINDOW} rows. The
 * component is purely presentational: keys route through {@link mapKeyEvent}
 * in the loop owner (Ctrl+K toggles, printable keys filter, Enter resumes).
 * @module @deepseek-ai/dsh-tui-render/search-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { styled } from './theme.ts'

/** One search candidate: a persisted session and its strongest match. */
export interface SearchCandidate {
  /** Persisted session id. */
  id: string
  /** Folded session title (escaped at render). */
  title: string
  /** Plain-text excerpt around the strongest match. */
  snippet: string
}

/** Search panel phase: loading/error are mutually exclusive with results. */
export type SearchStatus = 'idle' | 'searching' | 'error'

/** SearchPane props. */
export interface SearchPaneProps {
  /** The live search query. */
  query: string
  /** Matched candidates, in rank order. */
  results: readonly SearchCandidate[]
  /** Index of the highlighted candidate. */
  selectedIndex: number
  /** Search phase (loading/error states render instead of results). */
  status?: SearchStatus
}

/** Controller snapshot backing the search panel. */
export interface SearchPaneState {
  /** The live search query. */
  query: string
  /** Matched candidates, in rank order. */
  results: readonly SearchCandidate[]
  /** Index of the highlighted candidate. */
  selectedIndex: number
  /** Whether the panel is open. */
  open: boolean
  /** Search phase: loading/error vs. settled results. */
  status: SearchStatus
}

/** Maximum visible candidates before the truncation hint. */
export const SEARCH_WINDOW = 30

/**
 * The full-text search panel.
 * @param props - query and ranked candidates.
 * @returns the element tree.
 */
export function SearchPane({
  query,
  results,
  selectedIndex,
  status = 'idle',
}: SearchPaneProps): ReactNode {
  const windowStart = Math.min(
    Math.max(0, selectedIndex - SEARCH_WINDOW + 1),
    Math.max(0, results.length - SEARCH_WINDOW),
  )
  const visible = results.slice(windowStart, windowStart + SEARCH_WINDOW)
  let bodyNode: ReactNode
  if (status === 'searching') {
    bodyNode = <Text dimColor>搜索中…</Text>
  } else if (status === 'error') {
    bodyNode = <Text>{styled(escapeContent('搜索失败，请重试'), 'error')}</Text>
  } else if (results.length === 0) {
    bodyNode = <Text dimColor>{query === '' ? '输入关键词搜索会话' : '无匹配会话'}</Text>
  } else {
    bodyNode = visible.map((row, index) => {
      const highlighted = windowStart + index === selectedIndex
      const cleanSnippet = escapeContent(row.snippet).replace(/\s+/gu, ' ')
      return (
        <Text key={row.id} wrap="truncate">
          {highlighted ? styled(escapeContent('› '), 'accent', undefined, true) : '  '}
          {styled(escapeContent(row.title), highlighted ? 'fg' : 'fgSoft', undefined, highlighted)}
          {styled(` — ${cleanSnippet}`, highlighted ? 'accentText' : 'fgDim')}
        </Text>
      )
    })
  }
  return (
    <Box flexDirection="column" width="100%">
      <Text wrap="truncate">
        {styled(`搜索: ${escapeContent(query)}`, 'fg', undefined, true)}
        {status === 'idle' && results.length > 0
          ? styled(`  ·  ${String(Math.min(results.length, Math.max(1, selectedIndex + 1)))}/${String(results.length)}`, 'fgDim')
          : ''}
      </Text>
      {bodyNode}
      {status !== 'searching' && results.length > SEARCH_WINDOW ? (
        <Text dimColor>… 还有 {results.length - SEARCH_WINDOW} 条结果</Text>
      ) : null}
      <Text>{styled(escapeContent('↑↓/jk 选择 · Enter 恢复 · Esc 关闭'), 'fgDim')}</Text>
    </Box>
  )
}
