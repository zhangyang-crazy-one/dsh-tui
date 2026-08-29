/**
 * Markdown rendering for the terminal: GFM markdown parses through the mdast
 * pipeline, then a small walker emits Ink elements against the Grok theme.
 * Code blocks highlight with a lightweight regex tokenizer (P12: cached by
 * content hash, collapsed above 500 lines). Every content byte passes
 * escapeContent before styling (P5). Markdown links wrap that styled text in
 * OSC 8 when {@link hyperlinksEnabled} is set; otherwise the href is printed
 * in parentheses when it differs from the label. Streaming callers reuse the
 * same block for settled text: `prefix` paints the turn marker on the first
 * row and the continuation indent on later rows (no sibling marker column,
 * so Ink leaves no unstyled gap cells), `tail` appends the streaming cursor
 * to the last painted row, and a trailing partial closing fence is trimmed
 * from the last code block until its marker completes. GFM tables paint a
 * box-drawing grid and wrap cells inside shared column widths.
 * @module @deepseek-ai/dsh-tui-render/markdown
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { PhrasingContent, Root, RootContent } from 'mdast'
import { displayWidth, escapeContent, padDisplayEnd, wrapDisplayLines } from './content.ts'
import { wrapLink } from './hyperlink.ts'
import { paintRow, styled, type StyleToken } from './theme.ts'

/** Highlight token kinds the lightweight tokenizer emits. */
type TokenKind = 'keyword' | 'string' | 'comment' | 'plain'

/** One highlighted span. */
interface Token {
  kind: TokenKind
  text: string
}

/** Language keyword set the tokenizer recognizes (subset, extend as needed). */
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'import',
  'export',
  'from',
  'async',
  'await',
  'class',
  'interface',
  'type',
  'new',
  'throw',
  'try',
  'catch',
  'finally',
  'switch',
  'case',
  'break',
  'continue',
  'default',
  'true',
  'false',
  'null',
  'undefined',
  'this',
])

/** Hard entry limit shared by the parsed-Markdown and token caches. */
const MARKDOWN_CACHE_LIMIT = 2000

/** Tokenizer cache: content hash + language → tokens (P12). */
const tokenCache = new Map<string, Token[]>()

/** Settled source → parsed and partial-fence-trimmed mdast. */
const markdownCache = new Map<string, Root>()

let markdownHits = 0
let markdownParses = 0
let markdownEvictions = 0
let tokenHits = 0
let tokenMisses = 0
let tokenEvictions = 0

function lruGet<Value>(cache: Map<string, Value>, key: string): Value | undefined {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function lruSet<Value>(
  cache: Map<string, Value>,
  key: string,
  value: Value,
  evicted: () => void,
): void {
  cache.delete(key)
  while (cache.size >= MARKDOWN_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
    evicted()
  }
  cache.set(key, value)
}

/**
 * Tokenize one source line into keyword/string/comment/plain spans.
 * @param source - one line of code.
 * @returns the spans, in order.
 */
function tokenizeLine(source: string): Token[] {
  const tokens: Token[] = []
  let plain = ''
  const flush = () => {
    if (plain !== '') {
      tokens.push({ kind: 'plain', text: plain })
      plain = ''
    }
  }
  const trimmed = source.trimStart()
  const indent = source.slice(0, source.length - trimmed.length)
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('--')
  ) {
    return [{ kind: 'comment', text: source }]
  }
  let i = 0
  while (i < trimmed.length) {
    const char = trimmed.charAt(i)
    if (char === "'" || char === '"' || char === '`') {
      const end = trimmed.indexOf(char, i + 1)
      const stop = end === -1 ? trimmed.length : end + 1
      flush()
      tokens.push({ kind: 'string', text: indent + trimmed.slice(i, stop) })
      i = stop
      continue
    }
    if (char === '/' && trimmed.charAt(i + 1) === '/') {
      flush()
      tokens.push({ kind: 'comment', text: indent + trimmed.slice(i) })
      return tokens
    }
    const word = trimmed.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0]
    if (word !== undefined && KEYWORDS.has(word)) {
      flush()
      tokens.push({ kind: 'keyword', text: word })
      i += word.length
      continue
    }
    plain += char
    i += 1
  }
  flush()
  return tokens
}

/**
 * Tokenize full source into cached spans (P12 cache keyed by content).
 * @param source - the code block text.
 * @param lang - fence language hint.
 * @returns cached span list.
 */
