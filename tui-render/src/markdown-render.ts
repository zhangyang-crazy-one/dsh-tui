/**
 * Styled mdast → {@link MarkdownRenderLine} renderer.
 *
 * The projector renders source by handing each top-level mdast block to a
 * {@link MarkdownBlockRenderer} callback. This module provides a renderer
 * that emits the full token set the JSX bridge needs:
 *
 *   - `fg` / `fgDim` / `accent` / `accentDim` / `codeBg`
 *   - bold
 *   - OSC 8 link targets (carried as `href` on the span; the bridge decides
 *     whether to emit the escape sequences based on the runtime
 *     `hyperlinksEnabled` flag)
 *
 * The default plain-text renderer in `markdown-projector.ts` ignores inline
 * styling; this renderer is the one the JSX path uses, and it produces
 * spans that match the visual output of the legacy JSX pipeline.
 *
 * The renderer is a pure data module — no Ink, no ANSI — so the
 * incremental projector can call it freely.
 *
 * @module @deepseek-ai/dsh-tui-render/markdown-render
 */

import type { Heading, List, Paragraph, PhrasingContent, RootContent, Table, TableCell, TableRow } from 'mdast'
import { displayWidth, escapeContent, padDisplayEnd, wrapDisplayLines } from './content.ts'
import { linkNeedsUrlSuffix } from './hyperlink.ts'
import {
  appendedRowsPreserveTableMetrics,
  layoutTableCells,
  measureTableCells,
} from './table-layout.ts'
import type {
  TableColumnMetrics,
  TableLayoutLine,
  TableRecordLayout,
} from './table-layout.ts'
import type {
  MarkdownBlockRenderer,
  MarkdownRenderLine,
  MarkdownRenderScope,
  MarkdownStyleToken,
} from './markdown-projector.ts'

/** Inline segment produced by walking one phrasing-content subtree. */
interface InlineSegment {
  readonly text: string
  readonly token: MarkdownStyleToken
  readonly bold: boolean
  /** OSC 8 target — when set the bridge wraps the segment in OSC 8 escapes. */
  readonly href?: string | undefined
  /** Visible (un-escaped) text of the link, for the `(href)` suffix check. */
  readonly hrefVisible?: string | undefined
}

/** Per-scope mutable buffer that accumulates segments into one physical line. */
interface LineBuffer {
  segments: InlineSegment[]
  cols: number
}

function makeBuffer(): LineBuffer {
  return { segments: [], cols: 0 }
}

/** Buffer-append result telling the caller whether to flush. */
type AppendResult =
  | { readonly kind: 'fit' }
  | { readonly kind: 'flush'; readonly tail: InlineSegment | null }

/** Append one segment to `buffer`, returning a hint for the caller's line loop. */
function appendSegment(buffer: LineBuffer, segment: InlineSegment, maxCols: number): AppendResult {
  if (segment.text === '') {
    buffer.segments.push(segment)
    return { kind: 'fit' }
  }
  if (buffer.cols >= maxCols) {
    buffer.segments.push(segment)
    return { kind: 'fit' }
  }
  const remaining = maxCols - buffer.cols
  const cols = displayWidth(segment.text)
  if (cols <= remaining) {
    buffer.segments.push(segment)
    buffer.cols += cols
    return { kind: 'fit' }
  }
  // Segment exceeds the remaining room. If the buffer already has content,
  // flush the buffer and ask the caller to retry on a fresh line.
  if (buffer.segments.length > 0) {
    return { kind: 'flush', tail: segment }
  }
  // Buffer is empty; hard-wrap the segment by display width.
  const lines = wrapDisplayLines(segment.text, remaining)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string
    const isLast = i === lines.length - 1
    buffer.segments.push({
      text: line,
      token: segment.token,
      bold: segment.bold,
      href: segment.href,
      hrefVisible: segment.hrefVisible,
    })
    buffer.cols = displayWidth(line)
    if (!isLast) buffer.cols = maxCols
  }
  return { kind: 'fit' }
}

/** Finalize one buffer into a {@link MarkdownRenderLine}, converting
 * segment columns into display-column spans. */
