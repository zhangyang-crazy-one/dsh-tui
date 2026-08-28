/**
 * Frame-fill (full-frame pure-black background): erase-in-line and the
 * visible-screen erase (`ESC[2J`) are bracketed with the tier's bg activator
 * so BCE terminals fill erased cells black. Scrollback wipe (`ESC[3J`) is
 * not bracketed. Entering the alternate screen triggers a full display
 * erase for never-painted rows, content bytes pass through untouched, and
 * the `none` tier keeps the zero-ANSI contract. The stdout wrapper delegates
 * every non-write property to the real stream.
 */

import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  hideFrameCaret,
  publishedCaretBytes,
  setFrameCaret,
  transformFrameChunk,
  wrapStdoutForFrameBg,
} from '../src/frame-fill.ts'

const TIERS = [
  { tier: 'truecolor', on: '\x1b[48;2;0;0;0m' },
  { tier: '256', on: '\x1b[48;5;16m' },
  { tier: '16', on: '\x1b[40m' },
] as const

describe('transformFrameChunk', () => {
  it('returns plain chunks before running any replacement scan', () => {
    const replaceAll = vi.spyOn(String.prototype, 'replaceAll')
    try {
      expect(transformFrameChunk('plain frame bytes', 'truecolor')).toBe('plain frame bytes')
      expect(replaceAll).not.toHaveBeenCalled()
    } finally {
      replaceAll.mockRestore()
    }
  })

  it.each(TIERS)('brackets eraseLine at the $tier tier', ({ tier, on }) => {
    const chunk = '\x1b[2K\x1b[1A\x1b[2Khello'
    expect(transformFrameChunk(chunk, tier)).toBe(
      on + '\x1b[2K\x1b[49m\x1b[1A' + on + '\x1b[2K\x1b[49mhello',
    )
  })

  it.each(TIERS)('brackets eraseEndLine at the $tier tier', ({ tier, on }) => {
    expect(transformFrameChunk('text\x1b[K', tier)).toBe(
      'text' + on + '\x1b[K\x1b[49m',
    )
  })

  it.each(TIERS)(
    'brackets the clearTerminal screen erase at the $tier tier',
    ({ tier, on }) => {
      // ansi-escapes clearTerminal: ESC[2J ESC[3J ESC[H. Only 2J fills the
      // visible screen; 3J is scrollback and must stay unbracketed so BCE
      // terminals do not paint the whole saved buffer on every overflow frame.
      expect(transformFrameChunk('\x1b[2J\x1b[3J\x1b[Hrow', tier)).toBe(
        `${on}\x1b[2J\x1b[49m\x1b[3J\x1b[Hrow`,
      )
    },
  )

  it('does not bracket eraseDown or a lone scrollback wipe', () => {
    expect(transformFrameChunk('\x1b[J\x1b[3J', 'truecolor')).toBe('\x1b[J\x1b[3J')
  })

  it('erases the display right after entering the alternate screen', () => {
    const out = transformFrameChunk('\x1b[?1049h\x1b[?25l', 'truecolor')
    expect(out).toBe(
      '\x1b[?1049h\x1b[48;2;0;0;0m\x1b[2J\x1b[H\x1b[49m\x1b[?25l',
    )
  })

  it('passes chunks through untouched at the none tier', () => {
    const chunk = '\x1b[2K\x1b[?1049hplain'
    expect(transformFrameChunk(chunk, 'none')).toBe(chunk)
  })

  it('leaves content bytes and non-erase sequences alone', () => {
    const chunk = '\x1b[38;2;255;0;0mred text\x1b[0m\x1b[?25h'
    expect(transformFrameChunk(chunk, 'truecolor')).toBe(chunk)
  })
})

describe('wrapStdoutForFrameBg', () => {
  function collect() {
    const chunks: string[] = []
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    })
    return { sink: sink as NodeJS.WriteStream, chunks }
  }

  it('transforms string writes at the current tier', () => {
    const { sink, chunks } = collect()
    const wrapped = wrapStdoutForFrameBg(sink, () => '256')
    wrapped.write('\x1b[2Krow')
    expect(chunks).toEqual(['\x1b[48;5;16m\x1b[2K\x1b[49mrow'])
  })

  it('passes non-string chunks through', () => {
    const { sink, chunks } = collect()
    const wrapped = wrapStdoutForFrameBg(sink, () => 'truecolor')
    wrapped.write(Buffer.from('\x1b[2Krow'))
    expect(chunks).toEqual(['\x1b[2Krow'])
  })

  it('delegates non-write properties to the wrapped stream', () => {
    const { sink } = collect()
    const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
    expect(wrapped.writable).toBe(sink.writable)
    expect(wrapped.destroyed).toBe(false)
  })
})

describe('caret anchoring', () => {
  it('appends the published caret after the frame suffix at the none tier too', () => {
    setFrameCaret({ up: 1, col: 13 })
    const out = transformFrameChunk('frame\x1b[?2026l', 'none')
    expect(out).toBe('frame\x1b[?2026l\x1b[1A\x1b[13G\x1b[?25h')
    // no styling bytes at the none tier, caret positioning excluded
    expect(out).not.toContain('\x1b[4')
  })

  it('skips the cursorUp when the caret is on the bottom row', () => {
    setFrameCaret({ up: 0, col: 5 })
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe(
      '\x1b[?2026l\x1b[5G\x1b[?25h',
    )
  })

  it('overrides Ink stale suffix because it is appended last', () => {
    setFrameCaret({ up: 1, col: 9 })
    const out = transformFrameChunk('row\x1b[1A\x1b[3G\x1b[?25h\x1b[?2026l', 'none')
    expect(out.endsWith('\x1b[?2026l\x1b[1A\x1b[9G\x1b[?25h')).toBe(true)
  })

  it('parks the cursor hidden while a panel owns the screen', () => {
    hideFrameCaret()
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe(
      '\x1b[?2026l\x1b[?25l',
    )
    setFrameCaret(undefined)
  })

  it('leaves frame chunks without a published caret unchanged', () => {
    setFrameCaret(undefined)
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe('\x1b[?2026l')
  })

  it('leaves non-frame chunks untouched', () => {
    setFrameCaret({ up: 1, col: 3 })
    expect(transformFrameChunk('plain text', 'none')).toBe('plain text')
    setFrameCaret(undefined)
  })

  it('exposes the published caret for mouse overlay restore', () => {
    expect(publishedCaretBytes()).toBe('')
    hideFrameCaret()
    expect(publishedCaretBytes()).toBe('\x1b[?25l')
    setFrameCaret({ up: 2, col: 4 })
    expect(publishedCaretBytes()).toBe('\x1b[2A\x1b[4G\x1b[?25h')
    setFrameCaret(undefined)
  })
})
