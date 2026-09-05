/**
 * Frame theme wiring (gap-audit blocker#1 / significant#3): the bg/fg token
 * runtime wiring through the frame — every AppShell row painted through the
 * bg strip with paired SGR resets (16-tier `\x1b[40m` never leaks into body
 * text), assistant body text defaulting to the fg token at every tier, user
 * rows left-aligned in the conversation column with an fgDim `>` marker, the
 * accent brightness matrix (bold current marker / plain accent marker /
 * plain accent marker / accentDim streaming cursor) in real render output,
 * and the PITFALLS L1 narrow-screen full-width fallback for the conversation
 * column. Four-tier byte assertions pin the pairing contract; stripAnsi
 * identity pins that every tier degrades to the same plain readable frame
 * (A3).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { Text } from 'ink'
import { AppShell } from '../src/app-shell.tsx'
import { StreamView, conversationWidth } from '../src/stream-view.tsx'
import { applyTheme, paintRow, styled } from '../src/theme.ts'
import type { ViewModel } from '../src/projection.ts'

afterEach(() => {
  applyTheme('truecolor')
})

/** Strip SGR sequences so content-level assertions ignore tier bytes. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

/** Render the shell frame at the installed tier. */
function renderShell(): string {
  return renderToString(
    createElement(AppShell, {
      title: '会话',
      badge: 'provider · model',
      children: createElement(Text, null, 'body'),
    }),
  )
}

/** Render one history user row at the installed tier. */
function renderUserRow(): string {
  return renderToString(
    createElement(StreamView, {
      model: {
        history: [{ kind: 'user', text: 'hello', timestamp: 1 }],
        activeTurn: undefined,
        status: 'idle',
        reasoningExpanded: false,
        toolCardsExpanded: false,
      } satisfies ViewModel,
    }),
  )
}

/** Render the generating active turn at the installed tier. */
function renderActiveTurn(): string {
  return renderToString(
    createElement(StreamView, {
      model: {
        history: [],
        activeTurn: {
          turn: 1,
          assistantText: 'answer',
          reasoningText: '',
          toolCalls: [],
          reasoningDurationMs: 100,
        },
        status: 'generating',
        reasoningExpanded: false,
        toolCardsExpanded: false,
      } satisfies ViewModel,
    }),
  )
}

describe('paintRow pairing', () => {
  it('wraps every part in the bg token with its own paired reset', () => {
    applyTheme('16')
    expect(paintRow([styled('> ', 'fgDim'), styled('hi', 'fg')])).toBe(
      '\x1b[40m\x1b[37m> \x1b[0m\x1b[0m\x1b[40m\x1b[37mhi\x1b[0m\x1b[0m',
    )
    applyTheme('truecolor')
    expect(paintRow([styled('● ', 'accent'), styled('body', 'fg')])).toContain(
      '\x1b[48;2;21;22;24m\x1b[38;2;77;107;254m● ',
    )
    applyTheme('256')
    expect(paintRow([styled('● ', 'accent'), styled('body', 'fg')])).toContain(
      '\x1b[48;5;233m\x1b[38;5;69m● ',
    )
    applyTheme('none')
    expect(paintRow([styled('● ', 'accent'), styled('body', 'fg')])).toBe(
      '● body',
    )
  })

  it('carries the bold accent tier without an extra reset', () => {
    expect(styled('● ', 'accent', '16', true)).toBe('\x1b[1m\x1b[94m● \x1b[0m')
    expect(styled('● ', 'accent', '256', true)).toBe(
      '\x1b[1m\x1b[38;5;69m● \x1b[0m',
    )
    expect(styled('● ', 'accent', 'truecolor', true)).toBe(
      '\x1b[1m\x1b[38;2;77;107;254m● \x1b[0m',
    )
    expect(styled('● ', 'accent', 'none', true)).toBe('● ')
  })
})

