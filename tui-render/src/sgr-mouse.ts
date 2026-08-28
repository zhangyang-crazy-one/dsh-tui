/**
 * SGR mouse tracking: enable/disable sequences, a streaming parser that
 * holds incomplete `\x1b[<btn;col;rowM` chunks so they never leak into Ink
 * as composer text, and the decoded event used by wheel, click, and drag.
 * Tracking is button-motion (1000+1002+1006), not all-motion 1003.
 * @module @deepseek-ai/dsh-tui-render/sgr-mouse
 */

/** Enable X11 mouse, button-event tracking, and SGR coordinates. */
export const ENABLE_SGR_MOUSE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'

/** Disable in reverse order of {@link ENABLE_SGR_MOUSE}. */
export const DISABLE_SGR_MOUSE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'

/** One decoded SGR mouse report. */
export interface SgrMouseEvent {
  /** press/drag/release for buttons; wheel for 64/65. */
  kind: 'press' | 'drag' | 'release' | 'wheel'
  /** Decoded button; `none` for wheel. */
  button: 'left' | 'middle' | 'right' | 'none'
  /** 1-based terminal column. */
  col: number
  /** 1-based terminal row. */
  row: number
  /** Wheel only: +1 is up/older, -1 is down/newer. */
  delta?: 1 | -1
}

/** Result of draining complete sequences out of a stdin buffer. */
export interface MouseConsumeResult {
  /** Complete mouse reports, in arrival order. */
  mouse: SgrMouseEvent[]
  /** Bytes that are not mouse reports; forward to Ink. */
  forward: string
  /** Incomplete prefix that must wait for the next chunk. */
  rest: string
}

const COMPLETE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/
const INCOMPLETE = /^\x1b\[<(?:\d+)?(?:;\d*){0,2}$/

/**
 * Decode one complete SGR payload. Horizontal wheel (66/67) is ignored.
 * @param button - SGR button code.
 * @param col - 1-based column.
 * @param row - 1-based row.
 * @param suffix - `M` press/drag, `m` release.
 * @returns the event, or undefined when the report is not handled.
 */
export function decodeSgrMouse(
  button: number,
  col: number,
  row: number,
  suffix: 'M' | 'm',
): SgrMouseEvent | undefined {
  if (button === 64) {
    return { kind: 'wheel', button: 'none', col, row, delta: 1 }
  }
  if (button === 65) {
    return { kind: 'wheel', button: 'none', col, row, delta: -1 }
  }
  if (button === 66 || button === 67) return undefined
  const base = button & 3
  const motion = (button & 32) !== 0
  const decoded: SgrMouseEvent['button'] =
    base === 0 ? 'left' : base === 1 ? 'middle' : base === 2 ? 'right' : 'none'
  if (suffix === 'm') {
    return { kind: 'release', button: decoded, col, row }
  }
  if (motion) return { kind: 'drag', button: decoded, col, row }
  return { kind: 'press', button: decoded, col, row }
}

/**
 * Split a stdin buffer into mouse events, bytes Ink should see, and a held
 * incomplete mouse or ESC prefix. A lone ESC or `ESC [` waits; other CSI
 * (arrows) forwards immediately.
 * @param buffer - accumulated stdin text.
 * @returns mouse events, forward bytes, and remainder.
 */
export function consumeMouseStdin(buffer: string): MouseConsumeResult {
  const mouse: SgrMouseEvent[] = []
  let forward = ''
  let index = 0
  while (index < buffer.length) {
    const remaining = buffer.slice(index)
    if (!remaining.startsWith('\x1b')) {
      forward += remaining.charAt(0)
      index += 1
      continue
    }
    if (remaining === '\x1b' || remaining === '\x1b[') {
      return { mouse, forward, rest: remaining }
    }
    if (remaining.startsWith('\x1b[<')) {
      const match = COMPLETE.exec(remaining)
      if (match !== null) {
        const event = decodeSgrMouse(
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          match[4] as 'M' | 'm',
        )
        if (event !== undefined) mouse.push(event)
        index += match[0].length
        continue
      }
      if (INCOMPLETE.test(remaining)) {
        return { mouse, forward, rest: remaining }
      }
      forward += remaining.charAt(0)
      index += 1
      continue
    }
    forward += remaining.charAt(0)
    index += 1
  }
  return { mouse, forward, rest: '' }
}
