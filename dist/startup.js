// tui/src/startup.ts
import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
var name = "tui-startup";
var inject = ["cmdlineArgs"];
var TUI_STARTUP_SERVICE = "tuiStartup";
function tuiCommand() {
  return new Command().name("dsh --profile deepseek-tui").description(
    "Boot the interactive deepseek-tui terminal loop; an optional task positional seeds the first message."
  ).helpOption("-h, --help", "show this help").argument("[task...]", "an optional first-message seed; multiple words are joined by spaces").option("--model <id>", "model id override").option("--resume <id>", "resume the session with this id").option("--cwd <dir>", "working directory override").option(
    "--frame-stats <path>",
    "write per-commit render-cost JSON to this path on orderly exit"
  ).addHelpText(
    "after",
    `
Examples:
  dsh --profile deepseek-tui                  open the interactive loop idle
  dsh --profile deepseek-tui "\u8BF4 hi"          seed the first message, then keep the loop open
  dsh --profile deepseek-tui --resume <id>    resume an earlier session (loads history idle)
  dsh --profile deepseek-tui --model <id>     override startup model
`
  );
}
function parseTuiArgs(argv) {
  const program = tuiCommand();
  program.exitOverride();
  program.allowExcessArguments();
  const opts = program.parse(argv, { from: "user" }).opts();
  const values = { task: program.args.join(" ").trim() };
  if (opts.model !== void 0) values.model = opts.model;
  if (opts.resume !== void 0) values.resume = opts.resume;
  if (opts.cwd !== void 0) values.cwd = opts.cwd;
  if (opts.frameStats !== void 0) values.frameStats = opts.frameStats;
  return values;
}
function apply(ctx) {
  const program = tuiCommand();
  program.action(() => {
    const options = program.opts();
    const values = { task: program.args.join(" ").trim() };
    if (options.model !== void 0) values.model = options.model;
    if (options.resume !== void 0) values.resume = options.resume;
    if (options.cwd !== void 0) values.cwd = options.cwd;
    if (options.frameStats !== void 0) values.frameStats = options.frameStats;
    ctx.provide(TUI_STARTUP_SERVICE, values);
  });
  parseCmdline(ctx, program);
}
export {
  TUI_STARTUP_SERVICE,
  apply,
  inject,
  name,
  parseTuiArgs
};
