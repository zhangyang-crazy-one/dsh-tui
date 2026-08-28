/** Human-transcript visibility predicates shared by render and host layers. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Identify a user-role event that came from direct human input.
 *
 * Agent instructions, plugin snapshots, skill catalogs, and future
 * declaration-merged context sources remain durable and model-visible, but
 * they are not rows in the human transcript.
 * @param event - one durable session event.
 * @returns whether the event is a human-authored user message.
 */
export function isHumanUserMessage(
  event: SessionEvent,
): event is SessionEvent<'user/message'> {
  return event.type === 'user/message' && event.data.source.kind === 'user'
}
