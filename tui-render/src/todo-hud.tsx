/** Bounded, localized todo section; empty and settled content paints nothing. */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { layoutHud } from './hud-layout.ts'
import { paintRow, styled } from './theme.ts'
import type { TuiLocale } from './ui-copy.ts'

/** One todo row the HUD paints; the host maps its projection onto this. */
export interface TodoHudItem {
  /** The task line (untrusted). */
  readonly content: string
  /** Lifecycle state. */
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Paint a section including its title and exact overflow count within its allowance.
 * @param props - current projection, locale, and physical row/column limits.
 * @returns bounded rows, or null when the section is empty.
 */
export function TodoHud({
  todos, maxCols, limit = 5, locale,
}: {
  /** Current projection; only live items are visible. */
  todos: readonly TodoHudItem[]
  /** Available display columns. */
  maxCols: number
  /** Total physical rows including the title. */
  limit?: number
  /** Presentation locale. */
  locale?: TuiLocale
}): ReactNode {
  const rows = layoutHud({ todos: todos, columns: maxCols, rows: limit, locale })
  return rows.length === 0 ? null : <>{rows.map(row => (
    <Text key={row.key} wrap="truncate">{paintRow([styled(row.text, row.token)])}</Text>
  ))}</>
}
