import { describe, expect, it } from 'vitest'
import {
  latestAssistantCopyTarget,
  type FrozenMessage,
} from '../src/projection.ts'

function row(id: number, kind: 'user' | 'assistant', text: string): FrozenMessage {
  return { id, kind, text, timestamp: id }
}

describe('latestAssistantCopyTarget', () => {
  it('selects the latest non-empty assistant row', () => {
    expect(latestAssistantCopyTarget([
      row(1, 'assistant', 'older'),
      row(2, 'user', 'user text'),
      row(3, 'assistant', ''),
      row(4, 'assistant', 'latest\u001b[2J'),
    ])).toEqual({ kind: 'message', text: 'latest\u001b[2J' })
  })

  it('selects the final closed backtick-fenced body without fence rows', () => {
    expect(latestAssistantCopyTarget([
      row(1, 'assistant', [
        'before',
        '```ts',
        'const first = 1',
        '```',
        'middle',
        '````txt',
        'final line 1',
        'final line 2',
        '`````',
        'after',
      ].join('\n')),
    ])).toEqual({ kind: 'code', text: 'final line 1\nfinal line 2' })
  })

  it('ignores an unfinished later fence and returns no target without assistant text', () => {
    expect(latestAssistantCopyTarget([
      row(1, 'assistant', '```\nclosed\n```\n```\nunfinished'),
    ])).toEqual({ kind: 'code', text: 'closed' })
    expect(latestAssistantCopyTarget([
      row(1, 'user', 'only user'),
      row(2, 'assistant', ''),
    ])).toBeUndefined()
  })
})
