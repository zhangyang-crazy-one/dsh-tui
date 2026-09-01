/**
 * Oracle-corpus tests for the incremental Markdown projector.
 *
 * Every fixture feeds the projector the same canonical source in two ways:
 *   1. one-shot — parse the whole source in a single pass;
 *   2. incremental — append the source one character or one line at a time
 *      and call `finalize()` on the collector.
 *
 * The two results must be deep-equal in:
 *   - the mdast structure parsed from the canonical source;
 *   - the physical rows the renderer emits for every top-level block;
 *   - the trailing raw-tail line (if any).
 *
 * During incremental feeding the test also captures the stable prefix
 * references after each commit and asserts that the references attached to
 * top-level blocks fully contained inside the committed prefix stay
 * referentially identical across appends — this is the contract the
 * StreamView virtualizer relies on to skip reconciliation on unchanged
 * rows.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { PhrasingContent, Root, RootContent } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { displayWidth } from '../src/content.ts'
import { wrapOsc8, isOsc8Href } from '../src/hyperlink.ts'
import {
  type MarkdownBlockRenderer,
  type MarkdownProjection,
  type MarkdownRenderLine,
  type MarkdownRenderScope,
  canProveLocality,
  createMarkdownCollector,
  createMarkdownProjector,
  markdownProjectorInternals,
  plainTextMarkdownBlockRenderer,
} from '../src/markdown-projector.ts'

const DEFAULT_SCOPE: MarkdownRenderScope = {
  width: 80,
  theme: 'truecolor',
  fold: 'expanded',
  renderMode: 'streaming',
}

interface Fixture {
  /** Human-readable fixture label. */
  readonly label: string
  /** Canonical source string. */
  readonly source: string
  /** How the source is broken into append deltas (either per-char or per-line). */
  readonly chunking: 'char' | 'line'
}

/** One-time feed-and-finalize driver; the projector returns both the
 *  intermediate stable-prefix refs and the final projection. */
function feedAndCapture(
  source: string,
  chunking: 'char' | 'line',
  scope: MarkdownRenderScope,
  renderer: MarkdownBlockRenderer = plainTextMarkdownBlockRenderer(),
): {
  finalProjection: MarkdownProjection
  stablePrefixRefs: readonly { readonly refs: readonly RootContent[]; readonly safeRecompute: MarkdownProjection['safeRecompute'] }[]
} {
  const projector = createMarkdownProjector(renderer)
  const collector = projector.collector
  const stablePrefixRefs: { readonly refs: readonly RootContent[]; readonly safeRecompute: MarkdownProjection['safeRecompute'] }[] = []
  if (chunking === 'line') {
    const lines = source.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const piece = lines[index]!
      const isLast = index === lines.length - 1
      collector.append(`${piece}${isLast ? '' : '\n'}`)
      if (!isLast) stablePrefixRefs.push(snapshotStableBlocks(projector, scope))
    }
    if (collector.rawTail() !== '') {
      collector.finalize()
      stablePrefixRefs.push(snapshotStableBlocks(projector, scope))
    }
  } else {
    for (const char of source) {
      collector.append(char)
      if (char === '\n') stablePrefixRefs.push(snapshotStableBlocks(projector, scope))
    }
    if (collector.rawTail() !== '') {
      collector.finalize()
      stablePrefixRefs.push(snapshotStableBlocks(projector, scope))
    }
  }
  const finalProjection = projector.project(scope)
  return { finalProjection, stablePrefixRefs }
}

function projectPartialSource(source: string): MarkdownProjection {
  const projector = createMarkdownProjector()
  const collector = projector.collector
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const piece = lines[index]!
    const isLast = index === lines.length - 1
    collector.append(`${piece}${isLast ? '' : '\n'}`)
  }
  return projector.project(DEFAULT_SCOPE)
}

function snapshotStableBlocks(
  projector: ReturnType<typeof createMarkdownProjector>,
  scope: MarkdownRenderScope,
): { readonly refs: readonly RootContent[]; readonly safeRecompute: MarkdownProjection['safeRecompute'] } {
  const projection = projector.project(scope)
  return {
    refs: projection.blocks
      .filter(block => block.stable)
      .map(block => block.node),
    safeRecompute: projection.safeRecompute,
  }
}

/** Compare mdast trees structurally. Position offsets are stripped so the
 *  test is unaffected by minor parser internal differences. */
function normalizeMdast(root: Root): Root {
  const clone = JSON.parse(JSON.stringify(root)) as Root
  walk(clone as unknown as WalkNode, (node) => {
    if ('position' in node) delete (node as { position?: unknown }).position
  })
  return clone
}

