import { describe, expect, it } from 'vitest'
import { detectColorSupport } from '../src/terminal-capabilities.ts'
import { detectHyperlinks } from '../src/hyperlink.ts'
import { assertInteractiveTerminal, NON_INTERACTIVE_MESSAGE } from '../../tui/src/terminal-guard.ts'

function captureGuard() {
  const writes: string[] = []
  const stderr = { write: (chunk: string) => { writes.push(chunk) } }
  let code: number | undefined
  const exit = (next: number) => { code = next }
  return { writes, stderr, exit, code: () => code }
}

describe('UX-04 terminal capability matrix', () => {
  it('pins the iTerm2 env row', () => {
    expect(
      detectColorSupport({
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'iTerm.app',
        ITERM_SESSION_ID: 'w0t0p0',
      }),
    ).toBe('truecolor')
    expect(
      detectHyperlinks({
        TERM_PROGRAM: 'iTerm.app',
        ITERM_SESSION_ID: 'w0t0p0',
      }),
    ).toBe(true)
    const io = captureGuard()
    assertInteractiveTerminal(
      { isTTY: true, term: 'xterm-256color' },
      io.stderr,
      io.exit,
    )
    expect(io.writes).toEqual([])
    expect(io.code()).toBeUndefined()
  })

  it('pins the Ghostty env row', () => {
    expect(
      detectColorSupport({
        COLORTERM: 'truecolor',
        TERM: 'xterm-ghostty',
        TERM_PROGRAM: 'ghostty',
        GHOSTTY_RESOURCES_DIR: '/opt/ghostty',
      }),
    ).toBe('truecolor')
    expect(
      detectHyperlinks({
        TERM_PROGRAM: 'ghostty',
        GHOSTTY_RESOURCES_DIR: '/opt/ghostty',
      }),
    ).toBe(true)
  })

  it('pins the Kitty env row without widening truecolor detection', () => {
    expect(
      detectColorSupport({
        TERM: 'xterm-kitty',
        TERM_PROGRAM: 'kitty',
        KITTY_WINDOW_ID: '7',
      }),
    ).toBe('16')
    expect(
      detectHyperlinks({
        TERM_PROGRAM: 'kitty',
        KITTY_WINDOW_ID: '7',
      }),
    ).toBe(true)
  })

  it('pins the tmux env row through the forwarding probe only', () => {
    expect(
      detectColorSupport({
        TERM: 'tmux-256color',
        TMUX: '/tmp/tmux-1000/default,123,0',
      }),
    ).toBe('256')
    expect(
      detectHyperlinks(
        {
          TERM: 'tmux-256color',
          TMUX: '/tmp/tmux-1000/default,123,0',
        },
        () => true,
      ),
    ).toBe(true)
    expect(
      detectHyperlinks(
        {
          TERM: 'tmux-256color',
          TMUX: '/tmp/tmux-1000/default,123,0',
        },
        () => false,
      ),
    ).toBe(false)
  })

  it('pins the VS Code terminal env row', () => {
    expect(
      detectColorSupport({
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'vscode',
      }),
    ).toBe('256')
    expect(
      detectHyperlinks({
        TERM_PROGRAM: 'vscode',
      }),
    ).toBe(true)
  })

  it('pins the Alacritty env row and keeps non-interactive fallback plain text', () => {
    expect(
      detectColorSupport({
        TERM: 'alacritty',
        TERM_PROGRAM: 'alacritty',
      }),
    ).toBe('16')
    expect(
      detectHyperlinks({
        TERM_PROGRAM: 'alacritty',
      }),
    ).toBe(true)
    const io = captureGuard()
    assertInteractiveTerminal(
      { isTTY: false, term: 'alacritty' },
      io.stderr,
      io.exit,
    )
    expect(io.writes).toEqual([NON_INTERACTIVE_MESSAGE])
    expect(io.code()).toBe(0)
  })
})
