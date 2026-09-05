/**
 * Incremental Markdown projector: a pure-data module that converts an
 * append-only stream of markdown deltas into a stable physical-row output.
 *
 * The module has three layers:
 *
 *   1. {@link MarkdownCollector} keeps the canonical source: deltas are
 *      appended, but only complete lines (those terminated by `\n`) advance
 *      the committed source; the unfinished tail stays mutable and is never
 *      fed to the parser.
 *   2. {@link MarkdownProjector} parses committed source, walks the parsed
 *      top-level mdast blocks, and preserves stable-block references across
 *      appends so already-painted physical rows never move. The "ambiguous
 *      tail" (the last top-level block that may still grow) is re-parsed
 *      each projection; the raw tail paints as a single partial line.
 *   3. The render callback (passed in at construction time) maps one
 *      mdast block to a list of physical {@link MarkdownRenderLine}
 *      records. The default implementation renders plain text with
 *      per-row style spans and never touches Ink or ANSI escapes, so the
 *      projector stays pure data and any rendering front-end can plug in.
 *
 * Decision 2 of `optimize-tui-streaming-renderer` is the source of truth:
 * closed top-level blocks keep both their parsed node identity and their
 * physical-row records; only the final ambiguous block is re-parsed; and
 * any of the explicit safe full-recompute paths (reference definitions,
 * inline visualization directives, render-mode changes, parser-locality
 * failures) re-parse the entire committed source and emit a fresh stable
 * prefix.
 *
 * @module @deepseek-ai/dsh-tui-render/markdown-projector
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Root, RootContent } from 'mdast'
import { displayWidth, escapeContent, wrapDisplayLines } from './content.ts'
import { parseMarkdownSource, trimPartialClosingFence } from './markdown-parse.ts'
import type { BackgroundToken } from './theme.ts'

/**
 * Default cache size for stable-block records. Sized to match the
 * upstream markdown cache limit (see {@link ./markdown.tsx}).
 */
export const MARKDOWN_PROJECTOR_DEFAULT_CACHE_LIMIT = 2000

/**
 * Default number of source bytes that must accumulate before the projector's
 * internal safe-recompute detector re-scans the committed source. The probe
 * is cheap, but skipping it on every append keeps the hot path O(1).
 */
export const MARKDOWN_PROJECTOR_DEFAULT_PROBE_INTERVAL = 64

/** Explicit reason a projection took the safe full-recompute path. */
export type SafeFullRecomputeReason =
  /** A reference-style link definition (`[id]: url`) appears in the committed source. */
  | 'reference-definition'
  /** An inline visualization directive appears in the committed source. */
  | 'visualization-directive'
  /** The render mode changed since the previous projection. */
  | 'render-mode-change'
  /** The committed source ends in a position whose locality the parser cannot prove. */
  | 'parser-locality'

/** Snapshot of projector counters; safe to read concurrently. */
export interface MarkdownProjectorStats {
  /** Source bytes handed to the Markdown parser across full and suffix parses. */
  readonly parsedBytes: number
  /** Total projections since the last reset. */
  readonly projections: number
  /** Projections that took the stable-prefix fast path. */
  readonly stableHits: number
  /** Projections that re-parsed the committed source because of a safe full-recompute trigger. */
  readonly safeRecomputes: number
  /** Increments per safe-recompute reason, keyed by the trigger. */
  readonly safeRecomputeReasons: Readonly<Partial<Record<SafeFullRecomputeReason, number>>>
  /** Stable blocks reused by reference across two consecutive projections. */
  readonly stableBlocksReused: number
  /** Physical rows carried by reused stable block references. */
  readonly stableRowsReused: number
  /** Stable blocks re-parsed because their content shifted. */
  readonly stableBlocksRerendered: number
  /** Current cache occupancy (stable blocks). */
  readonly cacheEntries: number
  /** Cache evictions since the last reset (LRU). */
  readonly cacheEvictions: number
  /** Tail (raw) lines painted since the last reset. */
  readonly tailLinesPainted: number
  /** Top-level blocks rendered since the last reset. */
  readonly topLevelBlocksRendered: number
}

