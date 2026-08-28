/**
 * Goal footer formatting: `目标 {phase} {n}/{max} · {objective}` with the host
 * phase key untranslated, the objective escaped and column-truncated with a
 * trailing `…`, and no fragment at all when no goal is current (D-06).
 */

import { describe, expect, it } from 'vitest'
import { formatGoalFooter, goalFooterHead, goalFooterRuns } from '../src/goal-footer.ts'
import { displayWidth } from '../src/content.ts'

describe('goal footer', () => {
  it('formats the exact fragment with the untranslated host phase', () => {
    expect(
      formatGoalFooter(
        { phase: 'active', objective: '落地 Phase 6 入口', maxGoalRounds: 8, roundsStarted: 2 },
        40,
      ),
    ).toBe('目标 active 2/8 · 落地 Phase 6 入口')
  })

  it('returns undefined when no goal is current', () => {
    expect(formatGoalFooter(undefined, 40)).toBeUndefined()
    expect(formatGoalFooter(null, 40)).toBeUndefined()
    expect(goalFooterRuns(undefined, 40)).toBeUndefined()
  })

  it('escapes CSI in the objective instead of passing it through', () => {
    const formatted = formatGoalFooter(
      { phase: 'active', objective: '清屏\x1b[2J', maxGoalRounds: 3, roundsStarted: 0 },
      40,
    )
    expect(formatted).toBeDefined()
    expect(formatted).not.toContain('\x1b')
    expect(formatted).toContain('\\x1b')
  })

  it('truncates the objective to the column budget with a trailing …', () => {
    const formatted = formatGoalFooter(
      { phase: 'paused', objective: '一二三四五六七八九十', maxGoalRounds: 3, roundsStarted: 0 },
      6,
    )
    expect(formatted).toBe('目标 paused 0/3 · 一二…')
    expect(displayWidth('一二…')).toBeLessThanOrEqual(6)
  })

  it('exposes the unescaped head for status-row budgeting', () => {
    expect(
      goalFooterHead({ phase: 'blocked', objective: 'x', maxGoalRounds: 5, roundsStarted: 4 }),
    ).toBe('目标 blocked 4/5')
  })

  it('splits the runs so the status row can paint the head and objective apart', () => {
    expect(
      goalFooterRuns(
        { phase: 'active', objective: 'obj', maxGoalRounds: 8, roundsStarted: 2 },
        40,
      ),
    ).toEqual({ head: '目标 active 2/8', objective: 'obj' })
  })
})
