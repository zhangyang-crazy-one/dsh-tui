/** Indexed tool detail sources and bounded physical-row windows; raw content remains intact. */

import { displayWidth, escapeContent } from './content.ts'
import { indexedRows, RowSequence, type RowSource } from './row-source.ts'
import type { ToolCardModel } from './tool-cards.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'

/** Raw tool fields required by the detail reader; identity stays with the owning card. */
export type ToolBodyCard = Omit<ToolCardModel, 'callId'>

/** Explicit choice of diagnostic data, original arguments, and presentation locale. */
export interface ToolBodyOptions {
  readonly diagnostics: boolean
  readonly includeArguments: boolean
  readonly locale: TuiLocale
}

/** A logical source line before escaping or terminal wrapping. */
export interface ToolBodyLine {
  readonly text: string
  readonly token: 'fgDim' | 'codeBg'
}

/** Resume point inside a logical source line; offset is a UTF-16 character offset. */
export interface ToolBodyCursor {
  readonly line: number
  readonly offset: number
}

/** One physical line's source interval, without a materialized display row. */
export interface ToolBodyFragment {
  readonly line: number
  readonly start: number
  readonly end: number
}

/** A bounded display window and an exact logical-line continuation. */
export interface ToolBodyWindow {
  readonly fragments: readonly ToolBodyFragment[]
  readonly next: ToolBodyCursor | undefined
  /** Remaining logical rows, including a partially displayed row. */
  readonly remainingLines: number
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Index newlines without splitting or escaping the complete result. */
function textLines(text: string, prefix = ''): RowSource<ToolBodyLine> {
  let length = 1
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) length += 1
  let lastLine = 0
  let lastStart = 0
  return indexedRows(length, (index) => {
    if (index < lastLine) { lastLine = 0; lastStart = 0 }
    while (lastLine < index) {
      lastStart = text.indexOf('\n', lastStart) + 1
      lastLine += 1
    }
    const end = text.indexOf('\n', lastStart)
    return { text: prefix + text.slice(lastStart, end < 0 ? text.length : end), token: 'codeBg' }
  })
}

/**
 * Build an indexed logical document without formatting the body.
 * @param card - canonical arguments/results with optional real presenter views.
 * @param options - explicit diagnostic, argument, and locale choices.
 * @returns source lines; large read/search results are formatted only when addressed.
 */
export function createToolBodyDocument(card: ToolBodyCard, options: ToolBodyOptions): RowSource<ToolBodyLine> {
  const rows = new RowSequence<ToolBodyLine>()
  const section = (label: string, source: RowSource<ToolBodyLine>): void => {
    rows.push({ text: label, token: 'fgDim' })
    rows.append(source)
  }
  const result = card.resultView
  const kind = result?.card ?? card.callView?.card ?? 'generic'
  const args = (): void => { section(tuiCopy('arguments', options.locale), textLines(card.arguments)) }
  if (options.includeArguments && kind !== 'generic') args()
  const bodyStart = rows.length
  switch (kind) {
    case 'terminal':
      if (result?.card === 'terminal') {
        if (result.output !== undefined && result.output !== '') section(tuiCopy('result', options.locale), textLines(result.output))
        if (result.exitCode !== undefined) section(tuiCopy('processStatus', options.locale), textLines(`exitCode ${result.exitCode}`))
        else if (result.signal !== undefined) section(tuiCopy('processStatus', options.locale), textLines(`signal ${result.signal}`))
      }
      break
    case 'diff': {
      const diffs = result?.card === 'diff' ? result.diffs : card.callView?.card === 'diff' ? card.callView.diffs : []
      if (diffs.length === 0) break
      const source = new RowSequence<ToolBodyLine>()
      for (const diff of diffs) {
        source.push({ text: `--- ${diff.path}`, token: 'codeBg' })
        if (diff.oldText !== null) source.append(textLines(diff.oldText, '- '))
        source.append(textLines(diff.newText, '+ '))
      }
      section('diff', source.build())
      break
    }
    case 'search': {
      if (result?.card !== 'search') break
      const source = new RowSequence<ToolBodyLine>()
      if (result.shape === 'matches') {
        for (const file of result.files) source.append(indexedRows(file.matches.length, (index) => {
          const match = file.matches[index] as (typeof file.matches)[number]
          return { text: `${file.path}:${match.lineNumber} ${match.line}`, token: 'codeBg' }
        }))
      } else source.append(indexedRows(result.paths.length, index => ({ text: result.paths[index] as string, token: 'codeBg' })))
      if (result.truncated) source.push({ text: '…', token: 'codeBg' })
      section(tuiCopy('result', options.locale), source.build())
      break
    }
    case 'read':
      if (result?.card === 'read') section(tuiCopy('result', options.locale), indexedRows(result.lines.length, (index) => {
        const line = result.lines[index] as (typeof result.lines)[number]
        return { text: `${line.number} ${line.text}`, token: 'codeBg' }
      }))
      break
    case 'web':
      if (result?.card === 'web') {
        if (result.kind === 'fetch') section(tuiCopy('result', options.locale), textLines(`${result.url} · ${result.statusCode}`))
        else {
          section(tuiCopy('result', options.locale), indexedRows(result.sources.length, (index) => {
            const source = result.sources[index] as (typeof result.sources)[number]
            return { text: source.title === undefined ? source.url : `${source.title} · ${source.url}`, token: 'codeBg' }
          }))
          if (result.truncated) rows.push({ text: '…', token: 'codeBg' })
        }
      }
      break
    default:
      // Unknown presenter tags retain the generic argument/result document.
      args()
      if (card.resultText !== undefined) section(tuiCopy('result', options.locale), textLines(card.resultText))
      break
  }
  if (result === undefined && kind !== 'generic' && card.resultText !== undefined) {
    section(tuiCopy('result', options.locale), textLines(card.resultText))
  }
  if (rows.length === bodyStart && !options.includeArguments) args()
  if (options.diagnostics && card.meta !== undefined) section(tuiCopy('diagnostics', options.locale), textLines(JSON.stringify(card.meta)))
  return rows.build()
}

