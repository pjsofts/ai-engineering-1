// repl.ts — Part 3: the loop now has two paths.
//
//     line starts with "/"  →  dispatch()  →  local / render / prompt
//     anything else         →  the model
//
// Note the shape of the code: dispatch() runs BEFORE anything expensive, and
// two of the three command kinds return without touching the network. That is
// the payoff of the taxonomy in commands.ts.
//
// Tab completion is wired to readline's completer — one function, and /he<TAB>
// becomes /help.
//
// Run:  npm run part3
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, Spinner } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";
import { completions, dispatch, type CommandContext } from "./commands.js";

async function main(): Promise<void> {
  banner("Part 3 · slash commands", `model: ${MODEL} — /help for commands`);

  const session = new Session();
  let running = true;

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    // readline's completer contract: return [matches, the text you completed].
    completer: (line: string): [string[], string] =>
      line.startsWith("/") ? [completions(line), line] : [[], line],
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

    // ---- command path ---------------------------------------------------
    let toSend = line;
    const result = dispatch(line, ctx);

    if (result) {
      if (result.type === "unknown") {
        console.log(c.amber(`  /${result.name} is not a command — try /help`));
        continue;
      }
      if (result.type === "handled") {
        if (result.output) console.log(result.output);
        continue;               // no model turn, no tokens, no dollars
      }
      // result.type === "prompt": fall through to the model with expanded text
      toSend = result.text;
      console.log(c.dim(`  ${line}  →  ${toSend.slice(0, 60)}…`));
    }

    // ---- model path -----------------------------------------------------
    const spinner = new Spinner("thinking");
    spinner.start();

    try {
      await session.send(toSend, {
        onFirstToken: () => { spinner.stop(); stdout.write("\n"); },
        onDelta: (text) => stdout.write(text),
      });
      console.log();
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
      session.messages.pop();
    }
  }

  rl.close();
  console.log(c.dim("\n  bye\n"));
}

main().catch((err) => {
  console.error(c.red(String(err)));
  process.exit(1);
});
