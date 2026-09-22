/** Pure selection and physical-row allocation for the live task HUD. */

import { escapeContent } from './content.ts'
import { truncateDisplay } from './tool-cards.ts'
import { tuiCopy } from './ui-copy.ts'
import type { TuiLocale } from './ui-copy.ts'
import type { TodoHudItem } from './todo-hud.tsx'
import type { JobHudItem } from './jobs-hud.tsx'
import type { WorkflowHudState } from './workflow-hud.tsx'
import type { RenderPolicy } from './render-policy.ts'
import type { StyleToken } from './theme.ts'

/** One escaped, width-bounded physical row. */
export interface HudRow {
  /** Stable React identity within the HUD. */
  readonly key: string
  /** Printable single-line text. */
  readonly text: string
  /** Theme token; status is also expressed in text. */
  readonly token: StyleToken
}

/**
 * Escape controls and fit a complete HUD row, including its status prefix.
 * @param text - untrusted text.
 * @param columns - available display columns.
 * @returns one printable row.
 */
export function fitHudRow(text: string, columns: number): string {
  return truncateDisplay(escapeContent(text).replace(/\n/g, '\\n').replace(/\t/g, '\\t'), Math.max(0, columns))
}

/**
 * Prioritize active todos while preserving original order inside each group.
 * @param todos - current plan.
 * @returns in-progress then pending rows, without completed items.
 */
export function activeTodos(todos: readonly TodoHudItem[]): readonly TodoHudItem[] {
  return [...todos.filter(todo => todo.status === 'in_progress'), ...todos.filter(todo => todo.status === 'pending')]
}

/**
 * Resolve the shared HUD limit after shell and transcript reservations.
 * @param policy - validated deployment limits.
 * @param height - terminal rows.
 * @param reserved - measured controls, shell, and minimum transcript rows.
 * @returns available HUD rows, clamped to zero.
 */
export function hudRowBudget(policy: RenderPolicy, height: number, reserved: number): number {
  return Math.max(0, Math.min(height < policy.compactHeightThreshold ? policy.compactHudRows : policy.normalHudRows, height - reserved))
}

/**
 * Format a live workflow as one summary; settled members never reappear.
 * @param run - live run snapshot.
 * @param locale - presentation locale.
 * @returns summary text, or undefined without a phase or active member.
 */
export function workflowSummary(run: WorkflowHudState | undefined, locale?: TuiLocale): string | undefined {
  if (run === undefined) return undefined
  const parts: string[] = []
  if (run.phase) parts.push(`${tuiCopy('hudPhase', locale)} ${run.phase}`)
  if (run.current !== undefined && run.current.outcome === undefined) {
    parts.push(`${run.current.seq} · ${run.current.label}`)
  }
  return parts.length === 0 ? undefined : `${tuiCopy('hudWorkflow', locale)} · ${parts.join(' · ')}`
}

/** Inputs whose entire presentation must fit the allocated rows and columns. */
export interface HudLayoutInput {
  /** Current plan, including completed items that will be hidden. */
  readonly todos?: readonly TodoHudItem[] | undefined
  /** Registry-order jobs; only running and stopping are visible. */
  readonly jobs?: readonly JobHudItem[] | undefined
  /** Live Workflow projection. */
  readonly workflow?: WorkflowHudState | undefined
  /** Total physical-row allowance, including section titles. */
  readonly rows: number
  /** Display-column allowance per row. */
  readonly columns: number
  /** Presentation locale. */
  readonly locale?: TuiLocale | undefined
}

/**
 * Allocate titled plan/execution sections with exact hidden-item counts.
 * @param input - current projections and available geometry.
 * @returns rows ordered by section, never exceeding the supplied allowance.
 */
export function layoutHud(input: HudLayoutInput): readonly HudRow[] {
  if (input.rows <= 0 || input.columns <= 0) return []
  const { locale } = input
  const todos = activeTodos(input.todos ?? [])
  const jobs = (input.jobs ?? []).filter(job => job.status === 'running' || job.status === 'stopping')
  const workflow = workflowSummary(input.workflow, locale)
  const planCount = todos.length + Number(workflow !== undefined)
  if (planCount + jobs.length === 0) return []
  const row = (key: string, text: string, token: StyleToken = 'fgDim'): HudRow => ({ key, text: fitHudRow(text, input.columns), token })
  const planCountText = `${todos.length} ${tuiCopy('hudTodo', locale)}${workflow === undefined ? '' : ` · 1 ${tuiCopy('hudWorkflow', locale)}`}`
  if (input.rows === 1) {
    return [row('summary', `─ ${tuiCopy('hudPlan', locale)} ${planCountText} | ${tuiCopy('hudJobs', locale)} ${jobs.length}`, 'accentText')]
  }
  let remaining = input.rows - Number(planCount > 0) - Number(jobs.length > 0)
  const selectedTodos: TodoHudItem[] = []
  const selectedJobs: JobHudItem[] = []
  let showWorkflow = false
  if (remaining > 0 && jobs[0] !== undefined) { selectedJobs.push(jobs[0]); remaining -= 1 }
  if (remaining > 0 && todos[0]?.status === 'in_progress') { selectedTodos.push(todos[0]); remaining -= 1 }
  if (remaining > 0 && workflow !== undefined) { showWorkflow = true; remaining -= 1 }
  for (const todo of todos.slice(selectedTodos.length)) {
    if (remaining <= 0) break
    selectedTodos.push(todo)
    remaining -= 1
  }
  for (const job of jobs.slice(selectedJobs.length)) {
    if (remaining <= 0) break
    selectedJobs.push(job)
    remaining -= 1
  }
  const result: HudRow[] = []
  if (planCount > 0) {
    const hiddenTodos = todos.length - selectedTodos.length
    const hiddenWorkflow = Number(workflow !== undefined && !showWorkflow)
    const hidden = hiddenTodos + hiddenWorkflow
    const overflow = hidden === 0 ? '' : ` · +${hidden} ${tuiCopy('hudMore', locale)} (${hiddenTodos}/${hiddenWorkflow})`
    result.push(row('plan-title', `─ ${tuiCopy('hudPlan', locale)} ${planCountText}${overflow}`, 'accentText'))
    selectedTodos.forEach((todo, index) => {
      const active = todo.status === 'in_progress'
      result.push(row(`todo-${index}`, `${active ? '▸' : '·'} ${tuiCopy(active ? 'hudProgress' : 'hudTodo', locale)} ${todo.content}`, active ? 'accent' : 'fgDim'))
    })
    if (showWorkflow && workflow !== undefined) result.push(row('workflow', workflow))
  }
  if (jobs.length > 0) {
    const hidden = jobs.length - selectedJobs.length
    result.push(row('jobs-title', `─ ${tuiCopy('hudJobs', locale)} ${jobs.length}${hidden === 0 ? '' : ` · +${hidden} ${tuiCopy('hudMore', locale)}`}`, 'accentText'))
    for (const job of selectedJobs) {
      result.push(row(`job-${job.id}`, `${job.id} · ${tuiCopy(job.status === 'running' ? 'hudRunning' : 'hudStopping', locale)} · ${job.label}`, 'accentText'))
    }
  }
  return result
}
