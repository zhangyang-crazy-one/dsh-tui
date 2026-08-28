/**
 * Signal semantics for the terminal surface: the single table that maps OS
 * signals to TUI actions, plus the multi-path exit hook that guarantees the
 * terminal is restored (or the process exits) on every teardown route. A
 * claiming surface installs these hooks first and then releases the
 * launcher's generic SIGINT/SIGTERM handlers in the same synchronous block
 * (through `ctx.releaseSignals`), so one owner sees every signal.
 * @module @deepseek-ai/dsh-tui/signal-semantics
 */

/** TUI action for one OS signal. */
export type SignalAction = 'stop-generation' | 'confirm-exit' | 'exit'

/** The signal → action table. Raw mode remaps Ctrl+C away from SIGINT death. */
export const SIGNAL_TABLE: Readonly<Record<string, SignalAction>> = {
  /** First Ctrl+C stops the current generation; a second one confirms exit. */
  SIGINT: 'stop-generation',
  /** Termination requests always exit. */
  SIGTERM: 'exit',
  /** Terminal close always exits. */
  SIGHUP: 'exit',
}

/** All signals the surface listens to. */
export const TRACKED_SIGNALS = Object.keys(SIGNAL_TABLE) as readonly string[]

/**
 * Install the multi-path exit hooks: every tracked signal, the process exit
 * event, and the uncaught-exception route all funnel into one `cleanup`
 * callback. Future terminal restoration (alt screen, raw mode, cursor) hangs
 * on this same hook.
 * @param cleanup - the single teardown path shared by every exit route.
 * @returns a disposer that removes every listener.
 */
export function installSignalHooks(cleanup: (signal: string) => void): () => void {
  const listeners = new Map<string, () => void>()
  for (const signal of TRACKED_SIGNALS) {
    const listener = () => {
      cleanup(signal)
    }
    listeners.set(signal, listener)
    process.on(signal, listener)
  }
  const onExit = () => {
    cleanup('exit')
  }
  const onException = () => {
    cleanup('uncaughtException')
  }
  process.on('exit', onExit)
  process.on('uncaughtException', onException)
  return () => {
    for (const [signal, listener] of listeners) process.off(signal, listener)
    process.off('exit', onExit)
    process.off('uncaughtException', onException)
  }
}