/** One painted physical row. */
export interface MarkdownRenderLine {
  /** Visible text (already escaped). */
  readonly text: string
  /** Display width of `text` in terminal columns. */
  readonly displayWidth: number
  /** Inline style spans inside `text`, ordered and non-overlapping. */
  readonly spans: readonly MarkdownRenderSpan[]
  /** Zero-based row index within its owning block. */
  readonly rowInBlock: number
  /** Byte offset in the committed source where this row's text begins. */
  readonly sourceStart: number
  /** Byte offset immediately after this row's text in the committed source. */
  readonly sourceEnd: number
  /** Whether this row is a streaming raw tail (no mdast node owns it). */
  readonly rawTail: boolean
  /** Background token; `undefined` means use the frame `bg`. */
  readonly background?: BackgroundToken | undefined
  /** Cell width painted through `background`; defaults to `displayWidth`. */
  readonly backgroundColumns?: number | undefined
}

/** One inline style span inside a {@link MarkdownRenderLine}. */
export interface MarkdownRenderSpan {
  /** Inclusive start column (in display columns) inside the line text. */
  readonly start: number
  /** Exclusive end column (in display columns) inside the line text. */
  readonly end: number
  /** Theme token name; the renderer is responsible for mapping it to ANSI. */
  readonly token: MarkdownStyleToken
  /** Whether to draw the span with bold. */
  readonly bold: boolean
  /** OSC 8 target — when set the bridge wraps the span in OSC 8 escapes. */
  readonly href?: string | undefined
}

/** Theme tokens the default renderer emits; see {@link ./theme.ts}. */
export type MarkdownStyleToken =
  | 'fg'
  | 'fgSoft'
  | 'fgDim'
  | 'accent'
  | 'accentText'
  | 'accentDim'
  | 'success'
  | 'warning'
  | 'error'
  | 'line'
  | 'codeBg'
  | 'codeKeyword'
  | 'codeString'
  | 'codeComment'
  | 'codeCommand'
  | 'markdownStrong'
  | 'markdownEmphasis'
  | 'markdownCode'
  | 'markdownLink'

/** All inputs that change the rendered physical rows. */
export interface MarkdownRenderScope {
  /** Body width in columns (after marker / cursor affixes are subtracted). */
  readonly width: number
  /** Theme tier — truecolor, 256, 16, or none. */
  readonly theme: 'truecolor' | '256' | '16' | 'none'
  /** Fold mode for oversized code fences. */
  readonly fold: 'expanded' | 'collapsed'
  /** Renderer mode — `streaming` keeps the cursor row, `settled` removes it. */
  readonly renderMode: 'streaming' | 'settled'
  /** Optional identifier for the owner block; used only for diagnostics. */
  readonly ownerId?: string | undefined
}

/**
 * Renderer callback that turns one top-level mdast block (or a raw tail
 * line) into physical rows. The projector never inspects the rendered
 * lines — it only forwards them — so a renderer can choose any level of
 * fidelity (plain text, ANSI pre-escaped, OSC 8-wrapped, …).
 */
export interface MarkdownBlockRenderer {
  /**
   * Render a parsed top-level mdast block.
   * @param node - one top-level mdast block owned by the projection.
   * @param scope - render scope shared with the projector.
   * @param blockIndex - zero-based top-level block index inside the projection.
   * @returns one physical row per line the block emits. A renderer may return
   *   an empty array when another projector owns an explicitly held-back
   *   mutable region, such as a confirmed streaming table.
   */
  renderBlock(
    node: RootContent,
    scope: MarkdownRenderScope,
    blockIndex: number,
  ): readonly MarkdownRenderLine[]

  /**
   * Render an unfinished trailing line whose bytes are still in the
   * collector's raw tail. The line ends mid-character-set and the renderer
   * decides how to truncate and style the partial row.
   * @param text - escaped partial line.
   * @param displayWidth - visible columns the partial line currently occupies.
   * @param scope - render scope shared with the projector.
   * @returns exactly one physical row (a streaming cursor may paint inside
   *   the renderer if `scope.renderMode === 'streaming'`).
   */
  renderRawTail(
    text: string,
    displayWidth: number,
    scope: MarkdownRenderScope,
  ): MarkdownRenderLine
}