function freezeLine(buffer: LineBuffer, rowInBlock: number, sourceStart: number): MarkdownRenderLine {
  let col = 0
  const spans: { start: number; end: number; token: MarkdownStyleToken; bold: boolean; href?: string | undefined }[] = []
  for (const seg of buffer.segments) {
    if (seg.text === '') continue
    const segWidth = displayWidth(seg.text)
    if (seg.token === 'fg' && !seg.bold && seg.href === undefined) {
      // Coalesce contiguous fg runs into one span.
      const last = spans[spans.length - 1]
      if (last && last.token === 'fg' && !last.bold && last.href === undefined && last.end === col) {
        last.end += segWidth
      } else {
        spans.push({ start: col, end: col + segWidth, token: 'fg', bold: false })
      }
    } else {
      spans.push({ start: col, end: col + segWidth, token: seg.token, bold: seg.bold, href: seg.href })
    }
    col += segWidth
  }
  return {
    text: buffer.segments.map(s => s.text).join(''),
    displayWidth: col,
    spans,
    rowInBlock,
    sourceStart: rowInBlock === 0 ? sourceStart : -1,
    sourceEnd: -1,
    rawTail: false,
  }
}

/** Finalize an empty buffer into a zero-width placeholder line. */
function freezeEmpty(rowInBlock: number, sourceStart: number): MarkdownRenderLine {
  return {
    text: '',
    displayWidth: 0,
    spans: [{ start: 0, end: 0, token: 'fg', bold: false }],
    rowInBlock,
    sourceStart: rowInBlock === 0 ? sourceStart : -1,
    sourceEnd: -1,
    rawTail: false,
  }
}

/** Walk one phrasing-content subtree and return flat segments (no wrap). */
function inlineToSegments(
  node: PhrasingContent,
  hyperlinks: boolean,
): InlineSegment[] {
  switch (node.type) {
    case 'text':
      return [{ text: escapeContent(node.value), token: 'fg', bold: false }]
    case 'inlineCode':
      return [{ text: escapeContent(node.value), token: 'codeBg', bold: false }]
    case 'strong':
      return [{
        text: escapeContent(literalText(node)),
        token: 'fg',
        bold: true,
      }]
    case 'emphasis':
      return [{
        text: escapeContent(literalText(node)),
        token: 'accent',
        bold: false,
      }]
    case 'delete':
      return [{
        text: escapeContent(literalText(node)),
        token: 'fgDim',
        bold: false,
      }]
    case 'link': {
      const visible = literalText(node)
      const escaped = escapeContent(visible)
      const segments: InlineSegment[] = [{
        text: escaped,
        token: 'accent',
        bold: false,
        href: node.url,
        hrefVisible: visible,
      }]
      if (!hyperlinks && linkNeedsUrlSuffix(visible, node.url)) {
        segments.push({
          text: ` (${node.url})`,
          token: 'fgDim',
          bold: false,
        })
      }
      return segments
    }
    case 'linkReference': {
      // Reference not resolved at data time: render the visible label as fg.
      return [{ text: escapeContent(literalText(node)), token: 'fg', bold: false }]
    }
    case 'image':
      return [{ text: escapeContent(node.alt ?? ''), token: 'fg', bold: false }]
    case 'break':
      return [{ text: '', token: 'fg', bold: false }]
    default: {
      const children = (node as unknown as { children?: readonly PhrasingContent[] }).children
      if (children === undefined) return []
      return children.flatMap(child => inlineToSegments(child, hyperlinks))
    }
  }
}

/** Recursively read every leaf text in a phrasing-content subtree. */
function literalText(node: PhrasingContent): string {
  if ('value' in node && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value
  }
  const children = (node as { children?: readonly PhrasingContent[] }).children
  if (children === undefined) return ''
  return children.map(child => literalText(child)).join('')
}

/**
 * Render a paragraph block into one or more physical lines, splitting on
 * hard wraps and the natural width of the available columns.
 */
