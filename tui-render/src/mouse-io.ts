/**
 * Fullscreen mouse session: SGR tracking, a cell atlas of the last frame,
 * wheel/edge-scroll callbacks, OSC 8 click, and drag-select copy. Stdin is
 * wrapped so mouse bytes never reach Ink's key parser.
 * @module @deepseek-ai/dsh-tui-render/mouse-io
 */

import { PassThrough } from 'node:stream'
import { ESC_TIMEOUT_MS } from './terminal-capabilities.ts'
import { publishedCaretBytes } from './frame-fill.ts'
import { ScreenAtlas, type ScreenPoint } from './screen-atlas.ts'
import {
  consumeMouseStdin,
  DISABLE_SGR_MOUSE,
  ENABLE_SGR_MOUSE,
  type SgrMouseEvent,
} from './sgr-mouse.ts'
import { copyText } from './clipboard.ts'
import { openUrl } from './open-url.ts'

/** Scroll callback the loop registers for wheel and edge auto-scroll. */
export type MouseScrollListener = (delta: number) => void

let scrollListener: MouseScrollListener | undefined

/**
 * Register the loop's wheel/edge-scroll handler. `undefined` clears it.
 * @param listener - next handler.
 */
export function setMouseScrollListener(
  listener: MouseScrollListener | undefined,
): void {
  scrollListener = listener
}

/**
 * Fire the registered scroll handler. Mount wiring and tests call this.
 * @param delta - +1 older / list up, -1 newer / list down.
 */
export function notifyMouseScroll(delta: number): void {
  scrollListener?.(delta)
}

/** Drag and copy/click owner for one mounted TUI. */
export class MouseSession {
  /** Cell atlas of bytes written through {@link feedStdout}. */
  readonly atlas: ScreenAtlas
  private drag:
    | { start: ScreenPoint; moved: boolean }
    | undefined
  private selection:
    | { start: ScreenPoint; end: ScreenPoint }
    | undefined
  private edgeTimer: ReturnType<typeof setInterval> | undefined
  private readonly openHref: (href: string) => void
  private readonly copy: (text: string) => void
  private readonly onScroll: MouseScrollListener
  private readonly startInterval: typeof setInterval
  private readonly stopInterval: typeof clearInterval

  /**
   * @param options - grid size and I/O hooks.
   */
  constructor(options: {
    columns?: number
    rows?: number
    openUrl?: (href: string) => void
    copyText?: (text: string) => void
    onScroll?: MouseScrollListener
    setInterval?: typeof setInterval
    clearInterval?: typeof clearInterval
  } = {}) {
    this.atlas = new ScreenAtlas(options.columns ?? 80, options.rows ?? 24)
    this.openHref = options.openUrl ?? openUrl
    this.copy = options.copyText ?? ((_text: string) => {
      // Production attachMouseIo always injects copyText; tests inject a spy.
    })
    this.onScroll = options.onScroll ?? notifyMouseScroll
    this.startInterval = options.setInterval ?? setInterval
    this.stopInterval = options.clearInterval ?? clearInterval
  }

  /**
   * Consume a decoded mouse event.
   * @param event - SGR report.
   */
  handle(event: SgrMouseEvent): void {
    if (event.kind === 'wheel' && event.delta !== undefined) {
      this.onScroll(event.delta)
      return
    }
    const point: ScreenPoint = { col: event.col, row: event.row }
    if (event.kind === 'press' && event.button === 'left') {
      this.stopEdge()
      this.drag = { start: point, moved: false }
      this.selection = { start: point, end: point }
      return
    }
    if (event.kind === 'drag' && this.drag !== undefined && event.button === 'left') {
      if (event.col !== this.drag.start.col || event.row !== this.drag.start.row) {
        this.drag.moved = true
      }
      this.selection = { start: this.drag.start, end: point }
      this.syncEdge(event.row)
      return
    }
    if (event.kind === 'release' && this.drag !== undefined) {
      this.stopEdge()
      if (this.drag.moved) {
        // A drag creates its selection with the same press and retains it until this release.
        const range = this.selection as { start: ScreenPoint; end: ScreenPoint }
        this.copy(this.atlas.extract(range.start, range.end))
      } else {
        const href = this.atlas.urlAt(event.col, event.row)
        if (href !== undefined) this.openHref(href)
      }
      this.drag = undefined
      this.selection = undefined
    }
  }

  /**
   * Feed a stdout chunk through the atlas and append a selection overlay.
   * @param chunk - bytes about to hit the terminal.
   * @returns chunk plus overlay and caret restore.
   */
  feedStdout(chunk: string): string {
    this.atlas.feed(chunk)
    if (this.selection === undefined) return chunk
    const overlay = this.atlas.selectionOverlay(
      this.selection.start,
      this.selection.end,
    )
    if (overlay === '') return chunk
    return `${chunk}${overlay}${publishedCaretBytes()}`
  }

