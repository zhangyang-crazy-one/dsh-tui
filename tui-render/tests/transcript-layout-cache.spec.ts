import { describe, expect, it } from 'vitest'
import { TranscriptLayoutCache } from '../src/transcript-layout-cache.ts'

function input(id: string, version: string, estimatedRows: number) {
  return { id, version, estimatedRows }
}

describe('TranscriptLayoutCache', () => {
  it('reuses stable frozen measurements and changes only an active tail version', () => {
    const cache = new TranscriptLayoutCache()
    const inputs = [
      input('message-1', 'frozen-a', 3),
      input('message-2', 'frozen-b', 4),
      input('assistant-turn-3', 'active-10', 5),
    ]
    expect(cache.layouts('80:truecolor:collapsed', inputs)).toEqual([
      { id: 'message-1', top: 0, rows: 3 },
      { id: 'message-2', top: 3, rows: 4 },
      { id: 'assistant-turn-3', top: 7, rows: 5 },
    ])
    expect(cache.record('80:truecolor:collapsed', 'message-1', 'frozen-a', 6)).toBe(true)
    expect(cache.record('80:truecolor:collapsed', 'message-2', 'frozen-b', 7)).toBe(true)
    expect(cache.record('80:truecolor:collapsed', 'assistant-turn-3', 'active-10', 8)).toBe(true)
    expect(cache.layouts('80:truecolor:collapsed', inputs).map(block => block.rows)).toEqual([
      6, 7, 8,
    ])

    const streamed = [
      inputs[0]!,
      inputs[1]!,
      input('assistant-turn-3', 'active-14', 9),
    ]
    expect(cache.layouts('80:truecolor:collapsed', streamed).map(block => block.rows)).toEqual([
      6, 7, 9,
    ])
  })

  it('invalidates every measurement when width, theme, or folds change', () => {
    const cache = new TranscriptLayoutCache()
    const inputs = [input('message-1', 'a', 2), input('message-2', 'b', 3)]
    cache.record('80:truecolor:collapsed', 'message-1', 'a', 9)
    expect(cache.layouts('80:truecolor:collapsed', inputs)[0]?.rows).toBe(9)
    expect(cache.layouts('60:truecolor:collapsed', inputs)).toEqual([
      { id: 'message-1', top: 0, rows: 2 },
      { id: 'message-2', top: 2, rows: 3 },
    ])
  })

  it('retains measured history when a new frozen block appends', () => {
    const cache = new TranscriptLayoutCache()
    cache.record('scope', 'message-1', 'a', 5)
    const appended = [input('message-1', 'a', 2), input('message-2', 'b', 4)]
    expect(cache.layouts('scope', appended)).toEqual([
      { id: 'message-1', top: 0, rows: 5 },
      { id: 'message-2', top: 5, rows: 4 },
    ])
  })
})
