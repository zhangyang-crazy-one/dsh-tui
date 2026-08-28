/**
 * OSC 8 hyperlink wrapping and capability detection. Markdown and tool-path
 * titles wrap already-styled text after {@link escapeContent}; unknown
 * terminals and tmux/screen that do not forward hyperlinks stay plain text so
 * a swallowed OSC 8 cannot hide the URL.
 * @module @deepseek-ai/dsh-tui-render/hyperlink
 */

import { execSync } from 'node:child_process'

/** Installed OSC 8 capability; {@link installHyperlinks} sets it at mount. */
let hyperlinks = false

/** tmux probe runner; production uses `execSync`. */
export type TmuxExec = (
  command: string,
  options: {
    encoding: 'utf8'
    timeout: number
    stdio: ['ignore', 'pipe', 'ignore']
  },
) => string

/**
 * Whether the attached tmux client lists `hyperlinks` in
 * `#{client_termfeatures}`. Any spawn or parse failure is `false`.
 * @param exec - injected runner; production uses `node:child_process.execSync`.
 * @returns true only when tmux reports the feature.
 */
export function probeTmuxHyperlinks(
  exec: TmuxExec = execSync,
): boolean {
  try {
    const termfeatures = exec("tmux display-message -p '#{client_termfeatures}'", {
      encoding: 'utf8',
      timeout: 250,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return termfeatures
      .split(',')
      .map(feature => feature.trim())
      .includes('hyperlinks')
  } catch {
    // tmux missing, nested without a client, or a timeout: keep OSC 8 off.
    return false
  }
}

/**
 * Detect OSC 8 support from environment conventions. tmux/screen default off
 * unless the tmux probe confirms forwarding; unknown terminals default off
 * because they swallow OSC 8 and drop the URL from the painted text.
 * @param env - environment snapshot.
 * @param tmuxForwards - tmux probe; production uses {@link probeTmuxHyperlinks}.
 * @returns true when OSC 8 may wrap visible text.
 */
export function detectHyperlinks(
  env: NodeJS.ProcessEnv,
  tmuxForwards: () => boolean = probeTmuxHyperlinks,
): boolean {
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? ''
  const terminalEmulator = env.TERMINAL_EMULATOR?.toLowerCase() ?? ''
  const term = env.TERM?.toLowerCase() ?? ''
  if (env.TMUX !== undefined || term.startsWith('tmux')) return tmuxForwards()
  if (term.startsWith('screen')) return false
  if (env.KITTY_WINDOW_ID !== undefined || termProgram === 'kitty') return true
  if (
    termProgram === 'ghostty'
    || term.includes('ghostty')
    || env.GHOSTTY_RESOURCES_DIR !== undefined
  ) {
    return true
  }
  if (env.WEZTERM_PANE !== undefined || termProgram === 'wezterm') return true
  if (
    termProgram === 'warpterminal'
    || env.WARP_SESSION_ID !== undefined
    || env.WARP_TERMINAL_SESSION_UUID !== undefined
  ) {
    return true
  }
  if (env.ITERM_SESSION_ID !== undefined || termProgram === 'iterm.app') {
    return true
  }
  if (env.WT_SESSION !== undefined) return true
  if (termProgram === 'vscode') return true
  if (termProgram === 'alacritty') return true
  if (terminalEmulator === 'jetbrains-jediterm') return false
  return false
}

/**
 * Detect and install the OSC 8 flag used by later {@link wrapLink}.
 * @param env - environment snapshot.
 * @param tmuxForwards - tmux probe.
 * @returns the installed flag.
 */
export function installHyperlinks(
  env: NodeJS.ProcessEnv,
  tmuxForwards: () => boolean = probeTmuxHyperlinks,
): boolean {
  hyperlinks = detectHyperlinks(env, tmuxForwards)
  return hyperlinks
}

/**
 * The OSC 8 flag installed by {@link installHyperlinks}.
 * @returns true when wrap uses OSC 8.
 */
export function hyperlinksEnabled(): boolean {
  return hyperlinks
}

/**
 * Override the installed OSC 8 flag. Tests pin both paint paths.
 * @param value - next flag.
 */
export function setHyperlinks(value: boolean): void {
  hyperlinks = value
}

/**
 * Whether `href` is safe to emit as OSC 8 or to open: no control bytes, and a
 * supported scheme so a click cannot launch `javascript:` or similar.
 * @param href - markdown or tool href.
 * @returns true when wrapping and opening are allowed.
 */
export function isOsc8Href(href: string): boolean {
  if (href === '') return false
  if (/[\u0000-\u001f\u007f]/.test(href)) return false
  return /^(https?:|mailto:|file:)/i.test(href)
}

/**
 * Wrap already-styled visible text in OSC 8. Callers escape and style first.
 * @param text - styled visible run.
 * @param url - href already accepted by {@link isOsc8Href}.
 * @returns OSC 8 wrapped text.
 */
export function wrapOsc8(text: string, url: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}

/**
 * Fallback when OSC 8 is off: keep the styled text, and append ` (href)` in
 * `urlSuffix` when the visible label differs from the href (mailto: strips
 * the scheme for that comparison).
 * @param visible - unescaped link label.
 * @param href - markdown href.
 * @returns true when the URL must be printed beside the label.
 */
export function linkNeedsUrlSuffix(visible: string, href: string): boolean {
  const comparable = href.startsWith('mailto:') ? href.slice('mailto:'.length) : href
  return visible !== href && visible !== comparable
}

/**
 * Paint a markdown link: OSC 8 when installed and the href is safe, otherwise
 * accent text plus an optional dim ` (href)` so the URL cannot disappear.
 * @param styledText - already styled, escaped label.
 * @param visible - unescaped label for the equality check.
 * @param href - markdown href.
 * @param urlSuffix - already styled ` (href)` run, or empty.
 * @returns parts for {@link paintRow}.
 */
export function wrapLink(
  styledText: string,
  visible: string,
  href: string,
  urlSuffix: string,
): string[] {
  if (hyperlinks && isOsc8Href(href)) return [wrapOsc8(styledText, href)]
  if (urlSuffix !== '' && linkNeedsUrlSuffix(visible, href)) {
    return [styledText, urlSuffix]
  }
  return [styledText]
}
