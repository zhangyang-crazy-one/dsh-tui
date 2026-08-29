/**
 * InputBar: the full-width bottom input panel — title hint, accent left rail,
 * buffered text, and mode hints. Purely presentational: every key routes through {@link mapKeyEvent}
 * in the loop owner, which is the single input listener, so Enter and the
 * panel actions dispatch exactly once. The terminal cursor is anchored at the
 * composer caret ({@link composerFrameAnchor} + frame-stream CSI): Ink 7.1.1
 * exposes no runtime IME composition state, and the terminal emulator renders
 * its native inline preedit at the cursor, so anchoring the caret is the
 * whole platform contract — no detection, no yield branch.
 * @module @deepseek-ai/dsh-tui-render/input-bar
 */

import { Box, Text, useStdout, useWindowSize } from 'ink'
import { useEffect, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import { composerFrameAnchor } from './composer-cursor.ts'
import { tokenizeComposer } from './composer-tokens.ts'
import { escapeContent } from './content.ts'
import { hideFrameCaret, setFrameCaret } from './frame-fill.ts'
import { inkColor, paintBackgroundRow, styled } from './theme.ts'

/** Input state handed between the state machine steps. */
export interface InputState {
  /** The buffered text. */
  text: string
  /** Whether the command-menu mode is open. */
  commandMode: boolean
  /** Whether the mention mode is open. */
  mentionMode: boolean
}

/** Result of one input event over the state machine. */
export interface InputEvent {
  /** Key name as Ink reports it. */
  input: string
  /** Modifier flags. */
  ctrl: boolean
  shift: boolean
}

/** Empty input state. */
export const EMPTY_INPUT: InputState = {
  text: '',
  commandMode: false,
  mentionMode: false,
}

/** What the state machine asks the owner to do. */
export type InputCommand =
  | { kind: 'none' }
  | { kind: 'send'; text: string }
  | { kind: 'open-command' }
  | { kind: 'open-mention' }
  | { kind: 'cancel' }

/**
 * Fold one key event over the input state. Pure, so tests drive every
 * branch without a terminal.
 * @param state - current state.
 * @param event - the key event.
 * @returns the next state and the command to dispatch.
 */
export function handleInput(
  state: InputState,
  event: InputEvent,
): { state: InputState; command: InputCommand } {
  if (event.input === 'return') {
    if (state.commandMode || state.mentionMode) {
      return {
        state: { ...state, commandMode: false, mentionMode: false },
        command: { kind: 'cancel' },
      }
    }
    return { state: EMPTY_INPUT, command: { kind: 'send', text: state.text } }
  }
  if (event.input === 'escape') {
    return {
      state: { ...state, commandMode: false, mentionMode: false },
      command: { kind: 'cancel' },
    }
  }
  if (event.input === '/') {
    return {
      state: { ...state, commandMode: true },
      command: { kind: 'open-command' },
    }
  }
  if (event.input === '@') {
    return {
      state: { ...state, mentionMode: true },
      command: { kind: 'open-mention' },
    }
  }
  if (event.input === 'backspace') {
    return {
      state: { ...state, text: state.text.slice(0, -1) },
      command: { kind: 'none' },
    }
  }
  return { state, command: { kind: 'none' } }
}

/** InputBar props: display state the keymap owner supplies. */
export interface InputBarProps {
  /** The buffered text to display. */
  text: string
  /** Command menu open state (renders the `/` hint). */
  commandMode: boolean
  /** Mention mode open state (renders the `@` hint). */
  mentionMode: boolean
  /** Palette rows painted under the composer; the caret counts them in `up`. */
  rowsBelow?: number
  /** Caret offset into `text`; omitted means the end of the buffer. */
  caretIndex?: number | undefined
}

/** Width of the prompt marker (`> `) before the buffered text. */
const PROMPT_WIDTH = 2

/** Dim placeholder shown when the composer buffer is empty. */
export const COMPOSER_PLACEHOLDER = '输入消息'

/**
 * The composer panel: title, accent prompt marker, buffered text, and mode hints, with the
 * terminal cursor anchored at the composer caret. AppShell pins the frame to
 * the terminal height, so a TTY write is Ink's fullscreen path (no trailing
 * newline, cursor left on the last output row). {@link composerFrameAnchor}
 * turns that origin plus the `> `-prefixed caret column into the CSI appended
 * after Ink's frame via {@link setFrameCaret}. The value is published during
 * render because Ink writes frames from resetAfterCommit, which precedes
 * layout and passive effects and would otherwise leave the cursor one commit
 * behind the text.
 * @param props - display state.
 * @returns the element tree.
 */
export function InputBar({
  text,
  commandMode,
  mentionMode,
  rowsBelow = 0,
  caretIndex,
}: InputBarProps): ReactNode {
  const { stdout } = useStdout()
  const { columns, rows } = useWindowSize()
  const anchor = composerFrameAnchor(text, caretIndex ?? text.length, {
    promptWidth: 2 + PROMPT_WIDTH,
    columns,
    rows,
    fullscreen: stdout.isTTY,
    rowsBelow,
  })
  // Publish during render (see the module doc): the frame stream appends this
  // anchor after Ink's own cursor suffix, so the visible cursor tracks the
  // caret in the same frame as the text. TTY + full-height AppShell is Ink's
  // fullscreen path, so the last composer line is `up = 0`.
  setFrameCaret(anchor)

  // Left/right only changes caretIndex, so Ink may skip the frame write.
  // Absolute CUP still moves the hardware cursor when the painted row is
  // unchanged. Omit SHOW_CURSOR so the frame-fill wrapper does not append a
  // second, origin-relative suffix.
  useLayoutEffect(() => {
    if (!stdout.isTTY) return
    stdout.write(`\x1b[${Math.max(1, rows - anchor.up)};${anchor.col}H`)
  }, [anchor.up, anchor.col, rows, stdout])

  // Park the cursor when the composer unmounts (a full-content panel owns the
  // screen); the next mounted composer republishes its caret.
  useEffect(() => {
    return () => {
      hideFrameCaret()
    }
  }, [])
  const lines = text.split('\n')
  return (
    <Box
      flexDirection="column"
      width="100%"
      backgroundColor={inkColor('codeBg')}
    >
      <Text wrap="truncate">
        {paintBackgroundRow([
          styled(escapeContent('│ '), 'accent'),
          styled(escapeContent(`› ${COMPOSER_PLACEHOLDER}`), 'fg'),
          styled(escapeContent(' · Enter 发送'), 'fgDim'),
        ], 'codeBg', columns)}
      </Text>
      {lines.map((line, lineIndex) => {
        const tokenParts = tokenizeComposer(line).map(token => styled(
          escapeContent(token.text),
          token.kind === 'command' || token.kind === 'mention'
            ? 'accent'
            : token.kind === 'image'
              ? 'fgDim'
              : 'fg',
        ))
        const last = lineIndex === lines.length - 1
        return (
          <Text key={lineIndex} wrap="truncate">
            {paintBackgroundRow([
              styled(escapeContent('│ '), 'accent'),
              styled(escapeContent(lineIndex === 0 ? '> ' : '  '), 'accent'),
              ...tokenParts,
              ...(last && commandMode ? [styled(escapeContent(' /'), 'fgDim')] : []),
              ...(last && mentionMode ? [styled(escapeContent(' @'), 'fgDim')] : []),
            ], 'codeBg', columns)}
          </Text>
        )
      })}
    </Box>
  )
}
