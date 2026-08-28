/**
 * ANSI output layering contract for the terminal surface.
 *
 * Content-vs-presentation layering (P5): only the render layer may emit color
 * and cursor control sequences. Every byte that originated as user input,
 * model output, or tool result is treated as plain text and must pass through
 * {@link escapeContent} before reaching stdout; the render layer wraps it in
 * styles from the theme token table instead. No bare escape sequence may be
 * written by business code anywhere in this package.
 *
 * `styled` lives in @deepseek-ai/dsh-tui-render (the theme token table and
 * the three-tier fallback); this module re-exports it so host-side code keeps
 * one stable import surface. {@link escapeContent} moved into the render
 * layer with the other content utilities ([render-utility-ownership
 * Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-15-render-utility-ownership.md))
 * and is re-exported here for the same reason.
 * @module @deepseek-ai/dsh-tui/ansi-styling
 */

export {
  styled,
  THEME_LEVELS,
  applyTheme,
  currentTier,
} from '@deepseek-ai/dsh-tui-render'
export type { StyleToken, ThemeTokens } from '@deepseek-ai/dsh-tui-render'
export { escapeContent } from '@deepseek-ai/dsh-tui-render'
