/**
 * The single keymap table: every terminal keybinding of the surface is
 * declared here and dispatched through one owner, so no component binds
 * keys itself. Ink 7.1.1 exposes no runtime IME composition state, so no
 * binding yields to the input method; the terminal emulator renders its
 * native inline preedit at the composer caret.
 * @module @deepseek-ai/dsh-tui-render/keymap
 */

/** Semantic key actions the surface understands. */
export type KeyAction =
  | 'send'
  | 'newline'
  | 'stop-generation'
  | 'confirm-exit'
  | 'toggle-reasoning'
  | 'toggle-tool-cards'
  | 'copy-message'
  | 'intake-clipboard-image'
  | 'edit-external'
  | 'toggle-compaction-divider'
  | 'scroll-down'
  | 'scroll-up'
  | 'command-menu'
  | 'mention'
  | 'cancel'

/** One key binding: the key name Ink reports plus the action. */
export interface KeyBinding {
  /** Ink input key name (e.g. 'return', 'c', 'escape'). */
  key: string
  /** Modifier requirement (ctrl for Ctrl+C). */
  ctrl?: boolean
  /** Modifier requirement (shift for Shift+Enter). */
  shift?: boolean
  /** The action to dispatch. */
  action: KeyAction
}

/** The surface's complete binding table, per 02-UI-SPEC §3. */
export const KEYMAP: readonly KeyBinding[] = [
  { key: 'return', action: 'send' },
  { key: 'return', shift: true, action: 'newline' },
  { key: 'c', ctrl: true, action: 'stop-generation' },
  { key: 'o', ctrl: true, action: 'toggle-reasoning' },
  { key: 'e', ctrl: true, action: 'toggle-tool-cards' },
  { key: 'y', ctrl: true, action: 'copy-message' },
  { key: 'p', ctrl: true, action: 'intake-clipboard-image' },
  { key: 'g', ctrl: true, action: 'edit-external' },
  { key: 'k', ctrl: true, action: 'toggle-compaction-divider' },
  { key: 'j', action: 'scroll-down' },
  { key: 'k', action: 'scroll-up' },
  { key: '/', action: 'command-menu' },
  { key: '@', action: 'mention' },
  { key: 'escape', action: 'cancel' },
]

/**
 * Resolve one exact key/modifier tuple through the single binding table.
 * @param key - Ink key name or printable sequence.
 * @param modifiers - modifier flags reported by Ink.
 * @returns the bound semantic action, or undefined when no binding matches.
 */
export function keyActionFor(
  key: string,
  modifiers: { readonly ctrl: boolean; readonly shift: boolean },
): KeyAction | undefined {
  return KEYMAP.find(binding =>
    binding.key === key
    && (binding.ctrl ?? false) === modifiers.ctrl
    && (binding.shift ?? false) === modifiers.shift,
  )?.action
}