describe('AppShell frame painting', () => {
  it('paints the title and separator rows on the Soft Slate frame at every tier', () => {
    applyTheme('16')
    const sixteen = renderShell()
    // CJK-aware gap: 80 − 会话(4) − provider · model(16) = 60 columns.
    expect(sixteen).toContain(
      `\x1b[40m\x1b[37m会话\x1b[39m${' '.repeat(60)}\x1b[37mprovider · model\x1b[39m\x1b[49m`,
    )
    expect(sixteen).toContain(
      `\x1b[40m\x1b[90m${'─'.repeat(80)}\x1b[39m\x1b[49m`,
    )

    applyTheme('256')
    expect(renderShell()).toContain(
      '\x1b[48;5;233m\x1b[38;5;255m会话\x1b[39m',
    )

    applyTheme('truecolor')
    expect(renderShell()).toContain(
      '\x1b[48;2;21;22;24m\x1b[38;2;238;240;242m会话\x1b[39m',
    )

    applyTheme('none')
    expect(renderShell()).not.toContain('\x1b')
  })

  it('keeps the plain-text projection identical across all four tiers', () => {
    const plain: Record<string, string> = {}
    for (const tier of ['truecolor', '256', '16', 'none'] as const) {
      applyTheme(tier)
      plain[tier] = stripAnsi(renderShell())
    }
    const expected = plain.none
    expect(plain.truecolor).toBe(expected)
    expect(plain['256']).toBe(expected)
    expect(plain['16']).toBe(expected)
    expect(expected).toContain('会话')
    expect(expected).toContain('provider · model')
    expect(expected).toContain('─'.repeat(80))
  })
})

describe('StreamView body rows', () => {
  it('centers user rows on the Soft Slate message surface', () => {
    applyTheme('16')
    const sixteen = renderUserRow()
    const line = sixteen.split('\n').find(l => stripAnsi(l).includes('> hello'))
    expect(stripAnsi(line ?? '').trim()).toBe('> hello')
    const prefix = (line ?? '').slice(0, (line ?? '').indexOf('>'))
    expect(prefix).toContain('\x1b[40m')
    expect(line).toContain('\x1b[37m> hello')

    applyTheme('256')
    expect(renderUserRow()).toContain(
      '\x1b[48;5;235m\x1b[38;5;248m> \x1b[38;5;252mhello',
    )
    applyTheme('truecolor')
    expect(renderUserRow()).toContain(
      '\x1b[48;2;37;40;44m\x1b[38;2;164;169;176m> \x1b[38;2;209;212;216mhello',
    )
    applyTheme('none')
    expect(renderUserRow()).not.toContain('\x1b')
    expect(stripAnsi(renderUserRow())).toContain('> hello')
  })

  it('marks the current turn with the bold accent tier without a transcript cursor', () => {
    applyTheme('16')
    const active = renderActiveTurn()
    expect(active).toContain(
      '\x1b[40m\x1b[1m\x1b[94m● \x1b[22m\x1b[37manswer\x1b[39m\x1b[49m',
    )
    expect(stripAnsi(active)).toContain('● answer')
    expect(stripAnsi(active)).not.toContain('▌')

    applyTheme('none')
    expect(renderActiveTurn().trimStart()).toBe(
      '● answer',
    )
  })

  it('keeps the streaming body readable at 256 and truecolor', () => {
    applyTheme('256')
    expect(renderActiveTurn()).toContain(
      '\x1b[1m\x1b[38;5;105m● \x1b[22m\x1b[38;5;255manswer',
    )
    applyTheme('truecolor')
    expect(renderActiveTurn()).toContain(
      '\x1b[1m\x1b[38;2;117;137;255m● \x1b[22m\x1b[38;2;238;240;242manswer',
    )
  })

  it('never leaks an unpaired 16-tier background into body text', () => {
    applyTheme('16')
    const out = renderUserRow() + renderActiveTurn()
    // Every `\x1b[40m` strip is closed by a `\x1b[49m` before the next row.
    const opens = out.match(/\x1b\[40m/g)?.length ?? 0
    const closes = out.match(/\x1b\[49m/g)?.length ?? 0
    expect(opens).toBe(closes)
    // Body fg runs are always paired with their 39 reset.
    const fgOpens = out.match(/\x1b\[37m/g)?.length ?? 0
    const fgCloses = out.match(/\x1b\[39m/g)?.length ?? 0
    expect(fgOpens).toBeGreaterThan(0)
    expect(fgCloses).toBe(fgOpens)
  })
})

describe('conversation column width', () => {
  it('uses two-column gutters on wide terminals', () => {
    expect(conversationWidth(0)).toBe(1)
    expect(conversationWidth(1)).toBe(1)
    expect(conversationWidth(10)).toBe(10)
    expect(conversationWidth(39)).toBe(39)
    expect(conversationWidth(40)).toBe(36)
    expect(conversationWidth(79)).toBe(75)
    expect(conversationWidth(80)).toBe(76)
    expect(conversationWidth(88)).toBe(84)
    expect(conversationWidth(123)).toBe(119)
    expect(conversationWidth(200)).toBe(196)
  })
})
