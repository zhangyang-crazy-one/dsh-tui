/** ANSI injection matrix: every content path escapes before rendering. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { MarkdownBlock, CodeBlock } from '../src/markdown.tsx'
import { ReasoningBlock } from '../src/reasoning.tsx'

const PAYLOADS = ['\x1b[2J', '\x1b]0;evil\x07', '\x07']

function assertEscaped(out: string): void {
  // The payloads must never reach the terminal verbatim; the renderer's own
  // styling sequences are its property (P5 layering), not content leakage.
  for (const payload of PAYLOADS) {
    expect(out).not.toContain(payload)
  }
  // The escaped literal form of the injected ESC payload must be visible.
  expect(out).toContain('\\x1b[2J')
}

describe('injection matrix', () => {
  it('escapes markdown text', () => {
    const out = renderToString(
      createElement(MarkdownBlock, { source: PAYLOADS.join(' between ') }),
    )
    assertEscaped(out)
    expect(out).toContain('\\x1b')
  })

  it('escapes code fence content', () => {
    const out = renderToString(
      createElement(CodeBlock, {
        source: `const evil = '${PAYLOADS[0]}'`,
        lang: 'ts',
      }),
    )
    assertEscaped(out)
  })

  it('escapes reasoning text', () => {
    const out = renderToString(
      createElement(ReasoningBlock, {
        text: PAYLOADS.join(' '),
        collapsed: false,
        durationMs: 100,
      }),
    )
    assertEscaped(out)
  })

  it('escapes payloads inside accent-styled emphasis (W2-T5 surface)', () => {
    const out = renderToString(
      createElement(MarkdownBlock, { source: `*${PAYLOADS[0]}*` }),
    )
    assertEscaped(out)
  })
})