function renderParagraph(
  node: Paragraph,
  width: number,
  rowOffset: number,
  sourceStart: number,
  hyperlinks: boolean,
): MarkdownRenderLine[] {
  const segments: InlineSegment[] = []
  for (const child of node.children) {
    segments.push(...inlineToSegments(child, hyperlinks))
  }
  if (segments.length === 0) {
    return [freezeEmpty(rowOffset, sourceStart)]
  }
  const lines: MarkdownRenderLine[] = []
  let buffer = makeBuffer()
  let row = rowOffset
  for (const seg of segments) {
    const parts = seg.text.split('\n')
    for (const part of parts) {
      if (part === '') {
        if (buffer.segments.length > 0) {
          lines.push(freezeLine(buffer, row, sourceStart))
          row += 1
          buffer = makeBuffer()
        }
        continue
      }
      const chunked = wrapDisplayLines(part, width)
      for (let c = 0; c < chunked.length; c += 1) {
        const line = chunked[c] as string
        const isLastChunk = c === chunked.length - 1
        if (line === '') {
          if (buffer.segments.length > 0) {
            lines.push(freezeLine(buffer, row, sourceStart))
            row += 1
            buffer = makeBuffer()
          }
          continue
        }
        if (!isLastChunk) {
          buffer = makeBuffer()
          const buffer2 = makeBuffer()
          appendSegment(buffer2, {
            text: line,
            token: seg.token,
            bold: seg.bold,
            href: seg.href,
            hrefVisible: seg.hrefVisible,
          }, width)
          lines.push(freezeLine(buffer2, row, sourceStart))
          row += 1
          continue
        }
        const result = appendSegment(buffer, {
          text: line,
          token: seg.token,
          bold: seg.bold,
          href: seg.href,
          hrefVisible: seg.hrefVisible,
        }, width)
        if (result.kind === 'flush') {
          lines.push(freezeLine(buffer, row, sourceStart))
          row += 1
          buffer = makeBuffer()
          appendSegment(buffer, {
            text: line,
            token: seg.token,
            bold: seg.bold,
            href: seg.href,
            hrefVisible: seg.hrefVisible,
          }, width)
        }
      }
    }
  }
  if (buffer.segments.length > 0 || lines.length === 0) {
    lines.push(freezeLine(buffer, row, sourceStart))
  }
  return lines
}

/**
 * Render a heading block into one or more physical lines, wrapping at the
 * available width. h1 keeps the `━━━` cap; h2+ keep the leading `━ `.
 */
function renderHeading(
  node: Heading,
  width: number,
  rowOffset: number,
  sourceStart: number,
): MarkdownRenderLine[] {
  const text = node.children.map(literalText).join('')
  const depth = node.depth === 1
  const prefix = depth ? '━━━ ' : '━ '
  const suffix = depth ? ' ━━━' : ''
  const wrapped = wrapDisplayLines(`${prefix}${escapeContent(text)}${suffix}`, width)
  return wrapped.map((line, index) => {
    const buffer = makeBuffer()
    appendSegment(buffer, { text: line, token: 'accent', bold: true }, width)
    return freezeLine(buffer, rowOffset + index, index === 0 ? sourceStart : -1)
  })
}

/** Render a blockquote block as `│ ` prefixed fgDim lines. */
function renderBlockquote(
  children: readonly PhrasingContent[],
  width: number,
  rowOffset: number,
  sourceStart: number,
  hyperlinks: boolean,
): MarkdownRenderLine[] {
  const segments: InlineSegment[] = []
  for (const child of children) segments.push(...inlineToSegments(child, hyperlinks))
  const merged = segments.map(s => s.text).join('')
  const wrapped = wrapDisplayLines(`│ ${escapeContent(merged)}`, width)
  return wrapped.map((line, index) => {
    const buffer = makeBuffer()
    appendSegment(buffer, { text: line, token: 'fgDim', bold: false }, width)
    return freezeLine(buffer, rowOffset + index, index === 0 ? sourceStart : -1)
  })
}

/** Render a list block as multiple marker-prefixed fg lines. */
function renderList(
  list: List,
  width: number,
  rowOffset: number,
  sourceStart: number,
  hyperlinks: boolean,
): MarkdownRenderLine[] {
  const lines: MarkdownRenderLine[] = []
  const ordered = list.ordered === true
  list.children.forEach((item, index) => {
    const marker = ordered ? `${(list.start ?? 1) + index}. ` : '- '
    const segments: InlineSegment[] = []
    const children = item.children as readonly PhrasingContent[]
    for (const child of children) segments.push(...inlineToSegments(child, hyperlinks))
    const merged = segments.map(s => s.text).join('')
    const wrapped = wrapDisplayLines(`${marker}${escapeContent(merged)}`, width)
    wrapped.forEach((line, lineIndex) => {
      const buffer = makeBuffer()
      appendSegment(buffer, { text: line, token: 'fg', bold: false }, width)
      lines.push(freezeLine(
        buffer,
        rowOffset + lines.length,
        index === 0 && lineIndex === 0 ? sourceStart : -1,
      ))
    })
  })
  return lines
}