type WalkNode = { children?: unknown[] } & Record<string, unknown>

function walk(node: WalkNode, visit: (node: WalkNode) => void): void {
  visit(node)
  const children = node.children
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        walk(child as WalkNode, visit)
      }
    }
  }
}

/** Run the oracle corpus for one fixture. */
function runFixture(
  fixture: Fixture,
  renderer: MarkdownBlockRenderer = plainTextMarkdownBlockRenderer(),
  scope: MarkdownRenderScope = DEFAULT_SCOPE,
): void {
  const oneShotRoot = parseSource(fixture.source)
  const oneShotRendered = renderAll(renderer, oneShotRoot, scope, fixture.source)
  const { finalProjection } = feedAndCapture(fixture.source, fixture.chunking, scope, renderer)
  const incrementalRoot = parseSource(fixture.source)
  expect(normalizeMdast(incrementalRoot)).toEqual(normalizeMdast(oneShotRoot))
  const incrementalRendered = projectionToLines(finalProjection)
  expect(incrementalRendered.map(stripRowInBlock)).toEqual(oneShotRendered.map(stripRowInBlock))
  if (finalProjection.tail !== undefined) {
    expect(stripRowInBlock(finalProjection.tail)).toEqual(stripRowInBlock(oneShotRendered.at(-1)!))
  }
}

function stripRowInBlock(line: MarkdownRenderLine): MarkdownRenderLine {
  return {
    text: line.text,
    displayWidth: line.displayWidth,
    spans: line.spans,
    sourceStart: line.sourceStart,
    sourceEnd: line.sourceEnd,
    rowInBlock: 0,
    rawTail: line.rawTail,
  }
}

function parseSource(source: string): Root {
  if (source === '') return { type: 'root', children: [] }
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

function renderAll(
  renderer: MarkdownBlockRenderer,
  root: Root,
  scope: MarkdownRenderScope,
  source: string,
): MarkdownRenderLine[] {
  const lines: MarkdownRenderLine[] = []
  root.children.forEach((node, index) => {
    const rendered = renderer.renderBlock(node, scope, index)
    for (const line of rendered) lines.push(line)
  })
  if (source !== '' && !source.endsWith('\n')) {
    const tailText = source.slice(source.lastIndexOf('\n') + 1)
    const escaped = escapeTail(tailText)
    lines.push(renderer.renderRawTail(escaped, displayWidth(escaped), scope))
  }
  return lines
}

function escapeTail(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\u001B/g, '\\x1b')
}

function projectionToLines(projection: MarkdownProjection): MarkdownRenderLine[] {
  const lines: MarkdownRenderLine[] = []
  for (const block of projection.blocks) {
    for (const line of block.lines) lines.push(line)
  }
  if (projection.tail !== undefined) lines.push(projection.tail)
  return lines
}

/** Verify that the stable prefix references attached to committed projections
 *  stay referentially identical across appends that do not trigger a
 *  safe-recompute; safe-recompute boundaries legitimately drop references
 *  because the parser can no longer prove the previous shape. */
function expectStablePrefixInvariance(
  source: string,
  chunking: 'char' | 'line',
  scope: MarkdownRenderScope,
): void {
  const projector = createMarkdownProjector()
  const collector = projector.collector
  let previousRefs: readonly RootContent[] = []
  if (chunking === 'line') {
    const lines = source.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const piece = lines[index]!
      const isLast = index === lines.length - 1
      collector.append(`${piece}${isLast ? '' : '\n'}`)
      if (!isLast) {
        const snapshot = snapshotStableBlocks(projector, scope)
        if (snapshot.safeRecompute === undefined) {
          expectOverlap(previousRefs, snapshot.refs)
        }
        previousRefs = snapshot.refs
      }
    }
  } else {
    for (const char of source) {
      collector.append(char)
      if (char === '\n') {
        const snapshot = snapshotStableBlocks(projector, scope)
        if (snapshot.safeRecompute === undefined) {
          expectOverlap(previousRefs, snapshot.refs)
        }
        previousRefs = snapshot.refs
      }
    }
  }
}

function expectOverlap(
  previous: readonly RootContent[],
  next: readonly RootContent[],
): void {
  const nextSet = new Set(next)
  for (const ref of previous) {
    expect(nextSet.has(ref)).toBe(true)
  }
}

afterEach(() => {
  /* test isolation lives inside each `it` via fresh projector instances */
})

