/** PassThrough-backed TTY adapters for Ink component tests. */

import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { wrapStdoutForFrameBg } from '../src/frame-fill.ts'
import type { ColorTier } from '../src/terminal-capabilities.ts'
import type { TuiController } from '../src/loop.tsx'
import { EMPTY_WORKSPACE_PANE } from '../src/workspace-pane.tsx'
import { EMPTY_FEEDBACK_PANE } from '../src/feedback-pane.tsx'
import { EMPTY_WORKFLOW_OVERLAY } from '../src/workflow-overlay.tsx'

/**
 * Remove terminal controls from captured output.
 * @param text - captured terminal output.
 * @returns printable text without ANSI sequences.
 */
export function stripTerminalControls(text: string): string {
  return stripVTControlCharacters(text)
}

/** Test adapters expose Ink's stream contract; no OS terminal is allocated. */
export type FakeTtyStdin = NodeJS.ReadStream
export type FakeTtyStdout = NodeJS.WriteStream

/** A TTY-shaped stdin Ink can attach its input parser to. */
export function fakeTtyStdin(): FakeTtyStdin {
  const stream = new PassThrough() as unknown as FakeTtyStdin
  stream.isTTY = true
  stream.isRaw = false
  stream.setRawMode = mode => {
    stream.isRaw = mode
    return stream
  }
  stream.ref = () => stream
  stream.unref = () => stream
  return stream
}

/** A writable stdout Ink can flush frames to. */
export function fakeTtyStdout(): FakeTtyStdout {
  return new PassThrough() as unknown as FakeTtyStdout
}

/**
 * Attach production frame painting to a PassThrough-backed test stream.
 * @param stdout - the owned PassThrough-backed fake TTY.
 * @param getTier - optional frame color tier.
 * @returns the wrapped stream with the same fake TTY interface.
 */
export function frameTtyStdout(stdout: FakeTtyStdout, getTier?: () => ColorTier): FakeTtyStdout {
  return wrapStdoutForFrameBg(stdout, getTier)
}

/** Defaults for pane tests that never exercise image intake or background overlays. */
export const PASSIVE_CONTROLLER = {
  getWorkspacePane: () => EMPTY_WORKSPACE_PANE,
  getFeedbackPane: () => EMPTY_FEEDBACK_PANE,
  getWorkflowOverlay: () => EMPTY_WORKFLOW_OVERLAY,
  intakeClipboardImage: async () => ({ ok: false as const, reason: 'No clipboard in pane fixture' }),
  intakeImagePath: async () => ({ ok: false as const, reason: 'No filesystem in pane fixture' }),
  note: () => {},
  noteUserActivity: () => {},
} satisfies Pick<TuiController,
  | 'getWorkspacePane' | 'getFeedbackPane' | 'getWorkflowOverlay'
  | 'intakeClipboardImage' | 'intakeImagePath' | 'note' | 'noteUserActivity'
>

/** Register Ink's exit waiter before unmount so its process listener is removed. */
export async function disposeRenderer(instance: {
  unmount(): void
  waitUntilExit(): Promise<unknown>
}): Promise<void> {
  const exited = instance.waitUntilExit()
  instance.unmount()
  await exited
}
