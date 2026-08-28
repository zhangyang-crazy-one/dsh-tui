/**
 * Open an OSC 8 href with the host default handler. Only http(s), mailto, and
 * file URLs are spawned; other schemes are ignored.
 * @module @deepseek-ai/dsh-tui-render/open-url
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { isOsc8Href } from './hyperlink.ts'

/** Spawn used to launch the platform opener. */
export type SpawnFn = typeof spawn

/** Command and argv for one platform opener. */
export interface OpenerSpec {
  /** Executable. */
  command: string
  /** Arguments, including the href as the last element on POSIX. */
  args: string[]
}

/**
 * Resolve the host opener. Darwin uses `open`, Windows `cmd /c start`,
 * elsewhere `xdg-open`.
 * @param platform - `process.platform` snapshot.
 * @param href - already-validated href.
 * @returns the spawn spec.
 */
export function openerSpec(platform: NodeJS.Platform, href: string): OpenerSpec {
  if (platform === 'darwin') return { command: 'open', args: [href] }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', href] }
  return { command: 'xdg-open', args: [href] }
}

/**
 * Spawn the host opener detached. Spawn or child errors are swallowed: a
 * missing opener must not tear down the TUI.
 * @param href - candidate href.
 * @param spawnFn - injectable spawn.
 * @param platform - injectable platform.
 */
export function openUrl(
  href: string,
  spawnFn: SpawnFn = spawn,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!isOsc8Href(href)) return
  const spec = openerSpec(platform, href)
  try {
    const child: ChildProcess = spawnFn(spec.command, spec.args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {
      // Missing opener or EACCES: the click is best-effort.
    })
    child.unref()
  } catch {
    // spawn threw synchronously (invalid argv on a stub): ignore.
  }
}
