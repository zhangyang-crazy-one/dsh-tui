/**
 * Jobs HUD: one `{id} · {status} · {label}` row per job the live agent owns,
 * host status keys untranslated (running / stopping / completed / killed /
 * failed), nothing at all when the list is empty (S18). The HUD captures no
 * keys (K28) and paints no kill affordance: `job_kill` is not this entry.
 * @module @deepseek-ai/dsh-tui-render/jobs-hud
 */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'
import type { StyleToken } from './theme.ts'

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
 * The sticky jobs HUD above the composer: no title bar, no plate; every row
 * escaped and truncated to the column budget.
 * @param props - job rows and the display-column budget per row.
 * @returns the row elements, or null when hidden.
 */
export function JobsHud({
  jobs,
  maxCols,
}: {
  /** The current job rows; an empty list paints nothing. */
  jobs: readonly JobHudItem[]
  /** Display-column budget per row. */
  maxCols: number
}): ReactNode {
  if (jobs.length === 0) return null
  return (
    <>
      {jobs.map((job) => {
        const rowText = `${job.id} · ${job.status} · ${job.label}`
        const statusToken: StyleToken = job.status === 'running'
          ? 'accentText'
          : job.status === 'failed' || job.status === 'killed'
            ? 'error'
            : 'fgDim'
        return (
          <Text key={job.id} wrap="truncate">
            {paintRow([
              styled(
                truncateDisplay(escapeContent(rowText), maxCols),
                statusToken,
              ),
            ])}
          </Text>
        )
      })}
    </>
  )
}
