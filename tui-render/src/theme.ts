/**
 * DeepSeek brand token table and the single styling helper. Every render-path
 * style goes through {@link styled}; content reaches it only after
 * {@link escapeContent}. The three-tier fallback (truecolor → 256 → 16 →
 * none) is owned here, per 02-UI-SPEC §1.1. Accent is DeepSeek logo blue
 * (`#4D6BFE`), not Grok/Tailwind `#3B82F6`. The runtime installs the
 * detected tier once at mount via {@link installTheme}; every {@link styled}
 * call then maps tokens through that tier, and `none` leaves text unstyled.
 * @module @deepseek-ai/dsh-tui-render/theme
 */

import { detectColorSupport, type ColorTier } from './terminal-capabilities.ts'

/** Theme token names available to render code. */
export type StyleToken =
  | 'bg'
  | 'fg'
  | 'fgDim'
  | 'accent'
  | 'accentDim'
  | 'success'
  | 'error'
  | 'codeBg'

/** Concrete colors for one tier. Empty strings at `none` disable styling. */
export interface ThemeTokens {
  bg: string
  fg: string
  fgDim: string
  accent: string
  accentDim: string
  success: string
  error: string
  codeBg: string
}

/** Per-tier token tables, per 02-UI-SPEC §1.1. */
export const THEME_LEVELS: Readonly<Record<ColorTier, ThemeTokens>> = {
  truecolor: {
    bg: '#000000',
    fg: '#F7F7F8',
    fgDim: '#8A8F98',
    accent: '#4D6BFE',
    accentDim: '#34415B',
    success: '#22C55E',
    error: '#EF4444',
    codeBg: '#0F1115',
  },
  '256': {
    bg: '16',
    fg: '255',
    fgDim: '245',
    accent: '69',
    accentDim: '60',
    success: '40',
    error: '196',
    codeBg: '233',
  },
  '16': {
    bg: 'black',
    fg: 'white',
    fgDim: 'bright-black',
    accent: 'bright-blue',
    accentDim: 'blue',
    success: 'green',
    error: 'red',
    codeBg: 'black',
  },
  none: {
    bg: '',
    fg: '',
    fgDim: '',
    accent: '',
    accentDim: '',
    success: '',
    error: '',
    codeBg: '',
  },
}

/** ANSI color names → SGR codes at the 16 tier; background = foreground + 10. */
const ANSI_16: Readonly<Record<string, number>> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  'bright-black': 90,
  'bright-red': 91,
  'bright-green': 92,
  'bright-yellow': 93,
  'bright-blue': 94,
  'bright-magenta': 95,
  'bright-cyan': 96,
  'bright-white': 97,
}

/** The active tier; {@link styled} styles against it. Tests may swap. */
let activeTier: ColorTier = 'truecolor'

/**
 * Install the color tier detected at startup; every later {@link styled}
 * call maps tokens through this tier's table.
 * @param tier - detected color tier.
 */
export function applyTheme(tier: ColorTier): void {
  activeTier = tier
}

/**
 * Return the tier installed by {@link applyTheme}.
 * @returns the active color tier.
 */
export function currentTier(): ColorTier {
  return activeTier
}

/**
 * Detect the color tier from an environment snapshot and install it as the
 * active tier. The mount path calls this once before the first render; tests
 * pass explicit snapshots so the installed tier stays deterministic.
 * @param env - environment snapshot to detect against.
 * @returns the installed tier.
 */
export function installTheme(env: NodeJS.ProcessEnv): ColorTier {
  const tier = detectColorSupport(env)
  applyTheme(tier)
  return tier
}

/**
 * Map one token to its terminal sequence at the active tier. truecolor
 * values use 38;2/48;2 form; 256 values use 38;5/48;5; 16 values map the
 * ANSI name to its SGR code (background = foreground + 10). Tokens are
 * foreground styles except `bg`/`codeBg`, which are background styles.
 * @param token - theme token.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns the SGR sequence prefix, or '' at `none`.
 */
function tokenSequence(
  token: StyleToken,
  tier: ColorTier = activeTier,
): string {
  const value = THEME_LEVELS[tier][token]
  if (value === '') return ''
  const background = token === 'bg' || token === 'codeBg'
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `\x1b[${background ? '48' : '38'};2;${r};${g};${b}m`
  }
  if (/^\d+$/.test(value)) {
    return `\x1b[${background ? '48' : '38'};5;${value}m`
  }
  const code = ANSI_16[value]
  if (code === undefined) {
    throw new Error(`theme: unknown 16-color value "${value}" for ${token}`)
  }
  return `\x1b[${background ? code + 10 : code}m`
}

/**
 * SGR sequence that activates the `bg` token at a tier, without any reset
 * pairing. Frame-level plumbing (frame-fill.ts) needs the bare activator to
 * set the terminal's current background before erase sequences; content
 * styling keeps using {@link styled}.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns the bare bg SGR sequence, or '' at `none`.
 */
export function bgSequence(tier: ColorTier = activeTier): string {
  return tokenSequence('bg', tier)
}

/**
 * Wrap escaped plain text in the paired sequence for one theme token. The
 * optional bold flag is the strong tier of the accent brightness matrix
 * (PITFALLS C3: gradient → bold/普通/dim 三档): it prepends SGR 1 so
 * {@link paintRow} rows and standalone markers can carry a bold accent run
 * without adding a second reset (a single `\x1b[0m` closes both).
 * @param text - escaped plain text.
 * @param token - theme token to style with.
 * @param tier - tier to map at (defaults to the installed tier).
 * @param bold - when true, prepend SGR 1 (bold) to the token sequence.
 * @returns the styled text; the plain text itself at `none`.
 */
export function styled(
  text: string,
  token: StyleToken,
  tier: ColorTier = activeTier,
  bold = false,
): string {
  const sequence = tokenSequence(token, tier)
  if (sequence === '') return text
  return `${bold ? '\x1b[1m' : ''}${sequence}${text}\x1b[0m`
}

/**
 * Compose one fully painted terminal row from styled parts. Every part is
 * wrapped in the bg token separately so the strip survives each part's own
 * SGR reset: a single outer wrap lets an inner `\x1b[0m` (e.g. the end of a
 * bold or codeBg run) leak the background for the rest of the line, while
 * per-part wrapping keeps the strip alive across bold/fg resets — Ink merges
 * the repeated bg prefix into one leading set with a single trailing reset.
 * @param parts - escaped, {@link styled}-styled row segments, in order.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns the fully painted row; the joined parts at `none`.
 */
export function paintRow(
  parts: readonly string[],
  tier: ColorTier = activeTier,
): string {
  return parts.map(part => styled(part, 'bg', tier)).join('')
}