describe('MarkdownCollector', () => {
  it('advances the committed source only at complete lines and keeps the tail mutable', () => {
    const collector = createMarkdownCollector()
    collector.append('hello')
    expect(collector.committedSource()).toBe('')
    expect(collector.rawTail()).toBe('hello')
    collector.append(' world\nnext')
    expect(collector.committedSource()).toBe('hello world\n')
    expect(collector.rawTail()).toBe('next')
    collector.append(' line\n')
    expect(collector.committedSource()).toBe('hello world\nnext line\n')
    expect(collector.rawTail()).toBe('')
  })

  it('counts revisions on each commit and finalizes the tail into a complete line', () => {
    const collector = createMarkdownCollector()
    expect(collector.revision()).toBe(0)
    collector.append('a\n')
    expect(collector.revision()).toBe(1)
    collector.append('partial')
    expect(collector.revision()).toBe(1)
    collector.finalize()
    expect(collector.revision()).toBe(2)
    expect(collector.committedSource()).toBe('a\npartial\n')
    expect(collector.rawTail()).toBe('')
  })

  it('returns stable lengths and source lengths', () => {
    const collector = createMarkdownCollector()
    collector.append('abcd\n')
    collector.append('efg')
    expect(collector.committedLength()).toBe(5)
    expect(collector.sourceLength()).toBe(8)
    collector.append('\nhi')
    expect(collector.committedLength()).toBe(9)
    expect(collector.sourceLength()).toBe(11)
  })
})

