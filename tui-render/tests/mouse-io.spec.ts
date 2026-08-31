/**
 * Mouse session: wheel, click OSC 8, drag-copy, edge auto-scroll, stdin wrap.
 */

import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachMouseIo,
  MouseSession,
  notifyMouseScroll,
  setMouseRailListener,
  setMouseRailRegion,
  setMouseScrollListener,
} from '../src/mouse-io.ts'
import { DISABLE_SGR_MOUSE, ENABLE_SGR_MOUSE } from '../src/sgr-mouse.ts'
import { setFrameCaret } from '../src/frame-fill.ts'
import { createFrameSnapshotRow, setVisibleFrameSnapshot } from '../src/frame-snapshot.ts'
import { createPhysicalLine } from '../src/physical-line.ts'

afterEach(() => {
  setMouseScrollListener(undefined)
  setMouseRailListener(undefined)
  setMouseRailRegion(undefined)
  setFrameCaret(undefined)
  setVisibleFrameSnapshot(undefined)
})

function ttyStdout(): NodeJS.WriteStream {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream
  stream.isTTY = true
  stream.columns = 80
  stream.rows = 24
  return stream
}

function ttyStdin(): NodeJS.ReadStream {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream
  stream.isTTY = true
  stream.setRawMode = () => stream
  stream.ref = () => stream
  stream.unref = () => stream
  return stream
}

