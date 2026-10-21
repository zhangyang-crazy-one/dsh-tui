/** Read-only, physical-row window over the authoritative current TODO projection. */
import { useEffect, useMemo, type ReactNode } from 'react'
import { Text, useWindowSize } from 'ink'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { OverlayShell } from './overlay-shell.tsx'
import { paintRow, styled, type StyleToken } from './theme.ts'
import type { TodoHudItem } from './todo-hud.tsx'
import type { TuiLocale } from './ui-copy.ts'

export interface TodoPaneProps {
  readonly todos: readonly TodoHudItem[]
  readonly offset: number
  readonly onOffsetChange?: (offset: number) => void
  readonly locale?: TuiLocale
}

/** Wrap only when the list/width changes; mount one screen of rows, including completed tasks. */
export function TodoPane({ todos, offset, onOffsetChange, locale }: TodoPaneProps): ReactNode {
  const { columns, rows } = useWindowSize()
  const width = Math.max(1, (columns || 80) - 4)
  const height = Math.max(1, (rows || 24) - 10)
  const english = locale === 'en-US'
  const { lines, counts } = useMemo(() => {
    const counts = { pending: 0, in_progress: 0, completed: 0 }
    const lines: { text: string; token: StyleToken }[] = []
    for (const [index, todo] of todos.entries()) {
      counts[todo.status] += 1
      let label = english ? 'Pending' : '待办'
      let token: StyleToken = 'fg'
      if (todo.status === 'completed') { label = english ? 'Done' : '已完成'; token = 'fgDim' }
      if (todo.status === 'in_progress') { label = english ? 'In progress' : '进行中'; token = 'accent' }
      const content = `${index + 1}. [${label}] ${escapeContent(todo.content)}`
      for (const text of wrapDisplayLines(content, width)) lines.push({ text, token })
    }
    return { lines, counts }
  }, [todos, width, english])
  const maximum = Math.max(0, lines.length - height)
  const start = Math.max(0, Math.min(offset, maximum))
  useEffect(() => {
    if (start !== offset) onOffsetChange?.(start)
  }, [start, offset, onOffsetChange])
  const summary = english
    ? `${todos.length} tasks · ${counts.in_progress} active · ${counts.pending} pending · ${counts.completed} done`
    : `共 ${todos.length} 项 · 进行中 ${counts.in_progress} · 待办 ${counts.pending} · 已完成 ${counts.completed}`
  const position = lines.length === 0 ? '' : ` ${start + 1}–${Math.min(start + height, lines.length)}/${lines.length}`
  return (
    <OverlayShell title={english ? 'TODO list' : '待办清单'}
      footnote={`${english ? '↑↓/jk Scroll · PgUp/PgDn Page · Esc Back' : '↑↓/jk 滚动 · PgUp/PgDn 翻页 · Esc 返回'}${position}`}>
      <Text wrap="truncate">{paintRow([styled(summary, 'fgDim')])}</Text>
      {todos.length === 0 && <Text>{english ? 'No TODO list in this turn.' : '当前回合暂无待办清单。'}</Text>}
      {lines.slice(start, start + height).map((line, index) => (
        <Text key={start + index} wrap="truncate">{paintRow([styled(line.text || ' ', line.token)])}</Text>
      ))}
    </OverlayShell>
  )
}
