/**
 * Todo HUD: the sticky todo strip above the composer. One
 * `{glyph} {statusWord} {content}` row per item, three states told apart by
 * glyph plus copy (never color alone, A2/A3), nothing at all when the list is
 * absent or empty (S18: no empty dock row). The HUD captures no keys; the
 * composer stays the input.
 * @module @deepseek-ai/dsh-tui-render/todo-hud
 */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent, displayWidth } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'
import type { StyleToken } from './theme.ts'

/** One todo row the HUD paints; the host maps its projection onto this. */
export interface TodoHudItem {
  /** The task line (untrusted). */
  readonly content: string
  /** Lifecycle state. */
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/** Per-status glyph, status word, and theme token. */
const STATUS_PRESENTATION: Record<
  TodoHudItem['status'],
  { glyph: string; word: string; token: StyleToken }
> = {
  pending: { glyph: '·', word: '待办', token: 'fgDim' },
  in_progress: { glyph: '▸', word: '进行中', token: 'accent' },
  completed: { glyph: '✓', word: '完成', token: 'success' },
}

/**
 * The sticky todo HUD above the composer: no title bar, no plate.
 * Completed items are hidden, showing at most the tail 5 incomplete items.
 * Content is escaped and truncated to the row budget.
 * @param props - todo rows, the display-column budget per row, and optional item limit.
 * @returns the row elements, or null when hidden.
 */
export function TodoHud({
  todos,
  maxCols,
  limit = 5,
}: {
  /** The current todo rows; an empty or all-completed list paints nothing. */
  todos: readonly TodoHudItem[]
  /** Display-column budget per row. */
  maxCols: number
  /** Maximum number of incomplete items to display (tail). Defaults to 5. */
  limit?: number
}): ReactNode {
  const safeLimit = Math.max(0, limit)
  const incomplete = todos.filter(todo => todo.status !== 'completed')
  const visible = safeLimit === 0 ? [] : incomplete.slice(-safeLimit)
  if (visible.length === 0) return null
  return (
    <>
      {visible.map((todo, index) => {
        const presentation = STATUS_PRESENTATION[todo.status]
        const head = `${presentation.glyph} ${presentation.word} `
        const contentToken: StyleToken = todo.status === 'in_progress' ? 'fgSoft' : 'fgDim'
        return (
          <Text key={index} wrap="truncate">
            {paintRow([
              styled(escapeContent(head), presentation.token),
              styled(
                truncateDisplay(
                  escapeContent(todo.content),
                  Math.max(1, maxCols - displayWidth(head)),
                ),
                contentToken,
              ),
            ])}
          </Text>
        )
      })}
    </>
  )
}