/** Optional hooks for callers that need to inject state. */
export interface MarkdownProjectorOptions {
  /** Cache limit; defaults to {@link MARKDOWN_PROJECTOR_DEFAULT_CACHE_LIMIT}. */
  readonly cacheLimit?: number
  /** Minimum source-byte delta between safe-recompute probes. */
  readonly probeInterval?: number
  /** Inline visualization directive detector; returns `true` if the source contains one. */
  readonly detectVisualizationDirective?: (source: string) => boolean
}

/** One rendered top-level block plus its physical lines. */
export interface MarkdownProjectedBlock {
  /** Parsed mdast node, retained by reference across projections when stable. */
  readonly node: RootContent
  /** Physical lines the renderer emitted for this block. */
  readonly lines: readonly MarkdownRenderLine[]
  /** Stable source range `[start, end)`. */
  readonly range: { readonly start: number; readonly end: number }
  /** Whether the block was reused from a previous projection. */
  readonly stable: boolean
}

/** The full projector output for one commit cycle. */
export interface MarkdownProjection {
  /** Source revision the projector consumed; monotonically increasing. */
  readonly revision: number
  /** Scope the projector consumed (a frozen copy of the caller's scope). */
  readonly scope: MarkdownRenderScope
  /** Rendered top-level blocks, in source order. */
  readonly blocks: readonly MarkdownProjectedBlock[]
  /** Final raw-tail line, if the committed source ended mid-line. */
  readonly tail: MarkdownRenderLine | undefined
  /** Source length in bytes (committed + raw tail). */
  readonly sourceLength: number
  /** Whether this projection took the safe full-recompute path. */
  readonly safeRecompute: SafeFullRecomputeReason | undefined
}

/** Append-only markdown collector exposed by the module. */
export interface MarkdownCollector {
  /**
   * Append a delta to the canonical source. Delimiters split on `\n`:
   * complete lines promote into the committed source and increment the
   * revision; the trailing partial line becomes the new raw tail.
   * @param delta - new markdown bytes (untrusted).
   */
  append(delta: string): void
  /** Current committed source (everything up to the last complete newline). */
  committedSource(): string
  /** Current raw-tail line (the unfinished bytes after the last newline). */
  rawTail(): string
  /** Committed-source length in bytes. */
  committedLength(): number
  /** Total source length (committed + raw tail). */
  sourceLength(): number
  /** Current revision counter; incremented on each commit. */
  revision(): number
  /**
   * Promote the raw tail into the committed source by appending a newline
   * so the next projection sees a complete final line. Use only when the
   * caller knows no more bytes will arrive for this commit (e.g. on
   * settlement). Returns the promoted source length.
   */
  finalize(): number
  /**
   * Reset the committed source, the raw tail, and the revision counter.
   * The projector owns this reset too; collectors do not need it during
   * normal streaming. Used by call sites that want to discard the
   * accumulated source (e.g. when a non-append edit rewinds the input).
   */
  reset(): void
}

/** Incremental markdown projector exposed by the module. */
export interface MarkdownProjector {
  /** The collector the projector reads from; exposed for tests. */
  readonly collector: MarkdownCollector
  /**
   * Run one projection pass against the committed source and raw tail.
   * @param scope - current width/theme/fold/render-mode snapshot.
   * @returns the rendered top-level blocks plus the raw tail.
   */
  project(scope: MarkdownRenderScope): MarkdownProjection
  /** Snapshot the projector's counters. */
  stats(): MarkdownProjectorStats
  /** Reset counters and caches; the collector's committed source is also cleared. */
  reset(): void
}

/**
 * Plain-text renderer used by tests and as a reference default.
 * @returns the shared stateless plain-text block renderer.
 */
export function plainTextMarkdownBlockRenderer(): MarkdownBlockRenderer {
  return PLAIN_TEXT_RENDERER
}

