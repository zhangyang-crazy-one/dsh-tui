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
  it('does not cursor-up on a fullscreen TTY empty composer', async () => {
    expect(await publishedCaret('', true)).toBe('\x1b[?2026l\x1b[3G\x1b[?25h')
  })

  it('places the fullscreen TTY caret after the buffered text', async () => {
    expect(await publishedCaret('hi', true)).toBe('\x1b[?2026l\x1b[5G\x1b[?25h')
  })

  it('places the fullscreen TTY caret at a mid-buffer index', async () => {
    expect(await publishedCaret('hello', true, 0)).toBe(
      '\x1b[?2026l\x1b[3G\x1b[?25h',
    )
    expect(await publishedCaret('hello', true, 1)).toBe(
      '\x1b[?2026l\x1b[4G\x1b[?25h',
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
      expect(chunks.join('')).toContain('\x1b[24;3H')
    } finally {
      instance.unmount()
      setFrameCaret(undefined)
    }
  })

  it('cursor-ups once after a non-TTY trailing-newline frame', async () => {
    expect(await publishedCaret('', false)).toBe(
      '\x1b[?2026l\x1b[1A\x1b[3G\x1b[?25h',
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
        '\x1b[?2026l\x1b[4G\x1b[?25h',
      )
    } finally {
      instance.unmount()
      setFrameCaret(undefined)
    }
  })
})

describe('InputBar prompt', () => {
  it('paints the composer prompt in accent', () => {
    const out = renderToString(
      createElement(InputBar, {
        text: 'hi',
        commandMode: false,
        mentionMode: false,
      }),
    )
    expect(out).toContain('\x1b[38;2;77;107;254m> ')
    expect(out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')).toContain('> hi')
  })

  it('paints a dim placeholder when the buffer is empty', () => {
    const out = renderToString(
      createElement(InputBar, {
        text: '',
        commandMode: false,
        mentionMode: false,
      }),
    )
    expect(out).toContain('输入消息')
    expect(out).toContain('\x1b[38;2;138;143;152m输入消息')
    expect(out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')).toContain('> 输入消息')
  })

  it('paints a slash command in accent', () => {
    const out = renderToString(
      createElement(InputBar, {
        text: '/settings',
        commandMode: false,
        mentionMode: false,
      }),
    )
    expect(out).toContain('\x1b[38;2;77;107;254m> /settings')
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
    expect(out).toContain('\x1b[38;2;138;143;152m[图片 #1]')
    expect(out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')).toContain(`> ${text}`)
  })
})
