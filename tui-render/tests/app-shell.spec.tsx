/**
 * AppShell layout: the thin `─` separator under the top bar (02-UI-SPEC
 * L5, thin-only) and the title/badge slots above it. The separator spans
 * the window width derived from Ink's window size, so a resize re-lays it
 * out without absolute-column assumptions.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Box, renderToString, useWindowSize } from 'ink'
import { createElement } from 'react'
import { Text } from 'ink'
import { AppShell, layoutTitleBar } from '../src/app-shell.tsx'
import { displayWidth } from '../src/content.ts'
import { BRAND_APP_TITLE } from '../src/brand.ts'
import { applyTheme, styled } from '../src/theme.ts'
import { transformFrameChunk } from '../src/frame-fill.ts'

vi.mock('ink', async importOriginal => ({
  ...await importOriginal<typeof import('ink')>(),
  useWindowSize: vi.fn(() => ({ columns: 80, rows: 24 })),
}))

function shell(title: string, badge = 'provider · model'): string {
  return renderToString(
    createElement(
      AppShell,
      { title, badge },
      createElement(Text, null, 'body'),
    ),
  )
}

function centeredShell(content: string): string {
  return renderToString(createElement(
    AppShell,
    { title: 't', badge: 'p' },
    createElement(
      Box,
      { width: 20, alignSelf: 'center' },
      createElement(Text, null, content),
    ),
  ))
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

afterEach(() => { applyTheme('truecolor') })

describe('layoutTitleBar', () => {
  it('keeps both runs and fills the remainder with a gap', () => {
    expect(layoutTitleBar('你好', 'p · m', 20)).toEqual({
      title: '你好',
      badge: 'p · m',
      gap: 11,
    })
  })

  it('truncates the badge first when the title still fits', () => {
    const fitted = layoutTitleBar(
      '你好',
      'deepseek-official · deepseek-v4-flash',
      20,
    )
    expect(fitted.title).toBe('你好')
    expect(fitted.badge.endsWith('…')).toBe(true)
    expect(displayWidth(fitted.badge)).toBeLessThan(20)
    expect(
      displayWidth(fitted.title) + fitted.gap + displayWidth(fitted.badge),
    ).toBe(20)
  })

  it('truncates the title when the badge still fits and the title does not', () => {
    const fitted = layoutTitleBar('T'.repeat(80), 'ab', 80)
    expect(fitted.badge).toBe('ab')
    expect(fitted.title.endsWith('…')).toBe(true)
    expect(
      displayWidth(fitted.title) + fitted.gap + displayWidth(fitted.badge),
    ).toBe(80)
  })

  it('shrinks both runs when neither side has a remainder', () => {
    const fitted = layoutTitleBar('标题过长的会话', 'provider · model', 10)
    expect(
      displayWidth(fitted.title) + fitted.gap + displayWidth(fitted.badge),
    ).toBe(10)
    expect(fitted.title.includes('…') || fitted.badge.includes('…')
      || fitted.badge === '').toBe(true)
  })

  it('does not split a wide glyph and returns empty runs at zero columns', () => {
    expect(layoutTitleBar('你好世界', 'x', 5)).toEqual({
      title: '你…',
      badge: 'x',
      gap: 1,
    })
    expect(layoutTitleBar('a', 'b', 0)).toEqual({
      title: '',
      badge: '',
      gap: 0,
    })
    expect(layoutTitleBar('', 'abcdef', 2)).toEqual({
      title: '',
      badge: '…',
      gap: 1,
    })
    expect(layoutTitleBar('你好', 'xyz', 5)).toEqual({
      title: '你好',
      badge: '',
      gap: 1,
    })
  })
})

describe('AppShell', () => {
  it.each([
    ['truecolor', '\x1b[48;2;21;22;24m'],
    ['256', '\x1b[48;5;233m'],
    ['16', '\x1b[40m'],
  ] as const)('paints the complete AppShell output at the %s tier', (tier, bg) => {
    applyTheme(tier)
    const out = transformFrameChunk(centeredShell('CENTERED_BODY'), tier)
    expect(out.startsWith(bg)).toBe(true)
    expect(out).toContain(`${' '.repeat(30)}CENTERED_BODY`)
    expect(out.endsWith('\x1b[49m')).toBe(true)
  })

  it('uses the terminal default background without SGR at the none tier', () => {
    applyTheme('none')
    const out = shell('t')
    expect(out).not.toContain('\x1b[48;')
    expect(out).not.toContain('\x1b[40m')
  })

  it('preserves an explicit code background inside the root frame background', () => {
    const out = centeredShell(styled('code', 'codeBg'))
    expect(out).toContain('\x1b[48;2;32;35;40mcode')
  })

  it('draws a thin fgDim separator spanning the window below the top bar', () => {
    const out = shell('t')
    // renderToString reports the default 80-column window.
    expect(out).toContain('─'.repeat(80))
  })

  it('uses the thin line vocabulary only (no thick or box borders)', () => {
    const out = shell('t')
    expect(out).not.toContain('═')
    expect(out).not.toContain('║')
    expect(out).not.toContain('┌')
    expect(out).not.toContain('└')
  })

  it('renders a title row that never exceeds the window width', () => {
    const out = shell('你好'.repeat(20), 'deepseek-official · deepseek-v4-flash')
    const titleRow = stripAnsi(out).split('\n')[0] ?? ''
    expect(displayWidth(titleRow)).toBe(80)
    expect(titleRow.startsWith('你好')).toBe(true)
    expect(titleRow).toContain('…')
  })

  it('renders the title and badge above the separator', () => {
    const out = shell('beta', 'p · m')
    expect(out.indexOf('beta')).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('beta')).toBeLessThan(out.indexOf('─'.repeat(80)))
    expect(out).toContain('p · m')
  })

  it('paints the DeepSeek wordmark in accent on the brand title', () => {
    const out = shell(BRAND_APP_TITLE, 'p')
    expect(out).toContain('\x1b[38;2;77;107;254mDeepSeek')
    expect(stripAnsi(out)).toContain('deepseek-tui')
  })

  it('renders the exact wordmark without a trailing title run', () => {
    const out = shell('DeepSeek', '')
    expect(out).toContain('\x1b[38;2;77;107;254mDeepSeek')
  })

  it('omits title gap and separator cells at zero columns', () => {
    vi.mocked(useWindowSize).mockReturnValueOnce({ columns: 0, rows: 2 })
    expect(stripAnsi(shell('title', 'badge')).split('\n')[0]).toBe('')
  })
})