const PLAIN_TEXT_RENDERER: MarkdownBlockRenderer = {
  renderBlock(node, scope, blockIndex) {
    const text = extractBlockText(node)
    if (text === '') return [emptyLine(blockIndex)]
    const wrapped = wrapDisplayLines(text, scope.width)
    const startOffset = node.position?.start.offset ?? 0
    return wrapped.map((line, index) => ({
      text: line,
      displayWidth: displayWidth(line),
      spans: [{ start: 0, end: displayWidth(line), token: 'fg', bold: false }],
      rowInBlock: index,
      sourceStart: index === 0 ? startOffset : -1,
      sourceEnd: -1,
      rawTail: false,
    }))
  },
  renderRawTail(text, cols, _scope) {
    return {
      text,
      displayWidth: cols,
      spans: [{ start: 0, end: cols, token: 'fg', bold: false }],
      rowInBlock: 0,
      sourceStart: -1,
      sourceEnd: -1,
      rawTail: true,
    }
  },
}

function emptyLine(blockIndex: number): MarkdownRenderLine {
  return {
    text: '',
    displayWidth: 0,
    spans: [{ start: 0, end: 0, token: 'fg', bold: false }],
    rowInBlock: blockIndex,
    sourceStart: 0,
    sourceEnd: 0,
    rawTail: false,
  }
}

function extractBlockText(node: RootContent): string {
  if ('value' in node && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value
  }
  const children = (node as { children?: readonly { value?: unknown; children?: readonly unknown[] }[] }).children
  if (children === undefined) return ''
  return children.map(child => childText(child)).join('')
}

function childText(node: { value?: unknown; children?: readonly unknown[] }): string {
  if (typeof node.value === 'string') return node.value
  if (Array.isArray(node.children)) {
    return node.children
      .map(child => childText(child as { value?: unknown; children?: readonly unknown[] }))
      .join('')
  }
  return ''
}

/** Range key for a parsed block; same source range ⇒ same cached entry. */
function rangeKey(start: number, end: number): string {
  return `${start}:${end}`
}

/** Cache scope identity: every field that influences physical-row output. */
function computeScopeKey(scope: MarkdownRenderScope): string {
  return `${scope.width}|${scope.theme}|${scope.fold}|${scope.renderMode}`
}

/** Reference link definition detector: `[id]: url` patterns anywhere in source. */
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:\s+\S/m

/**
 * Create a fresh append-only collector.
 * @returns the collector handle.
 */
export function createMarkdownCollector(): MarkdownCollector {
  let committed = ''
  let tail = ''
  let rev = 0
  return {
    append(delta) {
      if (delta === '') return
      const combined = tail + delta
      const lastNewline = combined.lastIndexOf('\n')
      if (lastNewline === -1) {
        tail = combined
        return
      }
      committed += combined.slice(0, lastNewline + 1)
      tail = combined.slice(lastNewline + 1)
      rev += 1
    },
    committedSource() {
      return committed
    },
    rawTail() {
      return tail
    },
    committedLength() {
      return committed.length
    },
    sourceLength() {
      return committed.length + tail.length
    },
    revision() {
      return rev
    },
    finalize() {
      if (tail === '') return committed.length
      committed += tail + '\n'
      tail = ''
      rev += 1
      return committed.length
    },
    reset() {
      committed = ''
      tail = ''
      rev = 0
    },
  }
}

/**
 * Create a fresh incremental markdown projector.
 * @param renderer - block renderer (defaults to the plain-text renderer).
 * @param options - cache limit, probe interval, and inline-directive detector.
 * @returns the projector handle.
 */