/** Render a code block as token-highlighted lines. Each source line is
 * walked through the lightweight tokenizer; spans carry fg/fgDim tokens
 * and the keyword bold tier. The line is wrapped in codeBg by the bridge.
 */
function renderCode(
  value: string,
  width: number,
  rowOffset: number,
  sourceStart: number,
): MarkdownRenderLine[] {
  const lines = value.split('\n')
  // Huge fences collapse to the first twenty rows plus a fold glyph so a
  // pasted log cannot blow up the frame budget; copy/export reads the
  // authoritative source, so the hidden rows stay recoverable.
  const collapsed = lines.length > 500
  const shown = collapsed ? lines.slice(0, 20) : lines
  const out: MarkdownRenderLine[] = []
  let row = rowOffset
  for (const [index, line] of shown.entries()) {
    const wrapped = wrapDisplayLines(escapeContent(line), width)
    if (wrapped.length === 0) {
      out.push(freezeEmpty(row, index === 0 ? sourceStart : -1))
      row += 1
      continue
    }
    for (const [partIndex, part] of wrapped.entries()) {
      const buffer = makeBuffer()
      const tokens = tokenizeCodeLine(`  ${part}`)
      for (const tk of tokens) {
        appendSegment(buffer, { text: tk.text, token: tk.token, bold: tk.bold }, width)
      }
      const line = freezeLine(
        buffer,
        row,
        index === 0 && partIndex === 0 ? sourceStart : -1,
      )
      out.push({ ...line, background: 'codeBg' })
      row += 1
    }
  }
  if (collapsed) {
    const text = `▾ … 还有 ${lines.length - 20} 行`
    const cols = displayWidth(text)
    out.push({
      text,
      displayWidth: cols,
      spans: [{ start: 0, end: cols, token: 'fgDim', bold: false }],
      rowInBlock: row,
      sourceStart: -1,
      sourceEnd: -1,
      rawTail: false,
    })
  }
  return out
}

/** One token in a code line. */
interface CodeToken {
  readonly text: string
  readonly token: MarkdownStyleToken
  readonly bold: boolean
}

/** Keyword set used for code-line tokenization (kept in sync with
 * `markdown.tsx`'s `tokenizeLine`). */
const CODE_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'import', 'export', 'from', 'async', 'await', 'class', 'interface', 'type',
  'new', 'throw', 'try', 'catch', 'finally', 'switch', 'case', 'break',
  'continue', 'default', 'true', 'false', 'null', 'undefined', 'this',
])

/** Tokenize a single code line (assumed already escaped). */
function tokenizeCodeLine(source: string): CodeToken[] {
  const out: CodeToken[] = []
  if (source === '') return out
  const trimmed = source.trimStart()
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
    return [{ text: source, token: 'fgDim', bold: false }]
  }
  let i = 0
  let plain = source.slice(0, source.length - trimmed.length)
  const flushPlain = (): void => {
    if (plain !== '') {
      out.push({ text: plain, token: 'fg', bold: false })
      plain = ''
    }
  }
  while (i < trimmed.length) {
    const ch = trimmed.charAt(i)
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = trimmed.indexOf(ch, i + 1)
      const stop = end === -1 ? trimmed.length : end + 1
      flushPlain()
      out.push({ text: trimmed.slice(i, stop), token: 'fg', bold: false })
      i = stop
      continue
    }
    if (ch === '/' && trimmed.charAt(i + 1) === '/') {
      flushPlain()
      out.push({ text: trimmed.slice(i), token: 'fgDim', bold: false })
      return out
    }
    const wordMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed.slice(i))
    if (wordMatch !== null && CODE_KEYWORDS.has(wordMatch[0])) {
      flushPlain()
      out.push({ text: wordMatch[0], token: 'fg', bold: true })
      i += wordMatch[0].length
      continue
    }
    plain += ch
    i += 1
  }
  flushPlain()
  return out
}

/** Render a GFM table using box-drawing rules and fg/accent body cells. */
function renderTable(
  node: Table,
  width: number,
  rowOffset: number,
  sourceStart: number,
): MarkdownRenderLine[] {
  const cells: string[][] = node.children.map((row: TableRow) =>
    row.children.map((cell: TableCell) => cell.children.map(literalText).join('')),
  )
  return renderTableCells(cells, width, rowOffset, sourceStart)
}

