/**
 * Rebuild the process argv for `/reload` and spawn the replacement `dsh`
 * invocation. TypeScript source is already evaluated, so an in-process plugin
 * refresh cannot pick up TUI edits; a new Node process can.
 * @module @deepseek-ai/dsh-tui/reload-argv
 */

import { constants as osConstants } from 'node:os'

/** `child_process.spawn` plus the Node executable the replacement must reuse. */
export interface RelaunchHost {
  /**
   * Start the replacement process. Production uses `child_process.spawn`;
   * tests inject a fake that never starts Node.
   */
  spawn: (
    command: string,
    args: readonly string[],
    options: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
  ) => {
    on(event: 'error', listener: (error: Error) => void): void
    on(
      event: 'close',
      listener: (code: number | null, signal: NodeJS.Signals | null) => void,
    ): void
  }
  /** `process.execPath` of the current Node. */
  execPath: string
  /** `process.execArgv` (tsx `--import`, inspect flags) forwarded unchanged. */
  execArgv: readonly string[]
  /** Environment inherited by the child. */
  env: NodeJS.ProcessEnv
}

/**
 * Copy launcher flags (`--profile`, `--patch`, …) from `process.argv` by
 * treating `innerArgs` as a suffix, then replace the TUI inner arguments with
 * `--cwd` / `--frame-stats` from the live config and `--resume` for the live
 * session. The original task positional is dropped so the first message is
 * not sent again.
 * @param processArgv - `process.argv` (`[execPath, script, …dshArgs]`).
 * @param innerArgs - `ctx.cmdlineArgs.get()`, the suffix after launcher flags.
 * @param options - live session id and TUI flags to forward.
 * @returns argv for `spawn(execPath, […execArgv, …result])` (`script` plus
 *   rewritten dsh arguments). Empty `processArgv` yields only the inner flags.
 */
export function rebuildReloadArgv(
  processArgv: readonly string[],
  innerArgs: readonly string[],
  options: {
    sessionId: string | undefined
    cwd?: string
    frameStats?: string
  },
): string[] {
  const script = processArgv[1]
  const dshArgv = processArgv.slice(2)
  const launcher = launcherPrefix(dshArgv, innerArgs)
  const inner = innerFlags(options)
  if (script === undefined) return [...launcher, ...inner]
  return [script, ...launcher, ...inner]
}

/**
 * Spawn a replacement Node with inherited stdio and wait until it exits.
 * The caller must unmount the TUI and dispose the live session first so the
 * child can reopen the same session files. The parent stays alive until the
 * child closes; each `/reload` therefore stacks one waiting Node.
 * @param argv - `rebuildReloadArgv` result (`script` plus dsh arguments).
 * @param host - spawn function and Node executable facts.
 * @returns the child's exit code, or `128 + signal` when it died of a signal.
 */
export function relaunchProcess(
  argv: readonly string[],
  host: RelaunchHost,
): Promise<number> {
  const child = host.spawn(host.execPath, [...host.execArgv, ...argv], {
    stdio: 'inherit',
    env: host.env,
  })
  return new Promise((resolve, reject) => {
    let settled = false
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      resolve(exitStatus(code, signal))
    })
  })
}

/**
 * Keep the launcher prefix of `dshArgv` when `inner` is an exact suffix so
 * `--profile` / `--patch` survive. A mismatch keeps none of `dshArgv`: a
 * stale positional must not be replayed as a first message.
 * @param dshArgv - `process.argv.slice(2)`.
 * @param inner - `ctx.cmdlineArgs.get()`.
 * @returns launcher flags only, or `dshArgv` when `inner` is empty.
 */
function launcherPrefix(
  dshArgv: readonly string[],
  inner: readonly string[],
): string[] {
  if (inner.length === 0) return [...dshArgv]
  const start = dshArgv.length - inner.length
  if (start < 0) return []
  for (let i = 0; i < inner.length; i += 1) {
    if (dshArgv[start + i] !== inner[i]) return []
  }
  return dshArgv.slice(0, start)
}

/**
 * TUI flags the replacement process should keep, plus `--resume` for the live
 * session. The original task positional is never forwarded.
 * @param options - live session id and optional `--cwd` / `--frame-stats`.
 * @returns inner argv with no positional task.
 */
function innerFlags(options: {
  sessionId: string | undefined
  cwd?: string
  frameStats?: string
}): string[] {
  const flags: string[] = []
  if (options.cwd !== undefined && options.cwd !== '') {
    flags.push('--cwd', options.cwd)
  }
  if (options.frameStats !== undefined && options.frameStats !== '') {
    flags.push('--frame-stats', options.frameStats)
  }
  if (options.sessionId !== undefined && options.sessionId !== '') {
    flags.push('--resume', options.sessionId)
  }
  return flags
}

/**
 * Map a child `close` payload to an exit code.
 * @param code - the exit code, or `null` when a signal killed the child.
 * @param signal - the killing signal, or `null` when the child exited itself.
 * @returns `code`, `128 + signal number`, or `1` when neither is usable.
 */
function exitStatus(code: number | null, signal: NodeJS.Signals | null): number {
  if (signal !== null) {
    const number = osConstants.signals[signal]
    return typeof number === 'number' ? 128 + number : 1
  }
  return code ?? 1
}