describe('MarkdownProjector oracle corpus', () => {
  it('rejects a non-positive cacheLimit at construction', () => {
    expect(() => createMarkdownProjector(plainTextMarkdownBlockRenderer(), { cacheLimit: 0 })).toThrow(/cacheLimit/)
  })

  const paragraphFixture: Fixture = {
    label: 'paragraph',
    source: 'hello world\n',
    chunking: 'line',
  }

  const paragraphCharFixture: Fixture = {
    label: 'paragraph (character feed)',
    source: 'hello world\n',
    chunking: 'char',
  }

  const multiParagraphFixture: Fixture = {
    label: 'multi-paragraph',
    source: 'first paragraph.\n\nsecond paragraph with **bold** and *italic*.\n\nthird.\n',
    chunking: 'line',
  }

  const listFixture: Fixture = {
    label: 'list',
    source: '- alpha\n- beta\n- gamma\n',
    chunking: 'line',
  }

  const orderedListFixture: Fixture = {
    label: 'ordered list',
    source: '1. one\n2. two\n3. three\n',
    chunking: 'line',
  }

  const blockquoteFixture: Fixture = {
    label: 'blockquote',
    source: '> quoted text\n> across two lines\n',
    chunking: 'line',
  }

  const setextHeadingFixture: Fixture = {
    label: 'setext heading',
    source: 'a setext title\n=============\n',
    chunking: 'line',
  }

  const setextHeadingTwoFixture: Fixture = {
    label: 'setext h2',
    source: 'subtitle\n---------\n',
    chunking: 'line',
  }

  const partialFenceLineFixture: Fixture = {
    label: 'partial closing fence (line feed)',
    source: '```ts\nconst x = 1\n``\n',
    chunking: 'line',
  }

  const partialFenceCharFixture: Fixture = {
    label: 'partial closing fence (character feed)',
    source: '```ts\nconst x = 1\n``\n',
    chunking: 'char',
  }

  const referenceLinkFixture: Fixture = {
    label: 'reference link',
    source: '[docs][ref]\n\n[ref]: https://example.com\n',
    chunking: 'line',
  }

  const cjkFixture: Fixture = {
    label: 'CJK',
    source: '中文测试段落，中英混排 ok。\n',
    chunking: 'line',
  }

  const combiningFixture: Fixture = {
    label: 'combining marks',
    source: 'café résumé naïve\n',
    chunking: 'line',
  }

  const zwjFixture: Fixture = {
    label: 'ZWJ emoji',
    source: 'family: 👨‍👩‍👧‍👦 people.\n',
    chunking: 'line',
  }

  const osc8Fixture: Fixture = {
    label: 'OSC 8 link',
    source: '[DeepSeek](https://deepseek.com) engine\n',
    chunking: 'line',
  }

  const fixtures: readonly Fixture[] = [
    paragraphFixture,
    paragraphCharFixture,
    multiParagraphFixture,
    listFixture,
    orderedListFixture,
    blockquoteFixture,
    setextHeadingFixture,
    setextHeadingTwoFixture,
    partialFenceLineFixture,
    partialFenceCharFixture,
    referenceLinkFixture,
    cjkFixture,
    combiningFixture,
    zwjFixture,
    osc8Fixture,
  ]

  for (const fixture of fixtures) {
    it(`matches the one-shot render for "${fixture.label}" (${fixture.chunking} feed)`, () => {
      runFixture(fixture)
    })

    it(`keeps stable prefix references invariant for "${fixture.label}" (${fixture.chunking} feed)`, () => {
      expectStablePrefixInvariance(fixture.source, fixture.chunking, DEFAULT_SCOPE)
    })
  }

  it('keeps the partial closing fence trimmed until the marker completes', () => {
    const partialSource = '```ts\nconst x = 1\n``'
    const completeSource = '```ts\nconst x = 1\n```\n'
    const partialProjection = projectPartialSource(partialSource)
    const completeProjection = feedAndCapture(completeSource, 'line', DEFAULT_SCOPE).finalProjection
    const partialBlockTexts = partialProjection.blocks
      .flatMap(block => block.lines)
      .map(line => line.text)
    const completeBlockTexts = completeProjection.blocks
      .flatMap(block => block.lines)
      .map(line => line.text)
    expect(partialBlockTexts.some(text => text.includes('const x = 1'))).toBe(true)
    expect(partialBlockTexts.some(text => text.includes('``'))).toBe(false)
    expect(completeBlockTexts.some(text => text.includes('const x = 1'))).toBe(true)
    expect(completeProjection.safeRecompute ?? null).toBe(null)
  })

  it('paints the unfinished raw tail characters without parsing them', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('```ts\nconst value = 1\n')
    projector.collector.append('``')
    const projection = projector.project(DEFAULT_SCOPE)
    const blockTexts = projection.blocks.flatMap(block => block.lines).map(line => line.text)
    expect(blockTexts.some(text => text.includes('const value = 1'))).toBe(true)
    expect(projection.tail?.text).toBe('``')
    expect(projection.tail?.rawTail).toBe(true)
  })

  it('triggers the safe full-recompute path for reference-link definitions', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('[ref]: https://example.com\n')
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.safeRecompute).toBe('reference-definition')
    expect(projector.stats().safeRecomputeReasons['reference-definition']).toBe(1)
  })

  it('triggers the safe full-recompute path for inline visualization directives', () => {
    const projector = createMarkdownProjector(plainTextMarkdownBlockRenderer(), {
      detectVisualizationDirective: source => /::: *viz /.test(source),
    })
    projector.collector.append('::: viz status\n')
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.safeRecompute).toBe('visualization-directive')
  })

  it('triggers the safe full-recompute path when the render mode changes', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('paragraph\n\nanother\n')
    const streamingScope: MarkdownRenderScope = { ...DEFAULT_SCOPE, renderMode: 'streaming' }
    const settledScope: MarkdownRenderScope = { ...DEFAULT_SCOPE, renderMode: 'settled' }
    projector.project(streamingScope)
    const projection = projector.project(settledScope)
    expect(projection.safeRecompute).toBe('render-mode-change')
  })

  it('triggers the safe full-recompute path when locality cannot be proven', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('- a\n')
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.safeRecompute).toBe('parser-locality')
  })

  it('does not trigger safe-recompute when locality is settled and source is reference-free', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('paragraph\n\nanother paragraph\n')
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.safeRecompute ?? null).toBe(null)
  })

  it('invalidates the cache when width changes', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('first paragraph\n\nsecond paragraph\n')
    const wideScope: MarkdownRenderScope = { ...DEFAULT_SCOPE, width: 80 }
    const narrowScope: MarkdownRenderScope = { ...DEFAULT_SCOPE, width: 12 }
    const wide = projector.project(wideScope)
    const narrow = projector.project(narrowScope)
    expect(wide.blocks[0]?.lines.length).toBeGreaterThan(0)
    const wideWidths = wide.blocks.flatMap(block => block.lines.map(line => line.displayWidth))
    const narrowWidths = narrow.blocks.flatMap(block => block.lines.map(line => line.displayWidth))
    expect(Math.max(...narrowWidths)).toBeLessThanOrEqual(12)
    expect(Math.max(...wideWidths)).toBeLessThanOrEqual(80)
  })

  it('increments cache eviction counters when the cache fills up', () => {
    const projector = createMarkdownProjector(plainTextMarkdownBlockRenderer(), { cacheLimit: 2 })
    projector.collector.append('paragraph one\n')
    projector.project(DEFAULT_SCOPE)
    projector.collector.append('\nparagraph two\n')
    projector.project(DEFAULT_SCOPE)
    projector.collector.append('\nparagraph three\n')
    projector.project(DEFAULT_SCOPE)
    const stats = projector.stats()
    expect(stats.cacheEvictions).toBeGreaterThan(0)
    expect(stats.cacheEntries).toBeLessThanOrEqual(2)
  })

  it('paints the streaming raw-tail line for unfinished deltas', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('hello world\nnext partial')
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.tail).toBeDefined()
    expect(projection.tail?.text).toBe('next partial')
    expect(projector.stats().tailLinesPainted).toBe(1)
  })

  it('paints the raw-tail line on the incremental path too', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('paragraph\n\n')
    const first = projector.project(DEFAULT_SCOPE)
    expect(first.tail).toBeUndefined()
    projector.collector.append('next partial')
    const second = projector.project(DEFAULT_SCOPE)
    expect(second.tail?.text).toBe('next partial')
    expect(projector.stats().tailLinesPainted).toBe(1)
  })

  it('counts a tail line on the safe-recompute path too', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('paragraph\n\n[ref]: https://example.com\npartial')
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.tail?.text).toBe('partial')
    expect(projector.stats().tailLinesPainted).toBe(1)
  })

  it('resets counters and the cache through reset()', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('paragraph\n')
    projector.project(DEFAULT_SCOPE)
    const before = projector.stats()
    expect(before.projections).toBeGreaterThan(0)
    projector.reset()
    const after = projector.stats()
    expect(after.projections).toBe(0)
    expect(after.cacheEntries).toBe(0)
  })

  it('reset() clears every safe-recompute reason', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('[ref]: https://example.com\n')
    projector.project(DEFAULT_SCOPE)
    expect(projector.stats().safeRecomputeReasons['reference-definition']).toBe(1)
    projector.reset()
    expect(projector.stats().safeRecomputeReasons['reference-definition']).toBeUndefined()
  })

  it('exposes OSC 8 wrapping when a custom renderer emits wrapOsc8', () => {
    const renderer = osc8MarkdownBlockRenderer()
    runFixture(osc8Fixture, renderer)
  })

  it('reuses cached blocks when appending more lines within the same scope', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('first paragraph\n')
    const first = projector.project(DEFAULT_SCOPE)
    const firstRefs = first.blocks.map(block => block.node)
    projector.collector.append('\nsecond paragraph\n')
    const second = projector.project(DEFAULT_SCOPE)
    const stableRefs = second.blocks.filter(block => block.stable).map(block => block.node)
    expect(stableRefs.length).toBe(1)
    expect(stableRefs[0]).toBe(firstRefs[0])
  })

  it('parses only the final mutable block and appended suffix after a stable prefix', () => {
    const projector = createMarkdownProjector()
    const stablePrefix = Array.from(
      { length: 200 },
      (_, index) => `stable paragraph ${String(index)}\n\n`,
    ).join('')
    projector.collector.append(`${stablePrefix}mutable tail\n`)
    projector.project(DEFAULT_SCOPE)
    const before = projector.stats().parsedBytes
    projector.collector.append('\nnew paragraph\n')
    projector.project(DEFAULT_SCOPE)
    const parsedForAppend = projector.stats().parsedBytes - before
    expect(parsedForAppend).toBeLessThan(stablePrefix.length / 10)
  })

  it('emits an empty placeholder for an empty committed source', () => {
    const projector = createMarkdownProjector()
    const projection = projector.project(DEFAULT_SCOPE)
    expect(projection.blocks).toHaveLength(0)
    expect(projection.tail).toBeUndefined()
    expect(projection.sourceLength).toBe(0)
  })

  it('finalize() with an empty tail is a no-op', () => {
    const collector = createMarkdownCollector()
    expect(collector.finalize()).toBe(0)
    expect(collector.committedSource()).toBe('')
  })

  it('append("") does not advance the revision', () => {
    const collector = createMarkdownCollector()
    const rev0 = collector.revision()
    collector.append('')
    expect(collector.revision()).toBe(rev0)
  })

  it('cache eviction keeps LRU ordering once the limit is reached', () => {
    const projector = createMarkdownProjector(plainTextMarkdownBlockRenderer(), { cacheLimit: 1 })
    projector.collector.append('first paragraph\n')
    projector.project(DEFAULT_SCOPE)
    projector.collector.append('\nsecond paragraph\n')
    projector.project(DEFAULT_SCOPE)
    const stats = projector.stats()
    expect(stats.cacheEntries).toBe(1)
    expect(stats.cacheEvictions).toBeGreaterThan(0)
  })

  it('clear the cache when scope changes by width, theme, fold, or render mode', () => {
    const projector = createMarkdownProjector()
    projector.collector.append('first paragraph\n\nsecond paragraph\n')
    const scopeA: MarkdownRenderScope = { width: 80, theme: 'truecolor', fold: 'expanded', renderMode: 'streaming' }
    const scopeB: MarkdownRenderScope = { width: 80, theme: '16', fold: 'expanded', renderMode: 'streaming' }
    const scopeC: MarkdownRenderScope = { width: 80, theme: '16', fold: 'collapsed', renderMode: 'streaming' }
    const scopeD: MarkdownRenderScope = { width: 80, theme: '16', fold: 'collapsed', renderMode: 'settled' }
    projector.project(scopeA)
    const initialBlocks = projector.stats().topLevelBlocksRendered
    projector.project(scopeB)
    projector.project(scopeC)
    projector.project(scopeD)
    const finalBlocks = projector.stats().topLevelBlocksRendered
    expect(finalBlocks).toBeGreaterThan(initialBlocks)
  })
})