export function createMarkdownProjector(
  renderer: MarkdownBlockRenderer = plainTextMarkdownBlockRenderer(),
  options: MarkdownProjectorOptions = {},
): MarkdownProjector {
  const cacheLimit = options.cacheLimit ?? MARKDOWN_PROJECTOR_DEFAULT_CACHE_LIMIT
  if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
    throw new Error(`cacheLimit must be a positive integer, got ${String(cacheLimit)}`)
  }
  const collector = createMarkdownCollector()
  const detectDirective = options.detectVisualizationDirective
  const cache = new Map<string, CachedBlock>()
  let projections = 0
  let stableHits = 0
  let safeRecomputes = 0
  let safeRecomputeReasons: { [K in SafeFullRecomputeReason]?: number } = {}
  let stableBlocksReused = 0
  let stableRowsReused = 0
  let stableBlocksRerendered = 0
  let cacheEvictions = 0
  let tailLinesPainted = 0
  let topLevelBlocksRendered = 0
  let parsedBytes = 0
  let lastProjectionRevision = -1
  let lastProjectionRenderMode: MarkdownRenderScope['renderMode'] | undefined
  let lastScopeKey = ''
  let lastEntries: readonly CachedBlock[] = []
  let lastCommittedLength = 0

  function incrementReason(reason: SafeFullRecomputeReason): void {
    const current = safeRecomputeReasons[reason] ?? 0
    safeRecomputeReasons[reason] = current + 1
  }

  function detectSafeRecompute(source: string, renderMode: MarkdownRenderScope['renderMode']): SafeFullRecomputeReason | undefined {
    if (lastProjectionRenderMode !== undefined && lastProjectionRenderMode !== renderMode) {
      return 'render-mode-change'
    }
    if (REFERENCE_DEFINITION.test(source)) return 'reference-definition'
    if (detectDirective !== undefined && detectDirective(source)) return 'visualization-directive'
    const previousLast = lastEntries.at(-1)?.node
    if (
      previousLast?.type === 'list'
      || previousLast?.type === 'blockquote'
      || previousLast?.type === 'code'
    ) {
      return 'parser-locality'
    }
    if (
      previousLast?.type === 'paragraph'
      && /^(?:=+|-+)[ \t]*\n/u.test(source.slice(lastCommittedLength))
    ) {
      return 'parser-locality'
    }
    if (lastProjectionRevision === -1 && !canProveLocality(source)) {
      return 'parser-locality'
    }
    return undefined
  }

  function cachePut(scopeKey: string, value: CachedBlock): void {
    const key = `${scopeKey}|${rangeKey(value.range.start, value.range.end)}`
    if (cache.has(key)) {
      cache.delete(key)
    }
    if (cache.size >= cacheLimit) {
      const oldestKey = cache.keys().next().value
      /* v8 ignore next -- cacheLimit >= 1 guarantees a non-empty cache at eviction */
      if (oldestKey !== undefined) {
        cache.delete(oldestKey)
        cacheEvictions += 1
      }
    }
    cache.set(key, value)
  }

  function cacheLookup(scopeKey: string, range: { start: number; end: number }): CachedBlock | undefined {
    return cache.get(`${scopeKey}|${rangeKey(range.start, range.end)}`)
  }

  function renderAndCache(
    node: RootContent,
    scope: MarkdownRenderScope,
    blockIndex: number,
    revision: number,
    scopeKey: string,
  ): CachedBlock {
    const lines = renderer.renderBlock(node, scope, blockIndex)
    const range = blockRange(node)
    const entry: CachedBlock = { node, lines, range, revision }
    cachePut(scopeKey, entry)
    return entry
  }

  function parseRange(
    source: string,
    start: number,
    settled: boolean,
  ): Root {
    const suffix = source.slice(start)
    parsedBytes += suffix.length
    const root = parseSource(suffix, settled)
    if (start > 0) shiftNodeOffsets(root, start)
    return root
  }

  function tailFor(
    text: string,
    scope: MarkdownRenderScope,
  ): MarkdownRenderLine | undefined {
    if (text === '') return undefined
    tailLinesPainted += 1
    const escaped = escapeContent(text)
    return paintTail(renderer, escaped, displayWidth(escaped), scope)
  }

  function finishProjection(
    entries: readonly CachedBlock[],
    revision: number,
    scope: MarkdownRenderScope,
    scopeKey: string,
    tailText: string,
    safeRecompute: SafeFullRecomputeReason | undefined,
    stableEntries: ReadonlySet<CachedBlock>,
  ): MarkdownProjection {
    lastEntries = entries
    lastProjectionRevision = revision
    lastProjectionRenderMode = scope.renderMode
    lastScopeKey = scopeKey
    lastCommittedLength = collector.committedLength()
    return {
      revision,
      scope,
      blocks: entries.map(entry => entryToBlock(entry, stableEntries.has(entry))),
      tail: tailFor(tailText, scope),
      sourceLength: collector.sourceLength(),
      safeRecompute,
    }
  }

  function project(scope: MarkdownRenderScope): MarkdownProjection {
    projections += 1
    const source = collector.committedSource()
    const tailText = collector.rawTail()
    const revision = collector.revision()
    const key = computeScopeKey(scope)
    if (
      revision === lastProjectionRevision
      && lastScopeKey === key
      && lastProjectionRenderMode === scope.renderMode
    ) {
      stableHits += lastEntries.length
      stableBlocksReused += lastEntries.length
      stableRowsReused += lastEntries.reduce((total, entry) => total + entry.lines.length, 0)
      return finishProjection(
        lastEntries,
        revision,
        scope,
        key,
        tailText,
        undefined,
        new Set(lastEntries),
      )
    }
    const reason = detectSafeRecompute(source, scope.renderMode)
    const fullReparse = reason !== undefined || lastProjectionRevision === -1 || lastScopeKey !== key
    if (fullReparse) {
      if (reason !== undefined) {
        safeRecomputes += 1
        incrementReason(reason)
      }
      if (lastScopeKey !== key && lastProjectionRevision !== -1) {
        cache.clear()
      }
      const root = parseRange(source, 0, scope.renderMode === 'settled')
      const entries = root.children.map((node, blockIndex) => {
        const entry = renderAndCache(node, scope, blockIndex, revision, key)
        topLevelBlocksRendered += 1
        return entry
      })
      return finishProjection(
        entries,
        revision,
        scope,
        key,
        tailText,
        reason,
        new Set(),
      )
    }
    const previousTail = lastEntries.at(-1)
    const reparseStart = Math.max(0, previousTail?.range.start ?? 0)
    const preserved = lastEntries.slice(0, Math.max(0, lastEntries.length - 1))
    stableHits += preserved.length
    stableBlocksReused += preserved.length
    stableRowsReused += preserved.reduce((total, entry) => total + entry.lines.length, 0)
    const root = parseRange(source, reparseStart, scope.renderMode === 'settled')
    const newEntries: CachedBlock[] = [...preserved]
    const stableEntries = new Set<CachedBlock>(preserved)
    for (const [index, node] of root.children.entries()) {
      const range = blockRange(node)
      const cached = cacheLookup(key, range)
      if (cached !== undefined && sameShape(cached.node, node)) {
        stableHits += 1
        stableBlocksReused += 1
        stableRowsReused += cached.lines.length
        newEntries.push(cached)
        stableEntries.add(cached)
        continue
      }
      const entry = renderAndCache(
        node,
        scope,
        preserved.length + index,
        revision,
        key,
      )
      stableBlocksRerendered += 1
      topLevelBlocksRendered += 1
      newEntries.push(entry)
    }
    return finishProjection(
      newEntries,
      revision,
      scope,
      key,
      tailText,
      undefined,
      stableEntries,
    )
  }

  function currentStats(): MarkdownProjectorStats {
    return Object.freeze({
      parsedBytes,
      projections,
      stableHits,
      safeRecomputes,
      safeRecomputeReasons: Object.freeze({ ...safeRecomputeReasons }),
      stableBlocksReused,
      stableRowsReused,
      stableBlocksRerendered,
      cacheEntries: cache.size,
      cacheEvictions,
      tailLinesPainted,
      topLevelBlocksRendered,
    })
  }

  function resetAll(): void {
    cache.clear()
    projections = 0
    stableHits = 0
    safeRecomputes = 0
    safeRecomputeReasons = {}
    stableBlocksReused = 0
    stableRowsReused = 0
    stableBlocksRerendered = 0
    cacheEvictions = 0
    tailLinesPainted = 0
    topLevelBlocksRendered = 0
    parsedBytes = 0
    lastProjectionRevision = -1
    lastProjectionRenderMode = undefined
    lastScopeKey = ''
    lastEntries = []
    lastCommittedLength = 0
  }

  return {
    collector,
    project,
    stats: currentStats,
    reset: resetAll,
  }
}

