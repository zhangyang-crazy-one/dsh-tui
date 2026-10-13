/** Bounded, localized workflow section; empty and settled content paints nothing. */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { layoutHud } from './hud-layout.ts'
import { paintRow, styled } from './theme.ts'
import type { TuiLocale } from './ui-copy.ts'

/** One workflow member row: an `agent()` call within the run. */
export interface WorkflowHudMember {
  /** 1-based sequence number within the run. */
  readonly seq: number
  /** The display label (untrusted). */
  readonly label: string
  /** Host outcome key; absent while the member runs. */
  readonly outcome?: string | undefined
}

/** The live-run snapshot the compact HUD paints. */
export interface WorkflowHudState {
  /** Current phase title (`workflow/phase`), if the script entered one. */
  readonly phase?: string | undefined
  /** The current member row: the in-flight call only. */
  readonly current?: WorkflowHudMember | undefined
}

/**
 * Paint a section including its title and exact overflow count within its allowance.
 * @param props - current projection, locale, and physical row/column limits.
 * @returns bounded rows, or null when the section is empty.
 */
export function WorkflowHud({
  run, maxCols, limit = 5, locale,
}: {
  /** Current projection; only live items are visible. */
  run: WorkflowHudState | undefined
  /** Available display columns. */
  maxCols: number
  /** Total physical rows including the title. */
  limit?: number
  /** Presentation locale. */
  locale?: TuiLocale
}): ReactNode {
  const rows = layoutHud({ workflow: run, columns: maxCols, rows: limit, locale })
  return rows.length === 0 ? null : <>{rows.map(row => (
    <Text key={row.key} wrap="truncate">{paintRow([styled(row.text, row.token)])}</Text>
  ))}</>
}
