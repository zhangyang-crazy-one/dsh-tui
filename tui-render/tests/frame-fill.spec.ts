/**
 * Frame-fill (full-frame pure-black background): every colored-tier string
 * write keeps bg active across centered spaces, content resets, and visible
 * erases. Scrollback wipe (`ESC[3J`) temporarily uses the terminal default.
 * Entering the alternate screen triggers a full display erase, while the
 * `none` tier keeps the zero-ANSI contract.
 */

import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  countWrittenCells,
  hideFrameCaret,
  publishedCaretBytes,
  setFrameCaret,
  setFrameRail,
  transformFrameChunk,
  wrapStdoutForFrameBg,
} from '../src/frame-fill.ts'
import { createFrameMetrics, markDeltaIngress } from '../src/frame-metrics.ts'
import { ScreenAtlas } from '../src/screen-atlas.ts'
import {
  createFrameSnapshotRow,
  setVisibleFrameSnapshot,
} from '../src/frame-snapshot.ts'
import { createPhysicalLine } from '../src/physical-line.ts'
import { setHyperlinks } from '../src/hyperlink.ts'

const TIERS = [
  { tier: 'truecolor', on: '\x1b[48;2;0;0;0m' },
  { tier: '256', on: '\x1b[48;5;16m' },
  { tier: '16', on: '\x1b[40m' },
] as const

