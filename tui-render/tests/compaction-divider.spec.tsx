import { renderToString } from 'ink'
import { createElement } from 'react'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { describe, expect, it } from 'vitest'
import { createProjector } from '../src/projection.ts'
import { compactionDividerLabel, StreamView } from '../src/stream-view.tsx'
import { installTheme } from '../src/theme.ts'

const COMPACTION_ID = CompactionId('divider-fixture')

function projected() {
  const projector = createProjector()
  projector.push({
    type: 'user/message', seq: 1, time: 1,
    data: createUserMessage({
      content: [{ type: 'text', text: 'old row remains' }],
      source: { kind: 'user' },
    }),
    surfaceOp: 'append',
  })
  projector.push({
    type: 'compaction/start', seq: 2, time: 2,
    data: { compactionId: COMPACTION_ID, turn: null },
  })
  projector.push({
    type: 'compaction/summary', seq: 3, time: 3,
    data: {
      compactionId: COMPACTION_ID,
      summary: [{ type: 'text', text: 'summary\u001b[2J content' }],
      shadowedRange: { start: 1, end: 120 },
      shadowedSeqs: Array.from({ length: 120 }, (_, index) => index + 1),
      shadowedTokenCount: 400,
      provider: 'test-provider',
      model: 'test-model',
    },
  })
  projector.push({
    type: 'compaction/end', seq: 4, time: 4,
    data: { compactionId: COMPACTION_ID, turn: null },
  })
  return projector.snapshot()
}

describe('compaction divider projection and rendering', () => {
  it('retains old rows and folds count plus escaped summary into one stable divider', () => {
    const model = projected()
    expect(model.history.map(row => row.text)).toEqual(['old row remains'])
    expect(model.compactionDividers).toEqual([{
      id: 2,
      compactionId: COMPACTION_ID,
      shadowedCount: 120,
      summary: 'summary\u001b[2J content',
    }])
    expect(compactionDividerLabel(model.compactionDividers[0], false)).toBe(
      '──── ✂ 已压缩 120 条 · Ctrl+K 展开 ────',
    )
    installTheme({ COLORTERM: 'truecolor' })
    const collapsed = renderToString(createElement(StreamView, { model }))
    expect(collapsed).toContain('已压缩 120 条 · Ctrl+K 展开')
    expect(collapsed).not.toContain('summary')
    expect(collapsed).not.toContain('\u001b[38;2;77;107;254m')

    const expanded = renderToString(createElement(StreamView, {
      model: { ...model, expandedCompactionId: COMPACTION_ID },
    }))
    expect(expanded).toContain('已压缩 120 条 · Ctrl+K 折叠')
    expect(expanded).toContain('summary\\x1b[2J content')
  })

  it('omits an unavailable count and ignores a summary without a start marker', () => {
    const projector = createProjector()
    projector.push({
      type: 'compaction/summary', seq: 1, time: 1,
      data: {
        compactionId: COMPACTION_ID,
        summary: [{ type: 'text', text: 'orphan' }],
        shadowedRange: { start: 1, end: 1 },
        shadowedSeqs: [1],
        shadowedTokenCount: 1,
        provider: 'test-provider',
        model: 'test-model',
      },
    })
    projector.push({
      type: 'compaction/start', seq: 2, time: 2,
      data: { compactionId: COMPACTION_ID, turn: null },
    })
    const divider = projector.snapshot().compactionDividers[0]
    expect(compactionDividerLabel(divider, false)).toBe(
      '──── ✂ 已压缩 · Ctrl+K 展开 ────',
    )
  })

})
