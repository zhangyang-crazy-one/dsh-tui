/**
 * Interaction state machine: owns the generation/stop/continue/exit-confirm
 * semantics from 02-UI-SPEC §3. Pure — the runtime dispatches signals and
 * turn events into it, and acts on the returned effect.
 * @module @deepseek-ai/dsh-tui-render/interaction-state
 */

/** The four interaction states. */
export type InteractionState = 'idle' | 'generating' | 'stopped' | 'exit-armed'

/** Effects the machine asks the runtime to perform. */
export type InteractionEffect =
  | { kind: 'none' }
  | { kind: 'cancel-generation' }
  | { kind: 'followup'; text: string }
  | { kind: 'exit'; code: number }
  | { kind: 'arm-exit' }

/** Events the runtime feeds into the machine. */
export type InteractionEvent =
  | { kind: 'sigint' }
  | { kind: 'turn-started' }
  | { kind: 'turn-ended'; completed: boolean }
  | { kind: 'send'; text: string }

/**
 * Fold one interaction event over the machine.
 * @param state - interaction state before the event.
 * @param event - event to apply.
 * @returns the next state and the runtime effect to perform.
 */
export function reduceInteraction(
  state: InteractionState,
  event: InteractionEvent,
): { state: InteractionState; effect: InteractionEffect } {
  switch (state) {
    case 'idle':
    case 'stopped': {
      if (event.kind === 'sigint') {
        return { state: 'exit-armed', effect: { kind: 'arm-exit' } }
      }
      if (event.kind === 'send') {
        return {
          state: 'generating',
          effect: { kind: 'followup', text: event.text },
        }
      }
      return { state, effect: { kind: 'none' } }
    }
    case 'generating': {
      if (event.kind === 'sigint') {
        return { state: 'generating', effect: { kind: 'cancel-generation' } }
      }
      if (event.kind === 'turn-ended') {
        return event.completed
          ? { state: 'idle', effect: { kind: 'none' } }
          : { state: 'stopped', effect: { kind: 'none' } }
      }
      return { state, effect: { kind: 'none' } }
    }
    case 'exit-armed': {
      if (event.kind === 'sigint') {
        return { state: 'exit-armed', effect: { kind: 'exit', code: 0 } }
      }
      if (event.kind === 'send') {
        return {
          state: 'generating',
          effect: { kind: 'followup', text: event.text },
        }
      }
      return { state, effect: { kind: 'none' } }
    }
  }
}