describe('canProveLocality', () => {
  it('returns true for empty source', () => {
    expect(canProveLocality('')).toBe(true)
  })

  it('returns true for a source containing only blank lines', () => {
    expect(canProveLocality('\n\n\n')).toBe(true)
  })

  it('returns true for a settled code block at the end of the source', () => {
    expect(canProveLocality('```\ncode\n```\n')).toBe(true)
  })

  it('returns false when a code block ends with a partial closing fence', () => {
    expect(canProveLocality('```\ncode\n``')).toBe(false)
  })

  it('returns false when source does not end with a newline', () => {
    expect(canProveLocality('paragraph')).toBe(false)
  })

  it('returns true for a paragraph at end of source with trailing newline', () => {
    expect(canProveLocality('hello\n')).toBe(true)
  })

  it('returns true for paragraphs separated by a blank line', () => {
    expect(canProveLocality('first\n\nsecond\n')).toBe(true)
  })

  it('returns false for a list at end of source without trailing blank line', () => {
    expect(canProveLocality('- a\n')).toBe(false)
  })

  it('returns true for a list followed by a blank line', () => {
    expect(canProveLocality('- a\n\n')).toBe(true)
  })

  it('returns false for a blockquote at end of source without trailing blank line', () => {
    expect(canProveLocality('> quoted\n')).toBe(false)
  })

  it('returns true for a blockquote followed by a blank line', () => {
    expect(canProveLocality('> quoted\n\n')).toBe(true)
  })

  it('returns false for a fenced code block with a partial closing fence', () => {
    expect(canProveLocality('```\ncode\n``')).toBe(false)
  })

  it('returns true when the partial closing fence is longer than the marker', () => {
    expect(canProveLocality('```\ncode\n```\n')).toBe(true)
  })

  it('returns false when the partial closing fence characters do not match the marker', () => {
    expect(canProveLocality('````\ncode\n`x')).toBe(false)
  })
})

