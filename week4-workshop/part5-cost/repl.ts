// repl.ts — mycode v0.1. The complete Week 4 deliverable.
//
// Everything from Parts 1-4, plus a meter that tells you what you just spent
// before you spend it again. Five parts, ~500 lines, and it feels like a
// product rather than a script:
//
//   read      readline gives us editing, history and tab completion
//   dispatch  local / render commands never reach the network
//   stream    tokens appear as they are generated
//   interrupt Ctrl+C stops the turn, not the session
//   meter     every turn is priced, and the session total is always visible
//
// Run:  npm run part5      (or: npm start)
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, Spinner } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";
import { formatUSD } from "./cost.js";
import { completions, dispatch, type CommandContext } from "./commands.js";

const DOUBLE_PRESS_MS = 1500;

async function main(): Promise<void> {
  banner("v0.1 · the chat interface", `${MODEL} — /help for commands, Ctrl+C to stop a turn`);

  const session = new Session();
  let running = true;
  let lastCtrlC = 0;

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    completer: (line: string): [string[], string] =>
      line.startsWith("/") ? [completions(line), line] : [[], line],
  });

  rl.on("SIGINT", () => {
    if (session.interrupt()) return;                    // Priority 1: cancel
    const now = Date.now();
    if (now - lastCtrlC < DOUBLE_PRESS_MS) {            // Priority 2: confirm
      goodbye();
      process.exit(0);
    }
    lastCtrlC = now;
    console.log(c.dim("\n  press Ctrl+C again to exit"));
    rl.prompt();
  });

  const ctx: CommandContext = {
    messages: session.messages,
    meter: session.meter,
    quit: () => { running = false; },
  };

  function goodbye(): void {
    const m = session.meter;
    console.log();
    console.log(m.turns
      ? c.dim(`  ${m.turns} turn(s) · ${formatUSD(m.totalUSD)} · bye`)
      : c.dim("  bye"));
    console.log();
  }

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
      spinner.stop();
      console.log();

      if (turn.interrupted) {
        console.log(c.amber(`  ⨯ interrupted after ${turn.text.length} chars — kept in history`));
      }
      // The footer. Small, dim, always there. A number you see after every
      // turn is a number you start optimizing.
      console.log(c.dim(
        `  ${turn.ttft}ms · ${(turn.ms / 1000).toFixed(1)}s · ${session.meter.turnLine()}`,
      ));
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
    }
  }

  rl.close();
  goodbye();
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
