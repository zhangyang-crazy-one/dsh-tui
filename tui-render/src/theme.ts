/**
 * DeepSeek brand token table and the single styling helper. Every render-path
 * style goes through {@link styled}; content reaches it only after
 * {@link escapeContent}. The three-tier fallback (truecolor → 256 → 16 →
 * none) is owned here, per 02-UI-SPEC §1.1. Soft Slate uses DeepSeek logo
 * blue (`#4D6BFE`) for brand marks and a lighter blue for small text. The runtime installs the
 * detected tier once at mount via {@link installTheme}; every {@link styled}
 * call then maps tokens through that tier, and `none` leaves text unstyled.
 * @module @deepseek-ai/dsh-tui-render/theme
 */

import { displayWidth } from './content.ts'
import { detectColorSupport, type ColorTier } from './terminal-capabilities.ts'

/** Theme token names available to render code. */
export type StyleToken =
  | 'bg'
  | 'messageBg'
  | 'toolBg'
  | 'inputBg'
  | 'codeBg'
  | 'fg'
  | 'fgSoft'
  | 'fgDim'
  | 'accent'
  | 'accentText'
  | 'accentDim'
  | 'success'
  | 'warning'
  | 'error'
  | 'line'
  | 'codeKeyword'
  | 'codeString'
  | 'codeComment'
  | 'codeCommand'
  | 'markdownStrong'
  | 'markdownEmphasis'
  | 'markdownCode'
  | 'markdownLink'

/** Tokens that paint terminal cell backgrounds rather than foreground glyphs. */
export type BackgroundToken = 'bg' | 'messageBg' | 'toolBg' | 'inputBg' | 'codeBg'

/** Concrete colors for one tier. Empty strings at `none` disable styling. */
export interface ThemeTokens {
  bg: string
  messageBg: string
  toolBg: string
  inputBg: string
  codeBg: string
  fg: string
  fgSoft: string
  fgDim: string
  accent: string
  accentText: string
  accentDim: string
  success: string
  warning: string
  error: string
  line: string
  codeKeyword: string
  codeString: string
  codeComment: string
  codeCommand: string
  markdownStrong: string
  markdownEmphasis: string
  markdownCode: string
  markdownLink: string
}

