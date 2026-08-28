import { renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { QueueChip, queueChipText } from '../src/queue-chip.tsx'

describe('QueueChip', () => {
  it('hides zero and paints the locked FIFO-only copy', () => {
    expect(queueChipText(0)).toBeUndefined()
    expect(renderToString(createElement(QueueChip, { count: 0 }))).toBe('')
    expect(queueChipText(3)).toBe('待发 3 · ↑ 取出')
    expect(renderToString(createElement(QueueChip, { count: 3 }))).toContain(
      '待发 3 · ↑ 取出',
    )
  })
})
