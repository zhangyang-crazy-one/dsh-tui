/**
 * OSC 52 encoding and host clipboard helper selection.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  copyText,
  encodeOsc52,
  hostClipboardCommand,
  OSC52_MAX_CHARS,
  type SpawnFn,
} from '../src/clipboard.ts'

/** Narrow the child-process double to the spawn face copyText consumes. */
function asSpawn(fn: () => unknown): SpawnFn {
  return fn as unknown as SpawnFn
}

describe('encodeOsc52', () => {
  it('base64-encodes and truncates oversized payloads', () => {
    expect(encodeOsc52('hi')).toBe(
      `\x1b]52;c;${Buffer.from('hi').toString('base64')}\x1b\\`,
    )
    const huge = 'a'.repeat(OSC52_MAX_CHARS + 10)
    const encoded = encodeOsc52(huge)
    expect(encoded.startsWith('\x1b]52;c;')).toBe(true)
    expect(encoded.endsWith('\x1b\\')).toBe(true)
    const b64 = encoded.slice('\x1b]52;c;'.length, -2)
    expect(Buffer.from(b64, 'base64').toString('utf8').length).toBe(OSC52_MAX_CHARS)
  })

  it('preserves model control bytes inside the clipboard payload', () => {
    const text = 'safe\u001b[2Jtail'
    const encoded = encodeOsc52(text)
    const payload = encoded.slice('\u001b]52;c;'.length, -2)
    expect(Buffer.from(payload, 'base64').toString('utf8')).toBe(text)
  })
})

describe('hostClipboardCommand', () => {
  it('picks a helper from platform and display env', () => {
    expect(hostClipboardCommand('darwin', {})).toEqual({
      command: 'pbcopy',
      args: [],
    })
    expect(hostClipboardCommand('win32', {})).toEqual({
      command: 'clip',
      args: [],
    })
    expect(hostClipboardCommand('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual({
      command: 'wl-copy',
      args: [],
    })
    expect(hostClipboardCommand('linux', { DISPLAY: ':0' })).toEqual({
      command: 'xclip',
      args: ['-selection', 'clipboard'],
    })
    expect(hostClipboardCommand('linux', {})).toBeUndefined()
  })
})

describe('copyText', () => {
  it('skips empty text', () => {
    const write = vi.fn()
    copyText('', write)
    expect(write).not.toHaveBeenCalled()
  })

  it('writes OSC 52 and pipes to a helper', () => {
    const write = vi.fn()
    const stdin = { end: vi.fn() }
    const child = Object.assign(new EventEmitter(), { stdin })
    const spawnFn = vi.fn(() => child)
    copyText('sel', write, asSpawn(spawnFn), { command: 'pbcopy', args: [] })
    expect(write).toHaveBeenCalledWith(encodeOsc52('sel'))
    expect(spawnFn).toHaveBeenCalled()
    expect(stdin.end).toHaveBeenCalledWith('sel')
    child.emit('error', new Error('missing'))
  })

  it('swallows a spawn throw after OSC 52', () => {
    const write = vi.fn()
    copyText('sel', write, asSpawn(() => {
      throw new Error('spawn')
    }), { command: 'pbcopy', args: [] })
    expect(write).toHaveBeenCalled()
  })

  it('skips piping when the helper has no stdin', () => {
    const write = vi.fn()
    const child = Object.assign(new EventEmitter(), { stdin: undefined })
    const spawnFn = vi.fn(() => child)
    copyText('sel', write, asSpawn(spawnFn), { command: 'pbcopy', args: [] })
    expect(write).toHaveBeenCalled()
  })

  it('skips the helper when no spec is resolved', () => {
    const write = vi.fn()
    const spawnFn = vi.fn()
    copyText('sel', write, asSpawn(spawnFn), null)
    expect(write).toHaveBeenCalled()
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('resolves the host helper when spec is omitted', () => {
    const write = vi.fn()
    const stdin = { end: vi.fn() }
    const child = Object.assign(new EventEmitter(), { stdin })
    const spawnFn = vi.fn(() => child)
    copyText('sel', write, asSpawn(spawnFn))
    expect(write).toHaveBeenCalled()
  })
})
