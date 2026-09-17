import { describe, expect, it } from 'vitest'
import {
  formatStickyThinkingLabel,
  formatStickyToolLabel,
  formatStickyUserLabel,
  resolveStickyThinkingHeader,
  resolveStickyTranscriptHeader,
} from '../src/sticky-header.ts'

describe('resolveStickyThinkingHeader', () => {
  const range = { start: 10, end: 40, turnOrdinal: 3, durationMs: 14_200 }

  it('formats the divider label with turn ordinal and duration', () => {
    expect(formatStickyThinkingLabel(range)).toBe(
      '💭 思考中 (第 3 轮 · 14.2s) · [Ctrl+O 折叠]',
    )
  })

  it('is silent while the reasoning header itself is the top visible row', () => {
    expect(resolveStickyThinkingHeader(10, [range])).toBeUndefined()
  })

  it('projects the sticky label once the header has scrolled off', () => {
    expect(resolveStickyThinkingHeader(11, [range])).toBe(
      '💭 思考中 (第 3 轮 · 14.2s) · [Ctrl+O 折叠]',
    )
    expect(resolveStickyThinkingHeader(39, [range])).toBe(
      '💭 思考中 (第 3 轮 · 14.2s) · [Ctrl+O 折叠]',
    )
  })

  it('reverts once the viewport leaves the reasoning body', () => {
    expect(resolveStickyThinkingHeader(9, [range])).toBeUndefined()
    expect(resolveStickyThinkingHeader(40, [range])).toBeUndefined()
  })
})

describe('resolveStickyTranscriptHeader', () => {
  const reasoning = { start: 10, end: 40, turnOrdinal: 3, durationMs: 14_200 }
  const tool = { start: 42, end: 50, title: 'ls -la /tmp/workspace' }
  const user = { start: 0, end: 4, text: 'fix the tool push\nplease' }

  it('formats tool and user divider labels', () => {
    expect(formatStickyToolLabel(tool)).toBe('▸ ls -la /tmp/workspace')
    expect(formatStickyUserLabel(user)).toBe('> fix the tool push please')
  })

  it('prefers a reasoning body over a tool body and a scrolled-off prompt', () => {
    expect(resolveStickyTranscriptHeader(12, {
      reasoning: [reasoning],
      tools: [tool],
      users: [user],
    })).toBe('💭 思考中 (第 3 轮 · 14.2s) · [Ctrl+O 折叠]')
  })

  it('projects a tool heading once the viewport is inside the card body', () => {
    expect(resolveStickyTranscriptHeader(43, {
      tools: [tool],
      users: [user],
    })).toBe('▸ ls -la /tmp/workspace')
    expect(resolveStickyTranscriptHeader(42, { tools: [tool] })).toBeUndefined()
    expect(resolveStickyTranscriptHeader(50, { tools: [tool] })).toBeUndefined()
  })

  it('pins the latest user prompt after tools have pushed it fully off-screen', () => {
    expect(resolveStickyTranscriptHeader(4, { users: [user], tools: [tool] })).toBe(
      '> fix the tool push please',
    )
    expect(resolveStickyTranscriptHeader(48, { users: [user] })).toBe(
      '> fix the tool push please',
    )
  })

  it('stays silent while the latest user prompt is still the top visible row', () => {
    expect(resolveStickyTranscriptHeader(0, { users: [user] })).toBeUndefined()
    expect(resolveStickyTranscriptHeader(3, { users: [user] })).toBeUndefined()
  })
})
