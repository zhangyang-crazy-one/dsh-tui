/**
 * Pairing of projected tool-call / tool-result records into one card per callId.
 */

import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import {
  attachPresenterViews,
  cardsFrom,
  cardsFromActiveTurn,
  cardsFromTurn,
  collapsedCardSummary,
  fileUrlFromToolArguments,
  tokenizeCommandHeading,
  toolCardDisplayStatus,
  truncateDisplay,
} from '../src/tool-cards.ts'
import type { ProjectedTurnContent } from '../src/projection.ts'

const CALL_A = ToolCallId('call-a')
const CALL_B = ToolCallId('call-b')
const CALL_ORPHAN = ToolCallId('call-orphan')

function call(
  callId: ToolCallId,
  name = 'bash',
  args = '{"command":"git status"}',
): ProjectedTurnContent {
  return { kind: 'tool-call', callId, name, arguments: args }
}

function result(
  callId: ToolCallId,
  text: string,
  isError: boolean,
  extra: Partial<Extract<ProjectedTurnContent, { kind: 'tool-result' }>> = {},
): ProjectedTurnContent {
  return { kind: 'tool-result', callId, text, isError, ...extra }
}

describe('cardsFrom', () => {
  it('pairs one call and one result into a single ok card', () => {
    const cards = cardsFrom([
      { kind: 'text', text: 'intro' },
      call(CALL_A, 'read_file', '{"path":"a.ts"}'),
      result(CALL_A, 'file contents', false, {
        error: { name: 'ToolWarning', code: 'PARTIAL' },
        meta: { presentation: 'diff' },
      }),
      { kind: 'reasoning', text: 'done' },
    ])
    expect(cards).toEqual([
      {
        callId: CALL_A,
        name: 'read_file',
        arguments: '{"path":"a.ts"}',
        status: 'ok',
        resultText: 'file contents',
        error: { name: 'ToolWarning', code: 'PARTIAL' },
        meta: { presentation: 'diff' },
      },
    ])
  })

  it('keeps a call without a result as running', () => {
    expect(cardsFrom([call(CALL_A)])).toEqual([
      {
        callId: CALL_A,
        name: 'bash',
        arguments: '{"command":"git status"}',
        status: 'running',
      },
    ])
  })

  it('marks an isError result as error', () => {
    const cards = cardsFrom([
      call(CALL_A, 'bash', '{}'),
      result(CALL_A, 'boom', true),
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0]?.status).toBe('error')
    expect(cards[0]?.resultText).toBe('boom')
    expect(cards[0]?.meta).toBeUndefined()
    expect(cards[0]?.error).toBeUndefined()
  })

  it('preserves first-seen order across two callIds', () => {
    const cards = cardsFrom([
      call(CALL_B, 'second', '{}'),
      call(CALL_A, 'first', '{}'),
      result(CALL_A, 'ok-a', false),
    ])
    expect(cards.map(card => card.callId)).toEqual([CALL_B, CALL_A])
    expect(cards[0]?.status).toBe('running')
    expect(cards[1]?.status).toBe('ok')
  })

  it('drops an orphan result', () => {
    expect(cardsFrom([result(CALL_ORPHAN, 'nobody', false)])).toEqual([])
  })

  it('does not mutate the input content array', () => {
    const content: ProjectedTurnContent[] = [call(CALL_A)]
    const frozen = Object.freeze([...content])
    cardsFrom(frozen)
    expect(frozen).toEqual([call(CALL_A)])
  })
})

describe('cardsFromActiveTurn', () => {
  it('synthesizes running cards from live toolCalls', () => {
    const cards = cardsFromActiveTurn([
      { callId: CALL_A, name: 'bash', arguments: '{}' },
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0]?.status).toBe('running')
    expect(cards[0]?.name).toBe('bash')
  })

  it('merges arrived tool-result items onto the live calls', () => {
    const cards = cardsFromActiveTurn(
      [{ callId: CALL_A, name: 'bash', arguments: '{}' }],
      [result(CALL_A, 'done', false)],
    )
    expect(cards[0]?.status).toBe('ok')
    expect(cards[0]?.resultText).toBe('done')
  })
})

describe('cardsFromTurn', () => {
  it('reads toolCalls and optional content from the active turn', () => {
    const running = cardsFromTurn({
      turn: 1,
      assistantText: '',
      reasoningText: '',
      toolCalls: [{ callId: CALL_A, name: 'bash', arguments: '{}' }],
      reasoningDurationMs: 0,
    })
    expect(running[0]?.status).toBe('running')
    const done = cardsFromTurn({
      turn: 1,
      assistantText: '',
      reasoningText: '',
      toolCalls: [{ callId: CALL_A, name: 'bash', arguments: '{}' }],
      content: [result(CALL_A, 'out', true)],
      reasoningDurationMs: 0,
    })
    expect(done[0]?.status).toBe('error')
  })
})

describe('collapsedCardSummary', () => {
  it('uses a string command field when arguments are JSON', () => {
    expect(collapsedCardSummary('{"command":"git status"}')).toBe('git status')
  })

  it('falls back to escaped raw arguments when JSON is invalid', () => {
    expect(collapsedCardSummary('{\x1b[2J')).toBe('{\\x1b[2J')
  })

  it('omits a summary for empty arguments', () => {
    expect(collapsedCardSummary('')).toBeUndefined()
  })

  it('uses escaped arguments when command is not a string', () => {
    expect(collapsedCardSummary('{"command":1}')).toBe('{"command":1}')
  })
})