export function tokenize(source: string, lang: string): Token[] {
  const key = `${lang}:${source}`
  const cached = lruGet(tokenCache, key)
  if (cached !== undefined) {
    tokenHits += 1
    return cached
  }
  tokenMisses += 1
  const tokens = source.split('\n').flatMap(line => tokenizeLine(line))
  lruSet(tokenCache, key, tokens, () => {
    tokenEvictions += 1
  })
  return tokens
}

/** Syntax token kind → theme token (02-UI-SPEC §1.1 C4: code stays neutral
 * gray-scale inside conversation prose, so blue is reserved for links and
 * emphasis; no new THEME_LEVELS keys). The keyword bold carries the C3 bold
 * tier, keeping the 16-color fallback readable without color (A3). */
const TOKEN_STYLES: Readonly<Record<TokenKind, StyleToken | undefined>> = {
  keyword: 'fg',
  string: 'fg',
  comment: 'fgDim',
  plain: undefined,
}

/** Token kinds that render bold over their foreground (C3 bold tier). */
const TOKEN_BOLD: Readonly<Set<TokenKind>> = new Set(['keyword'])

/**
 * The SGR prefix for one theme token at the installed tier, without a
 * reset. Code-line composition derives it from {@link styled} so the theme
 * table stays the single color source: the line opens with the codeBg strip
 * and each span sets its own foreground, with one reset at line end, so the
 * strip survives every span. The optional bold prefix rides the same tier
 * gate: at `none` both the color and the `\x1b[1m` are dropped, so the
 * plain-text fallback emits no ANSI at all.
 * @param token - theme token.
 * @param bold - prepend the bold SGR when the tier styles anything.
 * @returns the SGR prefix, or '' at `none`.
 */
function tokenSequence(token: StyleToken, bold = false): string {
  const wrapped = styled('', token)
  if (wrapped === '') return ''
  const sequence = wrapped.slice(0, -4)
  return bold ? `\x1b[1m${sequence}` : sequence
}

/**
 * One highlighted code line: each syntax span sets its foreground over the
 * per-line codeBg strip (plain spans re-assert the theme fg so a colored
 * span cannot bleed), and the strip resets once at line end. The two-column
 * indent is painted inside the strip so it cannot surface as an unstyled
 * gap; `prefix`/`tail` carry the turn marker and streaming cursor runs.
 */
export function HighlightedLine({
  source,
  lang,
  prefix = '',
  tail,
}: {
  source: string
  lang: string
  prefix?: string
  tail?: string | undefined
}): ReactNode {
  const tokens = tokenize(source, lang)
  const spans = tokens
    .map((token) => {
      const style = TOKEN_STYLES[token.kind] ?? 'fg'
      const bold = TOKEN_BOLD.has(token.kind)
      const prefixSequence = tokenSequence(style, bold)
      // Close the bold after keyword text so it cannot bleed into the next
      // span (no line-internal full reset, or the codeBg strip would die).
      const boldClose = bold && prefixSequence !== '' ? '\x1b[22m' : ''
      return `${prefixSequence}${escapeContent(token.text)}${boldClose}`
    })
    .join('')
  return <Text>{prefix}{styled(`  ${spans}`, 'codeBg')}{tail}</Text>
}

/** Code fence: collapsed above 500 lines, highlighted inline. */
export function CodeBlock({
  source,
  lang,
  lead = '',
  rest = '',
  tail,
}: {
  source: string
  lang: string
  lead?: string
  rest?: string
  tail?: string | undefined
}): ReactNode {
  const lines = source.split('\n')
  const collapsed = lines.length > 500
  const shown = collapsed ? lines.slice(0, 20) : lines
  return (
    <Box flexDirection="column">
      {shown.map((line, index) => (
        <HighlightedLine
          key={index}
          source={line}
          lang={lang}
          prefix={index === 0 ? lead : rest}
          tail={!collapsed && index === shown.length - 1 ? tail : undefined}
        />
      ))}
      {collapsed ? (
        <Text>
          {rest}
          {paintRow([styled(`▾ … 还有 ${lines.length - 20} 行`, 'fgDim')])}
          {tail}
        </Text>
      ) : null}
    </Box>
  )
}