describe('transformFrameChunk', () => {
  it('paints plain chunks without running any replacement scan', () => {
    const replaceAll = vi.spyOn(String.prototype, 'replaceAll')
    try {
      expect(transformFrameChunk('plain frame bytes', 'truecolor')).toBe(
        '\x1b[48;2;0;0;0mplain frame bytes\x1b[49m',
      )
      expect(replaceAll).not.toHaveBeenCalled()
    } finally {
      replaceAll.mockRestore()
    }
  })

  it.each(TIERS)('paints eraseLine at the $tier tier', ({ tier, on }) => {
    const chunk = '\x1b[2K\x1b[1A\x1b[2Khello'
    expect(transformFrameChunk(chunk, tier)).toBe(
      on + chunk + '\x1b[49m',
    )
  })

  it.each(TIERS)('paints eraseEndLine at the $tier tier', ({ tier, on }) => {
    expect(transformFrameChunk('text\x1b[K', tier)).toBe(
      on + 'text\x1b[K\x1b[49m',
    )
  })

  it.each(TIERS)(
    'brackets the clearTerminal screen erase at the $tier tier',
    ({ tier, on }) => {
      // ansi-escapes clearTerminal: ESC[2J ESC[3J ESC[H. Only 2J fills the
      // visible screen; 3J is scrollback and must stay unbracketed so BCE
      // terminals do not paint the whole saved buffer on every overflow frame.
      expect(transformFrameChunk('\x1b[2J\x1b[3J\x1b[Hrow', tier)).toBe(
        `${on}\x1b[2J\x1b[49m\x1b[3J${on}\x1b[Hrow\x1b[49m`,
      )
    },
  )

  it('keeps visible erase black and protects a scrollback wipe', () => {
    const on = '\x1b[48;2;0;0;0m'
    expect(transformFrameChunk('\x1b[J\x1b[3J', 'truecolor')).toBe(
      `${on}\x1b[J\x1b[49m\x1b[3J${on}\x1b[49m`,
    )
  })

  it('erases the display right after entering the alternate screen', () => {
    const out = transformFrameChunk('\x1b[?1049h\x1b[?25l', 'truecolor')
    expect(out).toBe(
      '\x1b[48;2;0;0;0m\x1b[?1049h\x1b[48;2;0;0;0m\x1b[2J\x1b[H\x1b[?25l\x1b[49m',
    )
  })

  it('passes chunks through untouched at the none tier', () => {
    const chunk = '\x1b[2K\x1b[?1049hplain'
    expect(transformFrameChunk(chunk, 'none')).toBe(chunk)
  })

  it('restores the frame background after content resets', () => {
    const chunk = '\x1b[38;2;255;0;0mred text\x1b[0m\x1b[?25h'
    const on = '\x1b[48;2;0;0;0m'
    expect(transformFrameChunk(chunk, 'truecolor')).toBe(
      `${on}\x1b[38;2;255;0;0mred text\x1b[0m${on}\x1b[?25h\x1b[49m`,
    )
  })

  it('keeps centered gutters black across reset-separated physical rows', () => {
    const on = '\x1b[48;2;0;0;0m'
    const gutter = ' '.repeat(12)
    const chunk = `${gutter}Hero\x1b[0m\n${gutter}Composer`
    expect(transformFrameChunk(chunk, 'truecolor')).toBe(
      `${on}${gutter}Hero\x1b[0m${on}\n${gutter}Composer\x1b[49m`,
    )
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
    expect(chunks).toEqual(['\x1b[48;5;16m\x1b[2Krow\x1b[49m'])
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

  it('counts printable cells and records the next write callback as drain', async () => {
    const { sink } = collect()
    const metrics = createFrameMetrics()
    markDeltaIngress(metrics, performance.now() - 5)
    const wrapped = wrapStdoutForFrameBg(sink, () => 'none', metrics)
    await new Promise<void>((resolve, reject) => {
      wrapped.write('\x1b[31m中a\x1b[0m\n', (error) => {
        if (error !== undefined && error !== null) reject(error)
        else resolve()
      })
    })
    expect(metrics.snapshot().writtenCells.total).toBe(3)
    expect(metrics.snapshot().deltaIngressToStdoutDrainMs.count).toBe(1)
  })
})

describe('countWrittenCells', () => {
  it('excludes CSI, OSC 8, cursor controls, and line breaks', () => {
    expect(countWrittenCells('\x1b[2J\x1b]8;;https://example.com\x07中a\x1b]8;;\x07\r\n')).toBe(3)
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

describe('fixed-column transcript rail', () => {
  it('paints a one-column terminal without a left guard cell', () => {
    setFrameRail({ col: 1, topRow: 1, rows: 1, thumbStart: 0, thumbRows: 1 })
    const out = transformFrameChunk('\x1b[?2026l', 'none')
    expect(out).toContain('\x1b[1;1H█')
    expect(out).not.toContain('\x1b[1;0H')
    setFrameRail(undefined)
  })

  it('paints every rail cell at the absolute column across a VS16 emoji row', () => {
    const atlas = new ScreenAtlas(40, 8)
    setFrameRail({
      col: 40,
      topRow: 3,
      rows: 4,
      thumbStart: 1,
      thumbRows: 2,
    })
    const frame = '\x1b[4;1H## ⚠️ 两点说明\x1b[?2026l'
    atlas.feed(transformFrameChunk(frame, 'none'))

    expect(atlas.cellAt(40, 3)?.ch).toBe('·')
    expect(atlas.cellAt(40, 4)?.ch).toBe('█')
    expect(atlas.cellAt(40, 5)?.ch).toBe('█')
    expect(atlas.cellAt(40, 6)?.ch).toBe('·')
    expect(atlas.cellAt(39, 4)?.ch).not.toBe('█')
  })

  it('clears the prior track when overflow disappears and restores the caret last', () => {
    const atlas = new ScreenAtlas(20, 6)
    setFrameRail({
      col: 20,
      topRow: 2,
      rows: 3,
      thumbStart: 0,
      thumbRows: 3,
    })
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))
    setFrameRail(undefined)
    setFrameCaret({ up: 0, col: 4 })
    const cleared = transformFrameChunk('\x1b[?2026l', 'none')
    atlas.feed(cleared)

    expect(atlas.cellAt(20, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 3)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 4)?.ch).toBe(' ')
    expect(atlas.cellAt(19, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(19, 3)?.ch).toBe(' ')
    expect(atlas.cellAt(19, 4)?.ch).toBe(' ')
    expect(cleared.endsWith('\x1b[4G\x1b[?25h')).toBe(true)
    setFrameCaret(undefined)
  })

  it('clears a wide-glyph guard and the old column when the rail moves', () => {
    const atlas = new ScreenAtlas(20, 6)
    atlas.feed('\x1b[2;19H前')
    setFrameRail({ col: 20, topRow: 2, rows: 1, thumbStart: 0, thumbRows: 1 })
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))

    expect(atlas.cellAt(19, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 2)?.ch).toBe('█')

    setFrameRail({ col: 18, topRow: 2, rows: 1, thumbStart: 0, thumbRows: 1 })
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))

    expect(atlas.cellAt(19, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(17, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(18, 2)?.ch).toBe('█')
    setFrameRail(undefined)
  })
})

describe('transcript differential clearing', () => {
  const geometry = {
    columns: 20,
    rows: 6,
    transcriptTop: 2,
    transcriptLeft: 2,
    transcriptWidth: 18,
    transcriptRows: 3,
  }
  const snapshot = (revision: string, text: string) => ({
    revision,
    geometry,
    rows: [createFrameSnapshotRow({
      id: 'tail:0',
      row: 2,
      col: 2,
      line: createPhysicalLine({
        blockId: 'tail',
        spans: [{ text, token: 'fg' as const }],
        sourceStart: 0,
        sourceEnd: text.length,
        blockRow: 0,
      }),
    })],
  })
  const positionedRow = (id: string, terminalRow: number, text: string) => createFrameSnapshotRow({
    id,
    row: terminalRow,
    col: 2,
    line: createPhysicalLine({
      blockId: id,
      spans: [{ text, token: 'fg' }],
      sourceStart: 0,
      sourceEnd: text.length,
      blockRow: 0,
    }),
  })

  it('inserts an absolute stale-tail clear before rail/sync and caret restoration', () => {
    setVisibleFrameSnapshot(snapshot('long', 'abcdef'))
    transformFrameChunk('frame\x1b[?2026l', 'none')
    setFrameRail({ col: 20, topRow: 2, rows: 1, thumbStart: 0, thumbRows: 1 })
    setFrameCaret({ up: 0, col: 4 })
    setVisibleFrameSnapshot(snapshot('short', 'ab'))
    const out = transformFrameChunk('next\x1b[?2026l', 'none')
    const clear = out.indexOf('\x1b[2;4H    ')
    const rail = out.indexOf('\x1b[2;20H')
    const sync = out.indexOf('\x1b[?2026l')
    const caret = out.lastIndexOf('\x1b[4G')
    expect(clear).toBeGreaterThan(out.indexOf('next'))
    expect(rail).toBeGreaterThan(clear)
    expect(sync).toBeGreaterThan(rail)
    expect(caret).toBeGreaterThan(sync)
    setVisibleFrameSnapshot(undefined)
    setFrameRail(undefined)
    setFrameCaret(undefined)
  })

  it('does not clear a screen row that a different transcript row now occupies', () => {
    const atlas = new ScreenAtlas(20, 6)
    setVisibleFrameSnapshot({
      revision: 'before-scroll',
      geometry,
      rows: [positionedRow('a', 2, 'AAAA'), positionedRow('b', 3, 'BBBB')],
    })
    atlas.feed(transformFrameChunk(
      '\x1b[2;2HAAAA\x1b[3;2HBBBB\x1b[?2026l',
      'none',
    ))

    setVisibleFrameSnapshot({
      revision: 'after-scroll',
      geometry,
      rows: [positionedRow('b', 2, 'BBBB'), positionedRow('c', 3, 'CCCC')],
    })
    atlas.feed(transformFrameChunk(
      '\x1b[2;2HBBBB\x1b[3;2HCCCC\x1b[?2026l',
      'none',
    ))

    expect(atlas.extract({ col: 2, row: 2 }, { col: 5, row: 2 })).toBe('BBBB')
    expect(atlas.extract({ col: 2, row: 3 }, { col: 5, row: 3 })).toBe('CCCC')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('repaints a changed snapshot row when the Ink frame omits its cells', () => {
    const atlas = new ScreenAtlas(20, 6)
    setVisibleFrameSnapshot({
      revision: 'before-scroll',
      geometry,
      rows: [positionedRow('a', 2, 'AAAA'), positionedRow('b', 3, 'BBBB')],
    })
    atlas.feed(transformFrameChunk(
      '\x1b[2;2HAAAA\x1b[3;2HBBBB\x1b[?2026l',
      'none',
    ))

    setVisibleFrameSnapshot({
      revision: 'after-scroll',
      geometry,
      rows: [positionedRow('b', 2, 'BBBB'), positionedRow('c', 3, 'CCCC')],
    })
    atlas.feed(transformFrameChunk(
      '\x1b[2;2H    \x1b[3;2HCCCC\x1b[?2026l',
      'none',
    ))

    expect(atlas.extract({ col: 2, row: 2 }, { col: 5, row: 2 })).toBe('BBBB')
    expect(atlas.extract({ col: 2, row: 3 }, { col: 5, row: 3 })).toBe('CCCC')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('scrubs transcript cells outside the current snapshot for a new repaint key', () => {
    const atlas = new ScreenAtlas(20, 6)
    setVisibleFrameSnapshot({
      revision: 'settled',
      geometry,
      rows: [positionedRow('settled', 4, 'DONE')],
    })
    atlas.feed(transformFrameChunk('\x1b[4;2HDONE\x1b[?2026l', 'none'))

    atlas.feed('\x1b[2;2HSTALE\x1b[3;2HTAIL')
    setVisibleFrameSnapshot({
      revision: 'settled',
      repaintKey: 'assistant-turn-1',
      geometry,
      rows: [positionedRow('settled', 4, 'DONE')],
    })
    atlas.feed(transformFrameChunk('\x1b[?25l', 'none'))
    expect(atlas.extract({ col: 2, row: 2 }, { col: 6, row: 2 })).toBe('STALE')
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))

    expect(atlas.extract({ col: 2, row: 2 }, { col: 6, row: 2 })).toBe('')
    expect(atlas.extract({ col: 2, row: 3 }, { col: 5, row: 3 })).toBe('')
    expect(atlas.extract({ col: 2, row: 4 }, { col: 5, row: 4 })).toBe('DONE')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('emits no full scrub for an empty transcript region', () => {
    setVisibleFrameSnapshot({
      revision: 'empty',
      repaintKey: 'assistant-turn-empty',
      geometry: {
        ...geometry,
        transcriptRows: 0,
      },
      rows: [],
    })
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe('\x1b[?2026l')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('repaints snapshot-owned code background and OSC 8 spans', () => {
    setHyperlinks(true)
    try {
      setVisibleFrameSnapshot({
        revision: 'linked-code-row',
        geometry,
        rows: [createFrameSnapshotRow({
          id: 'linked-code-row',
          row: 2,
          col: 2,
          line: createPhysicalLine({
            blockId: 'linked-code-row',
            spans: [{ text: 'doc', token: 'accent', href: 'https://example.test' }],
            sourceStart: 0,
            sourceEnd: 3,
            blockRow: 0,
            background: 'codeBg',
          }),
        })],
      })
      const out = transformFrameChunk('\x1b[?2026l', 'truecolor')
      expect(out).toContain('\x1b]8;;https://example.test\x1b\\')
      expect(out).toContain('doc')
    } finally {
      setVisibleFrameSnapshot(undefined)
      transformFrameChunk('\x1b[?2026l', 'none')
      setHyperlinks(false)
    }
  })
})
