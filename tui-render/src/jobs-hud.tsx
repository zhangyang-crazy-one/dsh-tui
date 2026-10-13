/** Bounded, localized jobs section; empty and settled content paints nothing. */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { layoutHud } from './hud-layout.ts'
import { paintRow, styled } from './theme.ts'
import type { TuiLocale } from './ui-copy.ts'

/** One jobs-HUD row; the host maps its registry snapshot onto this. */
export interface JobHudItem {
  /** Registry-issued id (`<kind>-N`). */
  readonly id: string
  /** Host lifecycle key: running / stopping / completed / killed / failed. */
  readonly status: string
  /** Producer-supplied one-line label (untrusted). */
  readonly label: string
}

/**
 * Paint a section including its title and exact overflow count within its allowance.
 * @param props - current projection, locale, and physical row/column limits.
 * @returns bounded rows, or null when the section is empty.
 */
export function JobsHud({
  jobs, maxCols, limit = 5, locale,
}: {
  /** Current projection; only live items are visible. */
  jobs: readonly JobHudItem[]
  /** Available display columns. */
  maxCols: number
  /** Total physical rows including the title. */
  limit?: number
  /** Presentation locale. */
  locale?: TuiLocale
}): ReactNode {
  const rows = layoutHud({ jobs: jobs, columns: maxCols, rows: limit, locale })
  return rows.length === 0 ? null : <>{rows.map(row => (
    <Text key={row.key} wrap="truncate">{paintRow([styled(row.text, row.token)])}</Text>
  ))}</>
}
