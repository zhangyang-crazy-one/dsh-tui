/**
 * Goal footer: the status-row goal fragment `目标 {phase} {n}/{max} · {objective}`.
 * The phase stays the untranslated host key; the objective is escaped and
 * column-truncated with a trailing `…`. No current goal means no fragment at
 * all — the row carries no placeholder.
 * @module @deepseek-ai/dsh-tui-render/goal-footer
 */

import { escapeContent } from './content.ts'
import { truncateDisplay } from './tool-cards.ts'

/** The goal fields the footer formats; the host maps its projection onto this. */
export interface GoalFooterView {
  /** Durable lifecycle phase (host key, never translated). */
  readonly phase: string
  /** The human-requested objective (untrusted). */
  readonly objective: string
  /** Total admitted goal-round cap. */
  readonly maxGoalRounds: number
  /** Highest admitted round number for this goal. */
  readonly roundsStarted: number
}

/**
 * The unescaped `目标 {phase} {roundsStarted}/{maxGoalRounds}` head. Exported
 * so the status row can measure it before budgeting the objective's columns.
 * @param goal - the current goal view.
 * @returns the fragment head, unescaped.
 */
export function goalFooterHead(goal: GoalFooterView): string {
  return `目标 ${goal.phase} ${goal.roundsStarted}/${goal.maxGoalRounds}`
}

/** Escaped footer runs: the `目标 …` head plus the truncated objective. */
export interface GoalFooterRuns {
  /** Escaped `目标 {phase} {roundsStarted}/{maxGoalRounds}`. */
  readonly head: string
  /** Escaped, column-truncated objective. */
  readonly objective: string
}

/**
 * Format the goal footer as escaped runs. `maxObjectiveCols` bounds the
 * objective's display columns so the fragment shares one status row with its
 * neighbors.
 * @param goal - the current goal view, or undefined/null when absent.
 * @param maxObjectiveCols - display-column budget for the objective.
 * @returns the escaped runs, or undefined when no goal is current.
 */
export function goalFooterRuns(
  goal: GoalFooterView | null | undefined,
  maxObjectiveCols: number,
): GoalFooterRuns | undefined {
  if (goal === undefined || goal === null) return undefined
  return {
    head: escapeContent(goalFooterHead(goal)),
    objective: truncateDisplay(escapeContent(goal.objective), maxObjectiveCols),
  }
}

/**
 * The goal footer as one escaped line: `{head} · {objective}`.
 * @param goal - the current goal view, or undefined/null when absent.
 * @param maxObjectiveCols - display-column budget for the objective.
 * @returns the formatted footer, or undefined when no goal is current.
 */
export function formatGoalFooter(
  goal: GoalFooterView | null | undefined,
  maxObjectiveCols: number,
): string | undefined {
  const runs = goalFooterRuns(goal, maxObjectiveCols)
  return runs === undefined ? undefined : `${runs.head} · ${runs.objective}`
}
