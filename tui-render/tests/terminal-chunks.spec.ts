import { describe, expect, it } from 'vitest'
import { MAX_PENDING_TERMINAL_BYTES, TerminalChunks } from '../src/terminal-chunks.ts'

describe('bounded terminal parser', () => {
  it('streams an oversized OSC without decorating its continuation', () => {
    const parser = new TerminalChunks()
    expect(parser.push('\x1b]8;;')).toEqual([])
    const text = 'x'.repeat(MAX_PENDING_TERMINAL_BYTES + 1)
    expect(parser.push(text)).toEqual([{ text: '\x1b]8;;' + text, decorate: false }])
    expect(parser.pendingBytes).toBe(0)
    expect(parser.incomplete).toBe(true)
    expect(parser.push('tail\x1b')).toEqual([{ text: 'tail\x1b', decorate: false }])
    expect(parser.push('\\OK')).toEqual([{ text: '\\', decorate: false }, { text: 'OK', decorate: true }])
    expect(parser.incomplete).toBe(false)
  })

  it('cancels only already-forwarded incomplete controls on disposal', () => {
    const buffered = new TerminalChunks()
    buffered.push('\x1b[48;2;2')
    expect(buffered.dispose()).toBe('')
    expect(buffered.push('OK')).toEqual([{ text: 'OK', decorate: true }])
    const forwarded = new TerminalChunks()
    forwarded.push('\x1b]' + 'x'.repeat(MAX_PENDING_TERMINAL_BYTES))
    expect(forwarded.dispose()).toBe('\x18')
    expect(forwarded.incomplete).toBe(false)
    expect(forwarded.pendingBytes).toBe(0)
  })

  it('keeps split UTF-16 graphemes and UTF-8 byte suffixes intact', () => {
    const parser = new TerminalChunks()
    expect(parser.push('\ud83d')).toEqual([])
    expect(parser.push('\ude42')).toEqual([{ text: '🙂', decorate: true }])
    expect(parser.push(Buffer.from([0xe4, 0xb8]))).toEqual([])
    expect(parser.incomplete).toBe(true)
    expect(parser.push(Buffer.from([0xad]))).toEqual([{ text: '中', decorate: true }])
    expect(parser.incomplete).toBe(false)
  })

  it('finishes canceled and intermediate escape sequences without leaking tails', () => {
    const parser = new TerminalChunks()
    expect(parser.push('\x1b(')).toEqual([])
    expect(parser.push('BOK')).toEqual([{ text: '\x1b(BOK', decorate: true }])
    expect(parser.push('\x1b[48;')).toEqual([])
    expect(parser.push('\x18OK')).toEqual([{ text: '\x1b[48;\x18OK', decorate: true }])
  })
})