describe('MouseSession', () => {
  it('scrolls on wheel and ignores a default copy hook', () => {
    const onScroll = vi.fn()
    const session = new MouseSession({ onScroll, rows: 10 })
    session.handle({
      kind: 'wheel',
      button: 'none',
      col: 1,
      row: 1,
      delta: 1,
    })
    expect(onScroll).toHaveBeenCalledWith(1)
    session.handle({
      kind: 'press',
      button: 'left',
      col: 1,
      row: 1,
    })
    session.handle({
      kind: 'drag',
      button: 'left',
      col: 2,
      row: 1,
    })
    session.handle({
      kind: 'release',
      button: 'left',
      col: 2,
      row: 1,
    })
  })

  it('opens the URL under a click and copies a drag', () => {
    const open = vi.fn()
    const copy = vi.fn()
    const session = new MouseSession({
      columns: 8,
      rows: 4,
      openUrl: open,
      copyText: copy,
    })
    session.feedStdout('\x1b[H\x1b]8;;https://ex.com\x1b\\ab\x1b]8;;\x1b\\')
    session.handle({ kind: 'press', button: 'left', col: 1, row: 1 })
    session.handle({ kind: 'release', button: 'left', col: 1, row: 1 })
    expect(open).toHaveBeenCalledWith('https://ex.com')
    session.handle({ kind: 'press', button: 'left', col: 1, row: 1 })
    session.handle({ kind: 'drag', button: 'left', col: 2, row: 1 })
    const painted = session.feedStdout('\x1b[Hab')
    expect(painted).toContain('\x1b[7m')
    session.handle({ kind: 'release', button: 'left', col: 2, row: 1 })
    expect(copy).toHaveBeenCalled()
    expect(session.feedStdout('x')).toBe('x')
    const silent = new MouseSession({
      columns: 8,
      rows: 4,
      openUrl: open,
      copyText: copy,
    })
    silent.handle({ kind: 'press', button: 'left', col: 8, row: 1 })
    silent.handle({ kind: 'release', button: 'left', col: 8, row: 1 })
  })

  it('repaints a changing selection immediately and restores it on release', () => {
    const copy = vi.fn()
    const session = new MouseSession({ columns: 8, rows: 4, copyText: copy })
    session.feedStdout('\x1b[Habcd')
    session.handle({ kind: 'press', button: 'left', col: 1, row: 1 })

    const expanded = session.handle({ kind: 'drag', button: 'left', col: 4, row: 1 })
    const shrunk = session.handle({ kind: 'drag', button: 'left', col: 2, row: 1 })
    const released = session.handle({ kind: 'release', button: 'left', col: 2, row: 1 })

    expect(expanded).toContain('\x1b[7mabcd\x1b[27m')
    expect(stripVTControlCharacters(shrunk)).toBe('abcdab')
    expect(shrunk).toContain('\x1b[7mab\x1b[27m')
    expect(stripVTControlCharacters(released)).toBe('ab')
    expect(released).not.toContain('\x1b[7m')
    expect(session.feedStdout('')).toBe('')
    expect(copy).toHaveBeenCalledWith('ab')
  })

  it('ignores middle-button press and a release without a press', () => {
    const open = vi.fn()
    const copy = vi.fn()
    const session = new MouseSession({ openUrl: open, copyText: copy })
    session.handle({ kind: 'press', button: 'middle', col: 1, row: 1 })
    session.handle({ kind: 'release', button: 'middle', col: 1, row: 1 })
    session.handle({ kind: 'drag', button: 'left', col: 2, row: 1 })
    expect(open).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
  })

  it('auto-scrolls at the top and bottom edges while dragging', () => {
    vi.useFakeTimers()
    const onScroll = vi.fn()
    const session = new MouseSession({
      columns: 8,
      rows: 6,
      onScroll,
      copyText: () => {},
    })
    session.handle({ kind: 'press', button: 'left', col: 1, row: 3 })
    session.handle({ kind: 'drag', button: 'left', col: 1, row: 1 })
    session.handle({ kind: 'drag', button: 'left', col: 2, row: 1 })
    expect(onScroll).toHaveBeenCalledWith(1)
    vi.advanceTimersByTime(80)
    expect(onScroll.mock.calls.length).toBeGreaterThan(1)
    session.handle({ kind: 'drag', button: 'left', col: 1, row: 3 })
    session.handle({ kind: 'drag', button: 'left', col: 1, row: 6 })
    expect(onScroll).toHaveBeenCalledWith(-1)
    session.dispose()
    vi.useRealTimers()
  })

  it('keeps a blank drag overlay empty until release', () => {
    const copy = vi.fn()
    const session = new MouseSession({ columns: 4, rows: 2, copyText: copy })
    session.feedStdout('中')
    session.handle({ kind: 'press', button: 'left', col: 2, row: 1 })
    session.handle({ kind: 'drag', button: 'left', col: 3, row: 1 })
    session.handle({ kind: 'drag', button: 'left', col: 2, row: 1 })
    expect(session.feedStdout('')).toBe('')
    session.handle({ kind: 'release', button: 'left', col: 2, row: 1 })
    expect(copy).toHaveBeenCalledWith('')
  })

  it('gives a visible rail priority over selection and maps press-drag-release positions', () => {
    const onRail = vi.fn()
    const copy = vi.fn()
    const onScroll = vi.fn()
    setMouseRailRegion({ col: 80, topRow: 3, rows: 10 })
    const session = new MouseSession({ onRail, copyText: copy, onScroll })

    session.handle({ kind: 'press', button: 'left', col: 80, row: 3 })
    session.handle({ kind: 'drag', button: 'left', col: 80, row: 7 })
    session.handle({ kind: 'release', button: 'left', col: 80, row: 12 })

    expect(onRail.mock.calls).toEqual([[0], [4 / 9], [1]])
    expect(copy).not.toHaveBeenCalled()
    expect(onScroll).not.toHaveBeenCalled()
    expect(session.feedStdout('frame')).toBe('frame')
  })

  it('selects and restores text outside the published rail column', () => {
    const onRail = vi.fn()
    const copy = vi.fn()
    setMouseRailRegion({ col: 8, topRow: 1, rows: 4 })
    const session = new MouseSession({ columns: 8, rows: 4, onRail, copyText: copy })
    const line = createPhysicalLine({
      blockId: 'assistant',
      spans: [{ text: 'abcdef', token: 'fg' }],
      sourceStart: 0,
      sourceEnd: 6,
      blockRow: 0,
    })
    setVisibleFrameSnapshot({
      revision: 'rail-selection',
      geometry: {
        columns: 8,
        rows: 4,
        transcriptTop: 1,
        transcriptLeft: 1,
        transcriptWidth: 7,
        transcriptRows: 4,
        rail: {
          col: 8,
          topRow: 1,
          rows: 4,
          thumbStart: 0,
          thumbRows: 1,
        },
      },
      rows: [createFrameSnapshotRow({ id: 'assistant:0', row: 1, col: 1, line })],
    })
    session.feedStdout('frame')

    session.handle({ kind: 'press', button: 'left', col: 6, row: 1 })
    const overlay = session.handle({ kind: 'drag', button: 'left', col: 8, row: 1 })
    const restored = session.handle({ kind: 'release', button: 'left', col: 8, row: 1 })

    expect(onRail).not.toHaveBeenCalled()
    expect(stripVTControlCharacters(overlay)).toBe('f')
    expect(stripVTControlCharacters(restored)).toBe('abcdef')
    expect(restored).not.toContain('\x1b[7m')
    expect(copy).toHaveBeenCalledWith('f')
  })

  it('notifies the module scroll listener by default', () => {
    const listener = vi.fn()
    setMouseScrollListener(listener)
    notifyMouseScroll(1)
    const session = new MouseSession()
    session.handle({
      kind: 'wheel',
      button: 'none',
      col: 1,
      row: 1,
      delta: -1,
    })
    expect(listener).toHaveBeenCalledWith(1)
    expect(listener).toHaveBeenCalledWith(-1)
  })
})

