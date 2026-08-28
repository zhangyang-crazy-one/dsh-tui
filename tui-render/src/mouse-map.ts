/**
 * Map a mouse wheel (or edge auto-scroll) delta onto the same LoopAction the
 * visible pane's j/k keys use. Wheel up is +1 (older / list up); wheel down
 * is -1. Settings edit and onboarding ignore the wheel so a drag cannot
 * change the field being typed.
 * @module @deepseek-ai/dsh-tui-render/mouse-map
 */

import type { LoopAction } from './loop.tsx'

/** Visible-pane flags the loop reads from its controller refs. */
export interface MouseScrollContext {
  /** Permission overlay is the content slot. */
  permissionOpen: boolean
  /** Settings overlay is the content slot. */
  settingsOpen: boolean
  /** Settings is capturing the composer (edit or onboarding). */
  settingsEditing: boolean
  /** Model picker is the content slot. */
  modelOpen: boolean
  /** Help sheet is the content slot. */
  helpOpen: boolean
  /** Session directory is the content slot. */
  sessionOpen: boolean
  /** Search panel is the content slot. */
  searchOpen: boolean
  /** Timeline view is the content slot. */
  timelineOpen: boolean
}

/**
 * Translate a signed wheel delta into a loop action for the visible pane.
 * @param delta - +1 wheel-up/older, -1 wheel-down/newer.
 * @param ctx - which overlay currently occupies the content slot.
 * @returns the action, or undefined when the wheel is ignored.
 */
export function mouseScrollAction(
  delta: number,
  ctx: MouseScrollContext,
): LoopAction | undefined {
  if (delta === 0) return undefined
  if (ctx.settingsOpen && ctx.settingsEditing) return undefined
  const listDelta = delta > 0 ? -1 : 1
  if (ctx.permissionOpen) return { kind: 'permission-move', delta: listDelta }
  if (ctx.settingsOpen) return { kind: 'settings-move', delta: listDelta }
  if (ctx.modelOpen) return { kind: 'model-move', delta: listDelta }
  if (ctx.helpOpen) return { kind: 'help-scroll', delta: listDelta }
  if (ctx.sessionOpen) return { kind: 'session-pane-move', delta: listDelta }
  if (ctx.searchOpen) return { kind: 'session-pane-move', delta: listDelta }
  if (ctx.timelineOpen) return { kind: 'timeline-scroll', delta: listDelta }
  return { kind: 'scroll', delta }
}
