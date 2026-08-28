/**
 * Terminal capability constants and detection: the Phase-1 interface surface
 * for bracketed paste (P9), the ESC disambiguation window (P10), and the
 * three-tier color fallback (P14). Phase 2 wires these into the render loop
 * and the Grok theme token layer.
 * @module @deepseek-ai/dsh-tui/terminal-capabilities
 */

/** Bracket paste enable sequence: pasted text arrives framed, never as keys. */
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h'

/** Disable sequence paired with {@link ENABLE_BRACKETED_PASTE} on teardown. */
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l'

/**
 * ESC disambiguation window in milliseconds. A lone ESC resolves as a key
 * press only after this quiet period; an `\x1b`-prefixed sequence matches
 * immediately. 40ms sits inside the 30–50ms perception-safe band.
 */
export const ESC_TIMEOUT_MS = 40

/** Color capability tiers, weakest last. */
export type ColorTier = 'truecolor' | '256' | '16' | 'none'

/**
 * Detect the strongest supported color tier from environment conventions:
 * COLORTERM=truecolor first, then the 256-color TERM whitelist, then basic
 * ANSI, and NO_COLOR forces none.
 * @param env - environment snapshot to inspect.
 * @returns the strongest supported tier.
 */
export function detectColorSupport(env: NodeJS.ProcessEnv): ColorTier {
  if (env.NO_COLOR !== undefined) return 'none'
  if (env.COLORTERM === 'truecolor') return 'truecolor'
  if (env.TERM?.includes('256color') === true) return '256'
  return '16'
}

/** Generated FishLogo glyph tiers, strongest first. */
export type BrandRenderTier = 'half-block' | 'full-block' | 'ascii' | 'plain'

/**
 * Detect the strongest safe generated-brand glyph tier independently of color.
 * A dumb terminal receives the wordmark, a non-UTF-8 locale receives ASCII,
 * and conservative kernel/vt consoles receive full blocks. Modern UTF-8
 * terminals use the selected half-block contour even under `NO_COLOR`.
 * @param env - terminal and locale environment snapshot.
 * @returns the strongest supported generated-brand tier.
 */
export function detectBrandRenderTier(env: NodeJS.ProcessEnv): BrandRenderTier {
  if (env.TERM === 'dumb') return 'plain'
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG
  if (locale !== undefined && !/(?:utf-?8)/iu.test(locale)) return 'ascii'
  if (env.TERM === 'linux' || env.TERM?.startsWith('vt') === true) return 'full-block'
  return 'half-block'
}

/** Turn-end terminal notification transports, strongest first. */
export type NotifyTransport = 'osc99' | 'osc9' | 'bell'

/**
 * Detect the turn-end desktop-notification transport for one terminal
 * environment. iTerm2 and VTE descendants speak OSC 99; Windows Terminal
 * speaks OSC 9; every other terminal falls back to BEL. The host may
 * additionally launch `notify-send` only for that final branch.
 * @param env - terminal environment snapshot.
 * @returns the strongest supported transport.
 */
export function detectNotifyCapability(env: {
  TERM?: string | undefined
  TERM_PROGRAM?: string | undefined
  ITERM_SESSION_ID?: string | undefined
  WT_SESSION?: string | undefined
  KONSOLE_VERSION?: string | undefined
  VTE_VERSION?: string | undefined
}): NotifyTransport {
  if (env.ITERM_SESSION_ID !== undefined || env.TERM_PROGRAM === 'iTerm.app') return 'osc99'
  if (env.WT_SESSION !== undefined) return 'osc9'
  if (env.KONSOLE_VERSION !== undefined || env.VTE_VERSION !== undefined) return 'osc99'
  return 'bell'
}

