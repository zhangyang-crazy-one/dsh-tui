/**
 * Re-export of the capability constants owned by @deepseek-ai/dsh-tui-render
 * (the leaf package without a back-reference to this one). Host-side code
 * keeps importing this module path unchanged.
 * @module @deepseek-ai/dsh-tui/terminal-capabilities
 */

export {
  ENABLE_BRACKETED_PASTE,
  DISABLE_BRACKETED_PASTE,
  ESC_TIMEOUT_MS,
  detectBrandRenderTier,
  detectColorSupport,
  detectNotifyCapability,
  notifyBytes,
  sanitizeOscPayload,
  stripControlCharacters,
} from '@deepseek-ai/dsh-tui-render/src/terminal-capabilities.ts'
export type { NotifyTransport } from '@deepseek-ai/dsh-tui-render/src/terminal-capabilities.ts'
export type { ColorTier } from '@deepseek-ai/dsh-tui-render/src/terminal-capabilities.ts'
export type { BrandRenderTier } from '@deepseek-ai/dsh-tui-render/src/terminal-capabilities.ts'
