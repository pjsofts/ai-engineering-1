// repl.ts — Part 1: the read-eval-print loop.
//
// The whole interface layer of a coding agent is this shape:
//
//     forever:
//       line = await read()        // block on the human
//       result = await eval(line)  // block on the model
//       print(result)
//
// Read, eval, print, loop. That is the R-E-P-L. Everything we add in Parts 2-5
// is about the SECOND await: the model takes seconds, and a program that goes
// silent for seconds feels broken even when it is working perfectly.
//
// Run:  npm run part1
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, Spinner } from "./ui.js";
import { completeTurn, MODEL, SYSTEM_PROMPT, type Msg } from "./model.js";

async function main(): Promise<void> {
  banner("Part 1 · the REPL skeleton", `model: ${MODEL} — Ctrl+D or /exit to quit`);

  // readline gives us line editing, history (up-arrow) and Ctrl+D for free.
  // Note what we did NOT have to build: cursor movement, backspace, kill-line.
  const rl = readline.createInterface({ input: stdin, output: stdout });

  // THE conversation. In Part 1 it is a plain in-memory array — same as Week 1.
  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];

  while (true) {
    // ---- READ ----------------------------------------------------------
    const answer = await ask(rl, c.blue("\n› "));
    if (answer === null) break;              // Ctrl+D
    const line = answer.trim();
    if (!line) continue;
    if (line === "/exit") break;

    messages.push({ role: "user", content: line });

    // ---- EVAL ----------------------------------------------------------
    // This await is the problem. On a real question it is 3-20 seconds of
    // absolutely nothing. The spinner is a lie we tell to make the wait
    // survivable: it proves the process is alive, but it carries no
    // information about the answer. Part 2 replaces the lie with the truth.
    const spinner = new Spinner("thinking");
    spinner.start();
    const t0 = Date.now();

    let reply: string;
    try {
      reply = await completeTurn(messages);
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
      messages.pop(); // don't leave a user turn with no answer after it
      continue;
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    spinner.stop();

    // ---- PRINT ---------------------------------------------------------
    // The entire answer lands in one blocking write. On a long reply this is
    // a wall of text that appears from nowhere.
    console.log(reply);
    console.log(c.dim(`  ${elapsed}s to first and last token`));

    messages.push({ role: "assistant", content: reply });
    // ---- LOOP ----------------------------------------------------------
  }

  rl.close();
  console.log(c.dim("\n  bye\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
