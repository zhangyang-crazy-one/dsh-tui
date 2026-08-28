/**
 * AskUserPane: the composer-slot numbered option list for one in-flight
 * user question. Presentational only — keys route through {@link mapKeyEvent}
 * in the loop owner, and the runtime answers `ctx.userQuestions`.
 * @module @deepseek-ai/dsh-tui-render/ask-user-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Exact key footnote when the question has at least one option. */
const FOOTNOTE = '↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问'
/** Host-error heading when the question has zero options (S16). */
const INVALID_TITLE = '✗ 提问无效'
/** Next-step copy for a zero-option question. */
const INVALID_NEXT = 'Esc 取消'

/** AskUserPane props. */
export interface AskUserPaneProps {
  /** Question header or prompt (untrusted). */
  header: string
  /** Option labels in display order (untrusted). */
  options: readonly string[]
  /** Highlighted option index. */
  selectedIndex: number
}

/** Controller snapshot backing the ask-user composer slot. */
export interface AskUserPaneState {
  /** Whether the slot currently occupies the composer. */
  open: boolean
  /** Question header or prompt (untrusted). */
  header: string
  /** Option labels in display order (untrusted). */
  options: readonly string[]
  /** Highlighted option index. */
  selectedIndex: number
}

/** Closed snapshot: TuiLoop keeps the ordinary composer. */
export const EMPTY_ASK_USER_PANE: AskUserPaneState = {
  open: false,
  header: '',
  options: [],
  selectedIndex: 0,
}

/**
 * One painted, escaped row in the composer slot.
 * @param text - untrusted or static copy.
 * @param token - theme token.
 * @param bold - heading uses the fg bold tier.
 * @returns the Text element.
 */
function line(
  text: string,
  token: 'fg' | 'fgDim' | 'error' | 'accent',
  bold = false,
): ReactNode {
  return (
    <Text>
      {paintRow([styled(escapeContent(text), token, undefined, bold)])}
    </Text>
  )
}

/**
 * The ask-user dialog: header, numbered labels, or the zero-option error.
 * Does not call `ctx.userQuestions`.
 * @param props - header, labels, and the highlighted index.
 * @returns the element tree.
 */
export function AskUserPane({
  header,
  options,
  selectedIndex,
}: AskUserPaneProps): ReactNode {
  if (options.length === 0) {
    return (
      <Box flexDirection="column" width="100%">
        {line(INVALID_TITLE, 'error', true)}
        {line(INVALID_NEXT, 'fgDim')}
      </Box>
    )
  }
  const footnote = FOOTNOTE
  return (
    <Box flexDirection="column" width="100%">
      {header !== '' ? line(header, 'fg', true) : null}
      {options.map((label, index) => {
        const selected = index === selectedIndex
        const numbered = `${index + 1} ${label}`
        return (
          <Box key={`${index}:${label}`} width="100%">
            <Text>
              {selected
                ? styled(escapeContent('› '), 'accent', undefined, true)
                : '  '}
            </Text>
            <Text>
              {paintRow([styled(escapeContent(numbered), selected ? 'fg' : 'fgDim')])}
            </Text>
          </Box>
        )
      })}
      {line(footnote, 'fgDim')}
    </Box>
  )
}
