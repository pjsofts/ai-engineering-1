// repl.ts — Part 4: Ctrl+C means "stop this turn", not "kill my session".
//
// Two states, two meanings — exactly the rule the real Claude Code follows in
// src/hooks/useCancelRequest.ts, where the handler is written as an explicit
// priority list:
//
//   busy  → Ctrl+C cancels the turn in flight. The session survives.
//   idle  → Ctrl+C once warns; twice within 1.5s exits.
//
// The double-press is not a gimmick. Ctrl+C is muscle memory for "make it
// stop", and a program that dies from the reflex you use to stop it is a
// program you learn to be afraid of.
//
// Run:  npm run part4       (then press Ctrl+C while it is answering)
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, Spinner } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";
import { completions, dispatch, type CommandContext } from "./commands.js";

const DOUBLE_PRESS_MS = 1500;

async function main(): Promise<void> {
  banner("Part 4 · safe interrupts", `model: ${MODEL} — Ctrl+C stops a turn, twice to exit`);

  const session = new Session();
  let running = true;
  let lastCtrlC = 0;

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    completer: (line: string): [string[], string] =>
      line.startsWith("/") ? [completions(line), line] : [[], line],
  });

  // readline hands us SIGINT instead of letting the default handler kill the
  // process. Because we registered a listener, Ctrl+C is now OURS to define.
  rl.on("SIGINT", () => {
    // Priority 1: a turn is running. Cancel it and nothing else.
    if (session.interrupt()) return;

    // Priority 2: idle. Require confirmation.
    const now = Date.now();
    if (now - lastCtrlC < DOUBLE_PRESS_MS) {
      console.log(c.dim("\n  bye\n"));
      process.exit(0);
    }
    lastCtrlC = now;
    console.log(c.dim("\n  press Ctrl+C again to exit"));
    rl.prompt();
  });

  const ctx: CommandContext = {
    messages: session.messages,
    quit: () => { running = false; },
  };

  while (running) {
    const answer = await ask(rl, c.blue("\n› "));
    if (answer === null) break;              // Ctrl+D
    const line = answer.trim();
    if (!line) continue;

    let toSend = line;
    const result = dispatch(line, ctx);
    if (result) {
      if (result.type === "unknown") {
        console.log(c.amber(`  /${result.name} is not a command — try /help`));
        continue;
      }
      if (result.type === "handled") {
        if (result.output) console.log(result.output);
        continue;
      }
      toSend = result.text;
      console.log(c.dim(`  ${line}  →  ${toSend.slice(0, 60)}…`));
    }

    const spinner = new Spinner("thinking · Ctrl+C to stop");
    spinner.start();

    try {
      const turn = await session.send(toSend, {
        onFirstToken: () => { spinner.stop(); stdout.write("\n"); },
        onDelta: (text) => stdout.write(text),
      });
      spinner.stop();                        // no-op if already stopped
      console.log();
      if (turn.interrupted) {
        // The partial answer stays on screen AND stays in history. Nothing is
        // rolled back, because the user genuinely read it.
        console.log(c.amber(`  ⨯ interrupted after ${turn.text.length} chars — kept in history`));
      }
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
    }
  }

  rl.close();
  console.log(c.dim("\n  bye\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
