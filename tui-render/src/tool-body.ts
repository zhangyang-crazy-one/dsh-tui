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

/** Diff role of a tool body line for syntax-highlighted diff rendering. */
export type ToolBodyDiffKind = 'add' | 'delete' | 'context' | 'hunk' | 'header'

/** A logical source line before escaping or terminal wrapping. */
export interface ToolBodyLine {
  readonly text: string
  readonly token: 'fgDim' | 'codeBg'
  readonly diffKind?: ToolBodyDiffKind | undefined
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

/** Split text into lines, handling CRLF and trailing newline without phantom blank lines. */
function splitDiffLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text
  return normalized.split(/\r?\n/u)
}

/**
 * Compute unified diff lines (' ' context, '-' removal, '+' addition)
 * between oldLines and newLines using longest common subsequence.
 */
function diffLines(oldLines: readonly string[], newLines: readonly string[]): string[] {
  if (oldLines.length === 0) return newLines.map(line => `+${line}`)
  if (newLines.length === 0) return oldLines.map(line => `-${line}`)

  const m = oldLines.length
  const n = newLines.length
  if (m * n > 500_000) {
    return [...oldLines.map(l => `-${l}`), ...newLines.map(l => `+${l}`)]
  }

  let prefixCount = 0
  while (prefixCount < m && prefixCount < n && oldLines[prefixCount] === newLines[prefixCount]) {
    prefixCount++
  }

  let suffixCount = 0
  while (
    suffixCount < (m - prefixCount)
    && suffixCount < (n - prefixCount)
    && oldLines[m - 1 - suffixCount] === newLines[n - 1 - suffixCount]
  ) {
    suffixCount++
  }

  const trimmedOld = oldLines.slice(prefixCount, m - suffixCount)
  const trimmedNew = newLines.slice(prefixCount, n - suffixCount)
  const midM = trimmedOld.length
  const midN = trimmedNew.length

  const middle: string[] = []
  if (midM === 0) {
    for (const line of trimmedNew) middle.push(`+${line}`)
  } else if (midN === 0) {
    for (const line of trimmedOld) middle.push(`-${line}`)
  } else {
    const stride = midN + 1
    const dp = new Int32Array((midM + 1) * stride)
    for (let i = 0; i < midM; i++) {
      for (let j = 0; j < midN; j++) {
        const dest = (i + 1) * stride + (j + 1)
        if (trimmedOld[i] === trimmedNew[j]) {
          dp[dest] = (dp[i * stride + j] ?? 0) + 1
        } else {
          const up = dp[i * stride + (j + 1)] ?? 0
          const left = dp[(i + 1) * stride + j] ?? 0
          dp[dest] = up > left ? up : left
        }
      }
    }

    const rev: string[] = []
    let i = midM
    let j = midN
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && trimmedOld[i - 1] === trimmedNew[j - 1]) {
        rev.push(` ${trimmedOld[i - 1]}`)
        i--
        j--
      } else if (j > 0 && (i === 0 || (dp[i * stride + (j - 1)] ?? 0) >= (dp[(i - 1) * stride + j] ?? 0))) {
        rev.push(`+${trimmedNew[j - 1]}`)
        j--
      } else if (i > 0) {
        rev.push(`-${trimmedOld[i - 1]}`)
        i--
      }
    }
    for (let k = rev.length - 1; k >= 0; k--) {
      const item = rev[k]
      if (item !== undefined) middle.push(item)
    }
  }

  const result: string[] = []
  for (let k = 0; k < prefixCount; k++) {
    result.push(` ${oldLines[k]}`)
  }
  for (const line of middle) {
    result.push(line)
  }
  for (let k = m - suffixCount; k < m; k++) {
    result.push(` ${oldLines[k]}`)
  }
  return result
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
      let lastPath: string | undefined
      for (const diff of diffs) {
        if (diff.path !== lastPath) {
          source.push({ text: `--- ${diff.path}`, token: 'codeBg', diffKind: 'header' })
          lastPath = diff.path
        }
        const oldStart = diff.oldStart ?? (diff.oldText === null ? 0 : 1)
        const newStart = diff.newStart ?? 1
        let lines: readonly string[]
        let oldLinesCount = diff.oldLines
        let newLinesCount = diff.newLines

        if (diff.lines !== undefined && diff.lines.length > 0) {
          lines = diff.lines
          oldLinesCount ??= diff.oldText === null ? 0 : splitDiffLines(diff.oldText).length
          newLinesCount ??= splitDiffLines(diff.newText).length
        } else if (diff.oldText === null) {
          const split = splitDiffLines(diff.newText)
          lines = split.map(line => `+${line}`)
          oldLinesCount = 0
          newLinesCount = split.length
        } else {
          const oldSplit = splitDiffLines(diff.oldText)
          const newSplit = splitDiffLines(diff.newText)
          lines = diffLines(oldSplit, newSplit)
          oldLinesCount ??= oldSplit.length
          newLinesCount ??= newSplit.length
        }

        const oldHunk = `${oldStart}${oldLinesCount !== 1 ? `,${oldLinesCount}` : ''}`
        const newHunk = `${newStart}${newLinesCount !== 1 ? `,${newLinesCount}` : ''}`
        source.push({ text: `@@ -${oldHunk} +${newHunk} @@`, token: 'codeBg', diffKind: 'hunk' })

        const maxLine = Math.max(oldStart + oldLinesCount, newStart + newLinesCount, 1)
        const gutterWidth = Math.max(3, String(maxLine).length)

        let curOld = oldStart === 0 ? 1 : oldStart
        let curNew = newStart === 0 ? 1 : newStart

        for (const raw of lines) {
          if (raw.startsWith('\\')) continue
          if (raw.startsWith('-')) {
            const num = String(curOld).padStart(gutterWidth, ' ')
            source.push({ text: `${num} │ - ${raw.slice(1)}`, token: 'codeBg', diffKind: 'delete' })
            curOld++
          } else if (raw.startsWith('+')) {
            const num = String(curNew).padStart(gutterWidth, ' ')
            source.push({ text: `${num} │ + ${raw.slice(1)}`, token: 'codeBg', diffKind: 'add' })
            curNew++
          } else if (raw.startsWith(' ')) {
            const num = String(curNew).padStart(gutterWidth, ' ')
            source.push({ text: `${num} │   ${raw.slice(1)}`, token: 'codeBg', diffKind: 'context' })
            curOld++
            curNew++
          } else {
            const num = String(curNew).padStart(gutterWidth, ' ')
            source.push({ text: `${num} │   ${raw}`, token: 'codeBg', diffKind: 'context' })
            curOld++
            curNew++
          }
        }
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
  return {
    text: escapeToolText(source.text.slice(fragment.start, fragment.end)),
    token: source.token,
    ...(source.diffKind !== undefined ? { diffKind: source.diffKind } : {}),
  }
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
