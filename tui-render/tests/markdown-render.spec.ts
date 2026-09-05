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

  it.each(['', '- ', '1. '])('preserves distinct inline semantic styles after the %j prefix', (prefix) => {
    const lines = render(`${prefix}plain **strong** *emphasis* \`code\` [link](https://example.com)`, { hyperlinks: true })
    const spans = lines.flatMap(line => line.spans)
    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'markdownStrong', bold: true }),
      expect.objectContaining({ token: 'markdownEmphasis', bold: false }),
      expect.objectContaining({ token: 'markdownCode', bold: false }),
      expect.objectContaining({ token: 'markdownLink', href: 'https://example.com' }),
    ]))
  })

  it('retains nested code and link semantics inside strong text without styling the following text', () => {
    const [line] = render('**bold \`code\` [link](https://example.com)** plain', { hyperlinks: true })
    expect(line?.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'markdownCode', bold: true }),
      expect.objectContaining({ token: 'markdownLink', bold: true, href: 'https://example.com' }),
    ]))
    expect(line?.spans.at(-1)).toMatchObject({ token: 'fg', bold: false })
  })

  it('emits a readable blue bold span for h1 with the ━━━ cap', () => {
    const lines = render('# title')
    expect(lines[0]?.text).toBe('━━━ title ━━━')
    expect(displayWidth(lines[0]?.text ?? '')).toBe(13)
    expect(lines[0]?.spans[0]).toMatchObject({
      start: 0,
      end: 13,
      token: 'accentText',
      bold: true,
    })
  })

  it('emits the link token and appends (href) when hyperlinks are off', () => {
    const lines = render('[docs](https://example.com)')
    expect(lines[0]?.text).toBe('docs (https://example.com)')
    const spans = lines[0]?.spans ?? []
    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({
      start: 0,
      end: 4,
      token: 'markdownLink',
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
      token: 'markdownLink',
      href: 'https://example.com',
    })
  })

  it('omits the suffix when hyperlinks are on (the JSX bridge wraps OSC 8 instead)', () => {
    const lines = render('[docs](https://example.com)', { hyperlinks: true })
    expect(lines[0]?.text).toBe('docs')
    expect(lines[0]?.spans).toHaveLength(1)
    expect(lines[0]?.spans[0]).toMatchObject({
      token: 'markdownLink',
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
    expect(lines[0]?.spans.some(span => span.token === 'codeKeyword')).toBe(true)
  })

  it('emits fgDim spans for blockquotes', () => {
    const lines = render('> quoted')
    expect(lines[0]?.text).toBe('│ quoted')
    expect(lines[0]?.spans[0]).toMatchObject({ token: 'fgDim' })
  })

  it('emits readable blue bold spans for table header rows and fg for body rows', () => {
    const lines = render('| a | b |\n| --- | --- |\n| 1 | 2 |')
    const top = lines.find(line => line.text.startsWith('┌─'))
    const header = lines.find(line => line.text.includes('a') && line.text.includes('│') && !line.text.startsWith('│ 1'))
    const body = lines.find(line => line.text.startsWith('│ 1 '))
    expect(top?.spans[0]).toMatchObject({ token: 'fgDim' })
    expect(header?.spans.some(s => s.token === 'accentText' && s.bold)).toBe(true)
    expect(body?.spans.some(s => s.token === 'fg')).toBe(true)
  })

  it('wraps a long paragraph at the configured width', () => {
    const lines = render('hello '.repeat(20).trim())
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(displayWidth(line.text)).toBeLessThanOrEqual(80)
    }
  })

  it('preserves every physical line and the final marker of a 5001-line paragraph', () => {
    const source = Array.from({ length: 5001 }, (_, index) => `history-${index}`).join('\n') + '\nFINAL_COMPLETE'
    const lines = render(source)
    expect(lines.map(line => line.text).join('\n')).toBe(source)
    expect(lines.at(-1)?.text).toBe('FINAL_COMPLETE')
    expect(lines.every(line => line.displayWidth <= 80)).toBe(true)
  })

  it('retains all 5001 highlighted fence rows for shared-viewport navigation', () => {
    const source = Array.from({ length: 5001 }, (_, index) => `const row${index} = ${index}`).join('\n')
    const lines = render(`\`\`\`ts\n${source}\n\`\`\``)
    expect(lines).toHaveLength(5001)
    expect(lines.at(-1)?.text).toBe('  const row5000 = 5000')
    expect(lines.every(line => line.background === 'codeBg')).toBe(true)
  })

  it('does not drop buffered text when the next styled segment needs multiple rows', () => {
    const text = 'word'.repeat(51)
    const lines = render(`prefix **${text}** suffix`)
    expect(lines.map(line => line.text).join('')).toBe(`prefix ${text} suffix`)
    expect(lines.every(line => line.displayWidth <= 80)).toBe(true)
    expect(lines.flatMap(line => line.spans).some(span => span.bold)).toBe(true)
  })

  it('wraps an exact-width segment before later text and honors Markdown hard breaks', () => {
    expect(render(`${'a'.repeat(80)}**b**`).map(line => line.text)).toEqual(['a'.repeat(80), 'b'])
    expect(render('first  \nsecond').map(line => line.text)).toEqual(['first', 'second'])
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
