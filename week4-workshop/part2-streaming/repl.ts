// repl.ts — Part 2: the same loop, but the answer arrives as it is written.
//
// Two numbers matter now, not one:
//   TTFT  — time to first token. How long until the screen changes. This is
//           the number the user actually feels.
//   total — time to the last token. Barely changed from Part 1.
//
// Streaming does not make the model faster. It makes the WAIT shorter, which
// is a completely different thing and the only one users perceive.
//
// Run:  npm run part2
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, Spinner } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";

async function main(): Promise<void> {
  banner("Part 2 · streaming output", `model: ${MODEL} — Ctrl+D or /exit to quit`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const session = new Session();

  while (true) {
    const answer = await ask(rl, c.blue("\n› "));
    if (answer === null) break;              // Ctrl+D
    const line = answer.trim();
    if (!line) continue;
    if (line === "/exit") break;

    const spinner = new Spinner("thinking");
    spinner.start();
    const t0 = Date.now();
    let ttft = 0;

    try {
      await session.send(line, {
        // The first token is the handover: the spinner has done its job and
        // must get off the screen before any real text is printed, or the two
        // will fight over the same line.
        onFirstToken: (ms) => {
          ttft = ms;
          spinner.stop();
          stdout.write("\n");
        },
        // Raw write, not console.log — console.log appends a newline, which
        // would break every word onto its own line.
        onDelta: (text) => stdout.write(text),
      });
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
      session.messages.pop();
      continue;
    }

    const total = ((Date.now() - t0) / 1000).toFixed(1);
    console.log();
    console.log(c.dim(`  first token ${ttft}ms · complete ${total}s`));
  }

  rl.close();
  console.log(c.dim("\n  bye\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
