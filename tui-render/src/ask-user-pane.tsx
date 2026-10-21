/**
 * AskUserPane: the composer-slot numbered option list for one in-flight
 * user question. Presentational only — keys route through {@link mapKeyEvent}
 * in the loop owner, and the runtime answers `ctx.userQuestions`.
 * @module @deepseek-ai/dsh-tui-render/ask-user-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { renderPaneLine as line } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'
import { useDialogTextRows, useDialogWindow } from './dialog-window.ts'
import { InputBar } from './input-bar.tsx'

interface AnswerEditorState {
  readonly multiSelect?: boolean
  readonly selectedIndices?: readonly number[]
  readonly editingCustom?: boolean
  readonly customText?: string
  readonly customCaretIndex?: number
  readonly questionNumber?: number
  readonly questionCount?: number
  readonly detail?: string
  readonly optionDescriptions?: readonly string[]
}

/** Exact key footnote when the question has at least one option. */
const FOOTNOTE = 'Enter 作答 · Esc 取消提问'
/** Host-error heading when the question has zero options (S16). */
const INVALID_TITLE = '✗ 提问无效'
/** Next-step copy for a zero-option question. */
const INVALID_NEXT = 'Esc 取消'

/** AskUserPane props. */
export interface AskUserPaneProps extends AnswerEditorState {
  customRowsBelow?: number
  /** Question header or prompt (untrusted). */
  header: string
  /** Option labels in display order (untrusted). */
  options: readonly string[]
  /** Highlighted option index. */
  selectedIndex: number
  maxRows?: number
  maxCols?: number
  detailsOpen?: boolean
  offset?: number
  onOffsetChange?: (offset: number) => void
}

/** Controller snapshot backing the ask-user composer slot. */
export interface AskUserPaneState extends AnswerEditorState {
  /** Whether the slot currently occupies the composer. */
  open: boolean
  requestId?: number
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
 * The ask-user dialog: numbered choices, a custom-answer editor, and bounded full text.
 * Does not call `ctx.userQuestions`.
 * @param props - header, labels, and the highlighted index.
 * @returns the element tree.
 */
export function AskUserPane({
  header, options, selectedIndex, maxRows, maxCols, detailsOpen = false, offset = 0, onOffsetChange,
  multiSelect, selectedIndices, editingCustom, customText, customCaretIndex,
  questionNumber, questionCount, detail, optionDescriptions, customRowsBelow,
}: AskUserPaneProps): ReactNode {
  const size = useWindowSize()
  const width = Math.max(1, maxCols ?? (size.columns || 80))
  const height = Math.max(4, maxRows ?? (size.rows || 24) - 6)
  const limit = Math.max(0, height - 4)
  const selected = Math.max(0, Math.min(selectedIndex, options.length - 1))
  const source = detailsOpen ? [header, detail, options.length === 0 ? '' : `${selected + 1}. ${options[selected] ?? ''}`,
    optionDescriptions?.[selected], customText === undefined ? '' : `自定义: ${customText}`,
  ].filter(Boolean).join('\n\n') : ''
  const detailRows = useDialogTextRows(source, width)
  const view = useDialogWindow(detailRows, offset, limit, detailsOpen ? onOffsetChange : undefined)
  const progress = questionCount === undefined ? '' : ` (${questionNumber}/${questionCount})`
  if (editingCustom && !detailsOpen) return <Box flexDirection="column" width="100%" flexShrink={0}>
    <Text wrap="truncate">{paintRow([styled(`${escapeContent(header)}${progress}`, 'fg', undefined, true)])}</Text>
    <InputBar text={(customText ?? '').replace(/[\r\n]/gu, '↵')} commandMode={false} mentionMode={false}
      caretIndex={customCaretIndex} rowsBelow={customRowsBelow ?? 2} />
    <Text wrap="truncate">{paintRow([styled('Enter 确认 · Tab 全文 · Esc 取消', 'fgDim')])}</Text>
  </Box>
  if (options.length === 0 && !editingCustom) {
    return <Box flexDirection="column" width="100%" flexShrink={0}>{line(INVALID_TITLE, 'error', true)}{line(INVALID_NEXT, 'fgDim')}</Box>
  }
  const start = Math.max(0, Math.min(options.length - limit, selected - Math.floor(limit / 2)))
  const position = detailsOpen ? ` ${view.start + 1}–${view.start + view.visible.length}/${view.total}` : ''
  const heading = detailsOpen ? `提问全文${options.length === 0 ? progress : ` · 选项 ${selected + 1}/${options.length}`}${position}` : `${escapeContent(header || '请选择').replace(/\n/g, ' ↵ ')}${progress}`
  return (
    <Box flexDirection="column" width="100%" flexShrink={0}>
      <Text wrap="truncate">{paintRow([styled(heading, 'fg', undefined, true)])}</Text>
      {detailsOpen ? view.visible.map((text, index) => (
        <Text key={view.start + index} wrap="truncate">{paintRow([styled(text || ' ', 'fg')])}</Text>
      )) : options.slice(start, start + limit).map((label, index) => {
        const actualIndex = start + index
        const active = actualIndex === selected
        const marker = multiSelect ? (selectedIndices?.includes(actualIndex) ? '[x] ' : '[ ] ') : ''
        const numbered = escapeContent(`${actualIndex + 1} ${marker}${label}`).replace(/\n/g, ' ↵ ')
        return <Text key={actualIndex} wrap="truncate">{paintRow([
          styled(active ? '› ' : '  ', 'accent', undefined, active),
          styled(numbered, active ? 'fg' : 'fgDim', undefined, active),
        ])}</Text>
      })}
      <Box flexDirection="column" width="100%" flexShrink={0}>
        <Text wrap="truncate">{paintRow([styled(editingCustom ? 'Tab/Esc 返回输入' : FOOTNOTE, 'fgDim')])}</Text>
        <Text wrap="truncate">{paintRow([styled(editingCustom ? '↑↓/jk 滚动 · Home/End 首尾' : multiSelect ? '↑↓ 移动 · Space 多选 · c 自定义' : '↑↓/jk 移动 · 1-9 选择 · c 自定义', 'fgDim')])}</Text>
        <Text wrap="truncate">{paintRow([styled(editingCustom ? 'PgUp/PgDn 翻页' : customText === undefined ? '[i] 全文 · PgUp/PgDn 翻页' : '已有自定义回答 · [i] 全文', 'fgDim')])}</Text>
      </Box>
    </Box>
  )
}
