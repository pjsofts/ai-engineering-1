# Build `mycode` from an empty folder

**Week 4 — the chat interface.**

This is the hands-on version of `PRESENTATION.md`. You start with nothing and end
with `mycode v0.1`: a terminal coding assistant that streams, takes slash
commands, survives Ctrl+C, and tells you what it just cost.

Five steps. Each one is small — a file or two — and each one **runs**. If a step
does not run, do not go on to the next one.

> **How this maps to the repo.** In `week4-workshop/` each part is its own folder
> (`part1-repl/` … `part5-cost/`) so you can diff them. Here you build **one
> folder** that changes over time, which is how you would actually write it. The
> code is identical. If you get stuck, `part<N>-*/` is the answer key for step N.

---

## What we are building, in one picture

```
       ┌──────────────────────────────┐
  you →│ repl.ts     read · print     │  ← knows about the terminal
       │ ui.ts       colours, spinner │
       │ commands.ts /help, /cost     │
       ├──────────────────────────────┤
       │ session.ts  the conversation │  ← knows NOTHING about the terminal
       │ model.ts    the API call     │
       │ cost.ts     the meter        │
       └──────────────────────────────┘
                                    ↓ OpenAI
```

The line in the middle is the point of the week. Everything above it draws
pixels; everything below it is the agent. Week 4's GUI (`week4-gui/`) imports
`session.ts` **unchanged** and renders it in a browser. That is the proof the
line is real.

---

## Step 0 — the empty folder

```bash
mkdir mycode && cd mycode
npm init -y
npm install openai
npm install -D typescript tsx @types/node
```

Four files, no source code yet.

**`package.json`** — replace the generated one:

```json
{
  "name": "mycode",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx --env-file=.env repl.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "openai": "^4.77.0" },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

Three things to notice:

- `"type": "module"` — we write ESM. That is why every local import below ends
  in `.js` even though the file on disk is `.ts`. You are importing the
  *compiled* name. Get this wrong and you will fight the resolver all evening.
- `tsx` runs TypeScript directly. No build step, no `dist/`.
- `--env-file=.env` is Node's own flag (18.20+/20.6+). **No `dotenv` package.**

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

**`.env`** — your key. `OPENAI_API_KEY` is the name the SDK reads by itself;
you never pass it in code.

```
OPENAI_API_KEY=sk-...
MODEL=gpt-4o-mini
```

**`.gitignore`**

```
.env
node_modules/
```

> Commit `.env.example` with an empty value, never `.env`. The most common
> real-world leak is a key pasted into the example file — the one file that is
> deliberately *not* ignored.

Check: `npm run typecheck` prints nothing. Nothing to check yet, which is the
correct amount.

---

## Step 1 — the loop

**New files: `ui.ts`, `model.ts`, `repl.ts`.**

The entire interface layer of a coding agent is this shape:

```
forever:
  line   = await read()        # block on the human
  result = await eval(line)    # block on the model
  print(result)