describe('attachMouseIo', () => {
  it('passes streams through when either side is not a TTY', () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream
    stdin.isTTY = false
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream
    stdout.isTTY = false
    const attached = attachMouseIo({ stdin, stdout })
    expect(attached.stdin).toBe(stdin)
    expect(attached.stdout).toBe(stdout)
    attached.dispose()
  })

  it('enables SGR mouse on a TTY pair and strips reports from Ink', () => {
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const chunks: string[] = []
    stdout.on('data', chunk => chunks.push(String(chunk)))
    const onScroll = vi.fn()
    setMouseScrollListener(onScroll)
    const attached = attachMouseIo({ stdin, stdout })
    expect(chunks.join('')).toContain(ENABLE_SGR_MOUSE)
    attached.stdout.write(Buffer.from('bin'))
    attached.stdout.write('text')
    stdin.push('\x1b[<64;2;2Mhi')
    const wrapped = attached.stdin
    wrapped.setRawMode?.(true)
    wrapped.ref()
    wrapped.unref()
    stdin.push(Buffer.from('z'))
    stdin.push('\x1b[<0;1;1')
    attached.session.feedStdout('\x1b[Habcd')
    attached.session.handle({ kind: 'press', button: 'left', col: 1, row: 1 })
    attached.session.handle({ kind: 'drag', button: 'left', col: 4, row: 1 })
    attached.session.handle({ kind: 'release', button: 'left', col: 4, row: 1 })
    stdin.push('\x1b')
    stdin.push('\x1b[<0;1;2')
    attached.dispose()
    expect(chunks.join('')).toContain(DISABLE_SGR_MOUSE)
    expect(onScroll).toHaveBeenCalledWith(3)
  })

  it('coalesces one raw wheel burst and advances three rows per report', () => {
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const onScroll = vi.fn()
    setMouseScrollListener(onScroll)
    const attached = attachMouseIo({ stdin, stdout })

    stdin.push(
      '\x1b[<64;2;2M'
      + '\x1b[<64;2;2M'
      + '\x1b[<64;2;2M',
    )

    expect(onScroll.mock.calls).toEqual([[9]])
    attached.dispose()
  })

  it('writes selection repaint bytes directly from raw drag input', () => {
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const chunks: string[] = []
    stdout.on('data', chunk => chunks.push(String(chunk)))
    const session = new MouseSession({ columns: 8, rows: 4, copyText: vi.fn() })
    const attached = attachMouseIo({ stdin, stdout, session })
    session.feedStdout('\x1b[Habcd')

    stdin.push('\x1b[<0;1;1M\x1b[<32;4;1M')

    expect(chunks.join('')).toContain('\x1b[7mabcd\x1b[27m')
    attached.dispose()
  })

  it('copies snapshot text from raw SGR drag reports', () => {
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const copy = vi.fn()
    const session = new MouseSession({ columns: 80, rows: 24, copyText: copy })
    const attached = attachMouseIo({ stdin, stdout, session })
    const line = createPhysicalLine({
      blockId: 'assistant',
      spans: [{ text: 'copy me', token: 'fg' }],
      sourceStart: 0,
      sourceEnd: 7,
      blockRow: 0,
    })
    setVisibleFrameSnapshot({
      revision: 'mouse-copy',
      geometry: {
        columns: 80,
        rows: 24,
        transcriptTop: 3,
        transcriptLeft: 3,
        transcriptWidth: 76,
        transcriptRows: 18,
      },
      rows: [createFrameSnapshotRow({ id: 'assistant:0', row: 3, col: 3, line })],
    })
    attached.stdout.write('frame')

    stdin.push('\x1b[<0;3;3M\x1b[<32;9;3M\x1b[<0;9;3m')

    expect(copy).toHaveBeenCalledWith('copy me')
    attached.dispose()
  })

  it('uses the release coordinate when a terminal omits drag reports', () => {
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const copy = vi.fn()
    const session = new MouseSession({ columns: 8, rows: 4, copyText: copy })
    const attached = attachMouseIo({ stdin, stdout, session })
    session.feedStdout('\x1b[Habcd')

    stdin.push('\x1b[<0;1;1M\x1b[<0;4;1m')

    expect(copy).toHaveBeenCalledWith('abcd')
    attached.dispose()
  })

  it('forwards a held ESC after the disambiguation window', () => {
    vi.useFakeTimers()
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const attached = attachMouseIo({ stdin, stdout })
    const forwarded: string[] = []
    attached.stdin.on('data', chunk => forwarded.push(String(chunk)))
    stdin.push('\x1b')
    vi.advanceTimersByTime(40)
    expect(forwarded.join('')).toBe('\x1b')
    attached.dispose()
    vi.useRealTimers()
  })

  it('resizes the atlas on stdout resize', () => {
    const stdin = ttyStdin()
    const stdout = ttyStdout()
    const attached = attachMouseIo({ stdin, stdout })
    stdout.columns = 40
    stdout.rows = 12
    stdout.emit('resize')
    attached.dispose()
  })

  it('ref/unref/setRawMode no-op when the raw stream lacks TTY methods', () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream
    stdin.isTTY = true
    const stdout = ttyStdout()
    const attached = attachMouseIo({ stdin, stdout })
    attached.stdin.setRawMode?.(true)
    attached.stdin.ref()
    attached.stdin.unref()
    attached.dispose()
  })

  it('accepts decoded string chunks from an encoded raw stream', () => {
    const stdin = ttyStdin()
    stdin.setEncoding('utf8')
    const attached = attachMouseIo({ stdin, stdout: ttyStdout() })
    const forwarded: string[] = []
    attached.stdin.on('data', chunk => forwarded.push(String(chunk)))
    stdin.push('plain')
    expect(forwarded.join('')).toBe('plain')
    attached.dispose()
  })
})
