/**
 * Copy selected terminal text: OSC 52 first (SSH-safe), then a host clipboard
 * helper when one is available. Writes cap at 100_000 UTF-8 characters so a
 * huge drag cannot stall the frame stream.
 * @module @deepseek-ai/dsh-tui-render/clipboard
 */

import { spawn, type ChildProcess } from 'node:child_process'

/** Spawn used for the host clipboard helper. */
export type SpawnFn = typeof spawn

/** Maximum characters encoded into one OSC 52 payload. */
export const OSC52_MAX_CHARS = 100_000

/** Host clipboard spawn spec, or undefined when OSC 52 is the only path. */
export interface ClipboardSpec {
  /** Executable (`pbcopy`, `wl-copy`, `xclip`, `clip`). */
  command: string
  /** Arguments. */
  args: string[]
}

/**
 * Encode text as OSC 52 clipboard set (primary `c` buffer). Empty input is
 * an empty payload; oversize input is truncated.
 * @param text - selected plain text.
 * @returns the OSC 52 sequence.
 */
export function encodeOsc52(text: string): string {
  const capped = text.length > OSC52_MAX_CHARS ? text.slice(0, OSC52_MAX_CHARS) : text
  return `\x1b]52;c;${Buffer.from(capped, 'utf8').toString('base64')}\x1b\\`
}

/**
 * Pick a host clipboard helper. Darwin uses `pbcopy`, Windows `clip`,
 * Wayland `wl-copy`, X11 `xclip`. Headless Linux without DISPLAY/WAYLAND
 * returns undefined so only OSC 52 runs.
 * @param platform - `process.platform` snapshot.
 * @param env - environment snapshot.
 * @returns the spawn spec, or undefined.
 */
export function hostClipboardCommand(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ClipboardSpec | undefined {
  if (platform === 'darwin') return { command: 'pbcopy', args: [] }
  if (platform === 'win32') return { command: 'clip', args: [] }
  if (env.WAYLAND_DISPLAY !== undefined) return { command: 'wl-copy', args: [] }
  if (env.DISPLAY !== undefined) {
    return { command: 'xclip', args: ['-selection', 'clipboard'] }
  }
  return undefined
}

/**
 * Write OSC 52 to `write` and, when a helper exists, pipe the same text to
 * the host clipboard. Helper spawn failures are swallowed.
 * @param text - selected plain text.
 * @param write - stdout write (OSC 52).
 * @param spawnFn - injectable spawn.
 * @param spec - injectable helper; omit to resolve from the environment;
 *   pass `null` to skip the host helper after OSC 52.
 */
export function copyText(
  text: string,
  write: (chunk: string) => void,
  spawnFn: SpawnFn = spawn,
  spec?: ClipboardSpec | null,
): void {
  if (text === '') return
  write(encodeOsc52(text))
  const helper = spec === undefined ? hostClipboardCommand() : spec === null ? undefined : spec
  if (helper === undefined) return
  try {
    const child: ChildProcess = spawnFn(helper.command, helper.args, {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.on('error', () => {
      // Helper missing: OSC 52 already went out.
    })
    child.stdin?.end(text)
  } catch {
    // spawn threw synchronously: OSC 52 already went out.
  }
}
