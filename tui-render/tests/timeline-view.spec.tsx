/** TimelineView rendering: relative timestamps, first lines, injection escaping. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { TimelineView, TIMELINE_WINDOW } from '../src/timeline-view.tsx'
import type { FrozenMessage } from '../src/projection.ts'

const NOW = 1_700_000_000_000

function renderTimeline(
  history: readonly FrozenMessage[],
  now = NOW,
  offset = 0,
): string {
  return renderToString(createElement(TimelineView, { history, now, offset }))
}

describe('TimelineView', () => {
  it('renders the empty state and uses the default clock', () => {
    const out = renderToString(createElement(TimelineView, { history: [] }))
    expect(out).toContain('（无历史消息）')
  })

  it('truncates a long first line', () => {
    const out = renderTimeline([
      { kind: 'assistant', text: 'x'.repeat(130), timestamp: NOW },
    ])
    const plain = out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '').replace(/\s+/g, '')
    expect(plain).toContain(`${'x'.repeat(120)}…`)
    expect(plain).not.toContain('x'.repeat(121))
  })
  it('renders one row per message with the relative age and the first line', () => {
    const out = renderTimeline([
      { kind: 'user', text: '第一轮问题', timestamp: NOW - 2 * 60_000 },
      { kind: 'assistant', text: '第一轮回答', timestamp: NOW - 60_000 },
      { kind: 'user', text: '第二轮问题', timestamp: NOW },
    ])
    expect(out).toContain('2 分钟前')
    expect(out).toContain('> 第一轮问题')
    expect(out).toContain('1 分钟前')
    expect(out).toContain('● 第一轮回答')
    expect(out).toContain('刚刚')
    expect(out).toContain('第二轮问题')
  })

  it('shows only the first line of a multi-line message', () => {
    const out = renderTimeline([
      { kind: 'user', text: '第一行\n第二行\n第三行', timestamp: NOW },
    ])
    expect(out).toContain('第一行')
    expect(out).not.toContain('第二行')
  })

  it('escapes ANSI injected through a message', () => {
    const out = renderTimeline([
      { kind: 'assistant', text: '\u001b[31mred\u001b[0m reply', timestamp: NOW },
    ])
    expect(out).not.toContain('\u001b[31m')
    expect(out).toContain('\\x1b')
    expect(out).toContain('red')
  })

  it('styles the current (newest visible) message in accent and the footer in fgDim', () => {
    const out = renderTimeline([
      { kind: 'user', text: 'older', timestamp: NOW - 60_000 },
      { kind: 'assistant', text: 'newest', timestamp: NOW },
    ])
    expect(out).toContain('\x1b[38;2;77;107;254mnewest')
    expect(out).not.toContain('\x1b[38;2;77;107;254molder')
    expect(out).toContain('\x1b[38;2;164;169;176m↑↓/jk 滚动 · Esc 关闭')
  })

  it('leaves the newest message unstyled when scrolled away from the tail', () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      kind: 'assistant' as const,
      text: `message ${index}`,
      timestamp: NOW - (64 - index),
    }))
    const out = renderTimeline(many, NOW, 3)
    // Offset 3 hides the log tail, so no row is current and none is accented.
    expect(out).not.toContain('\x1b[38;2;77;107;254mmessage')
  })

  it('windows to the newest 60 rows with a truncation hint (K3)', () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      kind: 'assistant' as const,
      text: `message ${index}`,
      timestamp: NOW - (64 - index),
    }))
    const out = renderTimeline(many)
    // Newest rows first in the window: 64 down to 5 (line-suffixed so
    // `message 4` cannot match `message 40`).
    expect(out).toContain('\x1b[38;2;77;107;254mmessage 64')
    expect(out).toContain('message 5\n')
    expect(out).not.toContain('message 4\n')
    expect(out).toContain('还有 5 条')
    expect(out).toContain('↑↓/jk 滚动 · Esc 关闭')
  })

  it('shifts the window backward with the offset (K3)', () => {
    const many = Array.from({ length: 65 }, (_, index) => ({
      kind: 'user' as const,
      text: `message ${index}`,
      timestamp: NOW - (64 - index),
    }))
    const out = renderTimeline(many, NOW, 3)
    // Offset 3: the window covers 2..61 (hint counts the older 2 rows).
    expect(out).toContain('message 61\n')
    expect(out).toContain('message 2\n')
    expect(out).not.toContain('message 62\n')
    expect(out).not.toContain('message 1\n')
    expect(out).toContain('还有 2 条')
  })

  it('exposes the 60-row window constant', () => {
    expect(TIMELINE_WINDOW).toBe(60)
  })
})
