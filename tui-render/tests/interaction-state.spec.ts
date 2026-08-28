import { describe, expect, it } from 'vitest'
import { reduceInteraction, type InteractionEvent } from '../src/interaction-state.ts'

describe('reduceInteraction', () => {
  it.each([
    ['idle', { kind: 'sigint' }, 'exit-armed', { kind: 'arm-exit' }],
    ['stopped', { kind: 'sigint' }, 'exit-armed', { kind: 'arm-exit' }],
    ['idle', { kind: 'send', text: 'next' }, 'generating', { kind: 'followup', text: 'next' }],
    ['stopped', { kind: 'send', text: 'resume' }, 'generating', { kind: 'followup', text: 'resume' }],
    ['idle', { kind: 'turn-started' }, 'idle', { kind: 'none' }],
    ['stopped', { kind: 'turn-ended', completed: true }, 'stopped', { kind: 'none' }],
    ['generating', { kind: 'sigint' }, 'generating', { kind: 'cancel-generation' }],
    ['generating', { kind: 'turn-ended', completed: true }, 'idle', { kind: 'none' }],
    ['generating', { kind: 'turn-ended', completed: false }, 'stopped', { kind: 'none' }],
    ['generating', { kind: 'turn-started' }, 'generating', { kind: 'none' }],
    ['exit-armed', { kind: 'sigint' }, 'exit-armed', { kind: 'exit', code: 0 }],
    ['exit-armed', { kind: 'send', text: 'continue' }, 'generating', { kind: 'followup', text: 'continue' }],
    ['exit-armed', { kind: 'turn-ended', completed: true }, 'exit-armed', { kind: 'none' }],
  ] as const)('%s + $event.kind', (state, event, nextState, effect) => {
    expect(reduceInteraction(state, event as InteractionEvent)).toEqual({
      state: nextState,
      effect,
    })
  })
})
