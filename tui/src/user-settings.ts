/**
 * The `tui` settings plugin: TUI-owned presentation preferences as one fully
 * volatile Config. dsh 0.2 projects volatile Config fields into settings
 * forms keyed by the Loader entry id, writes edits to the profile layer, and
 * updates the live reference without remounting; the runtime reads it through
 * the `tuiSettings` service on demand.
 * @module @deepseek-ai/dsh-tui/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TuiLocale } from '@deepseek-ai/dsh-tui-render'
import { DEFAULT_NOTIFY_QUIET_INPUT_SECONDS, type NotifyMode } from './notify.ts'

/** TUI-owned user settings: color, input, notification, and brand presentation. */
export interface TuiUserSettings {
  /** Locale for terminal presentation controls. */
  locale?: TuiLocale
  /** Whether thinking text is visible throughout the transcript. */
  reasoning?: boolean
  /** Whether the footer displays full metrics instead of one quiet row. */
  statusDetails?: boolean
  /** Optional override of the mount-time detected color tier. */
  colorTier?: 'truecolor' | '256' | '16' | 'none'
  /** When false, Enter inserts a newline and Ctrl+Enter sends. */
  submitOnEnter?: boolean
  /** Desktop notification policy (TERM-05): off, attention events only, or legacy per-turn popup. */
  notify?: NotifyMode
  /** Local input within this many seconds downgrades desktop notifications to bell. */
  notifyQuietInputSeconds?: number
  /** Generated FishLogo reveal mode (TERM-11). */
  brandAnimation?: 'auto' | 'on' | 'off'
  /** Whether overflowing conversation history displays a scrollbar. */
  scrollbar?: boolean
}

/** Field schema shared by the plugin Config and unit fixtures. */
export const TuiUserSettings: z<TuiUserSettings> = z.object({
  colorTier: z.union(['truecolor', '256', '16', 'none'] as const),
  submitOnEnter: z.boolean().default(true),
  notify: z.union(['off', 'attention', 'every-turn'] as const).default('attention'),
  notifyQuietInputSeconds: z.natural().default(DEFAULT_NOTIFY_QUIET_INPUT_SECONDS),
  brandAnimation: z.union(['auto', 'on', 'off'] as const).default('auto'),
  scrollbar: z.boolean().default(true),
  locale: z.union(['zh-CN', 'en-US'] as const).default('zh-CN'),
  reasoning: z.boolean().default(false),
  statusDetails: z.boolean().default(false),
})

/** Live read access to the current `tui` settings snapshot. */
export interface TuiSettingsService {
  /**
   * Read the current volatile TUI presentation preferences.
   * @returns the current settings snapshot; reread after settings edits.
   */
  get(): TuiUserSettings
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live TUI presentation preferences supplied by the settings plugin. */
    tuiSettings: TuiSettingsService
  }
}

/** Stable Cordis plugin name. */
export const name = 'tui-settings'

/** Every field is live-editable from the settings pane without a remount. */
export const Config = TuiUserSettings.volatile()

/**
 * Publish the live settings reference.
 * @param ctx - plugin context.
 * @param config - the volatile reference produced by {@link Config}.
 */
export function apply(ctx: Context, config: { get(): TuiUserSettings }): void {
  ctx.provide('tuiSettings', { get: () => config.get() })
}
