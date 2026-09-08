/** Preview row generation follows viewport demand; eviction never removes source. */
import { describe, expect, it } from 'vitest'
import { toolHeadingRow, ToolRowCache } from '../src/tool-rows.ts'
import { toolPolicyDefaults } from '../src/render-policy.ts'
import type { ToolBodyCard } from '../src/tool-body.ts'

const card: ToolBodyCard = { name: 'generic', arguments: '{}', status: 'ok', resultText: Array.from({ length: 5001 }, (_, index) => `line-${index}`).join('\n') }

describe('ToolRowCache', () => {
  it('measures bounded previews but formats only the requested visible rows', () => {
    const cache = new ToolRowCache(toolPolicyDefaults())
    const cards = Array.from({ length: 100 }, (_, index) => cache.rows(`tool-${index}`, card, 100, true, 'zh-CN'))
    expect(cache.stats().materialized).toBe(0)
    expect(cards.every(rows => rows.length === 8)).toBe(true)
    expect(cards[50]!.slice(1, 3).map(row => row.text)).toEqual(['  参数', '  {}'])
    expect(cache.stats().materialized).toBe(2)
    expect(cards[50]!.at(-1)?.text).toContain('/tools')
    expect(cache.stats().materialized).toBe(3)
  })

  it('rebuilds evicted rows and invalidates changed width, content, locale, and fold', () => {
    const cache = new ToolRowCache({ ...toolPolicyDefaults(), cacheEntries: 2, cacheRows: 3 })
    const first = cache.rows('first', card, 80, true, 'zh-CN')
    const original = first.at(1)
    first.slice()
    expect(cache.stats().rows).toBeLessThanOrEqual(3)
    expect(first.at(1)).toEqual(original)
    for (let index = 0; index < 100; index += 1) {
      cache.rows('first', card, index % 2 === 0 ? 80 : 112, index % 2 === 0, 'zh-CN').slice()
      cache.rows(`other-${index}`, card, 80, true, 'en-US').at(1)
      expect(cache.stats().entries).toBeLessThanOrEqual(2)
      expect(cache.stats().rows).toBeLessThanOrEqual(3)
    }
    expect(cache.rows('first', { ...card, arguments: '{"new":true}' }, 80, true, 'en-US').at(2)?.text).toContain('new')
    expect(cache.rows('first', card, 80, false, 'zh-CN').length).toBe(1)
    expect(cache.stats().evictions).toBeGreaterThan(0)
    cache.clear()
    expect(cache.stats()).toMatchObject({ entries: 0, rows: 0 })
    expect(card.resultText).toContain('line-5000')
  })

  it('does not compress diff cards to previewRows budget and renders all diff rows without remaining hint', () => {
    const cache = new ToolRowCache(toolPolicyDefaults())
    const diffCard: ToolBodyCard = {
      name: 'edit',
      arguments: '{"file_path":"test.ts"}',
      status: 'ok',
      resultView: {
        card: 'diff',
        title: 'Edit test.ts',
        diffs: [{
          path: 'test.ts',
          oldText: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n',
          newText: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10-mod\n',
          oldStart: 1,
          oldLines: 10,
          newStart: 1,
          newLines: 10,
          lines: [
            ' 1', ' 2', ' 3', ' 4', ' 5', ' 6', ' 7', ' 8', ' 9', '-10', '+10-mod',
          ],
        }],
      },
    }
    const rows = cache.rows('diff-1', diffCard, 80, true, 'zh-CN')
    const textRows = rows.slice().map(r => r.text)
    expect(textRows).not.toContain(expect.stringContaining('/tools'))
    expect(textRows).toHaveLength(15)
    expect(textRows[1]).toContain('diff')
    expect(textRows[2]).toContain('--- test.ts')
    expect(textRows[3]).toContain('@@ -1,10 +1,10 @@')
    expect(textRows.at(-1)).toContain('10-mod')
    const hunkRow = rows.at(3)
    expect(hunkRow?.spans.some(s => s.token === 'accentText')).toBe(true)
    const delRow = rows.at(13)
    expect(delRow?.spans.some(s => s.token === 'error')).toBe(true)
    expect(delRow?.spans.some(s => s.token === 'fgDim')).toBe(true)
    const addRow = rows.at(14)
    expect(addRow?.spans.some(s => s.token === 'success')).toBe(true)
    expect(addRow?.spans.some(s => s.token === 'fgDim')).toBe(true)
  })

  it('bounds diff cards to diffPreviewRows when diff exceeds the configured budget', () => {
    const cache = new ToolRowCache({ ...toolPolicyDefaults(), diffPreviewRows: 5 })
    const diffCard: ToolBodyCard = {
      name: 'edit',
      arguments: '{"file_path":"test.ts"}',
      status: 'ok',
      resultView: {
        card: 'diff',
        title: 'Edit test.ts',
        diffs: [{
          path: 'test.ts',
          oldText: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n',
          newText: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10-mod\n',
          oldStart: 1,
          oldLines: 10,
          newStart: 1,
          newLines: 10,
          lines: [
            ' 1', ' 2', ' 3', ' 4', ' 5', ' 6', ' 7', ' 8', ' 9', '-10', '+10-mod',
          ],
        }],
      },
    }
    const rows = cache.rows('diff-2', diffCard, 80, true, 'zh-CN')
    const textRows = rows.slice().map(r => r.text)
    expect(textRows).toHaveLength(7)
    expect(textRows.at(-1)).toContain('/tools')
  })

  it('renders subagent tool card with high contrast colors and semantic tokens', () => {
    const subagentCard: ToolBodyCard = {
      name: 'subagent',
      arguments: JSON.stringify({
        description: '探索架构',
        prompt: '分析代码库结构',
        model: 'deepseek-chat',
      }),
      status: 'running',
    }
    const heading = toolHeadingRow(subagentCard, 80, false, 'zh-CN')
    expect(heading.text).toContain('[子代理]')
    expect(heading.text).toContain('探索架构')
    expect(heading.text).toContain('● 运行中')
    expect(heading.text).toContain('[deepseek-chat]')
    expect(heading.spans.some(s => s.token === 'codeKeyword')).toBe(true)
    expect(heading.spans.some(s => s.token === 'fg')).toBe(true)
    expect(heading.spans.some(s => s.token === 'accentText')).toBe(true)
    expect(heading.spans.some(s => s.token === 'markdownCode')).toBe(true)
  })
})