/** Per-tier token tables, per 02-UI-SPEC §1.1. */
export const THEME_LEVELS: Readonly<Record<ColorTier, ThemeTokens>> = {
  truecolor: {
    bg: '#151618',
    messageBg: '#25282C',
    toolBg: '#1A1C1F',
    inputBg: '#23262B',
    codeBg: '#202328',
    fg: '#EEF0F2',
    fgSoft: '#D1D4D8',
    fgDim: '#A4A9B0',
    accent: '#4D6BFE',
    accentText: '#7589FF',
    accentDim: '#34415B',
    success: '#75B984',
    warning: '#D5AE6B',
    error: '#E27D77',
    line: '#3A3E44',
    codeKeyword: '#7EB6FF',
    codeString: '#B9A4E8',
    codeComment: '#A4A9B0',
    codeCommand: '#75B984',
    markdownStrong: '#E4C58A',
    markdownEmphasis: '#C4AEF2',
    markdownCode: '#9BC9B1',
    markdownLink: '#80C7D9',
  },
  '256': {
    bg: '233',
    messageBg: '235',
    toolBg: '234',
    inputBg: '235',
    codeBg: '235',
    fg: '255',
    fgSoft: '252',
    fgDim: '248',
    accent: '69',
    accentText: '105',
    accentDim: '60',
    success: '108',
    warning: '179',
    error: '174',
    line: '240',
    codeKeyword: '111',
    codeString: '141',
    codeComment: '248',
    codeCommand: '108',
    markdownStrong: '223',
    markdownEmphasis: '183',
    markdownCode: '151',
    markdownLink: '116',
  },
  '16': {
    bg: 'black',
    messageBg: 'black',
    toolBg: 'black',
    inputBg: 'bright-black',
    codeBg: 'black',
    fg: 'white',
    fgSoft: 'white',
    fgDim: 'white',
    accent: 'bright-blue',
    accentText: 'bright-blue',
    accentDim: 'blue',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    line: 'bright-black',
    codeKeyword: 'cyan',
    codeString: 'magenta',
    codeComment: 'bright-black',
    codeCommand: 'green',
    markdownStrong: 'bright-yellow',
    markdownEmphasis: 'bright-magenta',
    markdownCode: 'bright-green',
    markdownLink: 'bright-cyan',
  },
  none: {
    bg: '',
    messageBg: '',
    toolBg: '',
    inputBg: '',
    codeBg: '',
    fg: '',
    fgSoft: '',
    fgDim: '',
    accent: '',
    accentText: '',
    accentDim: '',
    success: '',
    warning: '',
    error: '',
    line: '',
    codeKeyword: '',
    codeString: '',
    codeComment: '',
    codeCommand: '',
    markdownStrong: '',
    markdownEmphasis: '',
    markdownCode: '',
    markdownLink: '',
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

/** Bounded cache for identical full-row background padding strings. */
const BACKGROUND_PADDING_CACHE_LIMIT = 256
const backgroundPaddingCache = new Map<string, string>()

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
 * foreground styles except the five surface tokens, which are backgrounds.
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
  const background = BACKGROUND_TOKENS.has(token)
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
 * Map one theme token to Ink's color-property vocabulary. Ink accepts hex,
 * named ANSI colors, and `ansi256(n)` rather than this package's numeric
 * 256-color storage form. Empty NO_COLOR values remain absent properties.
 * @param token - theme token used by an Ink color or backgroundColor prop.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns an Ink color value, or undefined at the none tier.
 */
export function inkColor(
  token: StyleToken,
  tier: ColorTier = activeTier,
): string | undefined {
  const value = THEME_LEVELS[tier][token]
  if (value === '') return undefined
  return /^\d+$/u.test(value) ? `ansi256(${value})` : value
}

/**
 * Wrap escaped text in the paired sequence for one theme token. Inline
 * Markdown code includes its codeBg surface in every row-painting path.
 * A single reset closes the foreground, background, and optional weight.
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
  const surface = token === 'markdownCode' ? tokenSequence('codeBg', tier) : ''
  return `${surface}${bold ? '\x1b[1m' : ''}${sequence}${text}\x1b[0m`
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

/**
 * Paint a complete layout row through one background token. Each part reopens
 * the background after its own SGR reset; explicit background cells cover the
 * remaining measured width because Ink may omit a Box's trailing spaces.
 * @param parts - escaped and optionally foreground-styled row segments.
 * @param background - background token shared with the owning Ink Box.
 * @param columns - measured width of the owning full-width Ink Box.
 * @param tier - tier to map at (defaults to the installed tier).
 * @returns background-painted row content and remaining cells.
 */
export function paintBackgroundRow(
  parts: readonly string[],
  background: BackgroundToken,
  columns: number,
  tier: ColorTier = activeTier,
): string {
  const content = parts.map(part => styled(part, background, tier)).join('')
  const padding = Math.max(0, columns - displayWidth(parts.join('')))
  if (padding === 0 || tokenSequence(background, tier) === '') return content
  const cacheKey = `${tier}:${background}:${String(padding)}`
  const cached = backgroundPaddingCache.get(cacheKey)
  if (cached !== undefined) {
    backgroundPaddingCache.delete(cacheKey)
    backgroundPaddingCache.set(cacheKey, cached)
    return `${content}${cached}`
  }
  const paintedPadding = styled(' '.repeat(padding), background, tier)
  backgroundPaddingCache.set(cacheKey, paintedPadding)
  if (backgroundPaddingCache.size > BACKGROUND_PADDING_CACHE_LIMIT) {
    const oldest = backgroundPaddingCache.keys().next().value
    if (oldest !== undefined) backgroundPaddingCache.delete(oldest)
  }
  return `${content}${paintedPadding}`
}

/** Closed background-token set used by the ANSI mapper. */
const BACKGROUND_TOKENS: ReadonlySet<StyleToken> = new Set<StyleToken>([
  'bg',
  'messageBg',
  'toolBg',
  'inputBg',
  'codeBg',
])
