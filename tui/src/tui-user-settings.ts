/**
 * Cordis plugin hosting the deepseek-tui user settings namespace.
 *
 * The 0.2.0-rc.2 merge removed `installSection` from the Settings API; the
 * settings describe()/update() flow needs a registered plugin entry with id
 * `tui` so the import-once pass in `settings.importLegacyDocument()` can route
 * the `tui:` block of `settings.yaml` into the live entry. Declaring the
 * TUI user settings fields as volatile on this plugin's Config makes them
 * editable from the settings overlay without restarting the runtime; the
 * runtime's `notifySettings()`, `presentationFlag()`, and `getSubmitOnEnter()`
 * continue to read them through `ctx.settings.describe().find(d => d.ns === 'tui')`.
 *
 * The `apply()` body is empty because this entry exists purely to host the
 * schema; tui-runtime (id `tui-runtime`) is the real driver.
 * @module @deepseek-ai/dsh-tui/user-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'tui-user-settings'

/** TUI user-facing settings; mirrored into the live entry Config. */
export interface TuiUserSettings {
  /** Optional override of the mount-time detected color tier. */
  colorTier: 'truecolor' | '256' | '16' | 'none'
  /** When false, Enter inserts a newline and Ctrl+Enter sends. */
  submitOnEnter: boolean
  /** Desktop notification policy (TERM-05): off, attention events only, or legacy per-turn popup. */
  notify: 'off' | 'attention' | 'every-turn'
  /** Local input within this many seconds downgrades desktop notifications to bell. */
  notifyQuietInputSeconds: number
  /** Generated FishLogo reveal mode (TERM-11). */
  brandAnimation: 'auto' | 'on' | 'off'
  /** Whether overflowing conversation history displays a scrollbar. */
  scrollbar: boolean
  /** Interface locale for the terminal copy. */
  locale: 'zh-CN' | 'en-US'
  /** Whether the rendered transcript shows reasoning blocks expanded by default. */
  reasoning: boolean
  /** Whether the adaptive footer renders a per-row detail column. */
  statusDetails: boolean
}

export const Config = z.object({
  colorTier: z.union(['truecolor', '256', '16', 'none'] as const).default('truecolor'),
  submitOnEnter: z.boolean().default(true).volatile(),
  notify: z.union(['off', 'attention', 'every-turn'] as const).default('attention').volatile(),
  notifyQuietInputSeconds: z.natural().default(10).volatile(),
  brandAnimation: z.union(['auto', 'on', 'off'] as const).default('auto').volatile(),
  scrollbar: z.boolean().default(true).volatile(),
  locale: z.union(['zh-CN', 'en-US'] as const).default('zh-CN').volatile(),
  reasoning: z.boolean().default(false).volatile(),
  statusDetails: z.boolean().default(false).volatile(),
})

/** No-op apply: the entry exists to host its Config schema only. */
export function apply(_ctx: Context, _config: TuiUserSettings): void {
  // The runtime reads these settings through ctx.settings.describe(); no
  // event handlers need to be wired here.
}
