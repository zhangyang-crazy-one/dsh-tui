/**
 * ReasoningBlock fold surface: the collapsed marker carries the ▸ glyph and
 * the Ctrl+O hint so the fold is discoverable without trial (02-UI-SPEC
 * §1.3 L4 glyph + copy; A3 readable without color), expanded reasoning
 * renders dim, and an empty fold skips entirely.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { ReasoningBlock, REASONING_LIVE_TAIL } from '../src/reasoning.tsx'
import { applyTheme } from '../src/theme.ts'

afterEach(() => {
  applyTheme('truecolor')
})

function render(
  collapsed: boolean,
  text = 'deep thinking\nsecond line',
  durationMs = 1234,
): string {
  return renderToString(
    createElement(ReasoningBlock, {
      text,
      collapsed,
      durationMs,
    }),
  )
}

describe('ReasoningBlock', () => {
  it('skips an empty collapsed fold entirely', () => {
    expect(render(true, '')).toBe('')
  })

  it('shows expanded thinking dim', () => {
    expect(render(false)).toContain('deep thinking')
    expect(render(false)).toContain('second line')
  })

  it('marks the collapsed fold with ▸ and the Ctrl+O hint (L4/A3)', () => {
    const out = render(true)
    expect(out).toContain('▸ ✻ 思考 (1.2s) · 2 行 · Ctrl+O 展开')
    expect(out).toContain('\x1b[38;2;138;143;152m')
  })

  it('keeps the fold marker readable without color at none (A3)', () => {
    applyTheme('none')
    const out = render(true)
    expect(out).toContain('▸ ✻ 思考 (1.2s) · 2 行 · Ctrl+O 展开')
    expect(out).not.toContain('\x1b')
  })

  it('paints only the live tail while generating', () => {
    const lines = Array.from(
      { length: REASONING_LIVE_TAIL + 6 },
      (_, index) => `THINK_${index}`,
    )
    const out = renderToString(
      createElement(ReasoningBlock, {
        text: lines.join('\n'),
        collapsed: false,
        live: true,
        durationMs: 48800,
      }),
    )
    expect(out).toContain('✻ 思考 (48.8s)')
    expect(out).toContain('…')
    expect(out).not.toContain('THINK_0')
    expect(out).toContain(`THINK_${REASONING_LIVE_TAIL + 5}`)
  })

  it('dumps the full body when expanded and not live', () => {
    const out = render(false, 'deep thinking\nsecond line')
    expect(out).toContain('deep thinking')
    expect(out).toContain('second line')
    expect(out).not.toContain('Ctrl+O 展开')
  })
})
