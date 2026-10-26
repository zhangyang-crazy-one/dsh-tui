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
import { useLayoutEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { composerFrameAnchor } from './composer-cursor.ts'
import { composerIndex, composerRowBudget, composerRowWindow } from './composer-index.ts'
import { displayWidth, escapeContent } from './content.ts'
import { hideFrameCaret, setFrameCaret } from './frame-fill.ts'
import { writeTerminalControl } from './terminal-output.ts'
import { currentTier, inkColor, paintBackgroundRow, styled } from './theme.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'
import { maskComposerInput } from './secret-input.ts'

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
  /** Instructions for a value editor that temporarily owns the composer. */
  actionHint?: string
  /** Mask a credential editor while keeping the owner-controlled source buffer intact. */
  secret?: boolean
  /** Presentation-copy locale, Chinese when omitted. */
  locale?: TuiLocale
  /** The buffered text to display. */
  text: string
  /** Command menu open state (the header names the command mode). */
  commandMode: boolean
  /** Mention mode open state (the header names the mention mode). */
  mentionMode: boolean
  /** Palette and status rows below the composer, excluded from its caret row. */
  rowsBelow?: number
  /** Caret offset into `text`; omitted means the end of the buffer. */
  caretIndex?: number | undefined
  /** Selection origin in the unmasked buffer's UTF-16 coordinates. */
  selectionAnchor?: number | undefined
  /** Model name to show in the composer frame chip. */
  modelChip?: string | undefined
  /** Mode name ('agent' | 'plan' | 'focus') to show in the composer frame chip. */
  modeChip?: string | undefined
}

/** Width of the prompt marker (`> `) before the buffered text. */
const PROMPT_WIDTH = 2

/** Dim placeholder shown when the composer buffer is empty. */
export const COMPOSER_PLACEHOLDER = tuiCopy('inputHint')

/**
 * The composer panel: title, accent prompt marker, buffered text, and mode hints, with the
 * terminal cursor anchored at the composer caret. AppShell pins the frame to
 * the terminal height; {@link composerFrameAnchor} determines the caret's
 * distance above the bottom, which is converted to an absolute terminal row.
 * The position is appended after Ink's frame via {@link setFrameCaret} and published during
 * render because Ink writes frames from resetAfterCommit, which precedes
 * layout and passive effects and would otherwise leave the cursor one commit
 * behind the text.
 * @param props - display state.
 * @returns the element tree.
 */
