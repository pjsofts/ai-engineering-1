// repl.ts — mycode v0.2. The complete Week 5 deliverable.
//
// Everything from Week 4 (readline, slash commands, streaming, Ctrl+C, the cost
// meter) plus everything from Parts 1-4 of this week:
//
//   six tools    read · write · edit · bash · glob · grep
//   guards       read-before-edit, staleness, exact and unique match
//   the loop     model → tools → results → model, with a step limit
//   the gate     allow / ask / deny, and "always" that is remembered
//
// It is still the case that this file draws and session.ts thinks. The proof is
// one directory over: ../../week5-gui/ imports session.ts unmodified — including
// the permission gate, which becomes a dialog box instead of a y/a/N prompt.
//
// Run:  npm run part5      (from the workshop root; it starts inside sandbox/)
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, askApproval, banner, c, resultLine, Spinner, toolLine } from "./ui.js";
import { MODEL } from "./model.js";
import { MAX_STEPS, Session } from "./session.js";
import { formatUSD } from "./cost.js";
import { completions, dispatch, type CommandContext } from "./commands.js";

const DOUBLE_PRESS_MS = 1500;

async function main(): Promise<void> {
  banner("v0.2 · a coding agent", `${MODEL} — /help for commands, Ctrl+C to stop a turn`);
  console.log(`  ${c.dim("working in")} ${c.bold(process.cwd())}`);
  console.log(`  ${c.dim("read-only tools run free · writes and shell ask first")}\n`);

  const session = new Session();
  let running = true;
  let lastCtrlC = 0;

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    completer: (line: string): [string[], string] =>
      line.startsWith("/") ? [completions(line), line] : [[], line],
  });

  // Ctrl+C has three meanings in priority order, exactly as in Week 4: cancel
  // the turn, then confirm exit, then exit. An agent turn is long and expensive,
  // so the first press must always be "stop what you are doing".
  rl.on("SIGINT", () => {
    if (session.interrupt()) return;
    const now = Date.now();
    if (now - lastCtrlC < DOUBLE_PRESS_MS) {
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
    allowlist: session.allowlist,
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
    if (answer === null) break;                      // Ctrl+D
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

        // A tool receipt is printed in two halves at two different times: the
        // call before it runs, the result after. Between them the spinner keeps
        // moving, which is how a user tells a slow grep from a hung program.
        onToolStart: (call) => {
          spinner.stop();
          console.log(toolLine(call.name, call.args));
          spinner.setLabel(`${call.name}…`);
          spinner.start();
        },

        // The session blocks on this promise, and so does the agent. Take the
        // spinner down first or it repaints over the question.
        approve: async (req) => {
          spinner.stop();
          const choice = await askApproval(rl, req);
          if (choice === "always") {
            console.log(c.dim(`  remembered — /allowed to see it, /revoke to undo`));
          }
          spinner.start();
          return choice;
        },

        onToolEnd: (run) => {
          spinner.stop();
          // The tag is the audit trail: "read-only" and "allowlisted: npm"
          // both mean nobody was asked, and the user is entitled to see that.
          console.log(resultLine(run.result, run.ms, run.decision === "allow" ? run.why : run.decision));
          spinner.setLabel("thinking · Ctrl+C to stop");
          spinner.start();
        },
      });
      spinner.stop();
      console.log();

      if (turn.interrupted) {
        console.log(c.amber("  ⨯ interrupted — partial work is kept in history"));
      }
      if (turn.hitStepLimit) {
        console.log(c.amber(
          `  ⨯ stopped at the ${MAX_STEPS}-step limit. It was still working — ` +
          `say "continue" if that was wrong, or give it a narrower task.`,
        ));
      }
      console.log(c.dim(
        `  ${turn.steps} step(s) · ${turn.tools.length} tool call(s) · ` +
        `${turn.ttft}ms · ${(turn.ms / 1000).toFixed(1)}s · ${session.meter.turnLine()}`,
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
