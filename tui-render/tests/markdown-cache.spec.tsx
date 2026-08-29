/** Settled Markdown reuse, frozen-row memoization, and bounded syntax tokens. */

import { beforeEach, describe, expect, it } from 'vitest'
import { render, renderToString } from 'ink'
import { createElement } from 'react'
import {
  MarkdownBlock,
  markdownCacheInternals,
  tokenize,
} from '../src/markdown.tsx'
import type { ViewModel } from '../src/projection.ts'
import { StreamView } from '../src/stream-view.tsx'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

function renderMarkdown(source: string, settled: boolean): string {
  return renderToString(createElement(MarkdownBlock, {
    source,
    settled,
    maxCols: 80,
  }))
}

function model(history: ViewModel['history']): ViewModel {
  return {
    history,
    activeTurn: undefined,
    status: 'idle',
    reasoningExpanded: false,
    toolCardsExpanded: false,
  }
}

beforeEach(() => {
  markdownCacheInternals.reset()
})

describe('Markdown render caches', () => {
  it('parses an identical settled source once and reparses an edited source', () => {
    expect(renderMarkdown('**settled**', true)).toBe(renderMarkdown('**settled**', true))
    expect(markdownCacheInternals.snapshot()).toMatchObject({
      markdownEntries: 1,
      markdownHits: 1,
      markdownParses: 1,
    })
    renderMarkdown('**edited**', true)
    expect(markdownCacheInternals.snapshot().markdownParses).toBe(2)
  })

  it('never caches changing streaming sources', () => {
    renderMarkdown('stream', false)
    renderMarkdown('stream', false)
    expect(markdownCacheInternals.snapshot()).toMatchObject({
      markdownEntries: 0,
      markdownHits: 0,
      markdownParses: 2,
    })
  })

  it('reuses the safely trimmed final tree for an incomplete closing fence', () => {
    const source = '```ts\nconst value = 1\n``'
    expect(renderMarkdown(source, true)).toBe(renderMarkdown(source, true))
    expect(markdownCacheInternals.snapshot().markdownParses).toBe(1)
  })

  it('bounds syntax tokens with least-recently-used eviction', () => {
    const limit = markdownCacheInternals.snapshot().limit
    const retained = tokenize('const retained = 1', 'ts')
    for (let index = 0; index < limit - 1; index += 1) {
      tokenize(`const line_${String(index)} = ${String(index)}`, 'ts')
    }
    expect(tokenize('const retained = 1', 'ts')).toBe(retained)
    tokenize('const overflow = true', 'ts')
    expect(markdownCacheInternals.snapshot()).toMatchObject({
      tokenEntries: limit,
      tokenEvictions: 1,
    })
  })

  it('records a repeat-workload token hit rate above 0.9', () => {
    tokenize('const repeated = "value"', 'ts')
    for (let index = 0; index < 20; index += 1) {
      tokenize('const repeated = "value"', 'ts')
    }
    const stats = markdownCacheInternals.snapshot()
    expect(stats.tokenHits / (stats.tokenHits + stats.tokenMisses)).toBeGreaterThan(0.9)
  })

  it('does not revisit stable settled Markdown for a viewport-command commit', async () => {
    const history: ViewModel['history'] = [{
      id: 1,
      kind: 'assistant',
      text: '**stable history**',
      timestamp: 1,
    }]
    const element = (sequence: number) => createElement(StreamView, {
      model: model(history),
      viewportCommand: { sequence, kind: 'scroll' as const, delta: 1 },
    })
    const instance = render(element(0), {
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      expect(markdownCacheInternals.snapshot().markdownParses).toBe(1)
      markdownCacheInternals.reset()
      instance.rerender(element(1))
      await instance.waitUntilRenderFlush()
      expect(markdownCacheInternals.snapshot()).toMatchObject({
        markdownHits: 0,
        markdownParses: 0,
      })
    } finally {
      instance.unmount()
    }
  })
})
