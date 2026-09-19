/**
 * Host summary hydration: empty/disposed records are not cards; diffs stay on
 * the Host until Session dispose, then preview returns nothing.
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceChangesSummary, WorkspaceFileDiff } from '@deepseek-ai/dsh-workspace-changes/types'
import {
  formatWorkspaceChangeDiffPreview,
  lookupWorkspaceChange,
  workspaceChangesCardFromSummary,
} from '../src/workspace-changes.ts'

function summary(overrides: Partial<WorkspaceChangesSummary> = {}): WorkspaceChangesSummary {
  return {
    turn: 1,
    cwd: '/tmp',
    files: [
      { path: 'a.ts', display: 'a.ts', added: 2, deleted: 1 },
      { path: 'b.ts', display: 'b.ts', added: 0, deleted: 3 },
    ],
    total: 2,
    added: 2,
    deleted: 4,
    ...overrides,
  }
}

describe('workspaceChangesCardFromSummary', () => {
  it('returns undefined when the Host summary is missing or empty', () => {
    expect(workspaceChangesCardFromSummary(9, undefined)).toBeUndefined()
    expect(workspaceChangesCardFromSummary(9, summary({ files: [], total: 0 }))).toBeUndefined()
  })

  it('copies listed files and keeps overflow totals from the Host', () => {
    expect(workspaceChangesCardFromSummary(9, summary({ total: 8, added: 10, deleted: 6 }))).toEqual({
      seq: 9,
      turn: 1,
      files: [
        { path: 'a.ts', display: 'a.ts', added: 2, deleted: 1 },
        { path: 'b.ts', display: 'b.ts', added: 0, deleted: 3 },
      ],
      total: 8,
      added: 10,
      deleted: 6,
    })
  })
})

describe('lookupWorkspaceChange / formatWorkspaceChangeDiffPreview', () => {
  it('finds a listed file by path or display name', () => {
    const card = workspaceChangesCardFromSummary(9, summary())
    if (card === undefined) throw new Error('expected a card')
    const cards = new Map([[9, card]])
    expect(lookupWorkspaceChange(cards, 'b.ts')).toEqual({ seq: 9, index: 1 })
    expect(lookupWorkspaceChange(cards, 'missing.ts')).toBeUndefined()
  })

  it('returns undefined after Session dispose so callers show failure copy', () => {
    expect(formatWorkspaceChangeDiffPreview(undefined)).toBeUndefined()
  })

  it('paints Host text hunks and binary/oversized refusals without inventing a diff', () => {
    const text: WorkspaceFileDiff = {
      kind: 'text',
      path: 'a.ts',
      display: 'a.ts',
      before: true,
      after: true,
      coarse: false,
      hunks: [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'],
      }],
    }
    expect(formatWorkspaceChangeDiffPreview(text)).toEqual([
      'a.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ])
    expect(formatWorkspaceChangeDiffPreview({ kind: 'binary', path: 'a.bin', display: 'a.bin' }))
      .toEqual(['a.bin · binary'])
    expect(formatWorkspaceChangeDiffPreview({ kind: 'oversized', path: 'big', display: 'big' }))
      .toEqual(['big · oversized'])
  })
})
