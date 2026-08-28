/**
 * The deepseek-tui command-line provider: it parses the optional task seed,
 * `--resume`, `--cwd`, `--frame-stats`, and `--help`, then publishes
 * {@link TUI_STARTUP_SERVICE}. The runtime driver is an ordinary consumer
 * whose lazy config waits for that service.
 * @module @deepseek-ai/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the terminal driver. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the driver row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** The task text this invocation asked for. */
  task: string
  /** Session id to resume, when `--resume <id>` was given. */
  resume?: string
  /** Working directory override, when `--cwd <dir>` was given. */
  cwd?: string
  /** Frame-stats JSON output path, when `--frame-stats <path>` was given. */
  frameStats?: string
}

/**
 * This app's command: the optional task seed plus terminal-surface options.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile deepseek-tui')
    .description(
      'Boot the interactive deepseek-tui terminal loop; an optional task positional seeds the first message.',
    )
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'an optional first-message seed; multiple words are joined by spaces')
    .option('--resume <id>', 'resume the session with this id')
    .option('--cwd <dir>', 'working directory override')
    .option(
      '--frame-stats <path>',
      'write per-commit render-cost JSON to this path on orderly exit',
    )
    .addHelpText(
      'after',
      `
Examples:
  dsh --profile deepseek-tui                  open the interactive loop idle
  dsh --profile deepseek-tui "说 hi"          seed the first message, then keep the loop open
  dsh --profile deepseek-tui --resume <id>    resume an earlier session (loads history idle)
`,
    )
}

/**
 * Parse raw argv into the startup values the command publishes.
 * @param argv - raw command-line arguments (without node and script).
 * @returns the resolved task plus the `--resume`, `--cwd`, and `--frame-stats`
 *   values; `task` is empty for a missing or whitespace-only positional, which
 *   boots the loop idle (the runtime sends no initial message).
 */
export function parseTuiArgs(argv: string[]): TuiStartupValues {
  const program = tuiCommand()
  program.exitOverride()
  program.allowExcessArguments()
  const opts = program
    .parse(argv, { from: 'user' })
    .opts<{ resume?: string; cwd?: string; frameStats?: string }>()
  const values: TuiStartupValues = { task: program.args.join(' ').trim() }
  if (opts.resume !== undefined) values.resume = opts.resume
  if (opts.cwd !== undefined) values.cwd = opts.cwd
  if (opts.frameStats !== undefined) values.frameStats = opts.frameStats
  return values
}

/**
 * Parse and provide the task values as an ordinary Cordis service. The
 * command's action publishes the optional task seed and the `--resume`,
 * `--cwd`, and `--frame-stats` options it was given; a missing or
 * whitespace-only task publishes an empty seed so the profile boots the loop
 * idle. `--help` provides nothing, leaving dependent rows pending.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{ resume?: string; cwd?: string; frameStats?: string }>()
    const values: TuiStartupValues = { task: program.args.join(' ').trim() }
    if (options.resume !== undefined) values.resume = options.resume
    if (options.cwd !== undefined) values.cwd = options.cwd
    if (options.frameStats !== undefined) values.frameStats = options.frameStats
    ctx.provide(TUI_STARTUP_SERVICE, values)
  })
  parseCmdline(ctx, program)
}
