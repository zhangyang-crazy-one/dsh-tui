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
  const visible = results.slice(0, SEARCH_WINDOW)
  return (
    <Box flexDirection="column" width="100%">
      <Text>搜索: {escapeContent(query)}</Text>
      {status === 'searching' ? (
        <Text dimColor>搜索中…</Text>
      ) : status === 'error' ? (
        <Text>搜索失败，请重试</Text>
      ) : results.length === 0 ? (
        <Text dimColor>{query === '' ? '输入关键词搜索会话' : '无匹配会话'}</Text>
      ) : (
        visible.map((row, index) => {
          const highlighted = index === selectedIndex
          return (
            <Box key={row.id} width="100%">
              <Text>{highlighted ? styled(escapeContent('› '), 'accent', undefined, true) : '  '}</Text>
              <Text dimColor={!highlighted}>{escapeContent(row.title)}</Text>
              <Text dimColor={!highlighted}> — {escapeContent(row.snippet)}</Text>
            </Box>
          )
        })
      )}
      {status !== 'searching' && results.length > SEARCH_WINDOW ? (
        <Text dimColor>… 还有 {results.length - SEARCH_WINDOW} 条结果</Text>
      ) : null}
      <Text>{styled(escapeContent('↑↓/jk 选择 · Enter 恢复 · Esc 关闭'), 'fgDim')}</Text>
    </Box>
  )
}