/** Join one node's literal text, walking nested children when present. */
function literalText(node: PhrasingContent | RootContent): string {
  if ('value' in node) return node.value
  const children = (node as unknown as { children?: unknown[] }).children
  if (children !== undefined && children.length > 0) {
    return children
      .map(child => literalText(child as PhrasingContent | RootContent))
      .join('')
  }
  return ''
}

/** Extract the phrasing children of a node when the node carries them. */
function phrasingChildren(
  node: PhrasingContent,
): PhrasingContent[] | undefined {
  const children = (node as unknown as { children?: unknown }).children
  return Array.isArray(children) ? (children as PhrasingContent[]) : undefined
}

/**
 * Styled runs for one inline mdast node. Prose sits on the frame `bg` so
 * assistant paragraphs do not pick up the terminal default as a gray plate;
 * inline code keeps `codeBg`, and links/emphasis keep accent.
 * @param node - inline mdast node.
 * @returns paint parts for {@link paintRow}.
 */
function inlineParts(node: PhrasingContent): string[] {
  if (node.type === 'inlineCode') {
    return [styled(escapeContent(node.value), 'codeBg')]
  }
  if (node.type === 'strong') {
    return [styled(escapeContent(literalText(node)), 'fg', undefined, true)]
  }
  if (node.type === 'link') {
    const visible = literalText(node)
    const href = node.url
    return wrapLink(
      styled(escapeContent(visible), 'accent'),
      visible,
      href,
      styled(escapeContent(` (${href})`), 'fgDim'),
    )
  }
  if (node.type === 'emphasis') {
    return [styled(escapeContent(literalText(node)), 'accent')]
  }
  if ('value' in node) {
    return [styled(escapeContent(node.value), 'fg')]
  }
  const children = phrasingChildren(node)
  if (children === undefined) return []
  return children.flatMap(inlineParts)
}

/** Painted runs around one block's rows: turn marker and stream cursor. */
interface RowAffixes {
  /** Prepended to the block's first painted row. */
  lead: string
  /** Prepended to every later painted row. */
  rest: string
  /** Appended to the block's last painted row. */
  tail?: string | undefined
}

/**
 * One painted markdown line: escaped, themed parts over the frame `bg`. The
 * prefix and tail runs are already painted; concatenating them into the same
 * Text keeps the row one span so Ink cannot emit unstyled gap cells.
 */
function paintedLine(
  parts: string[],
  key: number | string,
  prefix = '',
  tail?: string,
): ReactNode {
  return (
    <Text key={key} wrap="truncate">
      {prefix}
      {paintRow(parts)}
      {tail}
    </Text>
  )
}

/**
 * One painted table row: a box-drawing rule, a header/body cell row, or a
 * fallback plain line when the window cannot hold a stable grid.
 */
type TableLine =
  | { kind: 'rule'; text: string }
  | { kind: 'row'; header: boolean; cells: readonly string[] }
  | { kind: 'plain'; text: string }

/** Cap for an unbreakable table-cell word when shrinking columns. */
const TABLE_WORD_CAP = 30

/**
 * Longest whitespace-delimited token in `text`, capped so one path cannot
 * starve every other column.
 * @param text - escaped cell text.
 * @returns at least one column.
 */
function longestWordWidth(text: string): number {
  let max = 1
  for (const word of text.split(/\s+/)) {
    if (word === '') continue
    max = Math.max(max, Math.min(TABLE_WORD_CAP, displayWidth(word)))
  }
  return max
}

/**
 * Distribute `available` display columns across `natural` widths, never
 * below `min`. Extra space goes to columns that still sit under their
 * natural width.
 * @param natural - unconstrained per-column display widths.
 * @param min - floor per column.
 * @param available - cell budget after box-drawing overhead.
 * @returns one width per column, summing to at most `available`.
 */
function fitColumnWidths(
  natural: readonly number[],
  min: readonly number[],
  available: number,
): number[] {
  const widths: number[] = []
  for (let index = 0; index < natural.length; index += 1) {
    const cap = natural[index] as number
    const floor = min[index] as number
    widths.push(Math.max(1, Math.min(floor, cap)))
  }
  let used = 0
  for (const width of widths) used += width
  while (used > available) {
    let widest = 0
    for (let col = 1; col < widths.length; col += 1) {
      if ((widths[col] as number) > (widths[widest] as number)) widest = col
    }
    widths[widest] = (widths[widest] as number) - 1
    used -= 1
  }
  let leftover = available - used
  let index = 0
  let stalled = 0
  while (leftover > 0 && stalled < widths.length) {
    const cap = natural[index] as number
    if ((widths[index] as number) < cap) {
      widths[index] = (widths[index] as number) + 1
      leftover -= 1
      stalled = 0
    } else {
      stalled += 1
    }
    index = (index + 1) % widths.length
  }
  if (leftover > 0) {
    widths[widths.length - 1] = (widths.at(-1) as number) + leftover
  }
  return widths
}

