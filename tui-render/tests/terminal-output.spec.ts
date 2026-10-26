import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { TerminalOutput, MAX_PENDING_OUTPUT_BYTES, OUTPUT_TRACE_CAPACITY, writeTerminalControl, terminalOutputSnapshot } from '../src/terminal-output.ts'
import { disposeFrameOutput, setFrameCaret, writePublishedFrameSnapshot, wrapStdoutForFrameBg } from '../src/frame-fill.ts'
import { createFrameSnapshotRow, setVisibleFrameSnapshot } from '../src/frame-snapshot.ts'
import { createPhysicalLine } from '../src/physical-line.ts'

function sink() {
  const stream = new EventEmitter() as NodeJS.WriteStream
  const writes: string[] = []
  const callbacks: ((error?: Error | null) => void)[] = []
  let blocked = false
  Object.assign(stream, { isTTY: true, columns: 80, rows: 24, write: (text: string, callback?: (error?: Error | null) => void) => {
    writes.push(text)
    if (callback) callbacks.push(callback)
    return !blocked
  } })
  return { stream, writes, callbacks, block: () => { blocked = true }, drain: () => { blocked = false; stream.emit('drain') } }
}

describe('terminal transaction queue', () => {
  it('honors drain, keeps mandatory bytes ordered and coalesces unstarted overlays', () => {
    const target = sink()
    const output = new TerminalOutput(target.stream, () => {})
    target.block()
    expect(output.write('first', 'ink')).toBe(false)
    expect(output.write('notify', 'notify')).toBe(false)
    output.latest('transcript', () => output.write('old snapshot', 'transcript'))
    output.latest('transcript', () => output.write('new snapshot', 'transcript'))
    expect(target.writes).toEqual(['first'])
    expect(output.snapshot().pendingBytes).toBe(6)
    target.drain()
    expect(target.writes).toEqual(['first', 'notify', 'new snapshot'])
    expect(output.snapshot().pendingBytes).toBe(0)
    output.dispose()
  })

  it('rejects excess mandatory backlog explicitly and does not retain the rejected bytes', () => {
    const target = sink()
    const error = vi.fn()
    const output = new TerminalOutput(target.stream, error)
    target.block()
    output.write('start', 'ink')
    expect(() => output.write('x'.repeat(MAX_PENDING_OUTPUT_BYTES + 1), 'ink')).toThrow('finite budget')
    expect(output.pendingBytes).toBe(0)
    expect(error).toHaveBeenCalledOnce()
    output.dispose()
  })

  it('keeps trace metadata bounded and excludes the text while identifying failed writes', () => {
    const target = sink()
    const error = vi.fn()
    const output = new TerminalOutput(target.stream, error)
    for (let index = 0; index < OUTPUT_TRACE_CAPACITY + 10; index++) {
      output.write('secret draft', 'ink')
      target.callbacks.shift()?.()
    }
    output.write('secret notification', 'notify')
    target.callbacks.shift()?.(new Error('transport failed'))
    const snapshot = output.snapshot()
    expect(snapshot.trace).toHaveLength(OUTPUT_TRACE_CAPACITY)
    expect(snapshot.trace.at(-1)?.state).toBe('failed')
    expect(snapshot.trace.at(-1)?.source).toBe('notify')
    expect(snapshot.bundle).toContain('terminal-output')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(error).toHaveBeenCalledOnce()
    output.dispose()
  })

  it('allows queued lifecycle bytes to drain during disposal without keeping deferred frames', () => {
    const target = sink()
    const output = new TerminalOutput(target.stream, () => {})
    target.block()
    output.write('frame', 'ink')
    output.write('leave alternate screen', 'lifecycle')
    output.latest('transcript', () => output.write('obsolete', 'transcript'))
    output.dispose()
    target.drain()
    expect(target.writes).toEqual(['frame', 'leave alternate screen'])
    expect(target.stream.listenerCount('drain')).toBe(0)
    expect(output.pendingBytes).toBe(0)
  })

  it('holds side-channel notifications until an unfinished color has completed', () => {
    const target = sink()
    const wrapped = wrapStdoutForFrameBg(target.stream, () => 'truecolor')
    setFrameCaret({ row: 20, col: 5 })
    wrapped.write('\x1b[48;2;2')
    writeTerminalControl(wrapped, '\x1b]9;done\x07', 'notify')
    expect(target.writes).toEqual([])
    wrapped.write('1;22;24mOK')
    expect(target.writes[0]).toContain('\x1b[48;2;21;22;24mOK')
    expect(target.writes[1]).toBe('\x1b]9;done\x07\x1b[20;5H\x1b[?25h')
    for (const callback of target.callbacks) callback()
    expect(terminalOutputSnapshot(wrapped)?.trace.at(-1)?.source).toBe('notify')
    disposeFrameOutput(wrapped)
    expect(terminalOutputSnapshot(wrapped)).toBeUndefined()
    setFrameCaret(undefined)
  })

  it('ends an open synchronized frame when disposing the output owner', () => {
    const target = sink()
    const wrapped = wrapStdoutForFrameBg(target.stream, () => 'none')
    wrapped.write('\x1b[?2026hpartial')
    writeTerminalControl(wrapped, '\x1b[?1000l', 'lifecycle')
    disposeFrameOutput(wrapped)
    expect(target.writes.slice(-2)).toEqual(['\x1b[?2026l', '\x1b[?1000l'])
  })

  it('invalidates failed paint and clears parser/caret state when remounting', () => {
    const target = sink()
    const wrapped = wrapStdoutForFrameBg(target.stream, () => 'truecolor')
    const line = createPhysicalLine({ blockId: 'body', spans: [{ text: 'BODY', token: 'fg' }], sourceStart: 0, sourceEnd: 4, blockRow: 0 })
    setVisibleFrameSnapshot({ revision: 'same', geometry: { columns: 80, rows: 24, transcriptTop: 2, transcriptLeft: 1, transcriptWidth: 80, transcriptRows: 1 }, rows: [createFrameSnapshotRow({ id: 'body', row: 2, col: 1, line })] })
    writePublishedFrameSnapshot(wrapped)
    expect(target.writes.at(-1)).toContain('BODY')
    target.callbacks.shift()?.(new Error('failed write'))
    const count = target.writes.length
    writePublishedFrameSnapshot(wrapped)
    expect(target.writes.length).toBe(count + 1)
    expect(target.writes.at(-1)).toContain('BODY')
    setFrameCaret({ row: 19, col: 9 })
    wrapped.write('\x1b[48;2;2')
    disposeFrameOutput(wrapped)
    setVisibleFrameSnapshot(undefined)
    const remounted = wrapStdoutForFrameBg(target.stream, () => 'truecolor')
    remounted.write('OK\x1b[?2026l')
    expect(target.writes.at(-1)).not.toContain('19;9H')
    expect(target.writes.at(-1)).not.toContain('48;2;2OK')
    disposeFrameOutput(remounted)
  })
})
