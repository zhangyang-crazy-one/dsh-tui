/** SessionPane rendering: rows, selection marker, injection escaping, windowing. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPane, relativeTime } from '../src/session-pane.tsx'
import type { SessionRow } from '../src/session-pane.tsx'

const NOW = 1_700_000_000_000

function rows(...titles: string[]): SessionRow[] {
  return titles.map((title, index) => ({
    id: SessionId(`session-${index}`),
    title,
    updatedAt: NOW - index * 60_000,
  }))
}

function directoryRows(count: number): SessionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: SessionId(`session-${index}`),
    title: `row-${index.toString().padStart(3, '0')}`,
    updatedAt: NOW - index,
  }))
}

function visibleRowNumbers(output: string): number[] {
  return [...output.matchAll(/row-(\d{3})/g)].map(match => Number(match[1]))
}

function renderPane(props: Partial<Parameters<typeof SessionPane>[0]>): string {
  return renderToString(
    createElement(SessionPane, {
      rows: [],
      selectedIndex: 0,
      currentId: undefined,
      confirmDelete: false,
      now: NOW,
      ...props,
    }),
  )
}

describe('SessionPane', () => {
  it('renders the rows with titles, the selection marker, and the live marker', () => {
    const out = renderPane({
      rows: rows('alpha', 'beta', 'gamma'),
      selectedIndex: 1,
      currentId: SessionId('session-1'),
    })
    expect(out).toContain('alpha')
    expect(out).toContain('beta')
    expect(out).toContain('gamma')
    expect(out).toContain('› ')
    expect(out).toContain('当前')
    expect(out).toContain('会话 ID · session-1')
    expect(out).toContain('↑↓/jk 选择')
  })

  it('styles the selected prefix bold accent and the live marker accentDim', () => {
    const out = renderPane({
      rows: rows('alpha', 'beta'),
      selectedIndex: 0,
      currentId: SessionId('session-0'),
    })
    // The strong tier of the accent brightness matrix (bold) marks the
    // highlighted row; the live marker drops to the low-light tier.
    expect(out).toContain('\x1b[1m\x1b[38;2;77;107;254m› ')
    expect(out).toContain('\x1b[38;2;52;65;91m · 当前')
    expect(out).not.toContain('\x1b[1m\x1b[38;2;77;107;254mbeta')
  })

  it('renders the full escaped currentId independently from the title', () => {
    const out = renderPane({
      rows: [{
        id: SessionId('session-parent-001'),
        title: 'duplicate title',
        updatedAt: NOW,
      }, {
        id: SessionId('session-parent-002'),
        title: 'duplicate title',
        updatedAt: NOW - 1,
      }],
      selectedIndex: 0,
      currentId: SessionId('session-parent-002'),
    })
    expect(out).toContain('会话 ID · session-parent-002')
    expect(out).not.toContain('会话 ID · session-parent-001')
  })

  it('escapes CSI in the currentId carrier row', () => {
    const out = renderPane({
      rows: [{
        id: SessionId('session-\x1b[2J'),
        title: 'alpha',
        updatedAt: NOW,
      }],
      currentId: SessionId('session-\x1b[2J'),
    })
    expect(out).toContain('会话 ID · session-\\x1b[2J')
    expect(out).not.toContain('\x1b[2J')
  })

  it('escapes ANSI injected through a persisted title', () => {
    const out = renderPane({
      rows: rows('\u001b[31mred\u001b[0m'),
    })
    expect(out).not.toContain('\u001b[31m')
    expect(out).toContain('\\x1b')
    expect(out).toContain('red')
  })

  it('windows to the newest 50 rows and shows the truncation hint', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `s-${index}`,
      title: `row ${index}`,
      updatedAt: NOW - index,
    }))
    const out = renderPane({ rows: many })
    expect(out).toContain('row 0')
    expect(out).not.toContain('row 59')
    expect(out).toContain('还有 10 个会话')
  })

  it.each([
    { selectedIndex: -10, expectedSelectedIndex: 0, expectedStart: 0 },
    { selectedIndex: 0, expectedSelectedIndex: 0, expectedStart: 0 },
    { selectedIndex: 50, expectedSelectedIndex: 50, expectedStart: 25 },
    { selectedIndex: 75, expectedSelectedIndex: 75, expectedStart: 50 },
    { selectedIndex: 100, expectedSelectedIndex: 100, expectedStart: 51 },
    { selectedIndex: 500, expectedSelectedIndex: 100, expectedStart: 51 },
  ])(
    'centers and clamps the 50-row window for absolute selection $selectedIndex',
    ({ selectedIndex, expectedSelectedIndex, expectedStart }) => {
      const out = renderPane({
        rows: directoryRows(101),
        selectedIndex,
      })
      const expectedRows = Array.from(
        { length: 50 },
        (_, index) => expectedStart + index,
      )
      expect(visibleRowNumbers(out)).toEqual(expectedRows)
      const selectedTitle = `row-${expectedSelectedIndex.toString().padStart(3, '0')}`
      const selectedLine = out
        .split('\n')
        .find(line => line.includes(selectedTitle))
      expect(selectedLine).toContain('› ')
    },
  )

  it('shows the delete confirmation on the armed row', () => {
    const out = renderPane({
      rows: rows('alpha'),
      confirmDelete: true,
    })
    expect(out).toContain('再按 d 确认删除「alpha」')
  })

  it('styles the delete confirmation and the unavailable state in error', () => {
    const armed = renderPane({
      rows: rows('alpha'),
      confirmDelete: true,
      selectedIndex: 0,
    })
    expect(armed).toContain('\x1b[38;2;239;68;68m再按 d 确认删除「alpha」')
    const unavailable = renderPane({
      rows: rows('alpha'),
      deleteUnavailable: true,
    })
    expect(unavailable).toContain('\x1b[38;2;239;68;68m删除不可用（后端能力缺失）')
  })

  it('escapes ANSI injected through the delete-confirmation title', () => {
    const out = renderPane({
      rows: rows('\u001b[31malpha\u001b[0m'),
      confirmDelete: true,
      selectedIndex: 0,
    })
    expect(out).not.toContain('\u001b[31m')
    expect(out).toContain('\\x1b')
    expect(out).toContain('alpha')
  })

  it('styles the footer in fgDim', () => {
    const out = renderPane({ rows: rows('alpha') })
    expect(out).toContain('\x1b[38;2;138;143;152m↑↓/jk 选择')
  })

  it('shows the unavailable state when the delete capability is missing (K6)', () => {
    const out = renderPane({
      rows: rows('alpha'),
      deleteUnavailable: true,
    })
    expect(out).toContain('删除不可用（后端能力缺失）')
    expect(out).not.toContain('再按 d 确认删除')
  })

  it('renders the empty state and a title-less delete confirmation', () => {
    const out = renderPane({ rows: [], confirmDelete: true })
    expect(out).toContain('无会话')
    expect(out).toContain('再按 d 确认删除「」')
  })

  it('falls back to the wall clock when no now is supplied', () => {
    const out = renderPane({ rows: rows('alpha'), now: undefined })
    expect(out).toContain('alpha')
  })

  it('labels relative times in the terminal vocabulary', () => {
    expect(relativeTime(NOW, NOW)).toBe('刚刚')
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前')
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2 小时前')
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 天前')
  })
})
