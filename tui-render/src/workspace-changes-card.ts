/**
 * Bounded turn-end file-change card copied from Host `workspace/changes`
 * summaries. The render layer never imports `@deepseek-ai/dsh-workspace-changes`;
 * the TUI runtime hydrates these views from `ctx.workspaceChanges`.
 * @module @deepseek-ai/dsh-tui-render/workspace-changes-card
 */

/** One listed file from a Host change summary. */
export interface WorkspaceChangeFileView {
  /** Path relative to the Session cwd, or an absolute Host path. */
  readonly path: string
  /** Slash-separated display path (`../`, `~`, or absolute). */
  readonly display: string
  /** Lines added; zero for binary or oversized files. */
  readonly added: number
  /** Lines deleted; zero for binary or oversized files. */
  readonly deleted: number
  /** Present when git or a capture reported a binary side. */
  readonly binary?: true
  /** Present when a captured side exceeded `maxFileBytes`. */
  readonly oversized?: true
}

/** Transcript card facts for one `workspace/changes` announcement. */
export interface WorkspaceChangesCardView {
  /** Sequence of the announcing Session event. */
  readonly seq: number
  /** Turn the summary describes. */
  readonly turn: number
  /** Files already capped at the plugin `maxFiles`. */
  readonly files: readonly WorkspaceChangeFileView[]
  /** Complete changed-file count, including omitted files. */
  readonly total: number
  /** Lines added over every changed file, including omitted files. */
  readonly added: number
  /** Lines deleted over every changed file, including omitted files. */
  readonly deleted: number
}

/** Representative path rows painted on the card; overflow folds to one count. */
export const WORKSPACE_CHANGES_CARD_PATH_LIMIT = 3

/**
 * Counts label for one listed file. Binary and oversized sides never paint
 * fake `+0/−0` totals.
 * @param file - one summary file.
 * @returns the painted suffix.
 */
export function workspaceChangeCountsLabel(file: WorkspaceChangeFileView): string {
  if (file.binary === true) return 'binary'
  if (file.oversized === true) return 'oversized'
  return `+${String(file.added)}/−${String(file.deleted)}`
}

/**
 * Project a bounded transcript card. Empty file lists yield nothing so callers
 * can skip the entry instead of painting a zero card.
 * @param card - Host summary already stripped of abandoned records.
 * @param pathLimit - representative path rows; defaults to three.
 * @returns ordered card lines, or undefined when there is nothing to show.
 */
export function formatWorkspaceChangesCard(
  card: WorkspaceChangesCardView,
  pathLimit = WORKSPACE_CHANGES_CARD_PATH_LIMIT,
): readonly string[] | undefined {
  if (card.files.length === 0) return undefined
  const shown = card.files.slice(0, Math.max(0, pathLimit))
  const lines = [
    `改动 · ${String(card.total)} 个文件  +${String(card.added)}/−${String(card.deleted)}`,
    ...shown.map(file => `  ${file.display}  ${workspaceChangeCountsLabel(file)}`),
  ]
  const hidden = card.total - shown.length
  if (hidden > 0) lines.push(`  … +${String(hidden)} 个文件`)
  return lines
}