describe('truncateDisplay', () => {
  it('returns empty when the budget is non-positive', () => {
    expect(truncateDisplay('hello', 0)).toBe('')
    expect(truncateDisplay('hello', -1)).toBe('')
  })

  it('appends an ellipsis when the text overflows', () => {
    expect(truncateDisplay('abcd', 3)).toBe('ab…')
    expect(truncateDisplay('x', 1)).toBe('x')
    expect(truncateDisplay('xy', 1)).toBe('…')
  })
})

describe('attachPresenterViews', () => {
  const running = {
    callId: CALL_A,
    name: 'bash',
    arguments: '{"command":"git status"}',
    status: 'running' as const,
  }

  it('stores presentCall title and skips presentResult while running', () => {
    const attached = attachPresenterViews({
      get: () => ({
        presentCall: () => ({ card: 'generic', title: 'git status' }),
        presentResult: () => {
          throw new Error('presentResult must not run while running')
        },
      }),
    }, running)
    expect(attached.callView).toEqual({ card: 'generic', title: 'git status' })
    expect(attached.resultView).toBeUndefined()
  })

  it('returns the original card when tools are absent or JSON is invalid', () => {
    expect(attachPresenterViews(undefined, running)).toBe(running)
    const invalid = { ...running, arguments: '{' }
    expect(attachPresenterViews({
      get: () => ({ presentCall: () => ({ card: 'generic', title: 'nope' }) }),
    }, invalid)).toBe(invalid)
    expect(attachPresenterViews({ get: () => undefined }, running).callView)
      .toBeUndefined()
  })

  it('leaves views undefined when presentCall is missing, undefined, or throws', () => {
    expect(attachPresenterViews({ get: () => ({}) }, running).callView)
      .toBeUndefined()
    expect(attachPresenterViews({
      get: () => ({ presentCall: () => undefined }),
    }, running).callView).toBeUndefined()
    expect(attachPresenterViews({
      get: () => ({
        presentCall: () => {
          throw new Error('hostile presenter')
        },
      }),
    }, running).callView).toBeUndefined()
  })

  it('attaches presentResult when the card is not running', () => {
    const done = {
      ...running,
      status: 'ok' as const,
      resultText: 'ok',
    }
    const attached = attachPresenterViews({
      get: () => ({
        presentCall: () => ({ card: 'generic', title: 'git status' }),
        presentResult: () => ({ card: 'generic', title: 'done' }),
      }),
    }, done)
    expect(attached.callView).toEqual({ card: 'generic', title: 'git status' })
    expect(attached.resultView).toEqual({ card: 'generic', title: 'done' })
  })

  it('reports nonzero exits and signals as failed presentation states', () => {
    const done = { ...running, status: 'ok' as const, resultText: 'command output' }
    const nonzero = attachPresenterViews({
      get: () => ({
        presentResult: () => ({ card: 'terminal', output: 'compile failed', exitCode: 2 }),
      }),
    }, done)
    expect(toolCardDisplayStatus(nonzero)).toBe('error')
    expect(toolCardDisplayStatus({
      ...done,
      resultView: { card: 'terminal', output: '', signal: 'SIGTERM' },
    })).toBe('error')
    expect(toolCardDisplayStatus({
      ...done,
      resultView: { card: 'terminal', output: 'ok', exitCode: 0 },
    })).toBe('ok')
  })

  it('passes empty result text and metadata and accepts a result-only view', () => {
    const done = { ...running, status: 'ok' as const, meta: { source: 'test' } }
    let observed: unknown
    const attached = attachPresenterViews({
      get: () => ({
        presentResult: (_args, result) => {
          observed = result
          return { card: 'generic', title: 'done' }
        },
      }),
    }, done)
    expect(observed).toMatchObject({
      content: [{ type: 'text', text: '' }],
      isError: false,
      meta: { source: 'test' },
    })
    expect(attached.callView).toBeUndefined()
    expect(attached.resultView).toEqual({ card: 'generic', title: 'done' })
  })

  it('leaves resultView unset when presentResult throws', () => {
    const done = { ...running, status: 'error' as const, resultText: 'boom' }
    const attached = attachPresenterViews({
      get: () => ({
        presentCall: () => ({ card: 'generic', title: 'git status' }),
        presentResult: () => {
          throw new Error('hostile result presenter')
        },
      }),
    }, done)
    expect(attached.callView).toEqual({ card: 'generic', title: 'git status' })
    expect(attached.resultView).toBeUndefined()
  })
})

describe('fileUrlFromToolArguments', () => {
  it('rejects primitive and control-bearing paths while accepting alternate path keys', () => {
    expect(fileUrlFromToolArguments('null')).toBeUndefined()
    expect(fileUrlFromToolArguments('"text"')).toBeUndefined()
    expect(fileUrlFromToolArguments('{"path":"/tmp/\\u0000bad"}')).toBeUndefined()
    expect(fileUrlFromToolArguments('{"file_path":"/tmp/good"}')).toContain('file:///tmp/good')
  })
})

describe('tokenizeCommandHeading', () => {
  it('highlights the command name token with codeCommand', () => {
    expect(tokenizeCommandHeading('pnpm test')).toEqual([
      { text: 'pnpm', token: 'codeCommand' },
      { text: ' test', token: 'fgSoft' },
    ])
    expect(tokenizeCommandHeading('  git status -s')).toEqual([
      { text: '  ', token: 'fgSoft' },
      { text: 'git', token: 'codeCommand' },
      { text: ' status -s', token: 'fgSoft' },
    ])
    expect(tokenizeCommandHeading('ls')).toEqual([
      { text: 'ls', token: 'codeCommand' },
    ])
  })
})