/**
 * Render already-scanned table cells through the same row algorithm as mdast
 * tables. Streaming holdback uses this entry so a confirmed active table is
 * not parsed and rendered a second time through mdast.
 * @param cells - row-major cells with the header first and no delimiter row.
 * @param width - available display columns.
 * @param rowOffset - first row index inside the owning block.
 * @param sourceStart - source offset for the first emitted row.
 * @returns rendered table rows.
 */
export function renderTableCells(
  cells: readonly (readonly string[])[],
  width: number,
  rowOffset: number,
  sourceStart: number,
): MarkdownRenderLine[] {
  const safeCells = cells.map(row => row.map(cell => escapeContent(cell)))
  const layout = layoutTableCells(safeCells, { maxCols: Math.max(1, width) })
  const lines: MarkdownRenderLine[] = []
  let row = rowOffset
  const appendLine = (segments: readonly InlineSegment[]): void => {
    const buffer = makeBuffer()
    for (const segment of segments) appendSegment(buffer, segment, Math.max(1, width))
    lines.push(freezeLine(buffer, row, row === rowOffset ? sourceStart : -1))
    row += 1
  }
  if (layout.kind === 'record') {
    renderRecordLayout(layout, Math.max(1, width), appendLine)
    return lines
  }
  for (const line of layout.lines) {
    appendLine(gridLayoutSegments(line))
  }
  return lines
}

/** Reusable committed-grid snapshot for an active streaming table. */
export interface StreamingTableRenderCache {
  readonly width: number
  readonly widths: readonly number[]
  readonly columns: readonly TableColumnMetrics[]
  readonly committedRows: number
  readonly lines: readonly MarkdownRenderLine[]
}

/** Result of one incremental active-table presentation. */
export interface StreamingTableRenderResult {
  readonly lines: readonly MarkdownRenderLine[]
  readonly cache: StreamingTableRenderCache | undefined
}

/**
 * Render a growing table while reusing already materialized committed rows
 * whenever the adaptive column plan is unchanged. The unfinished tail is
 * painted for the current frame but never enters the reusable committed
 * snapshot until the collector promotes it.
 * @param committedCells - header plus newline-terminated body rows.
 * @param tailCells - current unfinished body row, when pipe-shaped.
 * @param width - available terminal columns.
 * @param rowOffset - first row inside the owning block.
 * @param sourceStart - source offset of the table header.
 * @param previous - prior committed-grid cache.
 * @returns current presentation plus the next reusable cache.
 */
