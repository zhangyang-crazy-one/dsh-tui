/**
 * Display-width helpers: the single width source for every layout decision in
 * the terminal surface. `String#length` counts UTF-16 units, not terminal
 * columns; CJK glyphs occupy two columns and ZWJ emoji sequences collapse to
 * two. All alignment, wrapping, and truncation must go through these helpers.
 *
 * The implementation and its `string-width` dependency live in
 * @deepseek-ai/dsh-tui-render ([render-utility-ownership
 * Agent Note](../../../../.agents/notes/implemented/architecture/2026-08-15-render-utility-ownership.md));
 * this module re-exports them so host-side callers keep one stable import
 * surface.
 * @module @deepseek-ai/dsh-tui/text-width
 */

export { displayWidth, wcwidthSafeSlice } from '@deepseek-ai/dsh-tui-render'
