import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertInteractiveTerminal, NON_INTERACTIVE_MESSAGE } from '../src/terminal-guard.ts'

function capture() {
  const writes: string[] = []
  const stderr = { write: (chunk: string) => { writes.push(chunk) } }
  let code: number | undefined
  const exit = (c: number) => { code = c }
  return { writes, stderr, exit, code: () => code }
}

describe('assertInteractiveTerminal', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('passes through a TTY with a real TERM', () => {
    const io = capture()
    assertInteractiveTerminal({ isTTY: true, term: 'xterm-256color' }, io.stderr, io.exit)
    expect(io.writes).toEqual([])
    expect(io.code()).toBeUndefined()
  })

  it('declines with plain text when stdout is not a TTY', () => {
    const io = capture()
    assertInteractiveTerminal({ isTTY: false, term: 'xterm-256color' }, io.stderr, io.exit)
    expect(io.writes).toEqual([NON_INTERACTIVE_MESSAGE])
    expect(io.code()).toBe(0)
    expect(io.writes[0]).not.toContain('\x1b')
  })

  it('declines when TERM is dumb even on a TTY', () => {
    const io = capture()
    assertInteractiveTerminal({ isTTY: true, term: 'dumb' }, io.stderr, io.exit)
    expect(io.writes).toEqual([NON_INTERACTIVE_MESSAGE])
    expect(io.code()).toBe(0)
  })

  it('uses the default process exit adapter on decline', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const writes: string[] = []
    assertInteractiveTerminal(
      { isTTY: false, term: 'xterm' },
      { write: (chunk) => { writes.push(chunk) } },
    )
    expect(exit).toHaveBeenCalledWith(0)
    expect(writes).toEqual([NON_INTERACTIVE_MESSAGE])
  })
})