/**
 * Box-drawing rule for the given column widths.
 * @param widths - cell display widths.
 * @param kind - top, header-split, or bottom.
 * @returns one rule string.
 */
function tableRule(
  widths: readonly number[],
  kind: 'top' | 'mid' | 'bottom',
): string {
  const fill = widths.map(width => '─'.repeat(Math.max(1, width)))
  if (kind === 'top') return `┌─${fill.join('─┬─')}─┐`
  if (kind === 'bottom') return `└─${fill.join('─┴─')}─┘`
  return `├─${fill.join('─┼─')}─┤`
}

/**
 * Paint one table line: dim box chrome, accent+bold header cells, fg body.
 * @param line - a rule, cell row, or fallback.
 * @returns styled runs for {@link paintedLine}.
 */
function tableLineParts(line: TableLine): string[] {
  if (line.kind === 'rule') return [styled(line.text, 'fgDim')]
  if (line.kind === 'plain') return [styled(line.text, 'fg')]
  const token = line.header ? 'accent' : 'fg'
  const parts: string[] = [styled('│ ', 'fgDim')]
  line.cells.forEach((cell, index) => {
    if (index > 0) parts.push(styled(' │ ', 'fgDim'))
    parts.push(styled(cell, token, undefined, line.header))
  })
  parts.push(styled(' │', 'fgDim'))
  return parts
}

/**
 * Layout a GFM table as a boxed grid. Columns share display-width maxima;
 * cells wrap inside the column instead of clipping the right-hand side.
 * When the window cannot hold `colCount` columns plus box chrome, the table
 * falls back to wrapped ` | `-joined lines.
 * @param cells - row-major cell text; row 0 is the header.
 * @param maxCols - wrap budget for one painted row, including box chrome.
 * @returns painted table lines in visual order.
 */
function layoutTable(
  cells: readonly (readonly string[])[],
  maxCols: number,
): TableLine[] {
  const colCount = Math.max(
    1,
    cells.reduce((max, row) => Math.max(max, row.length), 0),
  )
  const escaped = cells.map(row =>
    Array.from({ length: colCount }, (_, col) => escapeContent(row[col] ?? '')),
  )
  const overhead = 3 * colCount + 1
  const available = maxCols - overhead
  if (available < colCount) {
    return escaped.flatMap(row =>
      wrapDisplayLines(row.join(' | '), maxCols).map(text => ({
        kind: 'plain' as const,
        text,
      })),
    )
  }
  const natural = Array.from({ length: colCount }, (_, col) => {
    let width = 1
    for (const row of escaped) {
      width = Math.max(width, displayWidth(row[col] as string))
    }
    return width
  })
  const min = Array.from({ length: colCount }, (_, col) => {
    let width = 1
    for (const row of escaped) {
      width = Math.max(width, longestWordWidth(row[col] as string))
    }
    return width
  })
  const widths = fitColumnWidths(natural, min, available)
  const visualRows = (row: readonly string[], header: boolean): TableLine[] => {
    const wrapped = row.map((cell, col) => wrapDisplayLines(cell, widths[col] as number))
    const height = wrapped.reduce((max, lines) => Math.max(max, lines.length), 1)
    const lines: TableLine[] = []
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      lines.push({
        kind: 'row',
        header,
        cells: wrapped.map((linesForCell, col) =>
          padDisplayEnd(linesForCell[lineIndex] ?? '', widths[col] as number),
        ),
      })
    }
    return lines
  }
  const header = escaped[0] as string[]
  const body = escaped.slice(1)
  return [
    { kind: 'rule', text: tableRule(widths, 'top') },
    ...visualRows(header, true),
    { kind: 'rule', text: tableRule(widths, 'mid') },
    ...body.flatMap(row => visualRows(row, false)),
    { kind: 'rule', text: tableRule(widths, 'bottom') },
  ]
}

