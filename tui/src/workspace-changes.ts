/**
 * Hydrate Host `workspace/changes` summaries into transcript card views and
 * route one listed file's before/after into the existing workspace preview.
 * @module @deepseek-ai/dsh-tui/workspace-changes
 */

import type {
  WorkspaceChangedFile,
  WorkspaceChangesSummary,
  WorkspaceFileDiff,
} from '@deepseek-ai/dsh-workspace-changes/types'
import type { WorkspaceChangeFileView, WorkspaceChangesCardView } from '@deepseek-ai/dsh-tui-render'

/** Coordinates of one listed file inside a cached summary. */
export interface WorkspaceChangeLookup {
  /** Announcing event sequence. */
  readonly seq: number
  /** Index in `summary.files`. */
  readonly index: number
}

/**
 * Copy a Host summary into the render-layer card view. Empty file lists are
 * not cards; callers drop them so the transcript paints nothing.
 * @param seq - announcing event sequence.
 * @param summary - Host summary, or undefined once the Session was disposed.
 * @returns the card, or undefined when there is nothing to show.
 */
export function workspaceChangesCardFromSummary(
  seq: number,
  summary: WorkspaceChangesSummary | undefined,
): WorkspaceChangesCardView | undefined {
  if (summary === undefined || summary.files.length === 0) return undefined
  return {
    seq,
    turn: summary.turn,
    files: summary.files.map(toFileView),
    total: summary.total,
    added: summary.added,
    deleted: summary.deleted,
  }
}

function toFileView(file: WorkspaceChangedFile): WorkspaceChangeFileView {
  return {
    path: file.path,
    display: file.display,
    added: file.added,
    deleted: file.deleted,
    ...(file.binary === true ? { binary: true } : {}),
    ...(file.oversized === true ? { oversized: true } : {}),
  }
}

/**
 * Find a listed file by its Host path or display path.
 * @param cards - cached cards keyed by announcing seq.
 * @param needle - workspace preview path or display name.
 * @returns the card coordinates, or undefined when no listed file matches.
 */
export function lookupWorkspaceChange(
  cards: ReadonlyMap<number, WorkspaceChangesCardView>,
  needle: string,
): WorkspaceChangeLookup | undefined {
  for (const card of cards.values()) {
    const index = card.files.findIndex(file => file.path === needle || file.display === needle)
    if (index >= 0) return { seq: card.seq, index }
  }
  return undefined
}

/**
 * Paint one Host comparison into the existing workspace preview lines. Binary
 * and oversized refusals stay one line; text hunks keep their `+`/`-`/space
 * prefixes. Callers must not invent a diff from Session log bytes.
 * @param diff - Host comparison, or undefined after Session dispose.
 * @returns preview lines, or undefined when the comparison is gone.
 */
export function formatWorkspaceChangeDiffPreview(
  diff: WorkspaceFileDiff | undefined,
): readonly string[] | undefined {
  if (diff === undefined) return undefined
  if (diff.kind === 'binary' || diff.kind === 'oversized') {
    return [`${diff.display} · ${diff.kind}`]
  }
  const lines = [
    `${diff.display}${diff.coarse ? ' · coarse' : ''}`,
  ]
  for (const hunk of diff.hunks) {
    lines.push(`@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`)
    lines.push(...hunk.lines)
  }
  return lines
}
