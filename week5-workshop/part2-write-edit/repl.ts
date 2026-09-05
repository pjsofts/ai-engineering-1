// repl.ts — Part 2: the agent can change files.
//
// Unchanged from Part 1 — which is the interesting part. Two new tools appeared
// and the interface did not have to know. It draws whatever the session reports.
//
// What HAS changed is the stakes: this program now edits files in whatever
// directory you start it in, with no approval step. `npm run part2` therefore
// runs it inside `sandbox/`, a throwaway copy of `fixture/`. Do not point this
// part at code you care about — Part 4 is where it becomes safe to.
//
// Run:  npm run part2
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, resultLine, Spinner, toolLine } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";
import { formatUSD } from "./cost.js";

async function main(): Promise<void> {
  banner("v0.2 · part 2 — it can write now", `${MODEL} — read · write · edit · glob · grep`);
  console.log(c.dim(`  cwd: ${process.cwd()}\n`));

  const session = new Session();
  const rl = readline.createInterface({ input: stdin, output: stdout });

  rl.on("SIGINT", () => {
    if (session.interrupt()) return;
    console.log(c.dim("\n  bye\n"));
    process.exit(0);
  });

  while (true) {
    const answer = await ask(rl, c.blue("\n› "));
    if (answer === null) break;
    const line = answer.trim();
    if (!line) continue;
    if (line === "/exit") break;

    const spinner = new Spinner("thinking · Ctrl+C to stop");
    spinner.start();

    // A tool receipt has two halves and they are printed at two different
    // times: the call before it runs, the result after. Between them the
    // spinner keeps turning, which is how the user can tell the difference
    // between a slow grep and a hung program.
    const starts = new Map<string, number>();

    try {
      const turn = await session.send(line, {
        onFirstToken: () => { spinner.stop(); stdout.write("\n"); },
        onDelta: (text) => stdout.write(text),
        onToolStart: (call) => {
          spinner.stop();
          console.log(toolLine(call.name, call.args));
          starts.set(call.id, Date.now());
          spinner.setLabel(`${call.name}…`);
          spinner.start();
        },
        onToolEnd: (run) => {
          spinner.stop();
          console.log(resultLine(run.result, run.ms));
          spinner.setLabel("thinking · Ctrl+C to stop");
          spinner.start();
        },
      });
      spinner.stop();
      console.log();

      if (turn.interrupted) console.log(c.amber("  ⨯ interrupted — partial work kept in history"));
      console.log(c.dim(
        `  ${turn.steps} step(s) · ${turn.tools.length} tool call(s) · ` +
        `${(turn.ms / 1000).toFixed(1)}s · ${session.meter.turnLine()}`,
      ));
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
    }
  }

  rl.close();
  console.log(c.dim(`\n  ${session.meter.turns} turn(s) · ${formatUSD(session.meter.totalUSD)} · bye\n`));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
