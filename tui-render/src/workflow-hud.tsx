/**
 * Workflow compact HUD: while a run is live, `阶段 {title}` plus the current
 * member row `{seq} · {label} · {outcome}` (the outcome host key omitted for
 * an in-flight member). No live run paints nothing (S18). The HUD is
 * observe-only and captures no keys (K28).
 * @module @deepseek-ai/dsh-tui-render/workflow-hud
 */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent, displayWidth } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'

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
  /** The current member row: the in-flight call, else the latest settled one. */
  readonly current?: WorkflowHudMember | undefined
}

/**
 * The compact workflow HUD above the composer: no title bar, no plate; every
 * field escaped and each row truncated to the column budget.
 * @param props - the live run snapshot and the display-column budget per row.
 * @returns the row elements, or null when hidden.
 */
export function WorkflowHud({
  run,
  maxCols,
}: {
  /** The live run snapshot, or undefined when no run is live. */
  run: WorkflowHudState | undefined
  /** Display-column budget per row. */
  maxCols: number
}): ReactNode {
  if (run === undefined) return null
  const rows: ReactNode[] = []
  if (run.phase !== undefined && run.phase !== '') {
    const head = '阶段 '
    rows.push(
      <Text key="phase" wrap="truncate">
        {paintRow([
          styled(escapeContent(head), 'fgDim'),
          styled(
            truncateDisplay(escapeContent(run.phase), Math.max(1, maxCols - displayWidth(head))),
            'fgDim',
          ),
        ])}
      </Text>,
    )
  }
  if (run.current !== undefined) {
    const member = run.current
    const outcomeSuffix = member.outcome === undefined ? '' : ` · ${member.outcome}`
    rows.push(
      <Text key="member" wrap="truncate">
        {paintRow([
          styled(
            truncateDisplay(
              escapeContent(`${member.seq} · ${member.label}${outcomeSuffix}`),
              maxCols,
            ),
            'fgDim',
          ),
        ])}
      </Text>,
    )
  }
  return rows.length === 0 ? null : <>{rows}</>
}
