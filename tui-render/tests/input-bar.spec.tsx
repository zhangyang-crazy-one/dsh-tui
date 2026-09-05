/**
 * InputBar publishes the fullscreen last-row caret so the frame stream does
 * not move the cursor onto the status line of a TTY AppShell.
 */

import { describe, expect, it } from 'vitest'
import { render, renderToString } from 'ink'
import { createElement } from 'react'
import { EMPTY_INPUT, handleInput, InputBar } from '../src/input-bar.tsx'
import { setFrameCaret, transformFrameChunk } from '../src/frame-fill.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

function ttyStdout(isTTY: boolean) {
  const stream = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
    isTTY: boolean
    columns: number
    rows: number
  }
  stream.isTTY = isTTY
  stream.columns = 80
  stream.rows = 24
  return stream
}

async function publishedCaret(
  text: string,
  isTTY: boolean,
  caretIndex?: number,
): Promise<string> {
  setFrameCaret(undefined)
  const instance = render(
    createElement(InputBar, {
      text,
      caretIndex,
      commandMode: false,
      mentionMode: false,
    }),
    {
      stdout: ttyStdout(isTTY),
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    },
  )
  try {
    await instance.waitUntilRenderFlush()
    return transformFrameChunk('\x1b[?2026l', 'none')
  } finally {
    instance.unmount()
    setFrameCaret(undefined)
  }
}

describe('handleInput', () => {
  it('sends on Enter and clears the buffer', () => {
    const next = handleInput(
      { ...EMPTY_INPUT, text: 'hi' },
      { input: 'return', ctrl: false, shift: false },
    )
    expect(next.command).toEqual({ kind: 'send', text: 'hi' })
    expect(next.state.text).toBe('')
  })

  it('cancels command and mention modes on Enter or Escape', () => {
    expect(
      handleInput(
        { ...EMPTY_INPUT, commandMode: true },
        { input: 'return', ctrl: false, shift: false },
      ).command.kind,
    ).toBe('cancel')
    expect(
      handleInput(
        { ...EMPTY_INPUT, mentionMode: true },
        { input: 'return', ctrl: false, shift: false },
      ).command.kind,
    ).toBe('cancel')
    expect(
      handleInput(
        { ...EMPTY_INPUT, mentionMode: true },
        { input: 'escape', ctrl: false, shift: false },
      ).command.kind,
    ).toBe('cancel')
  })

  it('opens command and mention modes on / and @', () => {
    expect(
      handleInput(EMPTY_INPUT, { input: '/', ctrl: false, shift: false }).state
        .commandMode,
    ).toBe(true)
    expect(
      handleInput(EMPTY_INPUT, { input: '@', ctrl: false, shift: false }).state
        .mentionMode,
    ).toBe(true)
  })

  it('deletes the last character on Backspace and ignores other keys', () => {
    expect(
      handleInput(
        { ...EMPTY_INPUT, text: 'ab' },
        { input: 'backspace', ctrl: false, shift: false },
      ).state.text,
    ).toBe('a')
    expect(
      handleInput(EMPTY_INPUT, { input: 'x', ctrl: false, shift: false }).command
        .kind,
    ).toBe('none')
  })
})

describe('InputBar caret publish', () => {
  it('anchors the fullscreen caret on the full-width panel input row', async () => {
    expect(await publishedCaret('', true)).toBe('\x1b[24;5H\x1b[?25h\x1b[?2026l')
  })

  it('places the fullscreen TTY caret after the buffered text', async () => {
    expect(await publishedCaret('hi', true)).toBe('\x1b[24;7H\x1b[?25h\x1b[?2026l')
  })

  it('places the fullscreen TTY caret at a mid-buffer index', async () => {
    expect(await publishedCaret('hello', true, 0)).toBe(
      '\x1b[24;5H\x1b[?25h\x1b[?2026l',
    )
    expect(await publishedCaret('hello', true, 1)).toBe(
      '\x1b[24;6H\x1b[?25h\x1b[?2026l',
    )
  })

  it('writes an absolute CUP when only the caret index changes', async () => {
    const stdout = ttyStdout(true)
    const chunks: string[] = []
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(
      createElement(InputBar, {
        text: 'hello',
        caretIndex: 5,
        commandMode: false,
        mentionMode: false,
      }),
      {
        stdout,
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      chunks.length = 0
      instance.rerender(
        createElement(InputBar, {
          text: 'hello',
          caretIndex: 0,
          commandMode: false,
          mentionMode: false,
        }),
      )
      await instance.waitUntilRenderFlush()
      expect(chunks.join('')).toContain('\x1b[24;5H')
    } finally {
      instance.unmount()
      setFrameCaret(undefined)
    }
  })

  it('anchors above the trailing newline for a non-TTY frame', async () => {
    expect(await publishedCaret('', false)).toBe(
      '\x1b[23;5H\x1b[?25h\x1b[?2026l',
    )
  })

  it('renders command and mention mode hints without moving the caret origin', async () => {
    setFrameCaret(undefined)
    const instance = render(
      createElement(InputBar, {
        text: 'x',
        commandMode: true,
        mentionMode: true,
      }),
      {
        stdout: ttyStdout(true),
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      expect(transformFrameChunk('\x1b[?2026l', 'none')).toBe(
        '\x1b[24;6H\x1b[?25h\x1b[?2026l',
      )
    } finally {
      instance.unmount()
      setFrameCaret(undefined)
    }
  })
})

describe('InputBar prompt', () => {
  it('paints the composer prompt in the readable accent', () => {
    const out = renderToString(
      createElement(InputBar, {
        text: 'hi',
        commandMode: false,
        mentionMode: false,
      }),
    )
    expect(out).toContain('\x1b[38;2;117;137;255m│ > ')
    expect(out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')).toContain('> hi')
    expect(out).toContain('\x1b[48;2;35;38;43m')
  })

  it('paints a title hint and leaves the empty input row at the prompt', () => {
    const out = renderToString(
      createElement(InputBar, {
        text: '',
        commandMode: false,
        mentionMode: false,
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
    expect(plain).toContain('› 输入消息 · Enter 发送')
    expect(plain).toContain('\n│ > ')
  })

  it('paints a slash command in accent', () => {
    const out = renderToString(
      createElement(InputBar, {
        text: '/settings',
        commandMode: false,
        mentionMode: false,
      }),
    )
    expect(out).toContain('\x1b[38;2;117;137;255m│ > ')
    expect(out).toContain('\x1b[38;2;77;107;254m/settings')
  })

  it('paints semantic segments while preserving the exact composer text', () => {
    const text = '请 /compact @worker [图片 #1] 完成'
    const out = renderToString(
      createElement(InputBar, {
        text,
        commandMode: false,
        mentionMode: false,
      }),
    )
    expect(out).toContain('\x1b[38;2;77;107;254m/compact')
    expect(out).toContain('\x1b[38;2;77;107;254m@worker')
    expect(out).toContain('\x1b[38;2;164;169;176m[图片 #1]')
    expect(out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')).toContain(`> ${text}`)
  })
})