interface CachedBlock {
  readonly node: RootContent
  readonly lines: readonly MarkdownRenderLine[]
  readonly range: { readonly start: number; readonly end: number }
  readonly revision: number
}

function entryToBlock(entry: CachedBlock, stable: boolean): MarkdownProjectedBlock {
  return {
    node: entry.node,
    lines: entry.lines,
    range: entry.range,
    stable,
  }
}

function blockRange(node: RootContent): { readonly start: number; readonly end: number } {
  const position = node.position
  if (position === undefined) return { start: -1, end: -1 }
  const start = position.start.offset ?? -1
  const end = position.end.offset ?? -1
  return { start, end }
}

function parseSource(source: string, settled: boolean): Root {
  if (source === '') return { type: 'root', children: [] }
  return parseMarkdownSource(source, settled)
}

/** Add an absolute source offset to a suffix-parsed mdast tree in place. */
function shiftNodeOffsets(value: unknown, delta: number): void {
  if (typeof value !== 'object' || value === null) return
  const node = value as {
    position?: {
      start: { offset?: number }
      end: { offset?: number }
    }
    children?: readonly unknown[]
  }
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start !== undefined && node.position !== undefined) {
    node.position.start.offset = start + delta
  }
  if (end !== undefined && node.position !== undefined) {
    node.position.end.offset = end + delta
  }
  if (node.children !== undefined) {
    for (const child of node.children) shiftNodeOffsets(child, delta)
  }
}