/**
 * Wrap a styled-as-one-run block onto `maxCols` so Yoga's measured height
 * matches the rows Ink later paints. Long unwrapped paragraphs otherwise
 * measure as one row and overwrite the rows below.
 * @param text - already-escaped plain text.
 * @param token - body token.
 * @param maxCols - wrap budget.
 * @param key - react key prefix.
 * @param bold - heading uses bold.
 * @param affixes - marker/indent prefix runs and the optional cursor tail.
 * @returns one Text per wrapped row.
 */
function wrappedRun(
  text: string,
  token: StyleToken,
  maxCols: number,
  key: number,
  bold = false,
  affixes: RowAffixes = { lead: '', rest: '' },
): ReactNode {
  const lines = wrapDisplayLines(text, maxCols)
  if (lines.length <= 1) {
    return paintedLine(
      [styled(text, token, undefined, bold)],
      key,
      affixes.lead,
      affixes.tail,
    )
  }
  return (
    <Box key={key} flexDirection="column" width="100%">
      {lines.map((line, index) =>
        paintedLine(
          [styled(line, token, undefined, bold)],
          `${key}-${index}`,
          index === 0 ? affixes.lead : affixes.rest,
          index === lines.length - 1 ? affixes.tail : undefined,
        ),
      )}
    </Box>
  )
}

/** Render one block-level mdast node into Ink elements. */
function renderNode(
  node: RootContent,
  key: number,
  maxCols: number,
  affixes: RowAffixes,
): ReactNode {
  switch (node.type) {
    case 'heading': {
      const text = node.children.map(literalText).join('')
      // T2 closes the h1 frame on both sides: `━━━ 标题 ━━━`.
      const depth = node.depth === 1
      const prefix = depth ? '━━━ ' : '━ '
      const suffix = depth ? ' ━━━' : ''
      return wrappedRun(
        `${prefix}${escapeContent(text)}${suffix}`,
        'accent',
        maxCols,
        key,
        true,
        affixes,
      )
    }
    case 'paragraph': {
      const escaped = escapeContent(node.children.map(literalText).join(''))
      if (displayWidth(escaped) <= maxCols && !escaped.includes('\n')) {
        return paintedLine(
          node.children.flatMap(inlineParts),
          key,
          affixes.lead,
          affixes.tail,
        )
      }
      return wrappedRun(escaped, 'fg', maxCols, key, false, affixes)
    }
    case 'list': {
      const lastIndex = node.children.length - 1
      return (
        <Box key={key} flexDirection="column" width="100%">
          {node.children.map((item, index) => {
            let marker = '- '
            if (node.ordered === true) {
              // v8 ignore next -- micromark always supplies List.start on ordered lists.
              const startAt = node.start ?? 1
              marker = `${startAt + index}. `
            }
            const text = item.children.map(literalText).join('')
            return wrappedRun(
              `${marker}${escapeContent(text)}`,
              'fg',
              maxCols,
              index,
              false,
              {
                lead: index === 0 ? affixes.lead : affixes.rest,
                rest: affixes.rest,
                tail: index === lastIndex ? affixes.tail : undefined,
              },
            )
          })}
        </Box>
      )
    }
    case 'blockquote': {
      const text = node.children.map(literalText).join('')
      return wrappedRun(
        `│ ${escapeContent(text)}`,
        'fgDim',
        maxCols,
        key,
        false,
        affixes,
      )
    }
    case 'code':
      return (
        <CodeBlock
          key={key}
          source={node.value}
          lang={node.lang ?? 'text'}
          lead={affixes.lead}
          rest={affixes.rest}
          tail={affixes.tail}
        />
      )
    case 'table': {
      const rows = node.children.map(row =>
        row.children.map(cell => cell.children.map(literalText).join('')),
      )
      const lines = layoutTable(rows, maxCols)
      const lastIndex = lines.length - 1
      return (
        <Box key={key} flexDirection="column" width="100%">
          {lines.map((line, rowIndex) =>
            paintedLine(
              tableLineParts(line),
              rowIndex,
              rowIndex === 0 ? affixes.lead : affixes.rest,
              rowIndex === lastIndex ? affixes.tail : undefined,
            ),
          )}
        </Box>
      )
    }
    default:
      return null
  }
}

/**
 * Trim a streamed partial closing fence from the last code block. An
 * unclosed fence swallows the tail line as code content until the closing
 * marker is complete, so a fence arriving character by character would
 * briefly paint its own ` `` ` as code (the Pi #5825 flicker). The trimmed
 * line reappears as content when it turns out not to be a fence prefix.
 * @param root - parsed mdast tree (mutated in place).
 * @param source - the markdown source the tree was parsed from.
 */