describe('markdownProjectorInternals', () => {
  it('blockRange returns the parsed range for an mdast node with position', () => {
    const root = fromMarkdown('hello\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const paragraph = root.children[0]
    expect(paragraph).toBeDefined()
    if (paragraph !== undefined) {
      const range = markdownProjectorInternals.blockRange(paragraph)
      expect(range.start).toBe(0)
      expect(range.end).toBe(5)
    }
  })

  it('blockRange returns sentinel values when position is undefined', () => {
    const node = { type: 'paragraph', children: [] } as unknown as RootContent
    const range = markdownProjectorInternals.blockRange(node)
    expect(range).toEqual({ start: -1, end: -1 })
  })

  it('blockRange falls back when offset is undefined', () => {
    const node = {
      type: 'paragraph',
      position: { start: {}, end: {} },
    } as unknown as RootContent
    const range = markdownProjectorInternals.blockRange(node)
    expect(range).toEqual({ start: -1, end: -1 })
  })

  it('sameShape returns false for nodes of different types', () => {
    const paragraph = { type: 'paragraph', children: [] } as unknown as RootContent
    const heading = { type: 'heading', children: [] } as unknown as RootContent
    expect(markdownProjectorInternals.sameShape(paragraph, heading)).toBe(false)
  })

  it('sameShape returns false when the previous node lacks a position', () => {
    const previous = { type: 'paragraph', children: [] } as unknown as RootContent
    const current = {
      type: 'paragraph',
      position: { start: { offset: 0 }, end: { offset: 5 } },
    } as unknown as RootContent
    expect(markdownProjectorInternals.sameShape(previous, current)).toBe(false)
  })

  it('sameShape returns false when the current node lacks a position', () => {
    const previous = {
      type: 'paragraph',
      position: { start: { offset: 0 }, end: { offset: 5 } },
    } as unknown as RootContent
    const current = { type: 'paragraph', children: [] } as unknown as RootContent
    expect(markdownProjectorInternals.sameShape(previous, current)).toBe(false)
  })

  it('sameShape returns true for matching range and type', () => {
    const previous = {
      type: 'paragraph',
      position: { start: { offset: 0 }, end: { offset: 5 } },
    } as unknown as RootContent
    const current = {
      type: 'paragraph',
      position: { start: { offset: 0 }, end: { offset: 5 } },
    } as unknown as RootContent
    expect(markdownProjectorInternals.sameShape(previous, current)).toBe(true)
  })

  it('trimPartialClosingFence is a no-op on an empty root', () => {
    const root = { type: 'root', children: [] } as unknown as Root
    expect(() => { markdownProjectorInternals.trimPartialClosingFence(root, '') }).not.toThrow()
  })

  it('trimPartialClosingFence leaves a non-code top-level block alone', () => {
    const root = fromMarkdown('hello\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const before = JSON.stringify(root.children[0])
    markdownProjectorInternals.trimPartialClosingFence(root, 'hello\n')
    expect(JSON.stringify(root.children[0])).toBe(before)
  })

  it('trimPartialClosingFence is a no-op when a code block has no partial fence', () => {
    const root = fromMarkdown('```\ncode\n```\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const before = JSON.stringify(root.children[0])
    markdownProjectorInternals.trimPartialClosingFence(root, '```\ncode\n```\n')
    expect(JSON.stringify(root.children[0])).toBe(before)
  })

  it('trimPartialClosingFence is a no-op on an indented code block (no fence marker)', () => {
    const root = fromMarkdown('    indented\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const before = JSON.stringify(root.children[0])
    markdownProjectorInternals.trimPartialClosingFence(root, '    indented\n')
    expect(JSON.stringify(root.children[0])).toBe(before)
  })

  it('trimPartialClosingFence trims the partial closing fence when the source has no trailing newline', () => {
    const root = fromMarkdown('```\ncode\n``', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    markdownProjectorInternals.trimPartialClosingFence(root, '```\ncode\n``')
    const value = (root.children[0] as { value: string }).value
    expect(value.endsWith('``')).toBe(false)
  })

  it('trimPartialClosingFence handles a code block with a longer marker', () => {
    const root = fromMarkdown('````\ncode\n``\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const beforeValue = (root.children[0] as { value: string }).value
    markdownProjectorInternals.trimPartialClosingFence(root, '````\ncode\n``\n')
    const afterValue = (root.children[0] as { value: string }).value
    expect(afterValue).toBe(beforeValue)
  })

  it('trimPartialClosingFence handles a code block without position info', () => {
    const codeNode = { type: 'code', value: 'data', lang: null, meta: null } as unknown as RootContent
    const root = { type: 'root', children: [codeNode] } as unknown as Root
    expect(() => { markdownProjectorInternals.trimPartialClosingFence(root, '```\ndata\n') }).not.toThrow()
  })

  it('trimPartialClosingFence keeps a partial closing fence whose characters do not match', () => {
    const root = fromMarkdown('```\ncode\n`x\n', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const before = JSON.stringify(root.children[0])
    markdownProjectorInternals.trimPartialClosingFence(root, '```\ncode\n`x\n')
    expect(JSON.stringify(root.children[0])).toBe(before)
  })

  it('trimPartialClosingFence handles a partial close whose characters differ from the marker', () => {
    const root = fromMarkdown('```\ncode\n`x', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const before = JSON.stringify(root.children[0])
    markdownProjectorInternals.trimPartialClosingFence(root, '```\ncode\n`x')
    expect(JSON.stringify(root.children[0])).toBe(before)
  })

  it('trimPartialClosingFence is a no-op when code node offsets are missing', () => {
    const codeNode = {
      type: 'code',
      value: 'data\n`',
      position: { start: {}, end: {} },
    } as unknown as RootContent
    const root = { type: 'root', children: [codeNode] } as unknown as Root
    expect(() => { markdownProjectorInternals.trimPartialClosingFence(root, '```\ndata\n`') }).not.toThrow()
  })

  it('childText returns the value when the node has a string value', () => {
    expect(markdownProjectorInternals.childText({ value: 'hello' })).toBe('hello')
  })

  it('childText walks nested children when no value is present', () => {
    const result = markdownProjectorInternals.childText({
      children: [
        { value: 'foo' },
        { children: [{ value: 'bar' }] },
      ],
    })
    expect(result).toBe('foobar')
  })

  it('childText returns empty when neither value nor children exist', () => {
    expect(markdownProjectorInternals.childText({})).toBe('')
  })

  it('extractBlockText returns the literal value for code-like blocks', () => {
    const node = { type: 'code', value: 'literal code' } as unknown as RootContent
    expect(markdownProjectorInternals.extractBlockText(node)).toBe('literal code')
  })

  it('extractBlockText returns empty for blocks without value or children', () => {
    const node = { type: 'thematicBreak' } as unknown as RootContent
    expect(markdownProjectorInternals.extractBlockText(node)).toBe('')
  })

  it('plainTextMarkdownBlockRenderer handles a node without a position', () => {
    const renderer = plainTextMarkdownBlockRenderer()
    const node = { type: 'paragraph', children: [] } as unknown as RootContent
    const lines = renderer.renderBlock(node, DEFAULT_SCOPE, 0)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.text).toBe('')
  })

  it('plainTextMarkdownBlockRenderer handles a non-empty node without a position', () => {
    const renderer = plainTextMarkdownBlockRenderer()
    const node = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'hi' }],
    } as unknown as RootContent
    const lines = renderer.renderBlock(node, DEFAULT_SCOPE, 0)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]?.text).toBe('hi')
    expect(lines[0]?.sourceStart).toBe(0)
  })

  it('plainTextMarkdownBlockRenderer paints a non-empty block with default styles', () => {
    const renderer = plainTextMarkdownBlockRenderer()
    const root = fromMarkdown('hello world', { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    const paragraph = root.children[0]
    expect(paragraph).toBeDefined()
    if (paragraph !== undefined) {
      const lines = renderer.renderBlock(paragraph, DEFAULT_SCOPE, 0)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines[0]?.text).toBe('hello world')
    }
  })
})

/** Renderer that wraps inline links in OSC 8 so the oracle corpus can verify
 *  hyperlink-aware incremental behavior without coupling to ANSI. */
function osc8MarkdownBlockRenderer(): MarkdownBlockRenderer {
  return {
    renderBlock(node, scope, blockIndex) {
      const text = extractInline(node)
      if (text === '') return [emptyLine(scope)]
      const wrapped = wrapPlain(text, scope.width)
      return wrapped.map((line, index) => ({
        text: line,
        displayWidth: displayWidth(line),
        spans: [{ start: 0, end: displayWidth(line), token: 'fg', bold: false }],
        rowInBlock: index,
        sourceStart: index === 0 ? (node.position?.start.offset ?? 0) : -1,
        sourceEnd: -1,
        rawTail: false,
      }))
      void blockIndex
    },
    renderRawTail(text, cols, scope) {
      return {
        text,
        displayWidth: cols,
        spans: [{ start: 0, end: cols, token: 'fg', bold: false }],
        rowInBlock: 0,
        sourceStart: -1,
        sourceEnd: -1,
        rawTail: true,
      }
      void scope
    },
  }
}

function extractInline(node: RootContent): string {
  if (node.type === 'paragraph') {
    const parts: string[] = []
    for (const child of node.children) parts.push(renderPhrasing(child))
    return parts.join('')
  }
  if (node.type === 'heading') {
    return node.children.map(renderPhrasing).join('')
  }
  if ('value' in node && typeof node.value === 'string') return node.value
  return ''
}

function renderPhrasing(node: PhrasingContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'inlineCode') return node.value
  if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') {
    return node.children.map(renderPhrasing).join('')
  }
  if (node.type === 'link') {
    const text = node.children.map(renderPhrasing).join('')
    if (isOsc8Href(node.url)) return wrapOsc8(text, node.url)
    return text
  }
  if (node.type === 'image') return node.alt ?? ''
  return ''
}

function wrapPlain(text: string, width: number): string[] {
  if (width <= 0) return [text]
  const rows: string[] = []
  let rest = text
  while (rest.length > 0) {
    const cols = displayWidth(rest)
    if (cols <= width) {
      rows.push(rest)
      break
    }
    let cut = 0
    let cutCols = 0
    let lastSpace = -1
    for (let index = 0; index < rest.length; index += 1) {
      const char = rest[index]!
      const charCols = displayWidth(char)
      if (cutCols + charCols > width) break
      cutCols += charCols
      cut = index + 1
      if (char === ' ') lastSpace = cut
    }
    if (lastSpace > 0) {
      rows.push(rest.slice(0, lastSpace - 1))
      rest = rest.slice(lastSpace)
    } else {
      rows.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
  }
  return rows
}

function emptyLine(scope: MarkdownRenderScope): MarkdownRenderLine {
  return {
    text: '',
    displayWidth: 0,
    spans: [{ start: 0, end: 0, token: 'fg', bold: false }],
    rowInBlock: 0,
    sourceStart: -1,
    sourceEnd: -1,
    rawTail: false,
  }
  void scope
}
