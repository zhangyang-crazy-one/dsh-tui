/**
 * Interactive-terminal guard: refuses to run the terminal surface when the
 * environment cannot display it, and only ever writes plain text on the
 * decline path so piped logs stay control-sequence free.
 * @module @deepseek-ai/dsh-tui/terminal-guard
 */

/** Decline message written to stderr when the environment is not interactive. */
export const NON_INTERACTIVE_MESSAGE =
  'deepseek-tui requires an interactive terminal\n'

/** Minimal process-shaped surface the guard reads. */
export interface TerminalEnvironment {
  isTTY: boolean
  term: string | undefined
}

/** The process environment the guard checks; tests substitute captures. */
export const environment: TerminalEnvironment = {
  isTTY: process.stdout.isTTY,
  term: process.env.TERM,
}

/**
 * Exit the process with a plain-text decline when stdout is not a TTY or the
 * terminal declares itself dumb. The TUI writes control sequences; a pipe, a
 * CI log, or TERM=dumb would only be polluted by them.
 * @param env - environment snapshot to check (defaults to the process).
 * @param stderr - decline sink (defaults to process.stderr).
 * @param exit - exit request (defaults to the process exit).
 */
export function assertInteractiveTerminal(
  env: TerminalEnvironment = environment,
  stderr: { write(chunk: string): unknown } = process.stderr,
  exit: (code: number) => void = code => process.exit(code),
): void {
  if (env.isTTY && env.term !== 'dumb') return
  stderr.write(NON_INTERACTIVE_MESSAGE)
  exit(0)
}