function paintTail(
  renderer: MarkdownBlockRenderer,
  text: string,
  cols: number,
  scope: MarkdownRenderScope,
): MarkdownRenderLine {
  return renderer.renderRawTail(text, cols, scope)
}

/**
 * Whether the source's last byte is positioned so the parser can prove no
 * future byte could change a past top-level block. The check is local and
 * conservative: a list or blockquote needs a blank line after its end
 * (otherwise a new `- ` or `> ` line would extend it), while a paragraph
 * or heading is settled once its terminating newline is on disk. A code
 * block is unsettled when its source ends with a partial closing fence.
 * An empty source returns `true` so empty projections do not trigger
 * recomputes.
 * @param source - the committed source.
 * @returns true when the parser's locality holds.
 */
export function canProveLocality(source: string): boolean {
  if (source === '') return true
  if (!source.endsWith('\n')) return false
  const root = parseForLocality(source)
  const outer = lastTopLevelChild(root)
  if (outer === undefined) return true
  /* v8 ignore next -- mdast parse always attaches positions */
  const end = outer.position?.end.offset
  /* v8 ignore next -- mdast parse always attaches positions */
  if (end === undefined) return false
  if (source[end] !== '\n') return false
  if (outer.type === 'list' || outer.type === 'blockquote') {
    return end + 1 < source.length && source[end + 1] === '\n'
  }
  return true
}



function parseForLocality(source: string): Root {
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

function lastTopLevelChild(root: Root): RootContent | undefined {
  return root.children.at(-1)
}

/**
 * Decide whether two top-level mdast nodes are "the same block" for
 * cache reuse. Two nodes are identical when their ranges and types match;
 * content differences move the range, so range equality is sufficient.
 * @param previous - node retained from the previous projection.
 * @param current - node parsed from the new source.
 * @returns true when the cached entry may be reused.
 */
function sameShape(previous: RootContent, current: RootContent): boolean {
  if (previous.type !== current.type) return false
  const prev = previous.position
  const curr = current.position
  if (prev === undefined || curr === undefined) return false
  return prev.start.offset === curr.start.offset && prev.end.offset === curr.end.offset
}

/** Test seam: exposes internal helpers for coverage and oracle diffs. */
export const markdownProjectorInternals = {
  sameShape,
  blockRange,
  trimPartialClosingFence,
  childText,
  extractBlockText,
}
