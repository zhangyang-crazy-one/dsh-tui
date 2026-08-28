/**
 * Workflow overlay (`工作流`, `g w`): the live run's phase and member rows in
 * the K2 chrome. Empty state `当前无工作流运行`; a missing workflow service
 * paints `✗ 工作流状态不可用：{原因}` (S19). Observe-only: the overlay never
 * starts a run. Keys: j/k scroll the member window, Esc closes (K2′).
 * @module @deepseek-ai/dsh-tui-render/workflow-overlay
 */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { OverlayShell } from './overlay-shell.tsx'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'
import type { WorkflowHudMember } from './workflow-hud.tsx'

/** Member rows painted at once; j/k moves the window. */
export const WORKFLOW_OVERLAY_WINDOW = 8

/** Controller snapshot for the workflow overlay. */
export interface WorkflowOverlayState {
  /** Whether this overlay currently replaces the conversation column. */
  readonly open: boolean
  /** The live run snapshot; absent when no run has been observed. */
  readonly run?: {
    /** Current phase title (`workflow/phase`), if any. */
    readonly phase?: string | undefined
    /** The run's `agent()` members, ascending by seq. */
    readonly members: readonly WorkflowHudMember[]
  } | undefined
  /** Failure reason (painted as `✗ {error}`), e.g. `工作流状态不可用：未组合`. */
  readonly error?: string | undefined
  /** First visible member index (j/k 滚动). */
  readonly offset: number
}

/** Closed overlay snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_WORKFLOW_OVERLAY: WorkflowOverlayState = { open: false, offset: 0 }

/**
 * The workflow overlay: title `工作流`; a live run paints its phase row and a
 * windowed member list; otherwise the empty or error state (D-08).
 * @param props - the overlay state.
 * @returns the element tree, or null when closed.
 */
export function WorkflowOverlay({
  state,
}: {
  /** The overlay snapshot. */
  state: WorkflowOverlayState
}): ReactNode {
  if (!state.open) return null
  if (state.error !== undefined) {
    return <OverlayShell title="工作流" error={state.error} footnote="Esc 关闭" />
  }
  if (state.run === undefined) {
    return <OverlayShell title="工作流" body="当前无工作流运行" footnote="Esc 关闭" />
  }
  const rows: ReactNode[] = []
  if (state.run.phase !== undefined && state.run.phase !== '') {
    rows.push(
      <Text key="phase">
        {paintRow([styled(escapeContent(`阶段 ${state.run.phase}`), 'fg')])}
      </Text>,
    )
  }
  const windowed = state.run.members.slice(
    state.offset,
    state.offset + WORKFLOW_OVERLAY_WINDOW,
  )
  for (const member of windowed) {
    const outcomeSuffix = member.outcome === undefined ? '' : ` · ${member.outcome}`
    rows.push(
      <Text key={member.seq}>
        {paintRow([
          styled(escapeContent(`${member.seq} · ${member.label}${outcomeSuffix}`), 'fgDim'),
        ])}
      </Text>,
    )
  }
  return (
    <OverlayShell title="工作流" footnote="j/k 滚动 · Esc 关闭">
      {rows}
    </OverlayShell>
  )
}
