/**
 * CommandMenu width fallback: Ink's useWindowSize can report 0 columns
 * before a TTY size exists; the palette then uses 80.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderToString, useWindowSize } from 'ink'
import { createElement } from 'react'
import { CommandMenu } from '../src/command-menu.tsx'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useWindowSize: vi.fn(() => ({ columns: 80, rows: 24 })),
  }
})

describe('CommandMenu window width', () => {
  it('falls back to 80 columns when the window reports 0', () => {
    vi.mocked(useWindowSize).mockReturnValueOnce({ columns: 0, rows: 24 })
    const out = renderToString(
      createElement(CommandMenu, {
        items: [{ name: 'help', description: 'Show command help' }],
        query: '',
      }),
    )
    expect(out).toContain('/help')
    expect(out).toContain('Show command help')
  })

  it('paints the controlled selected command', () => {
    const out = renderToString(
      createElement(CommandMenu, {
        items: [
          { name: 'help', description: 'Show command help' },
          { name: 'plan', description: 'Open plan mode' },
        ],
        query: '',
        selectedIndex: 1,
      }),
    )
    const plain = stripAnsi(out)
    expect(plain).toContain('› /plan')
    expect(plain).not.toContain('› /help')
  })
})