function trimPartialClosingFence(root: Root, source: string): void {
  let node: RootContent | undefined = root.children.at(-1)
  while (
    node !== undefined
    && (node.type === 'list' || node.type === 'listItem' || node.type === 'blockquote')
  ) {
    node = (node.children as RootContent[]).at(-1)
  }
  if (node?.type !== 'code') return
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  // mdast nodes produced from source text always retain parser offsets.
  const raw = source.slice(start, end)
  const marker = /^(`{3,}|~{3,})/.exec(raw)?.[1]
  if (marker === undefined) return
  const lastLine = raw.split('\n').at(-1) as string
  if (lastLine === '' || lastLine.length >= marker.length) return
  if (lastLine !== marker.charAt(0).repeat(lastLine.length)) return
  node.value = node.value
    .slice(0, node.value.length - lastLine.length)
    .replace(/\n$/, '')
}

function parseMarkdown(source: string, settled: boolean): Root {
  if (settled) {
    const cached = lruGet(markdownCache, source)
    if (cached !== undefined) {
      markdownHits += 1
      return cached
    }
  }
  markdownParses += 1
  const root = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  trimPartialClosingFence(root, source)
  if (settled) {
    lruSet(markdownCache, source, root, () => {
      markdownEvictions += 1
    })
  }
  return root
}

/** Read-only instrumentation and reset seam for bounded Markdown-cache tests. */
export const markdownCacheInternals = {
  /** Clear both caches and their counters. */
  reset(): void {
    markdownCache.clear()
    tokenCache.clear()
    markdownHits = 0
    markdownParses = 0
    markdownEvictions = 0
    tokenHits = 0
    tokenMisses = 0
    tokenEvictions = 0
  },
  /**
   * Return current cache occupancy and access counters.
   * @returns an immutable diagnostic snapshot.
   */
  snapshot() {
    return Object.freeze({
      limit: MARKDOWN_CACHE_LIMIT,
      markdownEntries: markdownCache.size,
      markdownHits,
      markdownParses,
      markdownEvictions,
      tokenEntries: tokenCache.size,
      tokenHits,
      tokenMisses,
      tokenEvictions,
    })
  },
}

/** Painted prefix runs for the first and later rows of a markdown block. */
export interface MarkdownRowPrefix {
  /** Prepended to the first painted row (the turn marker). */
  first: string
  /** Prepended to every later painted row (the continuation indent). */
  rest: string
}

/**
 * Render GFM markdown source into Ink elements.
 * @param source - markdown source (untrusted; escaped inside).
 * @param maxCols - complete row budget, including marker and cursor affixes;
 * defaults to the current window width.
 * @param prefix - painted marker/indent runs; settled and streaming rows use
 * the same layout so a finishing turn does not reflow.
 * @param tail - painted run appended to the last painted row (the streaming
 * cursor).
 * @param settled - true only for immutable history sources eligible for mdast caching.
 * @returns the element tree.
 */
export function MarkdownBlock({
  source,
  maxCols,
  prefix,
  tail,
  settled = false,
}: {
  source: string
  maxCols?: number
  prefix?: MarkdownRowPrefix
  tail?: string | undefined
  settled?: boolean | undefined
}): ReactNode {
  const { columns } = useWindowSize()
  const width = Math.max(1, maxCols ?? columns)
  const prefixWidth = Math.max(
    displayWidth(prefix?.first ?? ''),
    displayWidth(prefix?.rest ?? ''),
  )
  const bodyWidth = Math.max(1, width - prefixWidth - displayWidth(tail ?? ''))
  const root = parseMarkdown(source, settled)
  const children = root.children
  if (children.length === 0) {
    if (tail === undefined) {
      return <Box flexDirection="column" width="100%" />
    }
    return (
      <Box flexDirection="column" width="100%">
        <Text>{prefix?.first}{tail}</Text>
      </Box>
    )
  }
  const lastIndex = children.length - 1
  return (
    <Box flexDirection="column" width="100%">
      {children.map((node, index) =>
        renderNode(node, index, bodyWidth, {
          lead: index === 0 ? prefix?.first ?? '' : prefix?.rest ?? '',
          rest: prefix?.rest ?? '',
          tail: index === lastIndex ? tail : undefined,
        }),
      )}
    </Box>
  )
}