export function InputBar({
  text: sourceText,
  commandMode,
  mentionMode,
  rowsBelow = 0,
  caretIndex: sourceCaretIndex,
  selectionAnchor: sourceSelectionAnchor,
  modelChip,
  modeChip,
  locale,
  secret,
  actionHint,
}: InputBarProps): ReactNode {
  const { text, caretIndex } = maskComposerInput(sourceText, sourceCaretIndex ?? sourceText.length, secret)
  const selectionAnchor = sourceSelectionAnchor === undefined ? undefined
    : maskComposerInput(sourceText, sourceSelectionAnchor, secret).caretIndex
  const { stdout } = useStdout()
  const { columns, rows } = useWindowSize()
  const index = useMemo(() => composerIndex(text), [text])
  const caret = index.snapCaret(caretIndex ?? text.length)
  const selectionCaret = selectionAnchor === undefined ? undefined : caret
  const selectionStart = selectionAnchor === undefined ? undefined : index.snapCaret(selectionAnchor)
  const selection = selectionCaret === undefined || selectionStart === undefined || selectionCaret === selectionStart
    ? undefined : { start: Math.min(selectionCaret, selectionStart), end: Math.max(selectionCaret, selectionStart) }
  const caretLine = index.rowAt(caret)
  const rowWindow = composerRowWindow(index, caret, rows, rowsBelow)
  const visibleLines = Array.from({ length: rowWindow.end - rowWindow.start }, (_, offset) => {
    const row = rowWindow.start + offset
    return { row, window: index.line(row).window(
      row === caretLine ? caret - (index.lineStarts[row] as number) : undefined, Math.max(1, columns - 4),
    ) }
  })
  const hiddenHint = rowWindow.hiddenAbove + rowWindow.hiddenBelow > 0
    ? `↑${rowWindow.hiddenAbove} ↓${rowWindow.hiddenBelow}` : ''
  const inlineHint = composerRowBudget(rows, rowsBelow) === 1
  const anchor = composerFrameAnchor(text, caret, {
    promptWidth: 2 + PROMPT_WIDTH,
    columns,
    rows,
    fullscreen: stdout.isTTY,
    rowsBelow,
    lineWindow: rowWindow,
  })
  const caretRow = Math.max(1, rows - anchor.up)
  const caretWindow = (visibleLines[caretLine - rowWindow.start] as (typeof visibleLines)[number]).window
  const caretCol = Math.min(columns, 5 + caretWindow.caretColumn)
  setFrameCaret({ row: caretRow, col: caretCol })

  // Left/right only changes caretIndex, so Ink may skip the frame write.
  // Absolute positioning also restores a newly mounted editor after the old
  // editor's layout cleanup hid the cursor during the same commit.
  useLayoutEffect(() => {
    if (!stdout.isTTY) return
    setFrameCaret({ row: caretRow, col: caretCol })
    writeTerminalControl(stdout, `\x1b[${caretRow};${caretCol}H\x1b[?25h`, 'caret')
  }, [caretRow, caretCol, stdout])

  // Park the cursor when the composer unmounts (a full-content panel owns the
  // screen); the next mounted composer republishes its caret.
  useLayoutEffect(() => {
    return () => {
      hideFrameCaret()
    }
  }, [])
  const chipText = modeChip && modelChip
    ? `${modeChip} · ${modelChip}`
    : (modeChip ?? modelChip ?? '')
  const leftPrefix = '│ '
  const placeholder = tuiCopy('inputHint', locale)
  const sendHint = tuiCopy('sendHint', locale)
  // The open palette owns Enter/Esc, so the header names the active mode.
  const modeHint = actionHint ?? (commandMode
    ? tuiCopy('commandModeHint', locale)
    : mentionMode ? tuiCopy('mentionModeHint', locale) : undefined)
  const leftHint = modeHint === undefined ? `› ${placeholder} · ${sendHint}` : `› ${modeHint}`
  const leftWidth = displayWidth(leftPrefix + leftHint)
  const chipWidth = chipText !== '' ? displayWidth(chipText) : 0
  const canFitChip = chipWidth > 0 && leftWidth + chipWidth + 2 <= columns
  const headerParts = [
    styled(escapeContent(leftPrefix), 'accentText'),
    ...(modeHint === undefined
      ? [
        styled(escapeContent(`› ${placeholder}`), 'fg'),
        styled(escapeContent(` · ${sendHint}`), 'fgDim'),
      ]
      : [styled(escapeContent(`› ${modeHint}`), 'accent')]),
    ...(canFitChip
      ? [
        ' '.repeat(Math.max(1, columns - leftWidth - chipWidth)),
        styled(escapeContent(chipText), 'fgDim'),
      ]
      : []),
  ]
  return (
    <Box
      flexDirection="column"
      width="100%"
      backgroundColor={inkColor('inputBg')}
    >
      <Text wrap="truncate">
        {paintBackgroundRow(inlineHint && hiddenHint !== '' ? [styled(hiddenHint, 'fgDim')] : headerParts, 'inputBg', columns)}
      </Text>
      {!inlineHint && hiddenHint !== '' && <Text wrap="truncate">
        {paintBackgroundRow([styled(`│ ${hiddenHint}`, 'fgDim')], 'inputBg', columns)}
      </Text>}
      {visibleLines.map(({ row: lineIndex, window }) => {
        const lineStart = index.lineStarts[lineIndex] as number
        const parts: { text: string; kind: (typeof window.glyphs)[number]['kind']; selected: boolean }[] = []
        for (const glyph of window.glyphs) {
          const selected = selection !== undefined && lineStart + glyph.start >= selection.start
            && lineStart + glyph.start < selection.end
          const previous = parts.at(-1)
          if (previous?.kind === glyph.kind && previous.selected === selected) previous.text += glyph.text
          else parts.push({ text: glyph.text, kind: glyph.kind, selected })
        }
        const tokenParts = parts.map(part => {
          const painted = styled(part.text, part.kind === 'command' || part.kind === 'mention'
            ? 'accent' : part.kind === 'image' ? 'fgDim' : 'fg')
          return part.selected && currentTier() !== 'none' ? `\x1b[7m${painted}\x1b[27m` : painted
        })
        return (
          <Text key={lineIndex} wrap="truncate">
            {paintBackgroundRow([
              styled(escapeContent('│ '), 'accentText'),
              styled(escapeContent(lineIndex === 0 ? '> ' : '  '), 'accentText'),
              ...(window.hiddenPrefix ? [styled('‹', 'fgDim')] : []),
              ...tokenParts,
            ], 'inputBg', columns)}
          </Text>
        )
      })}
    </Box>
  )
}