```

Read, eval, print, loop — that is the R-E-P-L, and it is 60 years old. Steps 2–5
are all about that **second** `await`: the model takes seconds, and a program
that goes silent for seconds feels broken even when it is working perfectly.

### `ui.ts` — the whole "UI framework"

No React, no Ink, no dependencies. A terminal UI is strings plus a few escape
sequences that move the cursor.

```ts
// ui.ts
export const c = {
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  blue:   (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[38;5;78m${s}\x1b[0m`,
  amber:  (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[38;5;203m${s}\x1b[0m`,
  violet: (s: string) => `\x1b[38;5;141m${s}\x1b[0m`,
};

// \r      = carriage return: cursor to column 0 of THIS line
// \x1b[2K = erase the whole line
// Together: overwrite the current line in place. That is 100% of the trick
// behind every terminal spinner you have ever seen.
const CLEAR_LINE = "\r\x1b[2K";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private started = 0;
  private label: string;

  constructor(label = "thinking") { this.label = label; }

  start(): void {
    if (this.timer) return;
    this.started = Date.now();
    this.timer = setInterval(() => this.paint(), 80);
    this.timer.unref?.();   // a live spinner must never hold the process open
    this.paint();
  }

  setLabel(label: string): void { this.label = label; }

  private paint(): void {
    const secs = ((Date.now() - this.started) / 1000).toFixed(1);
    const f = FRAMES[this.frame++ % FRAMES.length];
    process.stdout.write(
      `${CLEAR_LINE}${c.violet(f)} ${c.dim(this.label)} ${c.dim(`(${secs}s)`)}`,
    );
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    process.stdout.write(CLEAR_LINE);
  }
}

export function banner(title: string, subtitle: string): void {
  console.log();
  console.log(`  ${c.bold(c.blue("mycode"))} ${c.dim("·")} ${c.bold(title)}`);
  console.log(`  ${c.dim(subtitle)}`);
  console.log();
}

/**
 * rl.question, but EOF is an answer rather than an exception.
 *
 * Ctrl+D closes stdin. readline then rejects (or throws ERR_USE_AFTER_CLOSE on
 * the next call), which is technically correct and completely useless as a user
 * experience. Every REPL needs this wrapper; almost none have it until someone
 * pipes input into the program and watches it crash.
 */
export async function ask(
  rl: { question(q: string): Promise<string> },
  prompt: string,
): Promise<string | null> {
  try { return await rl.question(prompt); }
  catch { return null; }        // stdin closed — Ctrl+D, or a pipe ran dry
}
```

**What it does:** `c` wraps text in SGR colour codes. `Spinner` repaints one
line every 80 ms. `ask` turns "the user pressed Ctrl+D" from a thrown exception
into the value `null`, which is the only sane thing to branch on.

### `model.ts` — the API call

```ts
// model.ts
import OpenAI from "openai";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

export const SYSTEM_PROMPT =
  "You are mycode, a terminal coding assistant. Be concise and concrete. " +
  "Prefer short paragraphs and small code blocks over long essays.";

const client = new OpenAI();

/** One turn. Returns the complete assistant message — only when it is done. */
export async function completeTurn(messages: Msg[]): Promise<string> {
  const res = await client.chat.completions.create({ model: MODEL, messages });
  return res.choices[0]?.message?.content ?? "";
}
```

**What it does:** exactly the Week 1 call, unchanged. `new OpenAI()` finds
`OPENAI_API_KEY` in the environment on its own. Nothing about this week is a
new model capability — the model is the same, the *interface* is what changes.

### `repl.ts` — the loop

```ts
// repl.ts
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, Spinner } from "./ui.js";
import { completeTurn, MODEL, SYSTEM_PROMPT, type Msg } from "./model.js";

async function main(): Promise<void> {
  banner("Part 1 · the REPL skeleton", `model: ${MODEL} — Ctrl+D or /exit to quit`);

  // readline gives us line editing, history (up-arrow) and Ctrl+D for free.
  // Note what we did NOT have to build: cursor movement, backspace, kill-line.
  const rl = readline.createInterface({ input: stdin, output: stdout });

  // THE conversation. A plain in-memory array — same as Week 1.
  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];

  while (true) {
    // ---- READ ----
    const answer = await ask(rl, c.blue("\n› "));
    if (answer === null) break;                 // Ctrl+D
    const line = answer.trim();
    if (!line) continue;
    if (line === "/exit") break;

    messages.push({ role: "user", content: line });

    // ---- EVAL ----
    // This await is the problem: 3-20 seconds of absolutely nothing. The
    // spinner is a lie we tell to make the wait survivable. It proves the
    // process is alive but carries no information about the answer.
    const spinner = new Spinner("thinking");
    spinner.start();
    const t0 = Date.now();

    let reply: string;
    try {
      reply = await completeTurn(messages);
    } catch (err) {
      spinner.stop();
      console.log(c.red(`  error: ${(err as Error).message}`));
      messages.pop();      // don't leave a user turn with no answer after it
      continue;
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    spinner.stop();

    // ---- PRINT ----
    console.log(reply);
    console.log(c.dim(`  ${elapsed}s to first and last token`));

    messages.push({ role: "assistant", content: reply });
    // ---- LOOP ----
  }

  rl.close();
  console.log(c.dim("\n  bye\n"));
}

main().catch((err) => { console.error(c.red(String(err))); process.exit(1); });
```

**Run it:** `npm run dev`. Ask for something long — *"explain how TCP
congestion control works"*. Watch the spinner for eight seconds, then get a wall
of text out of nowhere.

**The one line to look at:** `messages.pop()` in the `catch`. If the call fails
you must remove the user message you just pushed, or the next turn sends a
history where a user spoke twice in a row and nobody answered.

**What is wrong with it:** everything arrives at once, at the end. Fix that next.

---

## Step 2 — streaming

**Modify `model.ts`. New file `session.ts`. Rewrite the eval half of `repl.ts`.**

Non-streaming is one HTTP response delivered when the model is finished.
Streaming is one HTTP response held open, delivering server-sent events as the
tokens are produced. Same model, **same cost**, same final text. The only thing
that changes is *when* you are allowed to see it — and that is the whole
difference between an app that feels dead and one that feels alive.

### Modify `model.ts`

Delete `completeTurn`. Add:

```ts
/** An async generator of text deltas. `for await` reads it one chunk at a time. */
export async function* streamTurn(messages: Msg[]): AsyncGenerator<string> {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
```

**What it does:** `async function*` is an async generator. `yield` hands one
piece to the caller and pauses until the caller asks for the next. The caller
uses `for await`. Note the `if (delta)` — some chunks carry no content at all
(role announcements, finish reasons); yielding `undefined` would print the word
"undefined" into the answer.

### New `session.ts` — draw the line

This is the most important file of the week.

```ts
// session.ts — the agent core, with NO knowledge of the terminal.
import { streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";

export interface TurnHandlers {
  /** Called for every text delta, in order, as it arrives. */
  onDelta?: (text: string) => void;
  /** Called once, with the elapsed ms, when the first delta lands. */
  onFirstToken?: (ms: number) => void;
}

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];

  /** Run one user turn. Resolves with the complete assistant text. */
  async send(input: string, handlers: TurnHandlers = {}): Promise<string> {
    this.messages.push({ role: "user", content: input });

    const started = Date.now();
    let first = true;
    let full = "";

    for await (const delta of streamTurn(this.messages)) {
      if (first) {
        first = false;
        handlers.onFirstToken?.(Date.now() - started);
      }
      full += delta;
      handlers.onDelta?.(delta);
    }

    this.messages.push({ role: "assistant", content: full });
    return full;
  }
}
```

**What it does:** `Session` owns the conversation. It hands out text as it
arrives via **callbacks** and does not care whether that text ends up in a
terminal, a browser, a Slack message or a test assertion. There is not one
`console.log` in this file, and there never will be.

Say this out loud in class: *the thing that talks to the model and the thing
that draws on the screen are different objects.* Every student who skips this
ends up with a terminal program that has an agent trapped inside it, and no way
to put a web UI on it later.

### Modify `repl.ts`

Swap the imports (`completeTurn` → `Session`), create `const session = new
Session()` instead of the `messages` array, and replace the EVAL/PRINT block:

```ts
    const spinner = new Spinner("thinking");
    spinner.start();
    const t0 = Date.now();
    let ttft = 0;

    try {
      await session.send(line, {
        // The first token is the handover: the spinner has done its job and
        // must get off the screen before any real text is printed, or the two
        // will fight over the same line.
        onFirstToken: (ms) => { ttft = ms; spinner.stop(); stdout.write("\n"); },
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
```

**Run it.** Ask the same long question. Two numbers now matter instead of one:

| | |
|---|---|
| **TTFT** | time to first token — how long until the screen changes. **This is the number the user feels.** |
| **total** | time to the last token. Barely changed from Step 1. |

Typically ~400 ms vs ~8 s. Streaming did not make the model faster. It made the
**wait** shorter, which is a completely different thing and the only one anyone
perceives.

**The two traps, both in the code above:**

1. `stdout.write`, never `console.log`, for deltas. `console.log` appends `\n`.
2. Stop the spinner on the *first* token, not at the end. Two writers on one
   line produce garbage.

---

## Step 3 — slash commands

**New file `commands.ts`. Modify `repl.ts`.**

Some things the user types are not questions for the model. `/help` should not
cost money. The loop grows a second path:

```
line starts with "/"  →  dispatch()  →  local / render / prompt
anything else         →  the model
```

### New `commands.ts`

The taxonomy here is lifted from the real Claude Code source
(`src/types/command.ts`), which sorts every command into one of three **kinds**:

| kind | meaning | cost |
|---|---|---|
| `local` | runs code, prints a result. The model is never called. | free |
| `render` | produces a block of UI. Claude Code calls this `local-jsx` because it returns a React element; we return styled strings, because our renderer is `console.log`. | free |
| `prompt` | is not really a command — it expands into a message and goes down the normal model path. `/review` is a saved prompt with a short name. | a full turn |

Why the taxonomy matters: **it tells you where a command's cost lives.** Skip
this distinction and you end up calling the model to answer `/help`.

```ts
// commands.ts
import { c } from "./ui.js";
import { MODEL, type Msg } from "./model.js";

export interface CommandContext {
  messages: Msg[];
  /** Call to end the REPL after this command. */
  quit: () => void;
}

interface Base { name: string; description: string; aliases?: string[] }

export type Command = Base & (
  | { kind: "local";  run(args: string, ctx: CommandContext): string | void }
  | { kind: "render"; render(args: string, ctx: CommandContext): string }
  | { kind: "prompt"; expand(args: string, ctx: CommandContext): string }
);

export const COMMANDS: Command[] = [
  {
    kind: "local", name: "clear",
    description: "forget the conversation, keep the session",
    run: (_args, ctx) => {
      // Splice, don't reassign — the array is shared with the Session object.
      const dropped = ctx.messages.length - 1;
      ctx.messages.splice(1);      // index 0 is the system prompt: it survives
      return c.dim(`  cleared ${dropped} message${dropped === 1 ? "" : "s"}`);
    },
  },
  {
    kind: "local", name: "exit", aliases: ["quit", "q"],
    description: "leave",
    run: (_args, ctx) => { ctx.quit(); },
  },
  {
    kind: "render", name: "help", aliases: ["?"],
    description: "list the commands",
    render: () => {
      const width = Math.max(...COMMANDS.map((cmd) => cmd.name.length)) + 2;
      const rows = COMMANDS.map((cmd) => {
        const alias = cmd.aliases?.length
          ? c.dim(` (${cmd.aliases.map((a) => "/" + a).join(", ")})`) : "";
        return `  ${c.blue("/" + cmd.name.padEnd(width))}${cmd.description}${alias}`;
      });
      return ["", c.bold("  commands"), ...rows, "",
        c.dim("  anything else is sent to the model")].join("\n");
    },
  },
  {
    kind: "render", name: "status",
    description: "model, message count, rough context size",
    render: (_args, ctx) => {
      const chars = ctx.messages.reduce(
        (n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
      return [
        "",
        `  ${c.dim("model")}     ${MODEL}`,
        `  ${c.dim("messages")}  ${ctx.messages.length - 1}`,
        `  ${c.dim("context")}   ~${Math.round(chars / 4)} tokens ${c.dim("(chars ÷ 4)")}`,
        "",
      ].join("\n");
    },
  },
  {
    kind: "prompt", name: "review",
    description: "<file> — ask for a code review of a file's contents",
    expand: (args) => {
      if (!args) return "Explain what you would need in order to review code.";
      return `Review this file and list concrete problems, worst first. ` +
        `Be specific and cite line content. File: ${args}`;
    },
  },
  {
    kind: "prompt", name: "explain",
    description: "<thing> — explain it at a senior-engineer level",
    expand: (args) =>
      `Explain ${args || "the last thing you said"} to a senior engineer. No preamble.`,
  },
];

const byName = new Map<string, Command>();
for (const cmd of COMMANDS) {
  byName.set(cmd.name, cmd);
  for (const alias of cmd.aliases ?? []) byName.set(alias, cmd);
}

export type CommandResult =
  | { type: "handled"; output?: string }     // done — nothing to send
  | { type: "prompt"; text: string }         // send this to the model
  | { type: "unknown"; name: string };

/**
 * Parse and run a leading-slash line.
 * Returns null when the line is NOT a command, so the caller sends it as-is.
 */
export function dispatch(line: string, ctx: CommandContext): CommandResult | null {
  if (!line.startsWith("/")) return null;

  const space = line.indexOf(" ");
  const name = (space === -1 ? line.slice(1) : line.slice(1, space)).toLowerCase();
  const args = space === -1 ? "" : line.slice(space + 1).trim();

  const cmd = byName.get(name);
  if (!cmd) return { type: "unknown", name };

  switch (cmd.kind) {
    case "local":  return { type: "handled", output: cmd.run(args, ctx) || undefined };
    case "render": return { type: "handled", output: cmd.render(args, ctx) };
    case "prompt": return { type: "prompt",  text: cmd.expand(args, ctx) };
  }
}

/** Names for tab-completion. */
export function completions(prefix: string): string[] {
  return [...byName.keys()].map((n) => "/" + n)
    .filter((n) => n.startsWith(prefix)).sort();
}
```

**What it does:** a discriminated union on `kind` means TypeScript forces you to
handle all three cases in `dispatch`. `dispatch` returns `null` for a normal
line — *not* an error — so the caller's default path stays the simple one.

Note `ctx.messages.splice(1)` in `/clear`. `Session.messages` is `readonly`, so
you cannot reassign it, and the command only has a reference anyway. Splicing
mutates the array everyone is holding. Reassigning would silently clear a copy.

### Modify `repl.ts`

Add the import, wire tab completion into readline, build the context, and put
the command path *before* the spinner:

```ts
import { completions, dispatch, type CommandContext } from "./commands.js";

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
    // ... read as before, but DELETE the `if (line === "/exit") break;`

    let toSend = line;
    const result = dispatch(line, ctx);

    if (result) {
      if (result.type === "unknown") {
        console.log(c.amber(`  /${result.name} is not a command — try /help`));
        continue;
      }
      if (result.type === "handled") {
        if (result.output) console.log(result.output);
        continue;              // no model turn, no tokens, no dollars
      }
      // result.type === "prompt": fall through with the expanded text
      toSend = result.text;
      console.log(c.dim(`  ${line}  →  ${toSend.slice(0, 60)}…`));
    }

    // ... then the model path exactly as in Step 2, but sending `toSend`
```

**Run it.** Type `/he` then **Tab** → `/help`. Try `/status`, `/clear`,
`/explain closures`, and `/nope`.

Look at the shape of the code: `dispatch()` runs **before** anything expensive,
and two of the three kinds `continue` without touching the network. That is the
payoff of the taxonomy.

---

## Step 4 — interrupts

**Modify `model.ts`, `session.ts`, `repl.ts`.**

The model is 400 words into an answer you already know is wrong. What does
Ctrl+C do?

- The naive answer is `process.exit()` — you lose the session.
- The naive-but-worse answer throws away the half-finished turn, leaving
  `messages` ending on a user message with no reply. The next turn re-answers
  the abandoned question, and the model has a transcript of a conversation that
  never happened.

**The rule: whatever was actually shown to the user is part of history.** They
read those tokens. The model must know it said them.

### Modify `model.ts`

`AbortSignal` is the standard cancellation currency of the web platform, and
Node speaks it too. One signal, passed down, tears the HTTP request down at the
socket — not "ignore the result when it arrives". You stop being billed for
tokens you never see.

```ts
/** True when an error is "the user cancelled", not "something broke". */
export function isAbort(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIUserAbortError ||
    (err as { name?: string })?.name === "AbortError"
  );
}

export async function* streamTurn(
  messages: Msg[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const stream = await client.chat.completions.create(
    { model: MODEL, messages, stream: true },
    { signal },                       // ← the whole feature, in one option
  );
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
```

The signal goes in the **second** argument — request options, not body params.
That is the single most common mistake here.

### Modify `session.ts`

```ts
import { isAbort, streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";

export interface TurnResult {
  text: string;
  interrupted: boolean;
  ms: number;
}

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];

  /** The controller for the turn in flight, or null when idle. */
  private inflight: AbortController | null = null;

  get busy(): boolean { return this.inflight !== null; }

  /** Cancel the turn in flight. Safe to call when idle — it does nothing. */
  interrupt(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort();
    return true;
  }

  async send(input: string, handlers: TurnHandlers = {}): Promise<TurnResult> {
    if (this.inflight) throw new Error("a turn is already running");

    this.messages.push({ role: "user", content: input });

    const controller = new AbortController();
    this.inflight = controller;

    const started = Date.now();
    let first = true;
    let text = "";
    let interrupted = false;

    try {
      for await (const delta of streamTurn(this.messages, controller.signal)) {
        if (first) { first = false; handlers.onFirstToken?.(Date.now() - started); }
        text += delta;
        handlers.onDelta?.(delta);
      }
    } catch (err) {
      if (!isAbort(err)) {
        this.messages.pop();   // no reply happened at all — drop the user turn
        this.inflight = null;
        throw err;
      }
      interrupted = true;
    } finally {
      this.inflight = null;
    }

    // Do not rely on an exception to tell you the turn was cancelled. Some
    // clients throw an abort error; others simply stop iterating and let the
    // loop end normally. The signal is the one source of truth in both cases.
    if (controller.signal.aborted) interrupted = true;

    // Commit whatever the user actually saw. An interrupted turn is a REAL
    // turn: annotate it so the model knows the thought was cut off rather
    // than finished.
    if (interrupted) {
      this.messages.push({
        role: "assistant",
        content: text
          ? `${text}\n\n[interrupted by the user before finishing]`
          : "[interrupted by the user before answering]",
      });
    } else {
      this.messages.push({ role: "assistant", content: text });
    }

    return { text, interrupted, ms: Date.now() - started };
  }
}
```

**Read that `catch` carefully.** Two failures, two different repairs:

- **A real error** → nothing was shown, so `messages.pop()` and rethrow.
- **An abort** → text *was* shown, so keep it, tagged.

And `if (controller.signal.aborted)` after the loop is the belt to the
exception's braces. Depending on SDK version and where the abort lands, the
iteration may just end quietly. The signal never lies.

### Modify `repl.ts`

```ts
const DOUBLE_PRESS_MS = 1500;
// ...
  let lastCtrlC = 0;

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
```

and in the model path:

```ts
    const spinner = new Spinner("thinking · Ctrl+C to stop");
    spinner.start();

    try {
      const turn = await session.send(toSend, {
        onFirstToken: () => { spinner.stop(); stdout.write("\n"); },
        onDelta: (text) => stdout.write(text),
      });
      spinner.stop();                          // no-op if already stopped
      console.log();

      if (turn.interrupted) {
        // The partial answer stays on screen AND in history — nothing is
        // rolled back, because the user genuinely read it.
        console.log(c.amber(
          `  ⨯ interrupted after ${turn.text.length} chars — kept in history`));
      }
    } catch (err) { /* as before, minus the .pop() — Session owns that now */ }
```

Two states, two meanings — exactly the priority list the real Claude Code uses
in `src/hooks/useCancelRequest.ts`:

| state | Ctrl+C |
|---|---|
| **busy** | cancels the turn in flight. The session survives. |
| **idle** | once warns; twice within 1.5 s exits. |

The double-press is not a gimmick. Ctrl+C is muscle memory for "make it stop",
and a program that dies from the reflex you use to stop it is a program you
learn to be afraid of.

**Run it.** Ask something long, hit Ctrl+C mid-answer, then ask *"what were you
just saying?"* — the model knows, and it knows it was cut off.

---

## Step 5 — the meter

**New file `cost.ts`. Modify `model.ts`, `session.ts`, `commands.ts`, `repl.ts`.**

Three things make an agent's cost invisible, and all three are fixable:

1. Prices are quoted **per million** tokens, so every number looks like zero.
2. Input and output are billed at **different rates** — output is 4–8×.
3. Cached input is **discounted**, but only if you can see the cache hit at all.

Claude Code's `src/utils/modelCost.ts` keeps five meters (input, output,
cache-write, cache-read, web-search) for exactly this reason. We keep three,
which is all Chat Completions reports.

### New `cost.ts`

```ts
// cost.ts — the bill is a feature.
export interface ModelCosts { input: number; cachedInput: number; output: number }

// USD per 1,000,000 tokens, as of 2026-08.
const PRICES: Record<string, ModelCosts> = {
  "gpt-4o-mini":  { input: 0.15, cachedInput: 0.075, output: 0.60 },
  "gpt-4o":       { input: 2.50, cachedInput: 1.25,  output: 10.00 },
  "gpt-4.1-mini": { input: 0.40, cachedInput: 0.10,  output: 1.60 },
  "gpt-4.1":      { input: 2.00, cachedInput: 0.50,  output: 8.00 },
};

const FALLBACK: ModelCosts = PRICES["gpt-4o-mini"];

/**
 * Unknown models fall back rather than throw — a cost meter that crashes the
 * app is worse than one that is wrong — so we return a price AND say so.
 */
export function getModelCosts(model: string): { costs: ModelCosts; known: boolean } {
  const exact = PRICES[model];
  if (exact) return { costs: exact, known: true };
  // "gpt-4o-mini-2024-07-18" → try the longest registered prefix.
  const prefix = Object.keys(PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return { costs: PRICES[prefix], known: true };
  return { costs: FALLBACK, known: false };
}

export interface Usage {
  input: number;         // billed at full rate (already excludes cached)
  cachedInput: number;   // billed at the discount rate
  output: number;
}

export const ZERO: Usage = { input: 0, cachedInput: 0, output: 0 };

export function tokensToUSD(usage: Usage, model: string): number {
  const { costs } = getModelCosts(model);
  return (usage.input       * costs.input)       / 1_000_000 +
         (usage.cachedInput * costs.cachedInput) / 1_000_000 +
         (usage.output      * costs.output)      / 1_000_000;
}

/** Sub-cent numbers need more decimals than money usually does. */
export function formatUSD(usd: number): string {
  if (usd === 0)     return "$0.00";
  if (usd < 0.01)    return `$${usd.toFixed(5)}`;
  if (usd < 1)       return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Running totals for a session. One instance, mutated per turn. */
export class CostMeter {
  readonly model: string;
  readonly startedAt = Date.now();
  turns = 0;
  total: Usage = { ...ZERO };
  last: Usage = { ...ZERO };

  constructor(model: string) { this.model = model; }

  record(usage: Usage): void {
    this.turns++;
    this.last = usage;
    this.total = {
      input:       this.total.input       + usage.input,
      cachedInput: this.total.cachedInput + usage.cachedInput,
      output:      this.total.output      + usage.output,
    };
  }

  get lastUSD(): number  { return tokensToUSD(this.last,  this.model); }
  get totalUSD(): number { return tokensToUSD(this.total, this.model); }

  /** The one-line footer printed after every turn. */
  turnLine(): string {
    const u = this.last;
    const cached = u.cachedInput ? ` (+${u.cachedInput} cached)` : "";
    return `${u.input} in${cached} · ${u.output} out · ${formatUSD(this.lastUSD)}` +
      ` · session ${formatUSD(this.totalUSD)}`;
  }
}
```

**What it does:** `formatUSD` is the small idea that makes the rest work. A turn
costs `$0.00013`. Printed as `$0.00` it teaches you that the agent is free.

### Modify `model.ts`

With `stream: true` the usage block is normally omitted — the response is over
before the totals are known. `stream_options: { include_usage: true }` asks for
one final chunk, after the content, carrying the counts. **You must ask for it.**
Forget the flag and your meter silently reads zero.

```ts
import type { Usage } from "./cost.js";

// A discriminated union instead of a bare string, because the stream now
// carries two kinds of news: text, and the bill.
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: Usage };

export async function* streamTurn(
  messages: Msg[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const stream = await client.chat.completions.create(
    { model: MODEL, messages, stream: true, stream_options: { include_usage: true } },
    { signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield { type: "delta", text: delta };

    if (chunk.usage) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      yield {
        type: "usage",
        usage: {
          // prompt_tokens INCLUDES the cached ones — subtract, or you bill
          // the discounted tokens twice.
          input: chunk.usage.prompt_tokens - cached,
          cachedInput: cached,
          output: chunk.usage.completion_tokens,
        },
      };
    }
  }
}
```

That subtraction is a real billing bug in a lot of student code.

### Modify `session.ts`

```ts
import { isAbort, MODEL, streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";
import { CostMeter, ZERO, type Usage } from "./cost.js";

export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onUsage?: (usage: Usage) => void;
}

export interface TurnResult {
  text: string; interrupted: boolean; ms: number; ttft: number; usage: Usage;
}
```

Inside the class add `readonly meter = new CostMeter(MODEL);`, then in `send`:

```ts
    let ttft = 0;
    let usage: Usage = { ...ZERO };

    try {
      for await (const ev of streamTurn(this.messages, controller.signal)) {
        if (ev.type === "usage") {
          usage = ev.usage;
          handlers.onUsage?.(usage);
          continue;
        }
        if (first) { first = false; ttft = Date.now() - started; handlers.onFirstToken?.(ttft); }
        text += ev.text;
        handlers.onDelta?.(ev.text);
      }
    } // ... catch/finally unchanged
```

and just before pushing the assistant message:

```ts
    // An interrupted stream never delivers its usage chunk, but the tokens
    // were still generated and are still billed. Estimating is honest;
    // reporting zero is not.
    if (interrupted && usage.output === 0) {
      usage = { ...ZERO, output: Math.ceil(text.length / 4) };
    }
```

then after the push:

```ts
    this.meter.record(usage);
    return { text, interrupted, ms: Date.now() - started, ttft, usage };
```

### Modify `commands.ts`

Add `meter: CostMeter` to `CommandContext`, a spent line to `/status`, and a
new `/cost` command:

```ts
import { formatUSD, getModelCosts, type CostMeter } from "./cost.js";

  {
    kind: "render", name: "cost",
    description: "the bill so far, broken down",
    render: (_args, ctx) => {
      const m = ctx.meter;
      if (!m.turns) return c.dim("\n  no turns yet\n");
      const { costs, known } = getModelCosts(m.model);
      const mins = (Date.now() - m.startedAt) / 60000;
      const row = (label: string, tokens: number, usd: number) =>
        `  ${c.dim(label.padEnd(14))}${String(tokens).padStart(8)}  ${formatUSD(usd).padStart(10)}`;
      return [
        "",
        `  ${c.bold("session cost")}  ${c.dim(m.model)}`,
        "",
        row("input",        m.total.input,       (m.total.input       * costs.input)       / 1_000_000),
        row("cached input", m.total.cachedInput, (m.total.cachedInput * costs.cachedInput) / 1_000_000),
        row("output",       m.total.output,      (m.total.output      * costs.output)      / 1_000_000),
        `  ${c.dim("".padEnd(14))}${"".padStart(8)}  ${c.dim("----------")}`,
        `  ${c.bold("total".padEnd(14))}${"".padStart(8)}  ${c.green(formatUSD(m.totalUSD).padStart(10))}`,
        "",
        c.dim(`  ${m.turns} turn(s) over ${mins.toFixed(1)} min · ${formatUSD(m.totalUSD / m.turns)}/turn`),
        known ? "" : c.amber(`  ⚠ no price on file for ${m.model} — estimated at gpt-4o-mini rates`),
        "",
      ].filter(Boolean).join("\n");
    },
  },
```

### Modify `repl.ts`

Pass `meter: session.meter` into `ctx`, add a shared goodbye, and print the
footer after every turn:

```ts
import { formatUSD } from "./cost.js";

  function goodbye(): void {
    const m = session.meter;
    console.log();
    console.log(m.turns
      ? c.dim(`  ${m.turns} turn(s) · ${formatUSD(m.totalUSD)} · bye`)
      : c.dim("  bye"));
    console.log();
  }

      // The footer. Small, dim, always there. A number you see after every
      // turn is a number you start optimizing.
      console.log(c.dim(
        `  ${turn.ttft}ms · ${(turn.ms / 1000).toFixed(1)}s · ${session.meter.turnLine()}`,
      ));
```

Use `goodbye()` in the double-Ctrl+C branch and at the end of `main`.

**Run it.** Ask three questions, then `/cost`. Ask the same question twice and
watch the cached-input number appear on the second one.

---

## You are done

```
mycode/
├── .env            .gitignore     package.json    tsconfig.json
├── repl.ts         the terminal: read, print, Ctrl+C
├── ui.ts           colours, spinner, EOF-safe ask()
├── commands.ts     local / render / prompt
├── session.ts      the conversation — no terminal anywhere in it
├── model.ts        the streaming, cancellable, metered API call
└── cost.ts         prices and the running meter
```

About 500 lines, and it feels like a product rather than a script:

| | |
|---|---|
| **read** | readline gives editing, history and tab completion |
| **dispatch** | local/render commands never reach the network |
| **stream** | tokens appear as they are generated |
| **interrupt** | Ctrl+C stops the turn, not the session |
| **meter** | every turn is priced, and the total is always visible |

---

## Homework

1. **`/model <name>`** — switch models mid-session. Where does `MODEL` have to
   stop being a module constant for this to work? (That question is the exercise.)
2. **`/save <file>`** and **`/load <file>`** — write `session.messages` to JSON
   and read it back. Watch what `/clear` and `/load` do to each other.
3. **A cost ceiling.** Refuse to start a turn once the session passes
   `$MAX_SESSION_USD`. Where do you put the check so `/cost` still works after
   you hit the limit?
4. **Prove the split.** Write a `smoke.ts` that imports `Session` and drives a
   turn with no terminal at all. If it needs one line from `ui.ts`, your line is
   in the wrong place. (`part5-cost/smoke.ts` is one version of this.)

## Where to look next

- `part<N>-*/` in this repo — the answer key for each step.
- `week4-gui/` — the same `session.ts`, in a browser. Nothing in it changed.
- Claude Code's own `src/types/command.ts`, `src/hooks/useCancelRequest.ts`,
  `src/utils/modelCost.ts` — the three ideas of Steps 3, 4 and 5, at scale.
