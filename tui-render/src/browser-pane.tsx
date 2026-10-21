/** Shared bounded list/full-source viewer. Mutations remain with its controller. */
import { Box, Text } from 'ink'
import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { paintRow, styled } from './theme.ts'

export interface BrowserRow { readonly id: string; readonly title: string; readonly hint?: string }
export interface BrowserPaneState {
  readonly open: boolean
  readonly id: string
  readonly title: string
  readonly rows: readonly BrowserRow[]
  readonly selectedIndex: number
  readonly detail?: string | undefined
  readonly offset: number
  readonly busy: boolean
  readonly error?: string | undefined
  readonly actions: readonly { key: string; label: string }[]
}
export const EMPTY_BROWSER_PANE: BrowserPaneState = {
  open: false, id: '', title: '', rows: [], selectedIndex: 0, offset: 0, busy: false, actions: [],
}
export function BrowserPane({ state, maxRows, maxCols, onOffsetChange }: {
  state: BrowserPaneState; maxRows: number; maxCols: number; onOffsetChange?: (offset: number) => void
}): ReactNode {
  const detail = useMemo(() => state.detail === undefined ? [] : wrapDisplayLines(escapeContent(state.detail), Math.max(1, maxCols)), [state.detail, maxCols])
  const capacity = Math.max(1, maxRows - 4)
  const offset = Math.min(Math.max(0, state.offset), Math.max(0, detail.length - capacity))
  useLayoutEffect(() => {
    if (state.detail !== undefined && offset !== state.offset) onOffsetChange?.(offset)
  }, [state.detail, state.offset, offset, onOffsetChange])
  const start = Math.max(0, Math.min(state.rows.length - capacity, state.selectedIndex - Math.floor(capacity / 2)))
  const lines = state.detail === undefined
    ? state.rows.slice(start, start + capacity).map((row, index) => `${start + index === state.selectedIndex ? '›' : ' '} ${escapeContent(row.title)}${row.hint === undefined ? '' : ` · ${escapeContent(row.hint)}`}`)
    : detail.slice(offset, offset + capacity)
  return <Box flexDirection="column" width="100%" flexShrink={0}>
    <Text wrap="truncate">{paintRow([styled(`${escapeContent(state.title)} · ${state.rows.length}${state.detail === undefined ? '' : ` · ${offset + 1}–${offset + lines.length}/${detail.length}`}`, 'fg', undefined, true)])}</Text>
    {lines.length > 0 ? lines.map((line, index) => <Text key={index} wrap="truncate">{paintRow([styled(line || ' ', 'fg')])}</Text>)
      : <Text wrap="truncate">{paintRow([styled(state.busy ? '正在读取…' : '暂无记录', 'fgDim')])}</Text>}
    <Text wrap="truncate">{paintRow([styled(state.error === undefined ? state.busy ? '处理中…' : ' ' : `✗ ${escapeContent(state.error)}`, state.error === undefined ? 'fgDim' : 'error')])}</Text>
    <Text wrap="truncate">{paintRow([styled(state.detail === undefined ? '↑↓/PgUp/PgDn 选择 · Enter 详情 · r 刷新 · Esc 返回' : '↑↓/PgUp/PgDn 阅读 · Home/End 首尾 · Esc 列表', 'fgDim')])}</Text>
    <Text wrap="truncate">{paintRow([styled(state.actions.map(action => `${action.key} ${action.label}`).join(' · ') || ' ', 'fgDim')])}</Text>
  </Box>
}
