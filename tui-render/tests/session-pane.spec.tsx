/** SessionPane rendering: rows, selection marker, injection escaping, windowing. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { stripTerminalControls as stripAnsi } from './helpers.ts'
import { displayWidth } from '../src/content.ts'
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
      columns: 80,
      maxRows: 52,
      ...props,
    }),
  )
}

describe('SessionPane', () => {
  it('reserves the current marker, age, and distinct ids before shortening a long title', () => {
    const title = '很长的混合标题 with identifier '.repeat(8)
    const out = stripAnsi(renderPane({
      rows: [{ id: SessionId('session-aaaaaaaa-1'), title, updatedAt: NOW },
        { id: SessionId('session-bbbbbbbb-2'), title, updatedAt: NOW }],
      currentId: SessionId('session-aaaaaaaa-1'),
    }))
    const lines = out.split('\n')
    expect(lines[0]).toContain('aaaaaaaa')
    expect(lines[0]).toContain('刚刚 · 当前')
    expect(lines.find(line => line.includes('bbbbbbbb'))).toContain('刚刚')
    expect(lines.every(line => displayWidth(line) <= 80)).toBe(true)
    expect(lines).toHaveLength(4)
  })

  it('fits the centered directory and its controls in the supplied content rows', () => {
    const out = stripAnsi(renderPane({
      rows: directoryRows(101), selectedIndex: 75,
      currentId: SessionId('session-75'), maxRows: 12,
    }))
    expect(out.split('\n')).toHaveLength(12)
    expect(out).toContain('› row-075')
    expect(out).toContain('会话 ID · session-75')
    expect(out).toContain('还有 92 个会话')
    expect(out).toContain('↑↓/jk 选择')
  })

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

  it('disambiguates duplicate titles inline with stable session id hints', () => {
    const out = renderPane({
      rows: [{
        id: SessionId('session-81b9ecc6-b2d0-4b95-ae02-7a51353ed27c'),
        title: '你好',
        updatedAt: NOW,
      }, {
        id: SessionId('session-7fe21234-5356-405a-9e50-000f22c657f9'),
        title: '你好',
        updatedAt: NOW - 1,
      }, {
        id: SessionId('session-unique'),
        title: '独立标题',
        updatedAt: NOW - 2,
      }],
    })
    expect(out).toContain('你好 · 81b9ecc6')
    expect(out).toContain('你好 · 7fe21234')
    expect(out).toContain('独立标题')
    expect(out).not.toContain('独立标题 · unique')
  })

  it('extends shared id prefixes and falls back to raw ids after prefix removal collides', () => {
    const out = renderPane({
      rows: [{
        id: SessionId('session-81b9ecc6-aaaaaaaa'),
        title: 'shared prefix',
        updatedAt: NOW,
      }, {
        id: SessionId('session-81b9ecc6-bbbbbbbb'),
        title: 'shared prefix',
        updatedAt: NOW - 1,
      }, {
        id: SessionId('session-shared-id'),
        title: 'normalized collision',
        updatedAt: NOW - 2,
      }, {
        id: SessionId('shared-id'),
        title: 'normalized collision',
        updatedAt: NOW - 3,
      }],
    })
    expect(out).toContain('shared prefix · 81b9ecc6-a')
    expect(out).toContain('shared prefix · 81b9ecc6-b')
    expect(out).toContain('normalized collision · session-')
    expect(out).toContain('normalized collision · shared-i')
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
    expect(armed).toContain('\x1b[38;2;226;125;119m再按 d 确认删除「alpha」')
    const unavailable = renderPane({
      rows: rows('alpha'),
      deleteUnavailable: true,
    })
    expect(unavailable).toContain('\x1b[38;2;226;125;119m删除不可用（后端能力缺失）')
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
    expect(out).toContain('\x1b[38;2;164;169;176m↑↓/jk 选择')
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
