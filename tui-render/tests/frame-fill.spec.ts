/**
 * Frame-fill (full-frame Soft Slate background): every colored-tier string
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
  releaseFrameRail,
  transformFrameChunk,
  writePublishedFrameRail,
  writePublishedFrameSnapshot,
  wrapStdoutForFrameBg,
} from '../src/frame-fill.ts'
import { createFrameMetrics, markDeltaIngress, markScrollInput } from '../src/frame-metrics.ts'
import { ScreenAtlas } from '../src/screen-atlas.ts'
import {
  createFrameSnapshotRow,
  setVisibleFrameSnapshot,
} from '../src/frame-snapshot.ts'
import { createPhysicalLine } from '../src/physical-line.ts'
import { setHyperlinks } from '../src/hyperlink.ts'

const TIERS = [
  { tier: 'truecolor', on: '\x1b[48;2;21;22;24m' },
  { tier: '256', on: '\x1b[48;5;233m' },
  { tier: '16', on: '\x1b[40m' },
] as const

describe('transformFrameChunk', () => {
  it('paints plain chunks without running any replacement scan', () => {
    const replaceAll = vi.spyOn(String.prototype, 'replaceAll')
    try {
      expect(transformFrameChunk('plain frame bytes', 'truecolor')).toBe(
        '\x1b[48;2;21;22;24mplain frame bytes\x1b[49m',
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

  it('keeps visible erase themed and protects a scrollback wipe', () => {
    const on = '\x1b[48;2;21;22;24m'
    expect(transformFrameChunk('\x1b[J\x1b[3J', 'truecolor')).toBe(
      `${on}\x1b[J\x1b[49m\x1b[3J${on}\x1b[49m`,
    )
  })

  it('erases the display right after entering the alternate screen', () => {
    const out = transformFrameChunk('\x1b[?1049h\x1b[?25l', 'truecolor')
    expect(out).toBe(
      '\x1b[48;2;21;22;24m\x1b[?1049h\x1b[48;2;21;22;24m\x1b[2J\x1b[H\x1b[?25l\x1b[49m',
    )
  })

  it('passes chunks through untouched at the none tier', () => {
    const chunk = '\x1b[2K\x1b[?1049hplain'
    expect(transformFrameChunk(chunk, 'none')).toBe(chunk)
  })

  it('restores the frame background after content resets', () => {
    const chunk = '\x1b[38;2;255;0;0mred text\x1b[0m\x1b[?25h'
    const on = '\x1b[48;2;21;22;24m'
    expect(transformFrameChunk(chunk, 'truecolor')).toBe(
      `${on}\x1b[38;2;255;0;0mred text\x1b[0m${on}\x1b[?25h\x1b[49m`,
    )
  })

  it('keeps centered gutters themed across reset-separated physical rows', () => {
    const on = '\x1b[48;2;21;22;24m'
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
    expect(chunks).toEqual(['\x1b[48;5;233m\x1b[2Krow\x1b[49m'])
  })

  it('decodes and transforms Buffer writes through the same boundary', () => {
    const { sink, chunks } = collect()
    const wrapped = wrapStdoutForFrameBg(sink, () => 'truecolor')
    wrapped.write(Buffer.from('\x1b[2Krow'))
    expect(chunks).toEqual(['\x1b[48;2;21;22;24m\x1b[2Krow\x1b[49m'])
  })

  it('delegates non-write properties to the wrapped stream', () => {
    const { sink } = collect()
    const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
    expect(wrapped.writable).toBe(sink.writable)
    expect(wrapped.destroyed).toBe(false)
  })

  it('starts Ink erasure at the terminal bottom, not the published composer caret', () => {
    const { sink, chunks } = collect()
    Object.assign(sink, { isTTY: true, rows: 24, columns: 80 })
    const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
    const atlas = new ScreenAtlas(80, 24)
    try {
      setFrameCaret({ row: 20, col: 5 })
      atlas.feed('\x1b[21;1Hold command menu\x1b[24;1Hold footer\x1b[20;5H')
      wrapped.write('\x1b[?2026h')
      wrapped.write(`${'\x1b[2K\x1b[1A'.repeat(23)}\x1b[2K\x1b[GNew pane`)
      wrapped.write('\x1b[?2026l')
      atlas.feed(chunks.join(''))
      expect(atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })).toBe(`New pane${'\n'.repeat(23)}`)
      expect(atlas.cursorPosition).toEqual({ row: 20, col: 5 })
    } finally {
      setFrameCaret(undefined)
    }
  })

  it('does not reposition the cursor between Ink hiding it and writing its first frame', () => {
    const { sink, chunks } = collect()
    Object.assign(sink, { isTTY: true, rows: 24, columns: 80 })
    const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
    const atlas = new ScreenAtlas(80, 24)
    try {
      setFrameCaret({ row: 23, col: 5 })
      wrapped.write('\x1b[?2026h')
      wrapped.write('\x1b[?25l')
      wrapped.write(`FIRST_FRAME${'\n'.repeat(23)}FOOTER`)
      wrapped.write('\x1b[?2026l')
      atlas.feed(chunks.join(''))
      expect(atlas.extract({ col: 1, row: 1 }, { col: 80, row: 1 })).toBe('FIRST_FRAME')
      expect(atlas.extract({ col: 1, row: 24 }, { col: 80, row: 24 })).toBe('FOOTER')
      expect(atlas.cursorPosition).toEqual({ row: 23, col: 5 })
    } finally { setFrameCaret(undefined) }
  })

  it('erases the old 24-row frame from its own bottom when the terminal grows to 42 rows', () => {
    const { sink, chunks } = collect()
    Object.assign(sink, { isTTY: true, rows: 24, columns: 80 })
    const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
    const atlas = new ScreenAtlas(80, 24)
    try {
      setFrameCaret({ row: 23, col: 5 })
      wrapped.write(`OLD${'\n'.repeat(23)}FOOTER\x1b[?2026l`)
      atlas.feed(chunks.splice(0).join(''))
      Object.assign(sink, { rows: 42, columns: 112 })
      atlas.resize(112, 42)
      setFrameCaret({ row: 41, col: 5 })
      wrapped.write(`\x1b[?2026h${'\x1b[2K\x1b[1A'.repeat(23)}\x1b[2K\x1b[GNEW${'\n'.repeat(40)}> INPUT\nSTATUS\x1b[?2026l`)
      atlas.feed(chunks.join(''))
      expect(atlas.extract({ col: 1, row: 1 }, { col: 112, row: 1 })).toBe('NEW')
      expect(atlas.extract({ col: 1, row: 41 }, { col: 112, row: 41 })).toBe('> INPUT')
      expect(atlas.cursorPosition).toEqual({ row: 41, col: 5 })
    } finally { setFrameCaret(undefined) }
  })

  it('releases a former rail before a replacement pane paints its final columns', () => {
    try {
      setFrameRail({ col: 80, topRow: 3, rows: 16, thumbStart: 0, thumbRows: 2 })
      transformFrameChunk('\x1b[?2026l', 'none')
      releaseFrameRail()
      const next = transformFrameChunk('\x1b[3;77H当前\x1b[?2026l', 'none')
      const atlas = new ScreenAtlas(80, 24)
      atlas.feed(next)
      expect(atlas.extract({ col: 77, row: 3 }, { col: 80, row: 3 })).toBe('当前')
    } finally {
      setFrameRail(undefined)
      transformFrameChunk('\x1b[?2026l', 'none')
    }
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
    await new Promise<void>((resolve) => {
      wrapped.write('\x1b[?2026l', () => { resolve() })
    })
    await new Promise<void>((resolve) => {
      wrapped.write('\x1b[?2026l', () => { resolve() })
    })
    expect(metrics.snapshot().frameIntervalMs.count).toBe(1)
  })
})

describe('countWrittenCells', () => {
  it('does not join graphemes across cursor-addressed rows', () => {
    expect(countWrittenCells('👩\x1b[2;1H\u200d💻')).toBe(4)
    expect(countWrittenCells('👩\x1b[31m\u200d💻\x1b[0m')).toBe(2)
  })
  it('excludes CSI, OSC 8, cursor controls, and line breaks', () => {
    expect(countWrittenCells('\x1b[2J\x1b]8;;https://example.com\x07中a\x1b]8;;\x07\r\n')).toBe(3)
  })
})

describe('caret anchoring', () => {
  it('keeps the composer row after repeated independent rail and selection writes', () => {
    const atlas = new ScreenAtlas(80, 24)
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        atlas.feed(String(chunk))
        callback()
      },
    }) as NodeJS.WriteStream
    setFrameCaret({ row: 21, col: 5 })
    setFrameRail({ col: 80, topRow: 3, rows: 16, thumbStart: 2, thumbRows: 3 })
    try {
      atlas.feed('\x1b[24;1H')
      atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))
      writePublishedFrameRail(sink, 'none')
      writePublishedFrameRail(sink, 'none')
      atlas.feed(publishedCaretBytes())
      // Probe the terminal's actual cursor, without a second geometry oracle.
      atlas.feed('!')
      expect(atlas.cellAt(5, 21)?.ch).toBe('!')
    } finally {
      setFrameCaret(undefined)
      setFrameRail(undefined)
      transformFrameChunk('\x1b[?2026l', 'none')
    }
  })

  it('appends the published caret after the frame suffix at the none tier too', () => {
    setFrameCaret({ row: 23, col: 13 })
    const out = transformFrameChunk('frame\x1b[?2026l', 'none')
    expect(out).toBe('frame\x1b[23;13H\x1b[?25h\x1b[?2026l')
    // no styling bytes at the none tier, caret positioning excluded
    expect(out).not.toContain('\x1b[4')
  })

  it('uses absolute coordinates for the bottom-row caret', () => {
    setFrameCaret({ row: 24, col: 5 })
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe(
      '\x1b[24;5H\x1b[?25h\x1b[?2026l',
    )
  })

  it('overrides Ink stale suffix because it is appended last', () => {
    setFrameCaret({ row: 23, col: 9 })
    const out = transformFrameChunk('row\x1b[1A\x1b[3G\x1b[?25h\x1b[?2026l', 'none')
    expect(out.endsWith('\x1b[23;9H\x1b[?25h\x1b[?2026l')).toBe(true)
  })

  it('parks the cursor hidden while a panel owns the screen', () => {
    hideFrameCaret()
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe(
      '\x1b[?25l\x1b[?2026l',
    )
    setFrameCaret(undefined)
  })

  it('leaves frame chunks without a published caret unchanged', () => {
    setFrameCaret(undefined)
    expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe('\x1b[?2026l')
  })

  it('leaves non-frame chunks untouched', () => {
    setFrameCaret({ row: 23, col: 3 })
    expect(transformFrameChunk('plain text', 'none')).toBe('plain text')
    setFrameCaret(undefined)
  })

  it('exposes the published caret for mouse overlay restore', () => {
    expect(publishedCaretBytes()).toBe('')
    hideFrameCaret()
    expect(publishedCaretBytes()).toBe('\x1b[?25l')
    setFrameCaret({ row: 22, col: 4 })
    expect(publishedCaretBytes()).toBe('\x1b[22;4H\x1b[?25h')
    setFrameCaret(undefined)
  })
})

describe('fixed-column transcript rail', () => {
  it('preserves the new composer and footer when a 112x42 transcript shrinks to 80x24', () => {
    const atlas = new ScreenAtlas(112, 42)
    const publish = (columns: number, rows: number, transcriptRows: number) => {
      setVisibleFrameSnapshot({
        revision: `${columns}x${rows}`,
        geometry: {
          columns, rows, transcriptTop: 3, transcriptLeft: 3,
          transcriptWidth: columns - 4, transcriptRows,
        },
        rows: Array.from({ length: transcriptRows }, (_, index) => createFrameSnapshotRow({
          id: `row-${index}`, row: index + 3, col: 3,
          line: createPhysicalLine({
            blockId: 'history', blockRow: index,
            sourceStart: 0, sourceEnd: columns - 4,
            spans: [{ text: 'T'.repeat(columns - 4), token: 'fg' }],
          }),
        })),
      })
      setFrameRail({ col: columns, topRow: 3, rows: transcriptRows, thumbStart: 0, thumbRows: 2 })
    }
    try {
      publish(112, 42, 34)
      atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))
      atlas.resize(80, 24)
      publish(80, 24, 16)
      const next = transformFrameChunk(
        '\x1b[2J\x1b[1;1HHEADER\x1b[21;1HINPUT\x1b[24;1HSTATUS\x1b[?2026l',
        'none',
      )
      atlas.feed(next)
      expect(atlas.extract({ col: 1, row: 21 }, { col: 5, row: 21 })).toBe('INPUT')
      expect(atlas.extract({ col: 1, row: 24 }, { col: 6, row: 24 })).toBe('STATUS')
      for (const match of next.matchAll(/\x1b\[(\d+);(\d+)H/gu)) {
        expect(Number(match[1])).toBeLessThanOrEqual(24)
        expect(Number(match[2])).toBeLessThanOrEqual(80)
      }
    } finally {
      setVisibleFrameSnapshot(undefined)
      setFrameRail(undefined)
      transformFrameChunk('\x1b[?2026l', 'none')
    }
  })

  it('publishes layout-only rail updates inside one synchronized-output frame', () => {
    const chunks: string[] = []
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    }) as NodeJS.WriteStream
    setFrameRail({ col: 20, topRow: 2, rows: 2, thumbStart: 1, thumbRows: 1 })
    writePublishedFrameRail(sink, 'none')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatch(/^\x1b\[\?2026h[\s\S]*\x1b\[\?2026l$/u)
    setFrameRail(undefined)
  })

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
    setFrameCaret({ row: 6, col: 4 })
    const cleared = transformFrameChunk('\x1b[?2026l', 'none')
    atlas.feed(cleared)

    expect(atlas.cellAt(20, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 3)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 4)?.ch).toBe(' ')
    expect(atlas.cellAt(19, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(19, 3)?.ch).toBe(' ')
    expect(atlas.cellAt(19, 4)?.ch).toBe(' ')
    expect(cleared.endsWith('\x1b[6;4H\x1b[?25h\x1b[?2026l')).toBe(true)
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

  it('clears vacated rows when the track shifts within the same column', () => {
    const atlas = new ScreenAtlas(20, 6)
    setFrameRail({ col: 20, topRow: 2, rows: 4, thumbStart: 0, thumbRows: 2 })
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))
    expect(atlas.cellAt(20, 2)?.ch).toBe('█')
    expect(atlas.cellAt(20, 5)?.ch).toBe('·')
    setFrameRail({ col: 20, topRow: 4, rows: 2, thumbStart: 0, thumbRows: 1 })
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))
    expect(atlas.cellAt(20, 2)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 3)?.ch).toBe(' ')
    expect(atlas.cellAt(20, 4)?.ch).toBe('█')
    setFrameRail(undefined)
  })

  it('writes to direct stream when overlay writer is undefined', () => {
    const sink: string[] = []
    const directStream = new Writable({
      write(chunk, _encoding, callback) {
        sink.push(String(chunk))
        callback()
      },
    }) as unknown as NodeJS.WriteStream
    releaseFrameRail()
    setVisibleFrameSnapshot(undefined)
    writePublishedFrameRail(directStream, 'none')
    writePublishedFrameSnapshot(directStream, 'none')
    expect(sink).toEqual([])

    setFrameRail({ col: 20, topRow: 2, rows: 2, thumbStart: 0, thumbRows: 1 })
    writePublishedFrameRail(directStream, 'none')
    expect(sink.join('')).toContain('\x1b[2;20H█')
    sink.length = 0
    setVisibleFrameSnapshot({
      revision: 'direct',
      geometry: {
        columns: 20,
        rows: 6,
        transcriptTop: 2,
        transcriptLeft: 2,
        transcriptWidth: 18,
        transcriptRows: 3,
      },
      rows: [createFrameSnapshotRow({
        id: 'd1',
        row: 2,
        col: 2,
        line: createPhysicalLine({
          blockId: 'd1',
          spans: [{ text: 'DIRECT', token: 'fg' as const }],
          sourceStart: 0,
          sourceEnd: 6,
          blockRow: 0,
        }),
      })],
    })
    writePublishedFrameSnapshot(directStream, 'none')
    expect(sink.join('')).toContain('DIRECT')

    sink.length = 0
    const metrics = createFrameMetrics()
    const wrapped = wrapStdoutForFrameBg(directStream, () => 'none', metrics)
    writePublishedFrameRail(wrapped, 'none')
    expect(sink.join('')).toContain('\x1b[2;20H█')
    sink.length = 0
    setVisibleFrameSnapshot({
      revision: 'wrapped-diff',
      geometry: {
        columns: 20,
        rows: 6,
        transcriptTop: 2,
        transcriptLeft: 2,
        transcriptWidth: 18,
        transcriptRows: 3,
      },
      rows: [createFrameSnapshotRow({
        id: 'w1',
        row: 2,
        col: 2,
        line: createPhysicalLine({
          blockId: 'w1',
          spans: [{ text: 'WRAPPED', token: 'fg' as const }],
          sourceStart: 0,
          sourceEnd: 7,
          blockRow: 0,
        }),
      })],
    })
    writePublishedFrameSnapshot(wrapped, 'none')
    expect(sink.join('')).toContain('WRAPPED')

    setFrameRail(undefined)
    setVisibleFrameSnapshot(undefined)
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
    setFrameCaret({ row: 6, col: 4 })
    setVisibleFrameSnapshot(snapshot('short', 'ab'))
    const out = transformFrameChunk('next\x1b[?2026l', 'none')
    const clear = out.indexOf('\x1b[2;4H    ')
    const rail = out.indexOf('\x1b[2;20H')
    const sync = out.indexOf('\x1b[?2026l')
    const caret = out.lastIndexOf('\x1b[6;4H')
    expect(clear).toBeGreaterThan(out.indexOf('next'))
    expect(rail).toBeGreaterThan(clear)
    expect(sync).toBeGreaterThan(rail)
    expect(caret).toBeGreaterThan(rail)
    expect(caret).toBeLessThan(sync)
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

    atlas.feed('\x1b[2;1HLEFT\x1b[3;17HRIGHT')
    setFrameRail({ col: 20, topRow: 2, rows: 2, thumbStart: 0, thumbRows: 1 })
    setVisibleFrameSnapshot({
      revision: 'settled',
      repaintKey: 'assistant-turn-1',
      geometry,
      rows: [positionedRow('settled', 4, 'DONE')],
    })
    atlas.feed(transformFrameChunk('\x1b[?25l', 'none'))
    expect(atlas.extract({ col: 1, row: 2 }, { col: 3, row: 2 })).toBe('LEF')
    expect(atlas.cellAt(20, 3)?.ch).toBe('·')
    atlas.feed(transformFrameChunk('\x1b[?2026l', 'none'))

    expect(atlas.extract({ col: 2, row: 2 }, { col: 6, row: 2 })).toBe('')
    expect(atlas.extract({ col: 2, row: 3 }, { col: 5, row: 3 })).toBe('')
    expect(atlas.extract({ col: 1, row: 2 }, { col: 1, row: 2 })).toBe('')
    expect(atlas.cellAt(20, 2)?.ch).toBe('█')
    expect(atlas.cellAt(20, 3)?.ch).toBe('·')
    expect(atlas.extract({ col: 2, row: 4 }, { col: 5, row: 4 })).toBe('DONE')
    setFrameRail(undefined)
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

  it('repaints a snapshot-owned message surface through its full row width', () => {
    setVisibleFrameSnapshot({
      revision: 'message-surface-row',
      geometry,
      rows: [createFrameSnapshotRow({
        id: 'message-surface-row',
        row: 2,
        col: 2,
        line: createPhysicalLine({
          blockId: 'message-surface-row',
          spans: [{ text: '> hello', token: 'fgSoft' }],
          sourceStart: 0,
          sourceEnd: 5,
          blockRow: 0,
          background: 'messageBg',
          backgroundColumns: 12,
        }),
      })],
    })
    const out = transformFrameChunk('\x1b[?2026l', 'truecolor')
    expect(out).toContain('\x1b[48;2;37;40;44m')
    expect(out).toContain('     \x1b[0m')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('pads row with theme background up to guard column during incremental updates', () => {
    const geo = {
      columns: 20,
      rows: 6,
      transcriptTop: 2,
      transcriptLeft: 2,
      transcriptWidth: 17,
      transcriptRows: 3,
      rail: { col: 20, topRow: 2, rows: 3, thumbStart: 0, thumbRows: 1 },
    }
    setVisibleFrameSnapshot({
      revision: 'init',
      geometry: geo,
      rows: [createFrameSnapshotRow({
        id: 'r1',
        row: 2,
        col: 2,
        line: createPhysicalLine({
          blockId: 'r1',
          spans: [{ text: 'SHORT', token: 'fg' as const }],
          sourceStart: 0,
          sourceEnd: 5,
          blockRow: 0,
        }),
      })],
    })
    transformFrameChunk('\x1b[?2026l', 'truecolor')

    setVisibleFrameSnapshot({
      revision: 'next',
      geometry: geo,
      rows: [createFrameSnapshotRow({
        id: 'r1',
        row: 2,
        col: 2,
        line: createPhysicalLine({
          blockId: 'r1',
          spans: [{ text: 'CHANGED', token: 'fg' as const }],
          sourceStart: 0,
          sourceEnd: 7,
          blockRow: 0,
        }),
      })],
    })
    const out = transformFrameChunk('\x1b[?2026l', 'truecolor')
    expect(out).toContain('\x1b[2;9H\x1b[48;2;21;22;24m          ')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('pads to guard cell on a one-column terminal without left guard', () => {
    const geometry1 = {
      columns: 1,
      rows: 2,
      transcriptTop: 1,
      transcriptLeft: 1,
      transcriptWidth: 1,
      transcriptRows: 1,
    }
    setVisibleFrameSnapshot({
      revision: 'col-1-a',
      geometry: geometry1,
      rows: [createFrameSnapshotRow({
        id: 'c1',
        row: 1,
        col: 1,
        line: createPhysicalLine({
          blockId: 'c1',
          spans: [{ text: 'x', token: 'fg' as const }],
          sourceStart: 0,
          sourceEnd: 1,
          blockRow: 0,
        }),
      })],
    })
    transformFrameChunk('\x1b[?2026l', 'none')
    setVisibleFrameSnapshot({
      revision: 'col-1-b',
      geometry: geometry1,
      rows: [createFrameSnapshotRow({
        id: 'c1',
        row: 1,
        col: 1,
        line: createPhysicalLine({
          blockId: 'c1',
          spans: [{ text: 'y', token: 'fg' as const }],
          sourceStart: 0,
          sourceEnd: 1,
          blockRow: 0,
        }),
      })],
    })
    const out = transformFrameChunk('\x1b[?2026l', 'none')
    expect(out).toContain('\x1b[1;1Hy')
    setVisibleFrameSnapshot({
      revision: 'col-1-c',
      geometry: geometry1,
      rows: [],
    })
    const cleared = transformFrameChunk('\x1b[?2026l', 'none')
    expect(cleared).toContain('\x1b[1;1H')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })

  it('defers forced repaint until synchronized frame ends', () => {
    setVisibleFrameSnapshot({
      revision: 'forced-sync',
      geometry,
      rows: [positionedRow('forced-sync', 2, 'SYNC')],
    })
    const out = transformFrameChunk('\x1b[?25h', 'none')
    expect(out).not.toContain('SYNC')
    const flushed = transformFrameChunk('\x1b[?2026l', 'none')
    expect(flushed).toContain('SYNC')
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  })
})

it('keeps Ink’s logical bottom across repeated sparse incremental frames and caret overlays', () => {
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 24, columns: 80 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const atlas = new ScreenAtlas(80, 24)
  try {
    setFrameCaret({ row: 22, col: 5 })
    wrapped.write(`HEADER${'\n'.repeat(23)}FOOTER\x1b[?2026l`)
    atlas.feed(chunks.splice(0).join(''))
    for (const text of ['first', 'second', 'third']) {
      wrapped.write(`\x1b[?2026h\x1b[23A\x1b[E\x1b[G${text}\x1b[K\n${'\x1b[E'.repeat(21)}\x1b[?2026l`)
      atlas.feed(chunks.splice(0).join(''))
      expect(atlas.extract({ col: 1, row: 1 }, { col: 80, row: 1 })).toBe('HEADER')
      expect(atlas.extract({ col: 1, row: 2 }, { col: 80, row: 2 })).toBe(text)
      expect(atlas.extract({ col: 1, row: 24 }, { col: 80, row: 24 })).toBe('FOOTER')
      expect(atlas.cursorPosition).toEqual({ row: 22, col: 5 })
    }
  } finally { setFrameCaret(undefined) }
})

it.each(['ABCDE', '甲乙A', '🌍甲A', 'A甲乙', 'A甲🌍'])('retains the final glyph of a full-width incremental row: %s', text => {
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } })
  Object.assign(sink, { isTTY: true, rows: 4, columns: 5 })
  const wrapped = wrapStdoutForFrameBg(sink as unknown as NodeJS.WriteStream, () => 'none')
  const atlas = new ScreenAtlas(5, 4)
  setVisibleFrameSnapshot(undefined)
  releaseFrameRail()
  try {
    setFrameCaret({ row: 4, col: 1 })
    wrapped.write('H\nold\nI\nF\x1b[?2026l')
    atlas.feed(chunks.splice(0).join(''))
    // Ink 7's changed-row protocol clears to EOL after printing the row.
    wrapped.write(`\x1b[?2026h\x1b[3A\x1b[E\x1b[G\x1b[31m${text}\x1b[0m\x1b[K\n\x1b[E\x1b[?2026l`)
    atlas.feed(chunks.join(''))
    expect(atlas.extract({ col: 1, row: 2 }, { col: 5, row: 2 })).toBe(text)
    chunks.splice(0)
    wrapped.write('\x1b[?2026h\x1b[3A\x1b[E\x1b[GX\x1b[K\n\x1b[E\x1b[?2026l')
    atlas.feed(chunks.join(''))
    expect(atlas.extract({ col: 1, row: 2 }, { col: 5, row: 2 })).toBe('X')
  } finally { setFrameCaret(undefined) }
})


it('clears the former footer when a sparse diff is followed by a shorter Ink frame', () => {
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 24, columns: 80 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const atlas = new ScreenAtlas(80, 24)
  try {
    setFrameCaret({ row: 20, col: 5 })
    wrapped.write(`HEADER${'\n'.repeat(23)}OLD FOOTER\x1b[?2026l`)
    wrapped.write(`\x1b[?2026h\x1b[23A\x1b[E\x1b[Gchanged\x1b[K\n${'\x1b[E'.repeat(21)}\x1b[?2026l`)
    atlas.feed(chunks.splice(0).join(''))
    // Ink 7 erases the two removed rows from its previous logical bottom,
    // then returns to the top before walking the shorter 22-row frame.
    wrapped.write(`\x1b[?2026h\x1b[2K\x1b[1A\x1b[2K\x1b[G\x1b[22A${'\x1b[E'.repeat(21)}\x1b[GNEW FOOTER\x1b[K\x1b[?2026l`)
    atlas.feed(chunks.join(''))
    expect(atlas.extractRowText(22)).toBe('NEW FOOTER')
    expect(atlas.extractRowText(24)).toBe('')
  } finally { setFrameCaret(undefined) }
})

it('restores an unchanged transcript after Ink erases it, while footer-only diffs stay sparse', () => {
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 6, columns: 20 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const atlas = new ScreenAtlas(20, 6)
  const snapshot = {
    revision: 'stable-transcript',
    geometry: { columns: 20, rows: 6, transcriptTop: 2, transcriptLeft: 2, transcriptWidth: 17, transcriptRows: 3 },
    rows: [createFrameSnapshotRow({ id: 'stable-row', row: 2, col: 2, line: createPhysicalLine({ blockId: 'stable-row', spans: [{ text: 'TRANSCRIPT', token: 'fg' }], sourceStart: 0, sourceEnd: 10, blockRow: 0 }) })],
  }
  try {
    setFrameCaret({ row: 5, col: 3 })
    setVisibleFrameSnapshot(snapshot)
    wrapped.write(`HEADER${'\n'.repeat(5)}FOOTER\x1b[?2026l`)
    atlas.feed(chunks.splice(0).join(''))
    // No snapshot change: a full Ink repaint still overwrites its empty slot.
    wrapped.write(`\x1b[?2026h${'\x1b[2K\x1b[1A'.repeat(5)}\x1b[2K\x1b[GHEADER${'\n'.repeat(5)}FOOTER\x1b[?2026l`)
    atlas.feed(chunks.splice(0).join(''))
    expect(atlas.extractRowText(2)).toBe(' TRANSCRIPT')
    wrapped.write(`\x1b[?2026h\x1b[5A${'\x1b[E'.repeat(5)}\x1b[GNEW FOOTER\x1b[K\x1b[?2026l`)
    expect(chunks.join('')).not.toContain('TRANSCRIPT')
    atlas.feed(chunks.splice(0).join(''))
    expect(atlas.extractRowText(2)).toBe(' TRANSCRIPT')
    expect(atlas.extractRowText(6)).toBe('NEW FOOTER')
  } finally {
    setFrameCaret(undefined)
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  }
})


it.each([false, true])('tracks real Ink 7 height changes after sparse frames (incremental=%s)', async incremental => {
  // Import the installed Ink implementation rather than reproducing its diff.
  const { default: logUpdate } = await import(new URL('../node_modules/ink/build/log-update.js', import.meta.url).href)
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 24, columns: 80 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const update = logUpdate.create(wrapped, { incremental })
  const atlas = new ScreenAtlas(80, 24)
  const paint = (lines: string[]): void => {
    wrapped.write('\x1b[?2026h')
    update(lines.join('\n'))
    wrapped.write('\x1b[?2026l')
    atlas.feed(chunks.splice(0).join(''))
  }
  try {
    setFrameCaret({ row: 20, col: 5 })
    const lines = Array.from({ length: 24 }, (_, index) => `row ${index + 1}`)
    paint(lines)
    lines[1] = 'changed'
    paint(lines)
    paint([...lines.slice(0, 21), 'new footer'])
    expect(atlas.extractRowText(1)).toBe('row 1')
    expect(atlas.extractRowText(2)).toBe('changed')
    expect(atlas.extractRowText(22)).toBe('new footer')
    expect(atlas.extractRowText(23)).toBe('')
    expect(atlas.extractRowText(24)).toBe('')
    expect(atlas.cursorPosition).toEqual({ row: 20, col: 5 })
  } finally { setFrameCaret(undefined) }
})


it('completes scroll latency only in the write callback carrying its overlay revision', () => {
  const callbacks: (() => void)[] = []
  const sink = {
    isTTY: true, rows: 6, columns: 20,
    write(_chunk: unknown, ...args: unknown[]) {
      const callback = args.at(-1)
      if (typeof callback === 'function') callbacks.push(callback as () => void)
      return true
    },
  } as unknown as NodeJS.WriteStream
  const metrics = createFrameMetrics()
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none', metrics)
  const publish = (text: string, scrollRevision?: number): void => setVisibleFrameSnapshot({
    revision: text,
    ...(scrollRevision === undefined ? {} : { scrollRevision }),
    geometry: { columns: 20, rows: 6, transcriptTop: 2, transcriptLeft: 2, transcriptWidth: 17, transcriptRows: 3 },
    rows: [createFrameSnapshotRow({ id: 'row', row: 2, col: 2, line: createPhysicalLine({ blockId: 'row', spans: [{ text, token: 'fg' }], sourceStart: 0, sourceEnd: text.length, blockRow: 0 }) })],
  })
  try {
    publish('before')
    writePublishedFrameSnapshot(wrapped, 'none')
    expect(metrics.snapshot().writtenCells.total).toBeGreaterThanOrEqual(6)
    callbacks.shift()?.()
    markScrollInput(metrics, 1, performance.now() - 10)
    // Unrelated chrome finishes before the scroll's snapshot is published.
    wrapped.write('\x1b[6;1Hfooter\x1b[?2026l')
    callbacks.shift()?.()
    expect(metrics.snapshot().scrollInputToPaintMs.count).toBe(0)
    publish('first', 1)
    writePublishedFrameSnapshot(wrapped, 'none')
    const firstPaint = callbacks.shift()
    expect(metrics.snapshot().scrollInputToPaintMs.count).toBe(0)
    markScrollInput(metrics, 2, performance.now() - 5)
    firstPaint?.()
    expect(metrics.snapshot().scrollInputToPaintMs.count).toBe(1)
    expect(metrics.snapshot().frameIntervalMs.count).toBeGreaterThan(0)
    publish('second', 2)
    // Also cover an overlay appended to Ink's synchronized frame.
    wrapped.write('\x1b[?2026l')
    expect(metrics.snapshot().scrollInputToPaintMs.count).toBe(1)
    callbacks.shift()?.()
    expect(metrics.snapshot().scrollInputToPaintMs.count).toBe(2)
  } finally {
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  }
})

it('counts ST-terminated hyperlinks without swallowing intervening rows', () => {
  expect(countWrittenCells('\x1b]8;;https://example.test\x1b\\first\x1b]8;;\x1b\\\nsecond')).toBe(11)
})

it('releases overlay cells before real incremental Ink paints a short pane or home', async () => {
  const { default: logUpdate } = await import(new URL('../node_modules/ink/build/log-update.js', import.meta.url).href)
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 6, columns: 20 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const update = logUpdate.create(wrapped, { incremental: true })
  const atlas = new ScreenAtlas(20, 6)
  const paint = (lines: string[]): void => {
    wrapped.write('\x1b[?2026h')
    update(lines.join('\n'))
    wrapped.write('\x1b[?2026l')
    atlas.feed(chunks.splice(0).join(''))
  }
  const publish = (text: string): void => setVisibleFrameSnapshot({
    revision: text,
    geometry: { columns: 20, rows: 6, transcriptTop: 2, transcriptLeft: 2, transcriptWidth: 17, transcriptRows: 3 },
    rows: [createFrameSnapshotRow({ id: text, row: 3, col: 2, line: createPhysicalLine({ blockId: text, spans: [{ text, token: 'fg' }], sourceStart: 0, sourceEnd: text.length, blockRow: 0 }) })],
  })
  try {
    setFrameCaret({ row: 5, col: 3 })
    publish('old transcript')
    paint(['CHAT', '', '', '', 'input', 'footer'])
    setVisibleFrameSnapshot(undefined)
    hideFrameCaret()
    paint(['SETTINGS', 'entry', '', '', '', 'footer'])
    expect(atlas.extractRowText(1)).toBe('SETTINGS')
    expect(atlas.extractRowText(2)).toBe('entry')
    expect(atlas.extractRowText(3)).toBe('')
    setFrameCaret({ row: 5, col: 3 })
    publish('new transcript')
    paint(['CHAT', '', '', '', 'input', 'footer'])
    expect(atlas.extractRowText(3)).toBe(' new transcript')
    setVisibleFrameSnapshot(undefined)
    paint(['HOME', '', '', '', 'input', 'footer'])
    expect(atlas.extractRowText(1)).toBe('HOME')
    expect(atlas.extractRowText(3)).toBe('')
  } finally {
    setFrameCaret(undefined)
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  }
})

it.each(['snapshot', 'rail', 'ink suffix'])('defers stale resize geometry at the %s painter without consuming dirty state', painter => {
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 40, columns: 120 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const paint = (): void => {
    if (painter === 'snapshot') writePublishedFrameSnapshot(wrapped, 'none')
    else if (painter === 'rail') writePublishedFrameRail(wrapped, 'none')
    else wrapped.write('\x1b[?2026l')
  }
  try {
    setFrameCaret({ row: 38, col: 5 })
    setFrameRail({ col: 120, topRow: 2, rows: 34, thumbStart: 0, thumbRows: 2 })
    setVisibleFrameSnapshot({
      revision: 'before-resize',
      geometry: { columns: 120, rows: 40, transcriptTop: 2, transcriptLeft: 2, transcriptWidth: 117, transcriptRows: 34 },
      rows: [createFrameSnapshotRow({ id: 'resize-row', row: 30, col: 2, line: createPhysicalLine({ blockId: 'resize-row', spans: [{ text: 'OLD GEOMETRY', token: 'fg' }], sourceStart: 0, sourceEnd: 12, blockRow: 0 }) })],
    })
    writePublishedFrameSnapshot(wrapped, 'none')
    chunks.length = 0
    Object.assign(sink, { rows: 24, columns: 80 })
    // Ink can flush its resize erase before React publishes the new geometry.
    wrapped.write('\x1b[?2026h\x1b[2J\x1b[H\x1b[?2026l')
    paint()
    const stale = chunks.splice(0).join('')
    expect(stale).not.toContain('OLD GEOMETRY')
    expect(stale).not.toContain('\x1b[30;2H')
    expect(stale).not.toContain('\x1b[2;120H')
    expect(stale).not.toContain('\x1b[38;5H')
    // The same snapshot can become valid again. The skipped dirty repaint
    // must remain pending, rather than treating its rows as already restored.
    Object.assign(sink, { rows: 40, columns: 120 })
    writePublishedFrameSnapshot(wrapped, 'none')
    expect(chunks.join('')).toContain('OLD GEOMETRY')
  } finally {
    setFrameCaret(undefined)
    releaseFrameRail()
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  }
})

it.each([
  { isTTY: false, columns: 80, rows: 24 },
  { isTTY: true, columns: undefined, rows: undefined },
  { isTTY: true, columns: 0, rows: 0 },
])('keeps snapshot fallback for streams without live TTY dimensions: %j', dimensions => {
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, dimensions)
  try {
    setVisibleFrameSnapshot({
      revision: 'fallback-dimensions',
      geometry: { columns: 120, rows: 40, transcriptTop: 2, transcriptLeft: 2, transcriptWidth: 117, transcriptRows: 2 },
      rows: [createFrameSnapshotRow({ id: 'fallback-row', row: 2, col: 2, line: createPhysicalLine({ blockId: 'fallback-row', spans: [{ text: 'FALLBACK', token: 'fg' }], sourceStart: 0, sourceEnd: 8, blockRow: 0 }) })],
    })
    writePublishedFrameSnapshot(sink, 'none')
    expect(chunks.join('')).toContain('FALLBACK')
  } finally {
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  }
})

it.each(['HUD', ''])('waits for Ink before moving an existing transcript slot into new chrome: %j', async hud => {
  const { default: logUpdate } = await import(new URL('../node_modules/ink/build/log-update.js', import.meta.url).href)
  const chunks: string[] = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback() } }) as unknown as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, rows: 6, columns: 20 })
  const wrapped = wrapStdoutForFrameBg(sink, () => 'none')
  const update = logUpdate.create(wrapped, { incremental: true })
  const atlas = new ScreenAtlas(20, 6)
  const paint = (lines: string[]): void => {
    wrapped.write('\x1b[?2026h')
    update(lines.join('\n'))
    wrapped.write('\x1b[?2026l')
    atlas.feed(chunks.splice(0).join(''))
  }
  const publish = (text: string, transcriptRows: number): void => {
    setFrameRail({ col: 20, topRow: 2, rows: transcriptRows, thumbStart: 0, thumbRows: 1 })
    setVisibleFrameSnapshot({
      revision: text,
      geometry: { columns: 20, rows: 6, transcriptTop: 2, transcriptLeft: 2, transcriptWidth: 17, transcriptRows },
      rows: [createFrameSnapshotRow({ id: text, row: 1 + transcriptRows, col: 2, line: createPhysicalLine({ blockId: text, spans: [{ text, token: 'fg' }], sourceStart: 0, sourceEnd: text.length, blockRow: 0 }) })],
    })
  }
  try {
    setFrameCaret({ row: 5, col: 3 })
    publish('old tail', 3)
    paint(['HEADER', '', '', '', 'input', 'footer'])
    expect(atlas.extractRowText(4)).toContain('old tail')
    publish('new tail', 2)
    // A layout effect can run while Ink's new HUD frame is still throttled.
    writePublishedFrameSnapshot(wrapped, 'none')
    writePublishedFrameRail(wrapped, 'none')
    expect(chunks).toEqual([])
    paint(['HEADER', '', '', hud, 'input', 'footer'])
    expect(atlas.extractRowText(3)).toContain('new tail')
    // Clear the vacated slot before Ink, including an empty row it skips.
    expect(atlas.extractRowText(4)).toBe(hud)
    expect(atlas.extractRowText(5)).toBe('input')
  } finally {
    setFrameCaret(undefined)
    releaseFrameRail()
    setVisibleFrameSnapshot(undefined)
    transformFrameChunk('\x1b[?2026l', 'none')
  }
})
