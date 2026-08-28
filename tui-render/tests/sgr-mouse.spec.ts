/**
 * SGR mouse decode and stdin buffering.
 */

import { describe, expect, it } from 'vitest'
import {
  consumeMouseStdin,
  decodeSgrMouse,
  DISABLE_SGR_MOUSE,
  ENABLE_SGR_MOUSE,
} from '../src/sgr-mouse.ts'

describe('decodeSgrMouse', () => {
  it('decodes wheel, buttons, motion, and release', () => {
    expect(decodeSgrMouse(64, 3, 4, 'M')).toEqual({
      kind: 'wheel',
      button: 'none',
      col: 3,
      row: 4,
      delta: 1,
    })
    expect(decodeSgrMouse(65, 3, 4, 'M')).toEqual({
      kind: 'wheel',
      button: 'none',
      col: 3,
      row: 4,
      delta: -1,
    })
    expect(decodeSgrMouse(66, 1, 1, 'M')).toBeUndefined()
    expect(decodeSgrMouse(67, 1, 1, 'M')).toBeUndefined()
    expect(decodeSgrMouse(0, 2, 5, 'M')).toEqual({
      kind: 'press',
      button: 'left',
      col: 2,
      row: 5,
    })
    expect(decodeSgrMouse(1, 2, 5, 'M')).toMatchObject({ button: 'middle' })
    expect(decodeSgrMouse(2, 2, 5, 'M')).toMatchObject({ button: 'right' })
    expect(decodeSgrMouse(3, 2, 5, 'M')).toMatchObject({ button: 'none' })
    expect(decodeSgrMouse(32, 8, 9, 'M')).toEqual({
      kind: 'drag',
      button: 'left',
      col: 8,
      row: 9,
    })
    expect(decodeSgrMouse(0, 8, 9, 'm')).toEqual({
      kind: 'release',
      button: 'left',
      col: 8,
      row: 9,
    })
  })
})

describe('consumeMouseStdin', () => {
  it('holds incomplete ESC prefixes and forwards keys', () => {
    expect(consumeMouseStdin('ab')).toEqual({
      mouse: [],
      forward: 'ab',
      rest: '',
    })
    expect(consumeMouseStdin('\x1b')).toEqual({
      mouse: [],
      forward: '',
      rest: '\x1b',
    })
    expect(consumeMouseStdin('\x1b[')).toEqual({
      mouse: [],
      forward: '',
      rest: '\x1b[',
    })
    expect(consumeMouseStdin('\x1b[A')).toEqual({
      mouse: [],
      forward: '\x1b[A',
      rest: '',
    })
    expect(consumeMouseStdin('\x1b[<0;1;2')).toEqual({
      mouse: [],
      forward: '',
      rest: '\x1b[<0;1;2',
    })
  })

  it('emits complete SGR reports and drops horizontal wheel', () => {
    const once = consumeMouseStdin('\x1b[<64;10;3Mk')
    expect(once.mouse).toEqual([
      { kind: 'wheel', button: 'none', col: 10, row: 3, delta: 1 },
    ])
    expect(once.forward).toBe('k')
    expect(once.rest).toBe('')
    const drop = consumeMouseStdin('\x1b[<66;1;1Mx')
    expect(drop.mouse).toEqual([])
    expect(drop.forward).toBe('x')
  })

  it('forwards a malformed mouse prefix one byte at a time', () => {
    const out = consumeMouseStdin('\x1b[<nope')
    expect(out.mouse).toEqual([])
    expect(out.forward.startsWith('\x1b')).toBe(true)
  })
})

describe('enable sequences', () => {
  it('enable and disable are paired SGR modes', () => {
    expect(ENABLE_SGR_MOUSE).toBe('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
    expect(DISABLE_SGR_MOUSE).toBe('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
  })
})