/** Tabs are visible text so the host terminal cannot move outside the measured row. */
function escapeToolText(text: string): string { return escapeContent(text).replace(/\t/gu, '\\t') }

/** Measure one bounded prefix; no full-line escaping or full-result wrapping. */
function fragmentEnd(text: string, start: number, width: number): number {
  let columns = 0
  let end = start
  for (const part of graphemes.segment(text.slice(start))) {
    const size = displayWidth(escapeToolText(part.segment))
    if (columns + size > width && end > start) break
    end += part.segment.length
    columns += size
    if (columns >= width) break
  }
  return end
}

/**
 * Measure at most maxRows display fragments from a resumable source position.
 * @param document - indexed raw detail lines.
 * @param cursor - first logical row and character to display.
 * @param width - positive body width excluding card indentation.
 * @param maxRows - positive physical-row budget.
 * @returns unformatted source intervals and a continuation when content remains.
 */
export function planToolBodyWindow(
  document: RowSource<ToolBodyLine>, cursor: ToolBodyCursor, width: number, maxRows: number,
): ToolBodyWindow {
  const fragments: ToolBodyFragment[] = []
  let line = cursor.line
  let offset = cursor.offset
  while (line < document.length && fragments.length < maxRows) {
    const source = document.at(line) as ToolBodyLine
    const end = fragmentEnd(source.text, offset, width)
    fragments.push({ line, start: offset, end })
    if (end === source.text.length) { line += 1; offset = 0 }
    else offset = end
  }
  return { fragments, next: line < document.length ? { line, offset } : undefined, remainingLines: document.length - line }
}

/**
 * Escape only one measured body fragment for display.
 * @param document - canonical indexed detail source.
 * @param fragment - a measured source interval from planToolBodyWindow.
 * @returns the escaped text and semantic style of one physical row.
 */
export function materializeToolBodyRow(document: RowSource<ToolBodyLine>, fragment: ToolBodyFragment): ToolBodyLine {
  const source = document.at(fragment.line) as ToolBodyLine
  return { text: escapeToolText(source.text.slice(fragment.start, fragment.end)), token: source.token }
}

/**
 * Copy/export the unabridged logged arguments and result, with optional diagnostics.
 * @param card - canonical tool data, unaffected by detail pagination.
 * @param options - diagnostic and locale choices.
 * @returns full original text without terminal escapes or preview truncation.
 */
export function toolCardOriginalText(card: ToolBodyCard, options: ToolBodyOptions): string {
  const parts = [card.name, tuiCopy('arguments', options.locale), card.arguments]
  if (card.resultText !== undefined) parts.push(tuiCopy('result', options.locale), card.resultText)
  if (options.diagnostics && card.meta !== undefined) parts.push(tuiCopy('diagnostics', options.locale), JSON.stringify(card.meta))
  return `${parts.join('\n')}\n`
}
