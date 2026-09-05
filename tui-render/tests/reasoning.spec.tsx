/** Reasoning visibility and full-length, dim transcript rendering. */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { ReasoningBlock } from '../src/reasoning.tsx'
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

  it('hides the whole block without leaving a fold marker', () => {
    expect(render(true)).toBe('')
  })

  it('keeps visible reasoning readable without color', () => {
    applyTheme('none')
    const out = render(false)
    expect(out).toContain('✻ 思考 (1.2s)')
    expect(out).not.toContain('\x1b')
  })

  it('paints every streamed reasoning line without a local tail window', () => {
    const lines = Array.from(
      { length: 12 },
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
    expect(out).not.toContain('…')
    for (const line of lines) expect(out).toContain(line)
  })

  it('dumps the full body when expanded and not live', () => {
    const out = render(false, 'deep thinking\nsecond line')
    expect(out).toContain('deep thinking')
    expect(out).toContain('second line')
    expect(out).not.toContain('Ctrl+O 展开')
  })
})