export function renderStreamingTableCells(
  committedCells: readonly (readonly string[])[],
  tailCells: readonly string[] | undefined,
  width: number,
  rowOffset: number,
  sourceStart: number,
  previous: StreamingTableRenderCache | undefined,
): StreamingTableRenderResult {
  const safeWidth = Math.max(1, width)
  const plannedCells = tailCells === undefined
    ? committedCells
    : [...committedCells, tailCells]
  const appendedCells = previous === undefined
    ? plannedCells
    : [
      ...committedCells.slice(previous.committedRows),
      ...(tailCells === undefined ? [] : [tailCells]),
    ]
  const escapedAppended = appendedCells.map(row => row.map(cell => escapeContent(cell)))
  const plan = previous !== undefined
    && previous.width === safeWidth
    && previous.committedRows <= committedCells.length
    && appendedRowsPreserveTableMetrics(escapedAppended, previous.columns)
    ? {
      kind: 'grid' as const,
      widths: previous.widths,
      columns: previous.columns,
      maxCols: safeWidth,
    }
    : measureTableCells(
      plannedCells.map(row => row.map(cell => escapeContent(cell))),
      { maxCols: safeWidth },
    )
  if (plan.kind !== 'grid') {
    return {
      lines: renderTableCells(plannedCells, safeWidth, rowOffset, sourceStart),
      cache: undefined,
    }
  }
  const reusable = previous !== undefined
    && previous.width === safeWidth
    && previous.committedRows <= committedCells.length
    && sameNumberArray(previous.widths, plan.widths)
  let committedLines: MarkdownRenderLine[]
  if (reusable) {
    committedLines = previous.lines.slice(0, -1)
    for (let index = previous.committedRows; index < committedCells.length; index += 1) {
      const cells = committedCells[index]
      if (cells === undefined) continue
      committedLines.push(...renderGridRow(
        cells,
        plan.widths,
        false,
        safeWidth,
        rowOffset + committedLines.length,
        sourceStart,
      ))
    }
    committedLines.push(ruleRenderLine(
      gridRule(plan.widths, 'bottom'),
      rowOffset + committedLines.length,
      sourceStart,
      safeWidth,
    ))
  } else {
    committedLines = renderGridTableWithWidths(
      committedCells,
      plan.widths,
      safeWidth,
      rowOffset,
      sourceStart,
    )
  }
  const cache: StreamingTableRenderCache = {
    width: safeWidth,
    widths: plan.widths,
    columns: plan.columns,
    committedRows: committedCells.length,
    lines: committedLines,
  }
  if (tailCells === undefined) return { lines: committedLines, cache }
  const presentation = committedLines.slice(0, -1)
  presentation.push(...renderGridRow(
    tailCells,
    plan.widths,
    false,
    safeWidth,
    rowOffset + presentation.length,
    sourceStart,
  ))
  presentation.push(ruleRenderLine(
    gridRule(plan.widths, 'bottom'),
    rowOffset + presentation.length,
    sourceStart,
    safeWidth,
  ))
  return { lines: presentation, cache }
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function gridRule(
  widths: readonly number[],
  kind: 'top' | 'mid' | 'bottom',
): string {
  const fill = widths.map(cellWidth => '─'.repeat(Math.max(1, cellWidth)))
  if (kind === 'top') return `┌─${fill.join('─┬─')}─┐`
  if (kind === 'mid') return `├─${fill.join('─┼─')}─┤`
  return `└─${fill.join('─┴─')}─┘`
}

function ruleRenderLine(
  text: string,
  rowInBlock: number,
  sourceStart: number,
  width: number,
): MarkdownRenderLine {
  const buffer = makeBuffer()
  appendSegment(buffer, { text, token: 'fgDim', bold: false }, width)
  return freezeLine(buffer, rowInBlock, rowInBlock === 0 ? sourceStart : -1)
}

function renderGridTableWithWidths(
  cells: readonly (readonly string[])[],
  widths: readonly number[],
  width: number,
  rowOffset: number,
  sourceStart: number,
): MarkdownRenderLine[] {
  const out: MarkdownRenderLine[] = []
  out.push(ruleRenderLine(gridRule(widths, 'top'), rowOffset, sourceStart, width))
  out.push(...renderGridRow(cells[0] ?? [], widths, true, width, rowOffset + out.length, sourceStart))
  out.push(ruleRenderLine(gridRule(widths, 'mid'), rowOffset + out.length, sourceStart, width))
  for (const row of cells.slice(1)) {
    out.push(...renderGridRow(row, widths, false, width, rowOffset + out.length, sourceStart))
  }
  out.push(ruleRenderLine(gridRule(widths, 'bottom'), rowOffset + out.length, sourceStart, width))
  return out
}

function renderGridRow(
  row: readonly string[],
  widths: readonly number[],
  header: boolean,
  width: number,
  rowOffset: number,
  sourceStart: number,
): MarkdownRenderLine[] {
  const wrapped = widths.map((columnWidth, column) => {
    const text = escapeContent(row[column] ?? '')
    return displayWidth(text) <= columnWidth
      ? [text]
      : wrapDisplayLines(text, columnWidth)
  })
  const height = wrapped.reduce((maximum, lines) => Math.max(maximum, lines.length), 1)
  const out: MarkdownRenderLine[] = []
  for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
    const buffer = makeBuffer()
    appendSegment(buffer, { text: '│ ', token: 'fgDim', bold: false }, width)
    for (let column = 0; column < widths.length; column += 1) {
      if (column > 0) appendSegment(buffer, { text: ' │ ', token: 'fgDim', bold: false }, width)
      const text = wrapped[column]?.[lineIndex] ?? ''
      appendSegment(buffer, {
        text: padDisplayEnd(text, widths[column] as number),
        token: header ? 'accent' : 'fg',
        bold: header,
      }, width)
    }
    appendSegment(buffer, { text: ' │', token: 'fgDim', bold: false }, width)
    out.push(freezeLine(buffer, rowOffset + lineIndex, rowOffset === 0 && lineIndex === 0 ? sourceStart : -1))
  }
  return out
}