  /**
   * Resize the atlas to the live terminal size.
   * @param columns - next width.
   * @param rows - next height.
   */
  resize(columns: number, rows: number): void {
    this.atlas.resize(columns, rows)
  }

  /** Clear timers. */
  dispose(): void {
    this.stopEdge()
  }

  private syncEdge(row: number): void {
    const top = row <= 2
    const bottom = row >= this.atlas.height - 1
    if (!top && !bottom) {
      this.stopEdge()
      return
    }
    const delta: 1 | -1 = top ? 1 : -1
    if (this.edgeTimer !== undefined) return
    this.onScroll(delta)
    this.edgeTimer = this.startInterval(() => {
      this.onScroll(delta)
    }, 80)
  }

  private stopEdge(): void {
    if (this.edgeTimer === undefined) return
    this.stopInterval(this.edgeTimer)
    this.edgeTimer = undefined
  }
}

/** Loose write covering WriteStream overloads. */
type WriteCall = (chunk: unknown, ...args: unknown[]) => boolean

/**
 * Wrap stdin/stdout for one mount: enable SGR on a TTY pair, strip mouse
 * bytes from Ink's input, and feed frames into a {@link MouseSession}.
 * @param options - live streams and optional I/O hooks.
 * @returns streams to hand Ink, plus a disposer that disables tracking.
 */
export function attachMouseIo(options: {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  session?: MouseSession
}): {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  session: MouseSession
  dispose: () => void
} {
  const session = options.session ?? new MouseSession({
    columns: options.stdout.columns,
    rows: options.stdout.rows,
    copyText: (text) => {
      copyText(text, (chunk) => {
        options.stdout.write(chunk)
      })
    },
    onScroll: notifyMouseScroll,
  })
  const tty = options.stdin.isTTY && options.stdout.isTTY
  if (!tty) {
    return {
      stdin: options.stdin,
      stdout: options.stdout,
      session,
      dispose: () => {
        session.dispose()
      },
    }
  }
  options.stdout.write(ENABLE_SGR_MOUSE)
  const wrappedStdin = wrapStdin(options.stdin, (event) => {
    session.handle(event)
  })
  const write = options.stdout.write.bind(options.stdout) as WriteCall
  const wrappedStdout = Object.create(options.stdout) as NodeJS.WriteStream
  const transformingWrite: WriteCall = (chunk, ...args) => {
    if (typeof chunk !== 'string') return write(chunk, ...args)
    return write(session.feedStdout(chunk), ...args)
  }
  wrappedStdout.write = transformingWrite
  const onResize = () => {
    session.resize(options.stdout.columns, options.stdout.rows)
  }
  options.stdout.on('resize', onResize)
  return {
    stdin: wrappedStdin.stdin,
    stdout: wrappedStdout,
    session,
    dispose: () => {
      options.stdout.off('resize', onResize)
      wrappedStdin.dispose()
      session.dispose()
      options.stdout.write(DISABLE_SGR_MOUSE)
    },
  }
}

function wrapStdin(
  raw: NodeJS.ReadStream,
  onMouse: (event: SgrMouseEvent) => void,
): { stdin: NodeJS.ReadStream; dispose: () => void } {
  // PassThrough supplies the readable surface Ink uses; the TTY-only members
  // below are assigned here, so the widening cast goes through unknown.
  const stream = new PassThrough() as unknown as NodeJS.ReadStream & {
    isTTY: boolean
  }
  stream.isTTY = true
  stream.setRawMode = (mode: boolean) => {
    if (typeof raw.setRawMode === 'function') raw.setRawMode(mode)
    return stream
  }
  stream.ref = () => {
    if (typeof raw.ref === 'function') raw.ref()
    return stream
  }
  stream.unref = () => {
    if (typeof raw.unref === 'function') raw.unref()
    return stream
  }
  let buffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const onData = (chunk: Buffer | string) => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const consumed = consumeMouseStdin(buffer)
    buffer = consumed.rest
    for (const event of consumed.mouse) onMouse(event)
    if (consumed.forward !== '') stream.write(consumed.forward)
    if (buffer !== '') {
      flushTimer = setTimeout(() => {
        stream.write(buffer)
        buffer = ''
        flushTimer = undefined
      }, ESC_TIMEOUT_MS)
    }
  }
  raw.on('data', onData)
  return {
    stdin: stream,
    dispose: () => {
      raw.off('data', onData)
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      if (buffer !== '') stream.write(buffer)
    },
  }
}
