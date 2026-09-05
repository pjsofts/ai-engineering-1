// repl.ts — Part 4: nothing happens without your say-so.
//
// The first change to this file since Part 1, and it is one handler: `approve`.
//
// The session does not know what a terminal is, so it cannot ask a question. It
// hands the question OUT — to whatever interface is driving it — and waits on
// the promise. Here that is readline; in ../../week5-gui/ it is a dialog box and
// an HTTP round-trip. Same session, same gate, two completely different ways of
// saying yes.
//
// Run:  npm run part4
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, askApproval, banner, c, resultLine, Spinner, toolLine } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";
import { formatUSD } from "./cost.js";

async function main(): Promise<void> {
  banner("v0.2 · part 4 — the permission gate", `${MODEL} — read-only runs free · writes and shell ask`);
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
        // The session blocks on this promise. The spinner has to come down
        // first, or it will keep repainting over the question.
        approve: async (req) => {
          spinner.stop();
          const answer = await askApproval(rl, req);
          if (answer === "always") console.log(c.dim(`  remembered — ${req.name} will not ask again this session`));
          spinner.start();
          return answer;
        },
        onToolEnd: (run) => {
          spinner.stop();
          // The tag is the audit trail: "read-only" and "allowlisted: npm" mean
          // nobody was asked, and the user is entitled to see that.
          console.log(resultLine(run.result, run.ms, run.decision === "allow" ? run.why : run.decision));
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