/** Convert one adaptive grid-layout line into styled renderer segments. */
function gridLayoutSegments(line: TableLayoutLine): readonly InlineSegment[] {
  if (line.kind === 'rule' || line.kind === 'plain') {
    return [{ text: line.text, token: line.kind === 'rule' ? 'fgDim' : 'fg', bold: false }]
  }
  if (line.kind === 'record') return []
  const segments: InlineSegment[] = [{ text: '│ ', token: 'fgDim', bold: false }]
  for (const [index, cell] of line.cells.entries()) {
    if (index > 0) segments.push({ text: ' │ ', token: 'fgDim', bold: false })
    segments.push({
      text: cell.text,
      token: line.header ? 'accent' : 'fg',
      bold: line.header,
    })
  }
  segments.push({ text: ' │', token: 'fgDim', bold: false })
  return segments
}

/**
 * Paint a narrow table as labeled records. Header cells become field labels;
 * every body value is emitted in full and wraps within the physical width.
 */
function renderRecordLayout(
  layout: TableRecordLayout,
  width: number,
  appendLine: (segments: readonly InlineSegment[]) => void,
): void {
  const records = layout.lines.filter(line => line.kind === 'record')
  if (records.length <= 1) {
    const header = layout.header.map(cell => cell.text).join(' | ')
    for (const line of wrapDisplayLines(header, width)) {
      appendLine([{ text: line, token: 'accent', bold: true }])
    }
    return
  }
  for (const line of layout.lines) {
    if (line.kind === 'rule') {
      appendLine([{ text: line.text, token: 'fgDim', bold: false }])
      continue
    }
    if (line.kind !== 'record' || line.key.row === 0) continue
    const keyLabel = layout.header[0]?.text ?? 'key'
    for (const text of wrapDisplayLines(`${keyLabel}: ${line.key.text}`, width)) {
      appendLine([{ text, token: 'accent', bold: true }])
    }
    for (const value of line.values) {
      const label = layout.header[value.column]?.text ?? `#${String(value.column + 1)}`
      for (const text of wrapDisplayLines(`${layout.valueIndent}${label}: ${value.text}`, width)) {
        appendLine([{ text, token: 'fg', bold: false }])
      }
    }
  }
}

/** Factory options for the styled renderer. */
export interface StyledRendererOptions {
  /** Maximum columns available for one painted line (body width). */
  readonly width: number
  /** Whether OSC 8 hyperlinks are currently installed. */
  readonly hyperlinks: boolean
}

/**
 * Create a one-shot renderer bound to a fixed width + hyperlink flag.
 * @param options - body width and OSC 8 hyperlink flag for this renderer.
 * @returns the styled block renderer consumed by the projector.
 */
export function createStyledMarkdownBlockRenderer(
  options: StyledRendererOptions,
): MarkdownBlockRenderer {
  const { width, hyperlinks } = options
  return {
    renderBlock(node: RootContent, _scope: MarkdownRenderScope): readonly MarkdownRenderLine[] {
      const position = node.position
      const sourceStart = position?.start.offset ?? 0
      switch (node.type) {
        case 'paragraph':
          return renderParagraph(node, width, 0, sourceStart, hyperlinks)
        case 'heading':
          return renderHeading(node, width, 0, sourceStart)
        case 'blockquote':
          return renderBlockquote(
            node.children as readonly PhrasingContent[],
            width,
            0,
            sourceStart,
            hyperlinks,
          )
        case 'list':
          return renderList(node, width, 0, sourceStart, hyperlinks)
        case 'code':
          return renderCode(node.value, width, 0, sourceStart)
        case 'table':
          return renderTable(node, width, 0, sourceStart)
        default:
          return [freezeEmpty(0, sourceStart)]
      }
    },
    renderRawTail(text: string, cols: number, _scope: MarkdownRenderScope): MarkdownRenderLine {
      const buffer = makeBuffer()
      appendSegment(buffer, { text, token: 'fg', bold: false }, width)
      return {
        text: buffer.segments.map(s => s.text).join(''),
        displayWidth: cols,
        spans: [{ start: 0, end: cols, token: 'fg', bold: false }],
        rowInBlock: 0,
        sourceStart: -1,
        sourceEnd: -1,
        rawTail: true,
      }
    },
  }
}

/** Re-export the hyperlink helper for the bridge in `markdown.tsx`. */
export { linkNeedsUrlSuffix }