/**
 * Return the exact notification bytes for one transport; BEL emits only the
 * bell. OSC payloads are sanitized before entering the sequence: control
 * characters (C0/C1) are stripped and the text is capped, so a failure
 * message can never forge or break the terminator. Omitting the payload keeps
 * the legacy literal for callers that have no summary yet. When the caller
 * supplies the exact session-title suffix it appended to the body, that
 * suffix is matched verbatim against the end of the payload (after control
 * stripping) and preserved by shortening the prefix first — the title is
 * the part that distinguishes the notification across instances, so it
 * survives the cap even when the leading summary has to give way. Matching
 * is exact, so a body that contains its own ` · ` separator before a
 * delimiter-bearing title still preserves the entire trailing suffix.
 * @param transport - detected terminal notification transport.
 * @param payload - summary text carried by the OSC transports; optional.
 * @param titleSuffix - exact ` · {sessionTitle}` suffix to preserve; optional.
 * @returns the control sequence written to the terminal.
 */
export function notifyBytes(transport: NotifyTransport, payload?: string, titleSuffix?: string): string {
  if (transport === 'bell') return '\x07'
  const text = sanitizeOscPayload(payload ?? 'DeepSeek 回合已结束', 80, titleSuffix)
  if (transport === 'osc99') return `\x1b]99;i=1:d=0;${text}\x07`
  return `\x1b]9;${text}\x07`
}

/**
 * Strip C0/C1 control characters from one OSC payload candidate, returning
 * a plain string of Unicode scalar values with no embedded ST/BEL escapes.
 * Shared by {@link sanitizeOscPayload} and the suffix matcher so they walk
 * the same coordinate system — a control character before the suffix must
 * not shift the boundary the sanitizer preserves.
 * @param text - raw payload text (any C0/C1 may appear).
 * @returns the same text with C0 (U+0000..U+001F) and C1 (U+007F..U+009F) dropped.
 */
export function stripControlCharacters(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue
    out += char
  }
  return out
}

/**
 * Strip C0/C1 control characters and cap the length so the payload can
 * neither terminate the OSC sequence early nor flood the desktop banner.
 * Truncation operates on Unicode code points (Unicode scalar values) so
 * supplementary-plane characters never split mid-glyph. When the caller
 * supplies a non-empty `titleSuffix`, that exact string is matched against
 * the end of the sanitized payload and preserved verbatim by shortening the
 * prefix first. Matching is suffix-anchored, not delimiter-search, so a
 * payload whose summary contains its own ` · ` separator before a
 * delimiter-bearing title still preserves the entire trailing suffix.
 * Missing, empty, or non-matching `titleSuffix` triggers an ordinary hard
 * cap on the sanitized text: the longest leading code-point prefix within
 * the limit, with no claim about any literal fallback.
 * @param text - raw summary text.
 * @param limit - maximum number of code points to keep; defaults to 80.
 * @param titleSuffix - exact ` · {sessionTitle}` suffix to preserve; optional.
 * @returns sanitized text, at most `limit` code points long.
 */
export function sanitizeOscPayload(text: string, limit: number = 80, titleSuffix?: string): string {
  const sanitized = stripControlCharacters(text)
  const codePoints = Array.from(sanitized)
  if (codePoints.length <= limit) return sanitized
  if (titleSuffix !== undefined && titleSuffix.length > 0) {
    const suffixCodePoints = Array.from(titleSuffix)
    if (suffixCodePoints.length > 0 && codePoints.length >= suffixCodePoints.length) {
      const start = codePoints.length - suffixCodePoints.length
      let suffixMatches = true
      for (let i = 0; i < suffixCodePoints.length; i++) {
        if (codePoints[start + i] !== suffixCodePoints[i]) {
          suffixMatches = false
          break
        }
      }
      if (suffixMatches) {
        const prefix = codePoints.slice(0, start)
        if (suffixCodePoints.length >= limit) {
          return suffixCodePoints.slice(0, limit).join('')
        }
        return prefix.slice(0, limit - suffixCodePoints.length).concat(suffixCodePoints).join('')
      }
    }
  }
  return codePoints.slice(0, limit).join('')
}
