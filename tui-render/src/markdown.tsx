/**
 * Markdown rendering for the terminal: GFM markdown parses through the
 * mdast pipeline, then a styled renderer (in {@link ./markdown-render.ts})
 * produces physical row records, which the JSX bridge here paints through
 * the installed theme via {@link paintRow} / {@link styled}. Code blocks
 * highlight with a lightweight regex tokenizer (P12: cached by content
 * hash, collapsed above 500 lines). Markdown links wrap that styled text
 * in OSC 8 when {@link hyperlinksEnabled} is set; otherwise the href is
 * printed in parentheses when it differs from the label.
 *
 * Streaming callers reuse the same block for settled text: `prefix` paints
 * the turn marker on the first row and the continuation indent on later
 * rows (no sibling marker column, so Ink leaves no unstyled gap cells),
 * `tail` appends the streaming cursor to the last painted row, and a
 * trailing partial closing fence is trimmed from the last code block
 * until its marker completes (delegated to {@link ./markdown-parse.ts}).
 *
 * GFM tables feed through {@link ./markdown-render.ts#renderTable} and use
 * the same `layoutTableCells` strategy as the standalone
 * {@link ./table-layout.ts} so widths settle deterministically when the
 * window shrinks. Active tables (header and delimiter seen, body rows
 * still arriving) are also driven by the `TableScanner` so pre-table
 * content remains cached and the active table itself renders from raw
 * scanner cells.
 *
 * @module @deepseek-ai/dsh-tui-render/markdown
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { Fragment, useRef } from 'react'
import type { RootContent } from 'mdast'
import { displayWidth, escapeContent } from './content.ts'
import { hyperlinksEnabled } from './hyperlink.ts'
import { paintRow, styled, type StyleToken } from './theme.ts'
import { markdownParseInternals, parseMarkdownSource } from './markdown-parse.ts'
import { paintLineFromRenderLine } from './painted-line.ts'
import {
  type MarkdownBlockRenderer,
  type MarkdownRenderLine,
  type MarkdownRenderScope,
  type MarkdownStyleToken,
  createMarkdownProjector,
} from './markdown-projector.ts'
import { createStyledMarkdownBlockRenderer } from './markdown-render.ts'
import { parsePipeTableCells, TableScanner } from './table-scanner.ts'

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

/** Read-only counter block for the markdown-specific caches. */
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
    /* v8 ignore next -- cacheLimit >= 1 guarantees a non-empty cache at eviction */
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
  const flush = (): void => {
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

/** Render a single {@link MarkdownRenderLine} into one painted Text run. */
function paintedLineFromRenderLine(
  line: MarkdownRenderLine,
  hyperlinks: boolean,
): string {
  return paintLineFromRenderLine(line, hyperlinks && hyperlinksEnabled())
}

interface RowAffixes {
  /** Prepended to the block's first painted row. */
  lead: string
  /** Prepended to every later painted row. */
  rest: string
  /** Appended to the block's last painted row. */
  tail?: string | undefined
}

/** Emit JSX for one block from its physical lines + affixes. */
function linesToJsx(
  lines: readonly MarkdownRenderLine[],
  affixes: RowAffixes,
  hyperlinks: boolean,
): ReactNode {
  if (lines.length === 0) return null
  return (
    <Box flexDirection="column" width="100%">
      {lines.map((line, index) => {
        const painted = paintedLineFromRenderLine(line, hyperlinks)
        const prefix = index === 0 ? affixes.lead : affixes.rest
        const tail = index === lines.length - 1 ? affixes.tail : undefined
        return (
          <Text key={index} wrap="truncate">
            {prefix}
            {painted}
            {tail}
          </Text>
        )
      })}
    </Box>
  )
}

/** Read-only instrumentation and reset seam for the markdown cache surface. */
export const markdownCacheInternals = {
  /** Clear both caches and reset every counter to zero. */
  reset(): void {
    tokenCache.clear()
    tokenHits = 0
    tokenMisses = 0
    tokenEvictions = 0
    markdownParseInternals.reset()
  },
  /**
   * Return current cache occupancy and access counters.
   * @returns an immutable diagnostic snapshot.
   */
  snapshot() {
    const parseSnap = markdownParseInternals.snapshot()
    return Object.freeze({
      limit: MARKDOWN_CACHE_LIMIT,
      markdownEntries: parseSnap.entries,
      markdownHits: parseSnap.hits,
      markdownParses: parseSnap.parses,
      markdownEvictions: parseSnap.evictions,
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

/** Per-block JSX cache; useMemo-keyed by (node pointer) + (scopeKey). */

interface BlockEntry {
  /** ReactNode tree for the rendered block (null when the block paints empty). */
  readonly node: ReactNode
  /** Display width consumed by the last painted row (for affix clamping). */
  readonly lastRowWidth: number
  /** Source range of the block; used to detect stable prefix boundaries. */
  readonly range: { start: number; end: number }
}

interface RendererState {
  projector: ReturnType<typeof createMarkdownProjector>
  scanner: TableScanner
  lastSource: string
  /** Last scopeKey (width|theme|fold|renderMode) used to build the renderer. */
  scopeKey: string
  /** Cached renderer for the current scope. */
  renderer: MarkdownBlockRenderer
  /** Cached block-render output keyed by `start:end`. */
  cache: Map<string, BlockEntry>
  /** Last projection's per-block output for stable-prefix detection. */
  lastBlocks: readonly { range: { start: number; end: number }; lines: readonly MarkdownRenderLine[] }[]
}

/** Build a renderer bound to the active width + hyperlink flag. */
function buildRenderer(width: number, hyperlinks: boolean): MarkdownBlockRenderer {
  return createStyledMarkdownBlockRenderer({ width, hyperlinks })
}

function computeScopeKey(width: number, theme: string, fold: string, renderMode: string): string {
  return `${width}|${theme}|${fold}|${renderMode}`
}

/**
 * Render GFM markdown source into Ink elements.
 *
 * Internally the component owns one {@link MarkdownProjector} (incrementally
 * parses the source) and one {@link TableScanner} (tracks the active GFM
 * table region). For settled sources the projector reuses its cached
 * physical rows; for streaming sources only the new tail re-parses.
 * Active tables short-circuit mdast for the mutable region so pre-table
 * content stays cached and rows never duplicate.
 *
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
  const stateRef = useRef<RendererState | null>(null)
  const width = Math.max(1, maxCols ?? columns)
  const prefixWidth = Math.max(
    displayWidth(prefix?.first ?? ''),
    displayWidth(prefix?.rest ?? ''),
  )
  const tailWidth = displayWidth(tail ?? '')
  const bodyWidth = Math.max(1, width - prefixWidth - tailWidth)
  if (!source.endsWith('\n') && (tail === undefined || settled)) {
    return renderFullSource(source, bodyWidth, prefix, tail, settled)
  }
  if (stateRef.current === null) {
    const scope: MarkdownRenderScope = {
      width: bodyWidth,
      theme: 'truecolor',
      fold: 'expanded',
      renderMode: settled ? 'settled' : 'streaming',
    }
    stateRef.current = {
      projector: createMarkdownProjector(buildRenderer(bodyWidth, /* hyperlinks */ false), { cacheLimit: MARKDOWN_CACHE_LIMIT }),
      scanner: new TableScanner(),
      lastSource: '',
      scopeKey: computeScopeKey(bodyWidth, scope.theme, scope.fold, scope.renderMode),
      renderer: buildRenderer(bodyWidth, false),
      cache: new Map(),
      lastBlocks: [],
    }
  }
  const state = stateRef.current
  const scopeKey = computeScopeKey(bodyWidth, 'truecolor', 'expanded', settled ? 'settled' : 'streaming')
  if (state.scopeKey !== scopeKey) {
    state.projector = createMarkdownProjector(buildRenderer(bodyWidth, false), { cacheLimit: MARKDOWN_CACHE_LIMIT })
    state.renderer = buildRenderer(bodyWidth, false)
    state.cache.clear()
    state.lastBlocks = []
    state.scanner.reset()
    state.scopeKey = scopeKey
  }
  // Feed delta from previous render to current.
  if (source !== state.lastSource) {
    if (!source.startsWith(state.lastSource)) {
      state.projector.collector.reset()
      state.projector.reset()
      state.scanner.reset()
      state.cache.clear()
      state.lastBlocks = []
    }
    const delta = source.slice(state.lastSource.length)
    state.projector.collector.append(delta)
    state.scanner.feed(delta)
    state.lastSource = source
  }
  // Streaming keeps the unfinished line raw so token-sized updates do not
  // reparse the complete Markdown source. Settlement promotes it exactly
  // once before the immutable history snapshot is rendered.
  if (settled || tail === undefined) {
    state.projector.collector.finalize()
    state.scanner.finalize()
  }
  const projection = state.projector.project({
    width: bodyWidth,
    theme: 'truecolor',
    fold: 'expanded',
    renderMode: settled ? 'settled' : 'streaming',
  })
  const scannerSnap = state.scanner.snapshot()
  const activeTableTailCells = scannerSnap.state.kind === 'confirmed-table'
    && projection.tail !== undefined
    ? parsePipeTableCells(projection.tail.text)
    : undefined
  // Render blocks: pre-table / active-table / post-table.
  const renderScope: MarkdownRenderScope = {
    width: bodyWidth,
    theme: 'truecolor',
    fold: 'expanded',
    renderMode: settled ? 'settled' : 'streaming',
  }
  const affixes: RowAffixes = {
    lead: prefix?.first ?? '',
    rest: prefix?.rest ?? '',
    tail,
  }
  const out: ReactNode[] = []
  const blocks = projection.blocks
  let blockIndex = 0
  for (const block of blocks) {
    const range = block.range
    const overlaps = scannerSnap.state.kind === 'confirmed-table'
      && range.end > scannerSnap.mutableStart
      && range.start < scannerSnap.mutableEnd
    if (overlaps) {
      // Skip: this block is the mdast form of the active table.
      blockIndex += 1
      continue
    }
    const isLast = blockIndex === blocks.length - 1
      && projection.tail === undefined
      && scannerSnap.state.kind !== 'confirmed-table'
    const blockAffixes: RowAffixes = {
      lead: blockIndex === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: isLast ? affixes.tail : undefined,
    }
    out.push(<Fragment key={`b-${blockIndex}`}>{renderBlockEntry(block, blockAffixes, state, renderScope)}</Fragment>)
    blockIndex += 1
  }
  if (scannerSnap.state.kind === 'confirmed-table' && scannerSnap.rows.length > 0) {
    const tableAffixes: RowAffixes = {
      lead: blocks.length === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: projection.tail === undefined ? affixes.tail : undefined,
    }
    const tableRows = [
      ...scannerSnap.rows.filter(row => !row.isDelimiter),
      ...(activeTableTailCells === undefined
        ? []
        : [{ cells: activeTableTailCells }]),
    ]
    out.push(<Fragment key="active-table">{renderActiveTable(tableRows, bodyWidth, tableAffixes, false)}</Fragment>)
  }
  if (projection.tail !== undefined && activeTableTailCells === undefined) {
    out.push(
      <Fragment key="tail">
        {renderFullSource(
          projection.tail.text,
          bodyWidth,
          {
            first: blocks.length === 0 && scannerSnap.rows.length === 0
              ? affixes.lead
              : affixes.rest,
            rest: affixes.rest,
          },
          affixes.tail,
          false,
        )}
      </Fragment>,
    )
  }
  if (out.length === 0 && tail === undefined) {
    return <Box flexDirection="column" width="100%" />
  }
  if (out.length === 0) {
    return (
      <Box flexDirection="column" width="100%">
        <Text>{prefix?.first}{tail}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width="100%">
      {out}
    </Box>
  )
}

/** Render one cached block entry, recomputing on cache miss. */
function renderBlockEntry(
  block: { node: RootContent; lines: readonly MarkdownRenderLine[]; range: { start: number; end: number } },
  affixes: RowAffixes,
  state: RendererState,
  _scope: MarkdownRenderScope,
): ReactNode {
  const rangeKey = `${block.range.start}:${block.range.end}`
  const cached = state.cache.get(rangeKey)
  if (cached !== undefined) {
    return cached.node
  }
  const node = linesToJsx(block.lines, affixes, /* hyperlinks */ false)
  const lastRow = block.lines.at(-1)
  const entry: BlockEntry = {
    node,
    lastRowWidth: lastRow?.displayWidth ?? 0,
    range: block.range,
  }
  state.cache.set(rangeKey, entry)
  return node
}

/** Render one active table line range from raw scanner rows. */
function renderActiveTable(
  rows: readonly { cells: readonly string[] }[],
  width: number,
  affixes: RowAffixes,
  hyperlinks: boolean,
): ReactNode {
  // Determine column count from the widest row; pad shorter rows with ''.
  const colCount = rows.reduce((m, r) => Math.max(m, r.cells.length), 0)
  const normalized = rows.map((r) => {
    const cells = r.cells.slice()
    while (cells.length < colCount) cells.push('')
    return cells
  })
  const overhead = 3 * colCount + 1
  const available = Math.max(0, width - overhead)
  if (available < colCount) {
    const lines: MarkdownRenderLine[] = normalized.map((cells, index) => {
      const text = cells.join(' | ')
      return {
        text,
        displayWidth: displayWidth(text),
        spans: [{ start: 0, end: displayWidth(text), token: 'fg', bold: false }],
        rowInBlock: index,
        sourceStart: -1,
        sourceEnd: -1,
        rawTail: false,
      }
    })
    return linesToJsx(lines, affixes, hyperlinks)
  }
  const natural = Array.from({ length: colCount }, (_, col) => {
    let w = 1
    for (const row of normalized) w = Math.max(w, displayWidth(row[col] ?? ''))
    return w
  })
  const widths = natural.slice()
  let used = 0
  for (const w of widths) used += w
  while (used > available) {
    let widest = 0
    for (let col = 1; col < widths.length; col += 1) {
      if ((widths[col] as number) > (widths[widest] as number)) widest = col
    }
    widths[widest] = (widths[widest] as number) - 1
    used -= 1
  }
  const fill = widths.map(w => '─'.repeat(Math.max(1, w)))
  const lines: MarkdownRenderLine[] = []
  const pushRule = (rule: string): void => {
    lines.push(makeSimpleLine(rule, 'fgDim', lines.length))
  }
  pushRule(`┌─${fill.join('─┬─')}─┐`)
  normalized.forEach((cells, rowIndex) => {
    const escaped = cells.map(c => escapeContent(c))
    const header = rowIndex === 0
    const cellParts = cells.map((_cell, col) => {
      const cellWidth = widths[col] as number
      return (escaped[col] ?? '').padEnd(cellWidth, ' ').slice(0, cellWidth)
    })
    const inner = cellParts.join(' │ ')
    const lineText = `│ ${inner} │`
    lines.push(makeSimpleLine(lineText, header ? 'accent' : 'fg', lines.length, header))
    if (rowIndex === 0) {
      pushRule(`├─${fill.join('─┼─')}─┤`)
    }
  })
  pushRule(`└─${fill.join('─┴─')}─┘`)
  return linesToJsx(lines, affixes, hyperlinks)
}

/** Build a one-spanned MarkdownRenderLine from plain text + token. */
function makeSimpleLine(
  text: string,
  token: MarkdownStyleToken,
  rowInBlock: number,
  bold = false,
): MarkdownRenderLine {
  return {
    text,
    displayWidth: displayWidth(text),
    spans: [{ start: 0, end: displayWidth(text), token, bold }],
    rowInBlock,
    sourceStart: -1,
    sourceEnd: -1,
    rawTail: false,
  }
}

/**
 * Re-export the parse internals so callers can poke at the parse cache
 * surface (the upstream `markdownCacheInternals` seam wraps both layers).
 */
export { markdownParseInternals }


/**
 * One-shot render path used when the source ends without a trailing
 * newline. Parses the source via the shared parse layer (which applies the
 * partial-fence trim and the settled-source cache) and then emits the same
 * JSX shape as the projector path would, including table-holdback
 * partition by the scanner's mutable range.
 */
function renderFullSource(
  source: string,
  bodyWidth: number,
  prefix: MarkdownRowPrefix | undefined,
  tail: string | undefined,
  settled: boolean,
): ReactNode {
  const root = parseMarkdownSource(source, settled)
  const hyperlinks = hyperlinksEnabled()
  const renderer = buildRenderer(bodyWidth, hyperlinks)
  const affixes: RowAffixes = {
    lead: prefix?.first ?? '',
    rest: prefix?.rest ?? '',
    tail,
  }
  const out: ReactNode[] = []
  const scanner = new TableScanner()
  scanner.feed(source)
  scanner.finalize()
  const snap = scanner.snapshot()
  let blockIndex = 0
  const blocks = root.children
  for (const block of blocks) {
    const range = blockPositionRange(block)
    const overlaps = snap.state.kind === 'confirmed-table'
      && range.end > snap.mutableStart
      && range.start < snap.mutableEnd
    if (overlaps) {
      blockIndex += 1
      continue
    }
    const isLast = blockIndex === blocks.length - 1
    const blockAffixes: RowAffixes = {
      lead: blockIndex === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: isLast ? affixes.tail : undefined,
    }
    const lines = renderer.renderBlock(block, {
      width: bodyWidth,
      theme: 'truecolor',
      fold: 'expanded',
      renderMode: 'streaming',
    }, blockIndex)
    out.push(
      <Fragment key={`full-b-${blockIndex}`}>{linesToJsx(lines, blockAffixes, hyperlinks)}</Fragment>,
    )
    blockIndex += 1
  }
  if (snap.state.kind === 'confirmed-table' && snap.rows.length > 0) {
    const tableAffixes: RowAffixes = {
      lead: blocks.length === 0 ? affixes.lead : affixes.rest,
      rest: affixes.rest,
      tail: blocks.length === 0 ? affixes.tail : undefined,
    }
    out.push(<Fragment key="full-active-table">{renderActiveTable(snap.rows, bodyWidth, tableAffixes, hyperlinks)}</Fragment>)
  }
  if (out.length === 0 && tail === undefined) {
    return <Box flexDirection="column" width="100%" />
  }
  if (out.length === 0) {
    return (
      <Box flexDirection="column" width="100%">
        <Text>{prefix?.first}{tail}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width="100%">
      {out}
    </Box>
  )
}

function blockPositionRange(node: RootContent): { start: number; end: number } {
  const position = node.position
  if (position === undefined) return { start: -1, end: -1 }
  return { start: position.start.offset ?? -1, end: position.end.offset ?? -1 }
}
