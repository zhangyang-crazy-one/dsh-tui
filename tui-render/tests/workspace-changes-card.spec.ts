/**
 * Bounded turn-end file-change card: empty summaries paint nothing, overflow
 * folds to a count, and binary/oversized sides never show fake `+0/−0`.
 */
import { describe, expect, it } from 'vitest'
import {
  formatWorkspaceChangesCard,
  workspaceChangeCountsLabel,
  type WorkspaceChangesCardView,
} from '../src/workspace-changes-card.ts'

function card(overrides: Partial<WorkspaceChangesCardView> = {}): WorkspaceChangesCardView {
  return {
    seq: 9,
    turn: 1,
    files: [],
    total: 0,
    added: 0,
    deleted: 0,
    ...overrides,
  }
}

describe('formatWorkspaceChangesCard', () => {
  it('returns undefined for an empty file list so callers skip the card', () => {
    expect(formatWorkspaceChangesCard(card())).toBeUndefined()
    expect(formatWorkspaceChangesCard(card({ total: 4, added: 1, deleted: 1 }))).toBeUndefined()
  })

  it('lists paths with +n/−n and folds overflow to one count row', () => {
    expect(formatWorkspaceChangesCard(card({
      files: [
        { path: 'a.ts', display: 'a.ts', added: 3, deleted: 1 },
        { path: 'b.ts', display: 'b.ts', added: 0, deleted: 2 },
        { path: 'c.ts', display: 'c.ts', added: 4, deleted: 0 },
        { path: 'd.ts', display: 'd.ts', added: 1, deleted: 1 },
        { path: 'e.ts', display: 'e.ts', added: 1, deleted: 0 },
      ],
      total: 7,
      added: 12,
      deleted: 5,
    }))).toEqual([
      '改动 · 7 个文件  +12/−5',
      '  a.ts  +3/−1',
      '  b.ts  +0/−2',
      '  c.ts  +4/−0',
      '  … +4 个文件',
    ])
  })

  it('labels binary and oversized files instead of +0/−0', () => {
    expect(workspaceChangeCountsLabel({
      path: 'a.bin', display: 'a.bin', added: 0, deleted: 0, binary: true,
    })).toBe('binary')
    expect(workspaceChangeCountsLabel({
      path: 'big.bin', display: 'big.bin', added: 0, deleted: 0, oversized: true,
    })).toBe('oversized')
    expect(formatWorkspaceChangesCard(card({
      files: [
        { path: 'a.bin', display: 'a.bin', added: 0, deleted: 0, binary: true },
        { path: 'big.bin', display: 'big.bin', added: 0, deleted: 0, oversized: true },
      ],
      total: 2,
    }))).toEqual([
      '改动 · 2 个文件  +0/−0',
      '  a.bin  binary',
      '  big.bin  oversized',
    ])
  })
})
