/**
 * Collapsed ToolCard: ▸ name · status, escaped payloads, no plate.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ToolCard } from '../src/tool-card.tsx'
import { applyTheme } from '../src/theme.ts'
import { setHyperlinks } from '../src/hyperlink.ts'
import type { ToolCardModel } from '../src/tool-cards.ts'

afterEach(() => {
  applyTheme('truecolor')
  setHyperlinks(false)
})

function card(overrides: Partial<ToolCardModel> = {}): ToolCardModel {
  return {
    callId: ToolCallId('call-1'),
    name: 'bash',
    arguments: '{"command":"git status"}',
    status: 'running',
    ...overrides,
  }
}

function render(model: ToolCardModel): string {
  return renderToString(createElement(ToolCard, { card: model }))
}

describe('ToolCard', () => {
  it('renders a collapsed running card with the accent status word', () => {
    const out = render(card())
    expect(out).toContain('▸ bash · ')
    expect(out).toContain('运行中')
    expect(out).toContain('\x1b[38;2;77;107;254m运行中')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('OK')
  })

  it('renders completed and failed status words with their tokens', () => {
    expect(render(card({ status: 'ok' }))).toContain('完成')
    expect(render(card({ status: 'ok' }))).toContain('\x1b[38;2;34;197;94m完成')
    const failed = render(card({ status: 'error' }))
    expect(failed).toContain('失败')
    expect(failed).toContain('\x1b[38;2;239;68;68m失败')
  })

  it('escapes CSI in the tool name so it never reaches the terminal raw', () => {
    const out = render(card({
      name: '\x1b[2Jevil',
      arguments: '\x1b[2J{"command":"rm"}',
    }))
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b[2Jevil')
  })

  it('keeps the failed label readable without color (A2/A3)', () => {
    applyTheme('none')
    const out = render(card({ status: 'error', name: 'bash' }))
    expect(out).toContain('▸ bash · 失败')
    expect(out).not.toContain('\x1b')
  })

  it('appends a bash command summary on the collapsed row', () => {
    const out = render(card({
      arguments: '{"command":"git status"}',
    }))
    expect(out).toContain('git status')
    expect(out).toContain('▸ bash · ')
  })

  it('expands into 参数 / 结果 / meta blocks with escaped payloads', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        arguments: '{"command":"\x1b[2Jrm"}',
        resultText: 'out\x1b[2J',
        meta: { presentation: '\x1b[2Jdiff' },
      }),
      expanded: true,
    }))
    expect(out).toContain('▾ bash · ')
    expect(out).toContain('完成')
    expect(out).toContain('参数')
    expect(out).toContain('结果')
    expect(out).toContain('meta')
    expect(out).not.toContain('\x1b[2J')
    expect(out).not.toContain('presentCall')
  })

  it('omits the collapsed summary when the column budget is too small', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({ arguments: '{"command":"git status"}' }),
      maxCols: 1,
    }))
    expect(out).toContain('▸ bash · ')
    expect(out).not.toContain('git status')
  })

  it('omits 结果 and meta when they are absent', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({ status: 'running', arguments: '{}' }),
      expanded: true,
    }))
    expect(out).toContain('参数')
    expect(out).not.toContain('结果')
    expect(out).not.toContain('meta')
  })

  it('uses presentCall title on the collapsed row without collapsedCardSummary', () => {
    const out = render(card({
      arguments: '{}',
      callView: { card: 'generic', title: 'git status' },
    }))
    expect(out).toContain('▸ git status · ')
    expect(out).not.toContain('▸ bash · ')
  })

  it('keeps the tool name when callView is absent', () => {
    const out = render(card({ arguments: '{}' }))
    expect(out).toContain('▸ bash · ')
  })

  it('escapes CSI in a presenter title so it never reaches the terminal raw', () => {
    const out = render(card({
      callView: { card: 'generic', title: '\x1b[2Jgit status' },
    }))
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('▸ \\x1b[2Jgit status · ')
  })

  it('wraps an absolute path summary in OSC 8 when hyperlinks are on', () => {
    setHyperlinks(true)
    const out = render(card({
      name: 'read_file',
      arguments: '{"path":"/tmp/note.md"}',
    }))
    expect(out).toContain('\x1b]8;;file://')
    expect(out).toContain('/tmp/note.md')
  })

  it('expands a terminal result with escaped output and exitCode', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        callView: { card: 'terminal', title: 'npm test' },
        resultView: { card: 'terminal', output: 'ok\n清屏\x1b[2J', exitCode: 0 },
      }),
      expanded: true,
    }))
    expect(out).toContain('exitCode 0')
    expect(out).toContain('清屏\\x1b[2J')
    expect(out).not.toContain('清屏\x1b[2J')
  })

  it('covers terminal signal, output, cwd, and argument fallbacks', () => {
    const signal = renderToString(createElement(ToolCard, {
      card: card({
        status: 'error',
        callView: { card: 'terminal', title: 'terminated' },
        resultView: { card: 'terminal', signal: 'SIGTERM' },
      }),
      expanded: true,
    }))
    expect(signal).toContain('signal SIGTERM')
    expect(render(card({
      status: 'error',
      resultView: { card: 'terminal', signal: 'SIGKILL' },
    }))).toContain('signal SIGKILL')
    expect(render(card({
      status: 'ok',
      resultView: { card: 'terminal', output: 'one\ntwo' },
    }))).toContain('one two')
    expect(render(card({
      callView: { card: 'terminal', title: 'cwd', cwd: '/work' },
    }))).toContain('/work')
    expect(render(card({
      callView: { card: 'terminal', title: 'no cwd' },
    }))).not.toContain('/work')
    const fallback = renderToString(createElement(ToolCard, {
      card: card({ callView: { card: 'terminal', title: 'pending' }, arguments: '{"command":"run"}' }),
      expanded: true,
    }))
    expect(fallback).toContain('参数')
  })

  it('expands a diff result with hunk lines and no card chrome', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        name: 'edit',
        callView: {
          card: 'diff',
          title: 'Edit a.ts',
          diffs: [{ path: 'a.ts', oldText: 'old line', newText: 'new line' }],
        },
        resultView: {
          card: 'diff',
          diffs: [{ path: 'a.ts', oldText: 'old line', newText: 'new line' }],
        },
      }),
      expanded: true,
    }))
    expect(out).toContain('--- a.ts')
    expect(out).toContain('- old line')
    expect(out).toContain('+ new line')
    expect(out).not.toContain('┌')
  })

  it('collapses a diff card to the joined path list', () => {
    const out = render(card({
      name: 'edit',
      status: 'ok',
      callView: {
        card: 'diff',
        title: 'Edit two files',
        diffs: [
          { path: 'a.ts', oldText: 'x', newText: 'y' },
          { path: 'b.ts', oldText: null, newText: 'z' },
        ],
      },
    }))
    expect(out).toContain('a.ts · b.ts')
  })

  it('covers diff call-view fallback, create hunks, empty diffs, and result-only paths', () => {
    const callOnly = renderToString(createElement(ToolCard, {
      card: card({
        callView: {
          card: 'diff',
          title: 'Create a.ts',
          diffs: [{ path: 'a.ts', oldText: null, newText: 'new' }],
        },
      }),
      expanded: true,
    }))
    expect(callOnly).toContain('+ new')
    const empty = renderToString(createElement(ToolCard, {
      card: card({
        callView: { card: 'diff', title: 'empty', diffs: [] },
      }),
      expanded: true,
    }))
    expect(empty).toContain('参数')
    expect(render(card({
      callView: { card: 'diff', title: 'empty', diffs: [] },
    }))).not.toContain('a.ts')
    expect(render(card({
      status: 'ok',
      resultView: { card: 'diff', diffs: [{ path: 'result.ts', oldText: null, newText: 'x' }] },
    }))).toContain('result.ts')
  })

  it('keeps presenter-backed folded rows single-line and free of raw JSON payloads', () => {
    const terminal = render(card({
      status: 'ok',
      arguments: '{"command":"printf(\\"x\\")","cwd":"/tmp/project"}',
      callView: { card: 'terminal', title: 'npm test', cwd: '/tmp/project' },
      resultView: { card: 'terminal', output: 'ok\nsecond line', exitCode: 0 },
    }))
    const plainTerminal = terminal.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
    expect(plainTerminal).toContain('▸ npm test · 完成 exitCode 0')
    expect(plainTerminal).not.toContain('{"command"')
    expect(plainTerminal).not.toContain('second line')

    const web = render(card({
      status: 'ok',
      name: 'web_search',
      arguments: '{"q":"phase 6"}',
      resultView: {
        card: 'web',
        kind: 'search',
        sources: [{ title: 'Result One', url: 'https://example.com' }],
        truncated: false,
      },
    }))
    const plainWeb = web.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
    expect(plainWeb).toContain('▸ web_search · 完成 Result One')
    expect(plainWeb).not.toContain('{"q"')
    expect(plainWeb).not.toContain('\nhttps://example.com')
  })

  it('expands a search result with {path}:{line} rows and the truncation suffix', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        name: 'grep',
        resultView: {
          card: 'search',
          shape: 'matches',
          files: [{ path: 'src/a.ts', matches: [{ lineNumber: 42, line: 'hit' }] }],
          truncated: true,
          total: 9,
        },
      }),
      expanded: true,
    }))
    expect(out).toContain('src/a.ts:42 hit')
    expect(out).toContain('…')
    expect(render(card({
      status: 'ok',
      name: 'grep',
      resultView: {
        card: 'search',
        shape: 'paths',
        paths: ['a.ts'],
        truncated: false,
        total: 7,
      },
    }))).toContain('7')
  })

  it('expands path search results and falls back when only a call tag exists', () => {
    const paths = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        resultView: {
          card: 'search', shape: 'paths', paths: ['a.ts', 'b.ts'], truncated: true, total: 2,
        },
      }),
      expanded: true,
    }))
    expect(paths).toContain('a.ts')
    expect(paths).toContain('…')
    const untruncated = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        resultView: {
          card: 'search', shape: 'paths', paths: ['only.ts'], truncated: false, total: 1,
        },
      }),
      expanded: true,
    }))
    expect(untruncated).toContain('only.ts')
    expect(untruncated).not.toContain('…')
    const forged = card({ arguments: '{"q":"x"}' })
    ;(forged as { callView?: unknown }).callView = { card: 'search', title: 'search' }
    expect(renderToString(createElement(ToolCard, { card: forged, expanded: true }))).toContain('参数')
    expect(render(forged)).not.toContain('matches')
  })

  it('expands a read result with numbered lines', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        name: 'read',
        resultView: {
          card: 'read',
          path: '/tmp/a.ts',
          offset: 1,
          lines: [{ number: 7, text: 'const x = 1' }],
          totalLines: 9,
        },
      }),
      expanded: true,
    }))
    expect(out).toContain('7 const x = 1')
    expect(render(card({
      status: 'ok',
      name: 'read',
      resultView: {
        card: 'read',
        path: '/tmp/a.ts',
        offset: 1,
        lines: [],
        totalLines: 9,
      },
    }))).toContain('/tmp/a.ts')
  })

  it('falls back when only a read call tag exists', () => {
    const forged = card({ arguments: '{"path":"a.ts"}' })
    ;(forged as { callView?: unknown }).callView = { card: 'read', title: 'read' }
    expect(renderToString(createElement(ToolCard, { card: forged, expanded: true }))).toContain('参数')
    expect(render(forged)).not.toContain('a.ts')
  })

  it('expands a web fetch result with {url} · {statusCode}', () => {
    const out = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        name: 'web_fetch',
        resultView: {
          card: 'web',
          kind: 'fetch',
          url: 'https://example.com',
          statusCode: 200,
          truncated: false,
        },
      }),
      expanded: true,
    }))
    expect(out).toContain('https://example.com · 200')
    expect(render(card({
      status: 'ok',
      resultView: {
        card: 'web', kind: 'fetch', url: 'https://example.com', statusCode: 200, truncated: false,
      },
    }))).toContain('https://example.com · 200')
  })

  it('covers web search sources, truncation, counts, empty results, and call-only fallback', () => {
    const expanded = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        resultView: {
          card: 'web',
          kind: 'search',
          sources: [
            { url: 'https://one.example' },
            { title: 'Two', url: 'https://two.example' },
          ],
          truncated: true,
        },
      }),
      expanded: true,
    }))
    expect(expanded).toContain('https://one.example')
    expect(expanded).toContain('Two · https://two.example')
    expect(expanded).toContain('…')
    const single = render(card({
      status: 'ok',
      resultView: {
        card: 'web', kind: 'search', sources: [{ url: 'https://one.example' }], truncated: false,
      },
    }))
    expect(single).toContain('https://one.example')
    const singleExpanded = renderToString(createElement(ToolCard, {
      card: card({
        status: 'ok',
        resultView: {
          card: 'web', kind: 'search', sources: [{ url: 'https://one.example' }], truncated: false,
        },
      }),
      expanded: true,
    }))
    expect(singleExpanded).toContain('https://one.example')
    expect(render(card({
      status: 'ok',
      resultView: {
        card: 'web', kind: 'search', sources: [{ url: 'https://one.example' }, { url: 'https://two.example' }], truncated: false,
      },
    }))).toContain('2 sources')
    expect(render(card({
      status: 'ok',
      resultView: { card: 'web', kind: 'search', sources: [], truncated: false },
    }))).not.toContain('sources')
    const forged = card({ arguments: '{"url":"https://example.com"}' })
    ;(forged as { callView?: unknown }).callView = { card: 'web', title: 'web' }
    expect(renderToString(createElement(ToolCard, { card: forged, expanded: true }))).toContain('参数')
    expect(render(forged)).not.toContain('sources')
  })

  it('falls back to the generic fold for an unknown card tag', () => {
    const forged = card({ status: 'ok' })
    // A forged/unknown presenter card tag must never crash the switch.
    ;(forged as { resultView?: unknown }).resultView = { card: 'mystery' }
    const out = render(forged)
    expect(out).toContain('▸ bash · ')
  })
})
