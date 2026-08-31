import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import {
  createStyledMarkdownBlockRenderer,
  renderStreamingTableCells,
} from '../src/markdown-render.ts'
import type { MarkdownRenderLine } from '../src/markdown-projector.ts'
import { displayWidth } from '../src/content.ts'

const SCOPE = {
  width: 80,
  theme: 'truecolor' as const,
  fold: 'expanded' as const,
  renderMode: 'streaming' as const,
}

function render(source: string, options?: { hyperlinks?: boolean }) {
  const root = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const renderer = createStyledMarkdownBlockRenderer({
    width: 80,
    hyperlinks: options?.hyperlinks ?? false,
  })
  const lines: MarkdownRenderLine[] = []
  let blockIndex = 0
  for (const child of root.children) {
    for (const line of renderer.renderBlock(child, SCOPE, blockIndex)) {
      lines.push({ ...line })
    }
    blockIndex += 1
  }
  return lines
}

describe('createStyledMarkdownBlockRenderer', () => {
  it('emits an fg span for plain paragraph text', () => {
    const lines = render('hello')
    expect(lines.length).toBe(1)
    expect(lines[0]?.text).toBe('hello')
    expect(lines[0]?.spans).toHaveLength(1)
    expect(lines[0]?.spans[0]).toMatchObject({
      start: 0,
      end: 5,
      token: 'fg',
      bold: false,
    })
  })

  it('emits an accent+bold span for h1 with the ━━━ cap', () => {
    const lines = render('# title')
    expect(lines[0]?.text).toBe('━━━ title ━━━')
    expect(displayWidth(lines[0]?.text ?? '')).toBe(13)
    expect(lines[0]?.spans[0]).toMatchObject({
      start: 0,
      end: 13,
      token: 'accent',
      bold: true,
    })
  })

  it('emits an accent span and appends (href) when hyperlinks are off', () => {
    const lines = render('[docs](https://example.com)')
    expect(lines[0]?.text).toBe('docs (https://example.com)')
    const spans = lines[0]?.spans ?? []
    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({
      start: 0,
      end: 4,
      token: 'accent',
      bold: false,
      href: 'https://example.com',
    })
    expect(spans[1]).toMatchObject({
      start: 4,
      end: 26,
      token: 'fgDim',
      bold: false,
    })
  })

  it('omits the (href) suffix when the label equals the href', () => {
    const lines = render('[https://example.com](https://example.com)')
    expect(lines[0]?.text).toBe('https://example.com')
    expect(lines[0]?.spans).toHaveLength(1)
    expect(lines[0]?.spans[0]).toMatchObject({
      token: 'accent',
      href: 'https://example.com',
    })
  })

  it('omits the suffix when hyperlinks are on (the JSX bridge wraps OSC 8 instead)', () => {
    const lines = render('[docs](https://example.com)', { hyperlinks: true })
    expect(lines[0]?.text).toBe('docs')
    expect(lines[0]?.spans).toHaveLength(1)
    expect(lines[0]?.spans[0]).toMatchObject({
      token: 'accent',
      href: 'https://example.com',
    })
  })

  it('paints a single-line code block with the two-column indent and codeBg background', () => {
    const lines = render('```\nconst x = 1\n```')
    expect(lines.length).toBe(1)
    // The two-column indent lives inside the line text so the codeBg strip
    // covers it; the strip itself rides on the line-level background flag.
    expect(lines[0]?.text).toBe('  const x = 1')
    expect(lines[0]?.background).toBe('codeBg')
    expect(lines[0]?.spans.every(span => span.token === 'fg')).toBe(true)
  })

  it('emits fgDim spans for blockquotes', () => {
    const lines = render('> quoted')
    expect(lines[0]?.text).toBe('│ quoted')
    expect(lines[0]?.spans[0]).toMatchObject({ token: 'fgDim' })
  })

  it('emits accent+bold spans for table header rows and fg for body rows', () => {
    const lines = render('| a | b |\n| --- | --- |\n| 1 | 2 |')
    const top = lines.find(line => line.text.startsWith('┌─'))
    const header = lines.find(line => line.text.includes('a') && line.text.includes('│') && !line.text.startsWith('│ 1'))
    const body = lines.find(line => line.text.startsWith('│ 1 '))
    expect(top?.spans[0]).toMatchObject({ token: 'fgDim' })
    expect(header?.spans.some(s => s.token === 'accent' && s.bold)).toBe(true)
    expect(body?.spans.some(s => s.token === 'fg')).toBe(true)
  })

  it('wraps a long paragraph at the configured width', () => {
    const lines = render('hello '.repeat(20).trim())
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(displayWidth(line.text)).toBeLessThanOrEqual(80)
    }
  })

  it('wraps a list item with marker preserved on the first row', () => {
    const lines = render('- alpha\n- beta')
    expect(lines.length).toBe(2)
    expect(lines[0]?.text).toBe('- alpha')
    expect(lines[1]?.text).toBe('- beta')
  })
})

describe('renderStreamingTableCells', () => {
  it('reuses committed grid rows when appended cells keep the column plan', () => {
    const initial = renderStreamingTableCells([
      ['ID', 'Name'],
      ['1', 'item-100'],
    ], undefined, 40, 0, 0, undefined)
    expect(initial.cache).toBeDefined()
    const grown = renderStreamingTableCells([
      ['ID', 'Name'],
      ['1', 'item-100'],
      ['2', 'item-101'],
    ], ['3', 'item-102'], 40, 0, 0, initial.cache)
    expect(grown.cache).toBeDefined()
    expect(grown.cache?.lines[0]).toBe(initial.cache?.lines[0])
    expect(grown.cache?.lines[1]).toBe(initial.cache?.lines[1])
    expect(grown.lines.some(line => line.text.includes('item-102'))).toBe(true)
    expect(grown.cache?.lines.some(line => line.text.includes('item-102'))).toBe(false)
  })
})
