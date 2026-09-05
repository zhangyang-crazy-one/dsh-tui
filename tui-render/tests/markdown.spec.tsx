import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { MarkdownBlock, tokenize } from '../src/markdown.tsx'
import { displayWidth } from '../src/content.ts'
import { applyTheme } from '../src/theme.ts'
import { setHyperlinks, wrapOsc8 } from '../src/hyperlink.ts'
import { PRESET_TABLE_MARKDOWN } from './fixtures/preset-table.ts'

function renderText(source: string): string {
  return renderToString(createElement(MarkdownBlock, { source }))
}

afterEach(() => {
  applyTheme('truecolor')
  setHyperlinks(false)
})

describe('MarkdownBlock', () => {
  it('keeps every identifier in an active mixed-language table within its display width', () => {
    const output = renderToString(createElement(MarkdownBlock, {
      source: `${PRESET_TABLE_MARKDOWN}\n`, maxCols: 105, tail: '▌', settled: false,
    }), { columns: 105 }).replace(/\x1b\[[0-9;]*m/g, '')
    expect(output).toContain('bash/pwsh')
    expect(output).toContain('tool-cordis')
    expect(output).toContain('includeRuntimeContext:')
    expect(output).toContain('false')
    expect(output.split('\n').every(line => displayWidth(line) <= 105)).toBe(true)
  })

  it('renders an h1 closed by the ━━━ suffix in readable blue', () => {
    const out = renderText('# 标题')
    expect(out).toContain('━━━ 标题 ━━━')
    expect(out).toContain('\x1b[38;2;117;137;255m')
  })

  it('keeps one physical blank row between parsed top-level blocks', () => {
    const plain = renderText('# Title\n\nBody').replace(/\x1b\[[0-9;]*m/g, '')
    const lines = plain.split('\n')
    const heading = lines.findIndex(line => line.includes('Title'))
    const body = lines.findIndex(line => line.includes('Body'))
    expect(body - heading).toBe(2)
    expect(lines[heading + 1]?.trim()).toBe('')
  })

  it('renders list items with markers', () => {
    const out = renderText('- a\n- b')
    expect(out).toContain('- a')
    expect(out).toContain('- b')
  })

  it('renders blockquotes with the bar prefix', () => {
    expect(renderText('> quoted')).toContain('│ quoted')
  })

  it('renders a boxed table with aligned inner columns', () => {
    const out = renderText('| a | b |\n| - | - |\n| 中 | 2 |')
    expect(out).toContain('┌')
    expect(out).toContain('└')
    expect(out).toContain('a')
    expect(out).toContain('中')
  })

  it('keeps an empty table cell and a jagged body row', () => {
    const out = renderText('| a | |\n| --- | --- |\n| only |')
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('┌')
    expect(plain).toContain('a')
    expect(plain).toContain('only')
  })

  it('renders an empty source as an empty column', () => {
    expect(renderText('').replace(/\x1b\[[0-9;]*m/g, '').trim()).toBe('')
  })

  it('paints only the tail when source is empty', () => {
    const out = renderToString(
      createElement(MarkdownBlock, { source: '', tail: '▌' }),
    )
    expect(out).toContain('▌')
  })

  it('aligns boxed table pipes on display width for CJK, ASCII, and emoji', () => {
    const source = [
      '| 脚本 | 功能 |',
      '| --- | --- |',
      '| trilium_to_obsidian.py | 导入 |',
      '| organize_vault.py | 整理 |',
      '| 环节 | ✅ |',
    ].join('\n')
    const out = renderToString(
      createElement(MarkdownBlock, { source, maxCols: 80 }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('┌')
    expect(plain).toContain('├')
    expect(plain).toContain('└')
    const lines = plain.split('\n').filter(line => line.includes('│'))
    expect(lines.length).toBeGreaterThanOrEqual(4)
    const innerPipeCol = (line: string): number => {
      const first = line.indexOf('│')
      const second = line.indexOf('│', first + '│'.length)
      return displayWidth(line.slice(0, second))
    }
    const cols = lines.map(innerPipeCol)
    expect(new Set(cols).size).toBe(1)
    expect(plain).toContain('脚本')
    expect(plain).toContain('trilium_to_obsidian.py')
    expect(plain).toContain('✅')
    expect(out).toContain('\x1b[38;2;117;137;255m')
  })

  it('wraps a long paragraph onto multiple rows', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: 'word '.repeat(40).trim(),
        maxCols: 20,
      }),
    )
    const lines = out.split('\n').filter(line => line.includes('word'))
    expect(lines.length).toBeGreaterThan(1)
  })

  it('uses labeled records when intact table identifiers cannot share the column budget', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: '| wide-column-name | other |\n| --- | --- |\n| value | x |',
        maxCols: 24,
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('wide')
    expect(plain).toContain('other')
    expect(plain).toContain('wide-column-name: value')
    expect(plain).toContain('other: x')
    expect(plain).not.toContain('┌')
    expect(plain.split('\n').every(line => displayWidth(line) <= 24)).toBe(true)
  })

  it('grows a short column toward its natural width before wrapping a long one', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: [
          '| aa bb cc dd ee | x y |',
          '| --- | --- |',
          '| z | w |',
        ].join('\n'),
        maxCols: 18,
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('x y')
    expect(plain).toContain('┌')
  })

  it('keeps a short table at its natural width', () => {
    const maxCols = 40
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: '| item | status |\n| --- | --- |\n| memory | enabled |',
        maxCols,
        prefix: { first: '● ', rest: '  ' },
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    const tableLines = plain.split('\n').filter(line => /[┌│├└]/u.test(line))
    expect(tableLines.length).toBeGreaterThan(0)
    const widths = new Set(tableLines.map(displayWidth))
    expect(widths.size).toBe(1)
    expect(Math.max(...widths)).toBeLessThan(maxCols)
    expect(plain).not.toContain(`enabled${' '.repeat(10)}`)
  })

  it('keeps short emoji status labels intact before shrinking long columns', () => {
    const source = [
      '| 级别 | 位置 | 警告 | 建议 |',
      '| --- | --- | --- | --- |',
      `| 🔴 P1 | ${'a'.repeat(60)} | ${'b'.repeat(60)} | ${'c'.repeat(60)} |`,
      `| 🟠 P2 | ${'d'.repeat(60)} | ${'e'.repeat(60)} | ${'f'.repeat(60)} |`,
      `| 🟡 P3 | ${'g'.repeat(60)} | ${'h'.repeat(60)} | ${'i'.repeat(60)} |`,
    ].join('\n')
    const out = renderToString(
      createElement(MarkdownBlock, {
        source,
        maxCols: 109,
        prefix: { first: '● ', rest: '  ' },
      }),
      { columns: 113 },
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    const tableLines = plain.split('\n').filter(line => /[┌│├└]/u.test(line))
    for (const label of ['🔴 P1', '🟠 P2', '🟡 P3']) {
      expect(tableLines.some(line => line.includes(label))).toBe(true)
    }
    expect(new Set(tableLines.map(displayWidth)).size).toBe(1)
  })

  it('keeps all record fields when a later identifier exceeds the entire narrow row', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: '| a | long-second-header-name |\n| --- | --- |\n| x | y |',
        maxCols: 22,
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).not.toContain('┌')
    expect(plain).toContain('a: x')
    expect(plain.replace(/\s/gu, '')).toContain('long-second-header-name:y')
    expect(plain.split('\n').slice(1).every(line => line.startsWith('  '))).toBe(true)
    expect(plain.split('\n').every(line => displayWidth(line) <= 22)).toBe(true)
  })

  it('falls back to labeled records when the window cannot hold a boxed grid', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: '| a | b |\n| - | - |\n| c | d |',
        maxCols: 6,
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).not.toContain('┌')
    expect(plain).toContain('a: c')
    expect(plain).toContain('b: d')
  })

  it('escapes ANSI sequences in content (P5)', () => {
    const out = renderText('hello \x1b[2J world')
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b[2J')
  })

  it('highlights code fences with the lightweight tokenizer', () => {
    const out = renderText('```ts\nconst x = "s"\n```')
    expect(out).toContain('const')
    expect(out).toContain('x')
  })

  it('paints the marker prefix on the first row and the indent on later rows', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: 'one\n\ntwo',
        maxCols: 20,
        prefix: { first: '● ', rest: '  ' },
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    const lines = plain.split('\n').filter(line => line.trim() !== '')
    expect(lines[0]?.startsWith('● one')).toBe(true)
    expect(lines[1]?.startsWith('  two')).toBe(true)
  })

  it('appends the streaming cursor tail to the last painted row only', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: 'one\n\ntwo',
        maxCols: 20,
        tail: '▌',
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    const lines = plain.split('\n').filter(line => line.trim() !== '')
    expect(lines[0]?.endsWith('one')).toBe(true)
    expect(lines.at(-1)?.endsWith('two▌')).toBe(true)
  })

  it('reserves marker and cursor columns before wrapping streamed prose', () => {
    const source = `${'tok '.repeat(10)}TUI_PERF_STREAM_COMPLETE`
    const out = renderToString(
      createElement(MarkdownBlock, {
        source,
        maxCols: 20,
        prefix: { first: '● ', rest: '  ' },
        tail: '▌',
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    const joined = plain.split('\n').map(line => line.slice(2)).join('')
    expect(plain).not.toContain('…')
    expect(joined).toBe(`${source}▌`)
  })

  it('keeps the cursor tail on the last row of a streamed code fence', () => {
    const out = renderToString(
      createElement(MarkdownBlock, {
        source: '```ts\nconst x = 1',
        maxCols: 40,
        tail: '▌',
      }),
    )
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('const x = 1')
    expect(plain.trimEnd().endsWith('▌')).toBe(true)
  })

  it('trims a streamed partial closing fence until the marker completes', () => {
    const partial = renderToString(
      createElement(MarkdownBlock, {
        source: '```ts\nconst x = 1\n``',
        maxCols: 40,
      }),
    )
    const partialPlain = partial.replace(/\x1b\[[0-9;]*m/g, '')
    expect(partialPlain).toContain('const x = 1')
    expect(partialPlain).not.toContain('``')
    const complete = renderToString(
      createElement(MarkdownBlock, {
        source: '```ts\nconst x = 1\n```',
        maxCols: 40,
      }),
    )
    expect(complete.replace(/\x1b\[[0-9;]*m/g, '')).toContain('const x = 1')
  })

  it('keeps a short backtick line inside a closed fence as content', () => {
    // The `` line sits inside a four-backtick fence: content, not a prefix.
    const out = renderToString(
      createElement(MarkdownBlock, { source: '````\n``\n````', maxCols: 40 }),
    )
    expect(out.replace(/\x1b\[[0-9;]*m/g, '')).toContain('``')
  })

  it('keeps indented code and non-prefix partial tails unchanged', () => {
    expect(renderText('    indented code')).toContain('indented code')
    expect(renderText('```ts\nvalue\n`x')).toContain('`x')
  })
})

describe('tier-mapped code and inline tokens', () => {
  it('lays the codeBg strip under syntax spans at truecolor', () => {
    const out = renderText('```ts\nconst x = "s"\n```')
    expect(out).toContain('\x1b[48;2;32;35;40m')
    // keyword = codeKeyword (#7EB6FF: 126;182;255), string = codeString (#B9A4E8: 185;164;232).
    expect(out).toContain('\x1b[38;2;126;182;255m')
    expect(out).toContain('const')
    expect(out).toContain('\x1b[38;2;185;164;232m')
    expect(out).toContain('"s"')
    // accent is not leaked onto code spans.
    expect(out).not.toContain('\x1b[38;2;77;107;254m')
  })

  it('maps code tokens through the 256 tier', () => {
    applyTheme('256')
    const out = renderText('```ts\nconst x = "s"\n```')
    expect(out).toContain('\x1b[48;5;235m')
    expect(out).toContain('\x1b[38;5;111m')
    expect(out).toContain('const')
    expect(out).toContain('\x1b[38;5;141m')
  })

  it('maps code tokens through the 16 tier', () => {
    applyTheme('16')
    const out = renderText('```ts\nconst x = "s"\n```')
    expect(out).toContain('\x1b[40m')
    expect(out).toContain('\x1b[36m')
    expect(out).toContain('const')
    expect(out).toContain('\x1b[35m')
  })

  it('renders code unstyled at none', () => {
    applyTheme('none')
    const out = renderText('```ts\nconst x = 1\n```')
    expect(out).not.toContain('\x1b')
    expect(out).toContain('const x = 1')
  })

  it('indents code blocks two columns (T4)', () => {
    const out = renderText('```\nz\n```')
    const codeLine = out.split('\n').find(line => line.includes('z'))
    // The indent is painted inside the codeBg strip so the two columns are
    // never unstyled gap cells; strip SGR before measuring the columns.
    const plain = codeLine?.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain?.startsWith('  z')).toBe(true)
  })

  it('retains a huge fence through its last highlighted line', () => {
    const out = renderText(`\`\`\`ts\n${'a\n'.repeat(505)}FENCE_END\n\`\`\``)
    expect(out).toContain('FENCE_END')
    expect(out).not.toContain('还有')
  })

  it('styles inline code with an independent foreground and codeBg background', () => {
    applyTheme('256')
    // Ink's Text renderer normalizes the trailing reset to the default-bg
    // form, so assert the applied strip + text rather than the reset bytes.
    expect(renderText('a `b` c')).toContain('\x1b[48;5;235m\x1b[38;5;151mb')
    expect(renderText('a `b` c')).toContain('\x1b[48;5;233m\x1b[38;5;255m c')
    expect(renderText('a `b` c')).toContain('\x1b[49m')
  })

  it('paints prose paragraphs on the frame bg, not a gray plate', () => {
    const out = renderText('hello')
    expect(out).toContain('\x1b[48;2;21;22;24m')
    expect(out).toContain('hello')
    expect(out).not.toContain('\x1b[48;2;32;35;40m')
  })

  it('paints strong, strikethrough, h2, and ordered lists', () => {
    expect(renderText('**bold**')).toContain('bold')
    expect(renderText('~~strike~~')).toContain('strike')
    expect(renderText('## sub')).toContain('━ sub')
    expect(renderText('## sub')).toContain('\x1b[38;2;117;137;255m')
    expect(renderText('## sub')).not.toContain('━━━')
    expect(renderText('1. one')).toContain('1. one')
    expect(renderText('# ![x](y)')).toContain('━━━')
    expect(renderText('1. \n2. two')).toContain('2. two')
    expect(renderText('![alt](https://example.com/x.png)')).toBeDefined()
    expect(renderText('hello\n\n---\n\nworld')).toContain('hello')
    expect(renderText('hello\n\n---\n\nworld')).toContain('world')
  })

  it('distinguishes cyan links, lavender emphasis, and gold strong text', () => {
    const link = renderText('[docs](https://example.com)')
    expect(link).toContain('\x1b[38;2;128;199;217mdocs')
    expect(link).toContain(' (https://example.com)')
    const same = renderText('[https://example.com](https://example.com)')
    expect(same).not.toContain(' (https://example.com)')
    const emphasis = renderText('*note*')
    expect(emphasis).toContain('\x1b[38;2;196;174;242mnote')
    expect(renderText('**important**')).toContain('\x1b[1m\x1b[38;2;228;197;138mimportant')
  })

  it.each(['truecolor', '256', '16', 'none'] as const)('preserves text and emphasis through streaming and settlement at %s', (tier) => {
    applyTheme(tier)
    const source = '普通 **重点** *强调* `code` [link](https://example.com)\n\n- **列表重点** tail\n'
    const frames = [false, true].map(settled => renderToString(createElement(MarkdownBlock, {
      source, settled, maxCols: 80,
    }), { columns: 80 }))
    expect(frames[0]).toBe(frames[1])
    const output = frames[0]
    expect(output.replace(/\x1b\[[0-9;]*m/g, '')).toContain('普通 重点 强调 code link (https://example.com)')
    if (tier === 'none') {
      expect(output).not.toContain('\x1b')
    } else {
      const strongSequence = { truecolor: '38;2;228;197;138', '256': '38;5;223', '16': '93' }[tier]
      expect(output).toContain(`\x1b[${strongSequence}m列表重点`)
    }
  })

  it('wraps markdown links in OSC 8 when hyperlinks are installed', () => {
    setHyperlinks(true)
    const link = renderText('[docs](https://example.com)')
    expect(link).toContain(wrapOsc8('docs', 'https://example.com').slice(0, 20))
    expect(link).toContain('\x1b]8;;https://example.com\x1b\\')
    expect(link).toContain('docs')
    expect(link).not.toContain(' (https://example.com)')
  })
})

describe('tokenize', () => {
  it('caches identical inputs (P12)', () => {
    const first = tokenize('const a = 1', 'ts')
    const second = tokenize('const a = 1', 'ts')
    expect(second).toBe(first)
  })

  it('classifies keywords, strings, and comments', () => {
    const tokens = tokenize('const x = "s" // note', 'ts')
    expect(tokens.map(token => token.kind)).toContain('keyword')
    expect(tokens.map(token => token.kind)).toContain('string')
    expect(tokens.map(token => token.kind)).toContain('comment')
    expect(tokenize('// hi', 'ts')[0]?.kind).toBe('comment')
    expect(tokenize('# hi', 'py')[0]?.kind).toBe('comment')
    expect(tokenize('-- hi', 'sql')[0]?.kind).toBe('comment')
    expect(tokenize('x = "open', 'ts').some(token => token.kind === 'string')).toBe(true)
  })
})
