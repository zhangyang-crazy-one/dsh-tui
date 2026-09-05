/** Per-tool source reader with bounded physical pages and explicit diagnostic disclosure. */
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { displayWidth, escapeContent } from './content.ts'
import { paintLineFromRenderLine } from './painted-line.ts'
import { createToolBodyDocument, materializeToolBodyRow, planToolBodyWindow, type ToolBodyCursor } from './tool-body.ts'
import { toolBodyRenderRow, toolHeadingRow } from './tool-rows.ts'
import { truncateDisplay, type ToolCardModel } from './tool-cards.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'

/** Source-reader navigation requested by the loop's single keyboard owner. */
export type ToolDetailsInput = 'back' | 'select' | 'up' | 'down' | 'previous' | 'next' | 'diagnostics' | 'copy' | 'export'

/** Controller snapshot; source cursor offsets survive terminal width changes. */
export interface ToolDetailsPaneState {
  readonly open: boolean
  readonly cards: readonly ToolCardModel[]
  readonly selectedIndex: number
  readonly detail: boolean
  readonly diagnostics: boolean
  readonly cursor: ToolBodyCursor
  readonly page: number
}

/** Stable empty snapshot for renderer-only compositions without this capability. */
export const EMPTY_TOOL_DETAILS_PANE: ToolDetailsPaneState = Object.freeze({
  open: false, cards: [], selectedIndex: 0, detail: false, diagnostics: false, cursor: { line: 0, offset: 0 }, page: 0,
})

/**
 * Render a windowed tool list or a resumable page of the selected result.
 * @param props - controller snapshot, locale, measured pane size, and page budget.
 * @returns only the rows fitting this pane; keyboard ownership remains in TuiLoop.
 */
export function ToolDetailsPane({ state, columns, maxRows, pageRows, locale }: {
  state: ToolDetailsPaneState
  columns: number
  maxRows: number
  pageRows: number
  locale: TuiLocale
}): ReactNode {
  const capacity = Math.max(1, maxRows - 3)
  const selected = state.cards[state.selectedIndex]
  const lines: string[] = []
  let heading = `/tools · ${state.cards.length === 0 ? '0' : state.selectedIndex + 1}/${state.cards.length}`
  if (state.detail && selected !== undefined) {
    const row = toolHeadingRow(selected, Math.max(1, columns - displayWidth(heading) - 3), true, locale)
    heading += ` · ${paintLineFromRenderLine(row, false)}`
  }
  if (selected === undefined) lines.push(tuiCopy('noTools', locale))
  else if (!state.detail) {
    const first = Math.max(0, Math.min(state.selectedIndex - Math.floor(capacity / 2), state.cards.length - capacity))
    for (let index = first; index < Math.min(state.cards.length, first + capacity); index += 1) {
      const prefix = index === state.selectedIndex ? '> ' : '  '
      const card = state.cards[index] as ToolCardModel
      const row = toolHeadingRow(card, Math.max(1, columns - displayWidth(prefix)), false, locale)
      lines.push(`${prefix}${paintLineFromRenderLine(row, false)}`)
    }
  } else {
    const document = createToolBodyDocument(selected, { locale, diagnostics: state.diagnostics, includeArguments: true })
    const page = planToolBodyWindow(document, state.cursor, Math.max(1, columns - 2), Math.min(capacity, pageRows))
    for (const [index, fragment] of page.fragments.entries()) {
      const row = toolBodyRenderRow(materializeToolBodyRow(document, fragment), index, columns)
      lines.push(paintLineFromRenderLine(row, false))
    }
    lines.push(truncateDisplay(`${state.page + 1} · ${page.remainingLines} ${tuiCopy('remaining', locale)} · d ${tuiCopy('diagnostics', locale)} ${tuiCopy(state.diagnostics ? 'on' : 'off', locale)}`, columns))
  }
  return <Box flexDirection="column" width="100%">
    <Text wrap="truncate">{heading}</Text>
    {lines.map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
    <Text dimColor wrap="truncate">{escapeContent(tuiCopy(state.detail ? 'toolPageHint' : 'toolListHint', locale))}</Text>
  </Box>
}
