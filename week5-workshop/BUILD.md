# Build `mycode v0.2` — the week it grows hands

**Week 5 — tool use, function calling, and the permission gate.**

Last week you built an interface: a streaming REPL with slash commands, safe
interrupts and a cost meter. It talks about code. This week it **changes** code.

Five steps. Each one is small, each one **runs**, and each one ends with
something you can demonstrate. If a step does not run, do not go on to the next.

> **How this maps to the repo.** Each step has an answer key: `part1-read-only/`,
> `part2-write-edit/`, `part3-bash/`, `part4-permissions/`, `part5-agent/`. Those
> are five self-contained folders so you can diff them. Here you build **one**
> folder that changes over time, which is how you would actually write it.
>
> ```bash
> diff -r part3-bash part4-permissions   # exactly what the permission gate cost
> ```

---

## What we are building, in one picture

```
                 ┌───────────────────────────────────────┐
   you  ────────▶│ repl.ts       readline · ANSI          │  the interface
                 │ ui.ts         tool receipts, the y/a/N │  (or a browser —
                 │ commands.ts   /help /tools /allowed    │   see week5-gui/)
                 ├───────────────────────────────────────┤
                 │ session.ts    THE AGENT LOOP           │  the core:
                 │ model.ts      one API call             │  knows nothing
                 │ cost.ts       the meter                │  about terminals
                 ├───────────────────────────────────────┤
                 │ tools/specs.ts        the contracts    │
                 │ tools/fs.ts           read · write     │
                 │ tools/edit.ts         six guards       │  the hands
                 │ tools/shell.ts        run_bash         │
                 │ tools/search.ts       glob · grep      │
                 │ tools/permissions.ts  allow/ask/deny   │  the adult
                 │ tools/registry.ts     name → function  │
                 └───────────────────────────────────────┘
                                  ↓ OpenAI            ↓ your filesystem
```

Two ideas carry the entire week, and everything below is a consequence of one
of them.

**1. A tool is a contract, not a function.** The model never sees your code. It
sees a name, a paragraph of prose saying *when* to reach for the tool, and a
schema of arguments. Ninety percent of "the model uses tools badly" is really
"my tool descriptions are vague". When a tool is misused, **fix the description
before you touch the code.**

**2. The result is the teacher.** When a tool fails you do not crash — you
return the error to the model as data, and a good model reads it and fixes its
next call. Your error messages are a second prompt. We wrap every one in
`<tool_error>` tags and make them specific enough to act on:

> `old_string appears 3 times. Include surrounding lines to make it unique.`

That sentence is the reason the agent recovers instead of flailing.

---

## Step 0 — the folder

You can start from Week 4's `mycode` or from nothing. Two files come across
unchanged — `cost.ts` and `ui.ts` — and everything else is new or rewritten.

```bash
mkdir mycode && cd mycode
npm init -y
npm install openai
npm install -D typescript tsx @types/node
mkdir tools
cp ../week4-workshop/part5-cost/cost.ts .    # the meter, unchanged
cp ../week4-workshop/part5-cost/ui.ts .      # colours and the spinner
```

**`package.json`** — replace the generated one:

```json
{
  "name": "mycode",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx --env-file=.env repl.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

**`tsconfig.json`** — same as Week 4: `"target": "ES2022"`, `"module": "ES2022"`,
`"moduleResolution": "bundler"`, `"strict": true`, `"types": ["node"]`.

**`.env`**

```
OPENAI_API_KEY=sk-...
MODEL=gpt-4o-mini
```

**`.gitignore`** — `.env`, `node_modules/`, and `sandbox/`.

> ### Where the agent runs is a decision
>
> Every tool below resolves paths against `process.cwd()`. **The directory you
> start the program in is the blast radius.** From Step 2 onward this workshop
> runs everything inside `sandbox/` — a throwaway copy of `fixture/`, a tiny
> project with one real bug in it:
>
> ```bash
> npm run sandbox:reset     # rm -rf sandbox && cp -r fixture sandbox
> ```
>
> Point mycode at code you care about only after Step 4, and only once you have
> watched the permission gate say no to something.

---

## Step 1 — the loop, and three tools that cannot hurt you

**Add:** `tools/specs.ts`, `tools/fs.ts`, `tools/search.ts`, `tools/registry.ts`,
and rewrite `model.ts`, `session.ts`, `repl.ts`.

We start with **read-only** tools on purpose. The agent loop is the hard idea of
the week and you want to debug it while the stakes are zero. At the end of this
step mycode can explore a codebase and answer questions about what is actually
on disk. It cannot change a byte.

### 1a. The contracts

The model's entire user manual for your tools is this file.

```ts
// tools/specs.ts — the six tools, as the model sees them.
//
// The model never sees your code. It sees this file: a name, a paragraph of
// prose that says WHEN to reach for the tool, and a strict JSON schema of the
// arguments. That is the entire user manual it gets.
//
// So: ninety percent of "the model uses my tools badly" is really "my tool
// descriptions are vague". When a tool is misused, fix the description before
// you touch the code. You are writing documentation for a reader that follows
// it literally and never asks a follow-up question.
//
// Part 1 defines the three READ-ONLY tools. They cannot damage anything, which
// is why we can wire the agent loop up and let it run without a permission
// system standing in the way. Parts 2 and 3 add the dangerous three.
import type OpenAI from "openai";

export type ToolSpec = OpenAI.Chat.Completions.ChatCompletionTool;

/**
 * `additionalProperties: false` plus an explicit `required` list is what stops
 * the model inventing fields. Without it you will eventually receive
 * `{"path": "a.ts", "encoding": "utf-8"}` and crash on a parameter you never
 * declared.
 */
export function spec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolSpec {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const TOOL_SPECS: ToolSpec[] = [
  spec("read_file",
    "Read a file from the project. Returns numbered lines. " +
    "Use it before any edit — edit_file refuses to touch a file you have not read.",
    {
      path: { type: "string", description: "path relative to the project root" },
      offset: { type: "integer", description: "1-based first line to return" },
      limit: { type: "integer", description: "max lines to return, default 2000" },
    },
    ["path"]),

  spec("glob_files",
    "Find files by name pattern, e.g. '**/*.ts' or 'src/*.json'. " +
    "Newest-modified first, max 100 results. Use this instead of `find` in a shell.",
    { pattern: { type: "string" } },
    ["pattern"]),

  spec("grep_search",
    "Search file CONTENTS with a regular expression. Returns matching lines as " +
    "file:line: text. Use this instead of running `grep` through a shell — it is " +
    "capped, sorted and cheaper in context.",
    {
      pattern: { type: "string", description: "a JavaScript regular expression" },
      glob: { type: "string", description: "limit to matching filenames, e.g. '*.ts'" },
    },
    ["pattern"]),
];
```

> **Why `additionalProperties: false` matters.** Without it you will eventually
> receive `{"path": "a.ts", "encoding": "utf-8"}` and crash on a parameter you
> never declared. Strict schemas are not pedantry — they are the difference
> between "the model cannot invent fields" and "the model can invent fields".

### 1b. `read_file`, and the invisible star

```ts
// tools/fs.ts — read_file, and the invisible star of the whole week: READ_STATE.
//
// READ_STATE is a map of "which files have we read, and what was the file's
// modification time at that moment". read_file arms it. In Part 2, write_file
// and edit_file check it, and that one check is the difference between an agent
// that edits your code and an agent that overwrites your code with a plausible
// hallucination of what it probably said.
//
// It lives here rather than inside edit.ts because it is shared state between
// two tools — the classic shape of a safety interlock.
import fs from "node:fs";

/** path -> mtimeMs at the moment we last read (or wrote) it. */
export const READ_STATE = new Map<string, number>();

const MAX_LINES = 2000;
const MAX_BYTES = 262_144; // 256 KB

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export function readFile({ path: p, offset = 1, limit = MAX_LINES }: ReadArgs): string {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return `<tool_error>not found: ${p}</tool_error>`;
  }
  // An error beats a truncation. Anthropic ran this as an actual A/B test on
  // the real Read tool: silently truncating a huge file lowered the error rate
  // but raised mean token usage — a 100-byte error is cheaper than 25,000
  // tokens of content nobody asked for. They kept the error. So do we.
  if (fs.statSync(p).size > MAX_BYTES) {
    return `<tool_error>${p} is larger than 256KB. Read a slice with ` +
      `offset/limit, or grep_search it instead.</tool_error>`;
  }

  const lines = fs.readFileSync(p, "utf8").split("\n");
  READ_STATE.set(p, fs.statSync(p).mtimeMs); // arm the edit gate

  // A bare empty result makes models behave strangely — they tend to assume the
  // tool failed and call it again. Say something instead of nothing.
  if (lines.length === 1 && lines[0] === "") return "<note>file exists but is empty</note>";

  const start = Math.max(1, offset) - 1;
  const window = lines.slice(start, start + limit);
  // Numbered lines, `cat -n` style, so the model can say "line 15" and mean it.
  const body = window.map((l, i) => `${String(start + i + 1).padStart(5)}| ${l}`).join("\n");
  const rest = lines.length - start - window.length;
  return body + (rest > 0 ? `\n… ${rest} more lines (use offset to continue)` : "");
}
```

Three decisions worth saying out loud in class:

- **Numbered lines.** So the model can say "line 15" and mean it.
- **An error, not a truncation, on a huge file.** Anthropic ran this as an A/B
  test on the real Read tool: truncating lowered the error rate but raised mean
  token usage. A 100-byte error beats 25,000 tokens of unwanted content.
- **`READ_STATE`.** Nothing uses it yet. In Step 2 it becomes the interlock that
  stops the model overwriting a file it never looked at.

### 1c. Finding things

```ts
// tools/search.ts — glob_files and grep_search, written by hand.
//
// The model has to FIND things before it can change them, and "find" comes in
// two flavours: by filename and by content. Neither implementation is clever.
// The two decisions that actually matter are:
//
//   ordering — newest-modified first. The file you touched five minutes ago is
//              far likelier to be the one in question than one untouched for a
//              year. Relevance ranking for free.
//   caps     — 100 files, 250 matching lines. Not laziness: context-budget
//              policy. Enough for the model to see the shape of the answer,
//              small enough that you can afford to send it every turn.
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set([".git", "node_modules", "__pycache__", ".venv", "dist", "build", ".next"]);
const MAX_FILES = 100;
const MAX_HITS = 250;

/** Depth-first walk that never descends into the directories nobody means. */
export function* walk(root = "."): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // unreadable directory is not a crash
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p.replace(/^\.\//, "");
  }
}

/**
 * Translate a glob into a regex.
 *
 * Order matters, and this is the bug everyone writes once: the `**` case has to
 * be handled BEFORE the single `*`, or the first star eats the second one and
 * a pattern like `**` + `/*.ts` silently stops matching subdirectories. We
 * park it on a placeholder character first, then substitute at the end.
 */
function globToRegExp(pattern: string): RegExp {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0001", "(?:.*/)?");
  return new RegExp(`^${rx}$`);
}

export function globFiles({ pattern }: { pattern: string }): string {
  const rx = globToRegExp(pattern);
  const hits = [...walk()]
    .filter((p) => rx.test(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); // newest first
  if (!hits.length) return "(no matches)";
  const shown = hits.slice(0, MAX_FILES);
  const more = hits.length > MAX_FILES
    ? `\n… ${hits.length - MAX_FILES} more (narrow the pattern)`
    : "";
  return shown.join("\n") + more;
}

export function grepSearch({ pattern, glob = "*" }: { pattern: string; glob?: string }): string {
  let rx: RegExp;
  // A bad regex from the model is a tool error, not a crash. Tell it what broke
  // and it will fix the pattern on its next call.
  try {
    rx = new RegExp(pattern);
  } catch (err) {
    return `<tool_error>invalid regex: ${(err as Error).message}</tool_error>`;
  }

  const fileRx = globToRegExp(glob);
  const out: string[] = [];
  for (const p of walk()) {
    if (!fileRx.test(path.basename(p)) && !fileRx.test(p)) continue;
    let text: string;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue; // binary file: skip it
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue;
      out.push(`${p}:${i + 1}: ${lines[i].slice(0, 200)}`);
      if (out.length >= MAX_HITS) {
        out.push(`… [${MAX_HITS}-hit limit] narrow your pattern or pass a glob`);
        return out.join("\n");
      }
    }
  }
  return out.length ? out.join("\n") : "(no matches)";
}
```

The implementations are dull; the **policy** is the lesson. Newest-file-first is
relevance ranking for free, and the 100/250 caps are context-budget policy, not
laziness.

### 1d. Running a tool

```ts
// tools/registry.ts — name → implementation, plus the one function that runs a
// tool call safely.
//
// Keeping this separate from specs.ts is deliberate. specs.ts is what the MODEL
// sees; registry.ts is what YOU run. When the two drift — a spec for a tool
// that no longer exists, or a tool the model was never told about — you want a
// single obvious place where the mismatch shows up.
import { readFile } from "./fs.js";
import { globFiles, grepSearch } from "./search.js";

export type ToolFn = (args: any) => string | Promise<string>;

export const TOOLS: Record<string, ToolFn> = {
  read_file: readFile,
  glob_files: globFiles,
  grep_search: grepSearch,
};

/**
 * Run one tool call and ALWAYS return a string.
 *
 * Every failure below is returned as data rather than thrown, and that is the
 * central idea of the week: your tool's error message is a second prompt. A
 * good model reads "old_string appears 3 times" and fixes its next call. It
 * cannot read an exception, because an exception kills the loop it lives in.
 */
export async function runTool(name: string, rawArgs: string): Promise<string> {
  const fn = TOOLS[name];
  if (!fn) return `<tool_error>no such tool: ${name}</tool_error>`;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch (err) {
    // Models do emit malformed JSON, especially when an argument contains code.
    // That is a tool error, not a crash.
    return `<tool_error>arguments were not valid JSON: ${(err as Error).message}</tool_error>`;
  }

  try {
    return await fn(args);
  } catch (err) {
    return `<tool_error>${name} failed: ${(err as Error).message}</tool_error>`;
  }
}
```

Note that **every** failure path returns a string. This is idea #2 of the week
in twelve lines.

### 1e. The API call learns about tools

The only change to `model.ts` from Week 4 is that a stream can now carry tool
calls, and those arrive in fragments exactly like text does.

```ts
// model.ts — the API call, and nothing else.
//
// Week 4's version streamed text and reported usage. Week 5 adds one thing: the
// stream can now also carry TOOL CALLS, and those arrive in fragments just like
// text does — the function name in one chunk, the JSON arguments a few
// characters at a time across many more.
//
// Reassembling them is the one piece of genuine protocol handling in the whole
// week, and `index` is the field that makes it possible: it says which call a
// fragment belongs to when the model asks for three things at once.
import OpenAI from "openai";
import type { Usage } from "./cost.js";
import type { ToolSpec } from "./tools/specs.js";

export type Msg = OpenAI.Chat.ChatCompletionMessageParam;

export const MODEL = process.env.MODEL ?? "gpt-4o-mini";

// Part 1's prompt. It describes an agent that can look but not touch, because
// that is all it can do yet. The prompt grows with the tools, in Part 5.
export const SYSTEM_PROMPT =
  "You are mycode, a coding agent working in the user's project directory.\n" +
  "You can read files and search the project: read_file, glob_files, grep_search.\n" +
  "Use the tools to answer from what is actually on disk — never from memory or\n" +
  "guesswork. Cite files as path:line. Be concise.";

// Constructed on first use, not at import: a module that throws merely because
// it was imported cannot be loaded by a test or a type checker.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI());

export function isAbort(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIUserAbortError ||
    (err as { name?: string })?.name === "AbortError"
  );
}

/** A tool call, reassembled from its fragments. `args` is still raw JSON text. */
export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "calls"; calls: ToolCall[] };

/**
 * One model call. Yields text as it arrives, then — once the stream is over —
 * the tool calls it asked for, if any.
 *
 * Why the calls come at the end: an incomplete `{"path": "src/ap` is not
 * something you can act on. Text is useful half-finished; JSON arguments are
 * not, so we hold them until the stream closes.
 */
export async function* streamTurn(
  messages: Msg[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const stream = await client().chat.completions.create(
    {
      model: MODEL,
      messages,
      tools,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  );

  const partial: ToolCall[] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) yield { type: "delta", text: delta.content };

    for (const tc of delta?.tool_calls ?? []) {
      // `??=` because a fragment for index 2 can arrive before index 1 exists.
      const slot = (partial[tc.index] ??= { id: "", name: "", args: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
    }

    if (chunk.usage) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      yield {
        type: "usage",
        usage: {
          // prompt_tokens INCLUDES the cached ones. Subtract, or you bill the
          // discounted tokens at full price.
          input: chunk.usage.prompt_tokens - cached,
          cachedInput: cached,
          output: chunk.usage.completion_tokens,
        },
      };
    }
  }

  const calls = partial.filter(Boolean);
  if (calls.length) yield { type: "calls", calls };
}
```

> **The one piece of real protocol handling this week.** The function name
> arrives in one chunk, the JSON arguments a few characters at a time across
> many more, and `index` is what tells you which call a fragment belongs to when
> the model asks for three things at once. Get this wrong and you will see
> `{"path": "src/ap` in your logs and blame the model.

### 1f. The loop

Here is the whole game.

```ts
// session.ts — the agent loop. This is the whole game.
//
// Week 4's Session sent a message and streamed a reply. That is a chatbot. The
// only structural change this week is the `for` loop below:
//
//     ask the model  →  did it request tools?
//         no  → done, return the text
//         yes → run each one, append every result, ask again
//
// Everything else in Week 5 — six tools, six guards, a permission gate — hangs
// off that loop. Two rules in it are absolute:
//
//   1. EVERY tool call gets a result. The API rejects a conversation that
//      contains an assistant message with tool_calls and no matching tool
//      messages. A denied call, a crashed call and an interrupted call all
//      still return something.
//   2. There is ALWAYS a step limit. An agent that can loop forever will,
//      eventually, on some input, at 3am, on your account.
//
// And, as in Week 4: no console.log, no readline, no DOM. The terminal in
// repl.ts and the browser in ../../week5-gui/ both drive this same class.
import { isAbort, MODEL, streamTurn, SYSTEM_PROMPT, type Msg } from "./model.js";
import { CostMeter, ZERO, type Usage } from "./cost.js";
import { TOOL_SPECS } from "./tools/specs.js";
import { runTool } from "./tools/registry.js";

export const MAX_STEPS = 40;

/** One completed tool call, for the interface to draw as a receipt. */
export interface ToolRun {
  id: string;
  name: string;
  args: Record<string, any>;
  result: string;
  ms: number;
}

export interface TurnHandlers {
  onDelta?: (text: string) => void;
  onFirstToken?: (ms: number) => void;
  onUsage?: (usage: Usage) => void;
  /** A new model call is starting. `step` is 0-based. */
  onStep?: (step: number) => void;
  /** The model asked for a tool. Fires BEFORE it runs — this is the spinner. */
  onToolStart?: (call: { id: string; name: string; args: Record<string, any> }) => void;
  /** The tool finished. Fires with the receipt. */
  onToolEnd?: (run: ToolRun) => void;
}

export interface TurnResult {
  text: string;
  interrupted: boolean;
  ms: number;
  ttft: number;
  usage: Usage;
  steps: number;
  tools: ToolRun[];
  /** True when the loop stopped because it ran out of steps, not because it finished. */
  hitStepLimit: boolean;
}

const add = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cachedInput: a.cachedInput + b.cachedInput,
  output: a.output + b.output,
});

export class Session {
  readonly messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
  readonly meter = new CostMeter(MODEL);

  private inflight: AbortController | null = null;

  get busy(): boolean {
    return this.inflight !== null;
  }

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
    let ttft = 0;
    let first = true;
    let text = "";
    let interrupted = false;
    let usage: Usage = { ...ZERO };
    let steps = 0;
    let hitStepLimit = false;
    const tools: ToolRun[] = [];

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        steps = step + 1;
        handlers.onStep?.(step);

        let content = "";
        let calls: { id: string; name: string; args: string }[] = [];

        for await (const ev of streamTurn(this.messages, TOOL_SPECS, controller.signal)) {
          if (ev.type === "usage") {
            // Every step is billed. A turn's cost is the SUM of its steps, and
            // a five-step turn is roughly five times the price of a chat reply
            // — which is exactly why the meter from Week 4 is still here.
            usage = add(usage, ev.usage);
            handlers.onUsage?.(usage);
            continue;
          }
          if (ev.type === "calls") {
            calls = ev.calls;
            continue;
          }
          if (first) {
            first = false;
            ttft = Date.now() - started;
            handlers.onFirstToken?.(ttft);
          }
          content += ev.text;
          text += ev.text;
          handlers.onDelta?.(ev.text);
        }

        // The assistant's own message goes into history BEFORE the results, and
        // it has to carry the tool_calls verbatim — the ids are how the API
        // pairs a result with its request.
        this.messages.push({
          role: "assistant",
          content: content || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: c.args },
                })),
              }
            : {}),
        } as Msg);

        // No tools requested → the model is done talking. Note that we decide
        // this from the presence of tool calls, not from `finish_reason`, which
        // is not reliable enough to branch on.
        if (!calls.length) return this.finish(started, { text, interrupted, ttft, usage, steps, tools, hitStepLimit });

        for (const call of calls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.args || "{}");
          } catch {
            /* runTool reports it properly; this is only for the receipt */
          }
          handlers.onToolStart?.({ id: call.id, name: call.name, args });

          const t0 = Date.now();
          const result = await runTool(call.name, call.args);
          const run: ToolRun = { id: call.id, name: call.name, args, result, ms: Date.now() - t0 };
          tools.push(run);
          handlers.onToolEnd?.(run);

          this.messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }
      hitStepLimit = true;
    } catch (err) {
      if (!isAbort(err)) {
        this.inflight = null;
        throw err;
      }
      interrupted = true;
      // An interrupt can land between "the model asked for three tools" and
      // "we ran them". If it does, history now holds an assistant message with
      // dangling tool_calls, and the NEXT request is rejected by the API. So we
      // close every one of them with a synthetic result. The real Claude Code
      // does exactly this on cancellation.
      this.closeDanglingCalls();
    } finally {
      this.inflight = null;
    }

    // Do not rely on an exception to tell you the turn was cancelled: some
    // clients throw, others simply stop iterating. The signal is true in both.
    if (controller.signal.aborted) interrupted = true;

    return this.finish(started, { text, interrupted, ttft, usage, steps, tools, hitStepLimit });
  }

  /** Bill the turn and hand back the receipt. */
  private finish(
    started: number,
    r: Omit<TurnResult, "ms">,
  ): TurnResult {
    // An interrupted stream never delivers its usage chunk, but those tokens
    // were generated and are billed. Estimating is honest; reporting zero is not.
    const usage = r.interrupted && r.usage.output === 0
      ? { ...r.usage, output: Math.ceil(r.text.length / 4) }
      : r.usage;

    if (r.interrupted) {
      const last = this.messages.at(-1);
      if (last?.role === "assistant" && typeof last.content === "string") {
        last.content = `${last.content}\n\n[interrupted by the user]`.trim();
      } else if (last?.role !== "tool") {
        this.messages.push({ role: "assistant", content: "[interrupted by the user]" });
      }
    }

    this.meter.record(usage);
    return { ...r, usage, ms: Date.now() - started };
  }

  /** Give every unanswered tool_call a result, so history stays valid. */
  private closeDanglingCalls(): void {
    const answered = new Set(
      this.messages.filter((m) => m.role === "tool").map((m: any) => m.tool_call_id),
    );
    for (const msg of this.messages) {
      if (msg.role !== "assistant") continue;
      for (const call of (msg as any).tool_calls ?? []) {
        if (answered.has(call.id)) continue;
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "<tool_error>the user interrupted before this ran</tool_error>",
        });
      }
    }
  }
}
```

Read the `for` loop and nothing else, twice. Everything in this week hangs off
those fifteen lines:

```
ask the model → did it ask for tools?
    no  → done, return the text
    yes → run each one, append every result, ask again
```

**Two rules in it are absolute.**

1. **Every tool call gets a result.** The API rejects a conversation containing
   an assistant message with `tool_calls` and no matching `tool` messages. A
   denied call, a crashed call, an interrupted call — all still return
   something. That is what `closeDanglingCalls()` is for: an interrupt can land
   between "the model asked for three tools" and "we ran them", and without it
   the *next* request fails with a 400 that has nothing to do with the next
   request.
2. **There is always a step limit.** An agent that can loop forever will,
   eventually, on some input, at 3am, on your account.

Also notice what is *not* here: no `console.log`, no `readline`, no DOM. The
terminal and the browser both drive this same class.

### 1g. Drawing it

```ts
// repl.ts — Part 1: an agent that can look but not touch.
//
// Same shape as Week 4's REPL: read a line, stream a reply, print a footer.
// The new part is in the middle — while the model works, tool calls scroll past
// with their results. Everything it can do is read-only, so there is nothing to
// approve yet and nothing that can go wrong. That is the point of starting here:
// you get the loop working while the stakes are zero.
//
// Run:  npm run part1
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask, banner, c, resultLine, Spinner, toolLine } from "./ui.js";
import { MODEL } from "./model.js";
import { Session } from "./session.js";
import { formatUSD } from "./cost.js";

async function main(): Promise<void> {
  banner("v0.2 · part 1 — read-only tools", `${MODEL} — read_file · glob_files · grep_search`);
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
```

The tool receipt is printed in two halves at two different times — the call
before it runs, the result after — with the spinner turning in between. That is
how a user tells a slow `grep` from a hung program.

Add to `ui.ts`:

```ts
// ---------------------------------------------------------------------------
// Week 5 additions: drawing a tool call.
//
// A turn is no longer "the model said something". It is a sequence of actions
// with results, and the user has to be able to audit it at a glance. Three
// rules, all of them borrowed from watching real agents fail in front of an
// audience:
//
//   1. Show the tool BEFORE it runs, not after. A three-second grep that
//      appears only once it is finished looks like a freeze.
//   2. Show the arguments, not a summary. "editing a file" is not auditable;
//      the path and the diff are.
//   3. Show the result in ONE line. The model gets the whole 2,000-line file;
//      the human gets "read 412 lines". They have different jobs.
const TOOL_ICON: Record<string, string> = {
  read_file: "◇", write_file: "◆", edit_file: "✎",
  run_bash: "$", glob_files: "❯", grep_search: "⌕",
};

/** The one-line preview of what a tool is about to do. */
export function toolPreview(name: string, args: Record<string, any>): string {
  switch (name) {
    case "read_file":   return String(args.path ?? "");
    case "write_file":  return `${args.path} (${String(args.content ?? "").length} chars)`;
    case "edit_file":   return String(args.path ?? "");
    case "run_bash":    return String(args.command ?? "");
    case "glob_files":  return String(args.pattern ?? "");
    case "grep_search": return `/${args.pattern}/${args.glob && args.glob !== "*" ? ` in ${args.glob}` : ""}`;
    default:            return JSON.stringify(args).slice(0, 80);
  }
}

export function toolLine(name: string, args: Record<string, any>): string {
  const icon = TOOL_ICON[name] ?? "•";
  return `  ${c.violet(icon)} ${c.bold(name)} ${c.dim(toolPreview(name, args))}`;
}

/**
 * Collapse a tool result to one line for the human. The model still receives
 * every byte — this is purely the receipt.
 */
export function resultLine(result: string, ms: number): string {
  const failed = result.startsWith("<tool_error>");
  const first = result.split("\n")[0].replace(/<\/?tool_error>/g, "");
  const lines = result.split("\n").length;
  const body = failed
    ? c.red(first.slice(0, 100))
    : c.dim(lines > 1 ? `${lines} lines` : first.slice(0, 100) || "ok");
  return `    ${failed ? c.red("⨯") : c.green("✔")} ${body} ${c.dim(`(${ms}ms)`)}`;
}
```

### Check

```bash
npm run part1
› which files define the tool specs, and how many tools are declared?
```

You should see `grep_search`, then `read_file`, then an answer that cites real
paths. Ask it something about a file that does not exist and watch it recover
from a `<tool_error>` — that recovery is the whole design working.

---

## Step 2 — write and edit, and the six guards

**Add:** `writeFile` to `tools/fs.ts`, a new `tools/edit.ts`, two more specs,
two registry entries. The interface does not change at all.

### 2a. `write_file` and the read-before-write gate

```ts
export interface WriteArgs { path: string; content: string }

/**
 * write_file — create a file, or overwrite one you have already read.
 *
 * The gate is the whole point. An LLM that overwrites a file it never looked at
 * will cheerfully delete your work based on a hallucinated memory of what the
 * file "probably" contained, and it will sound confident while doing it. The
 * rule sounds bureaucratic: you may not write a file you have not read. It is
 * the difference between a safe agent and a dangerous one.
 *
 * Creating a NEW file is exempt — there is nothing to destroy.
 */
export function writeFile({ path: p, content }: WriteArgs): string {
  const exists = fs.existsSync(p);
  if (exists && !READ_STATE.has(p)) {
    return "<tool_error>refusing to overwrite a file you have not read. " +
      "Call read_file on it first, so your write is based on what is actually " +
      "there rather than what you remember.</tool_error>";
  }
  const dir = path.dirname(p);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, content);
  READ_STATE.set(p, fs.statSync(p).mtimeMs);   // we know the contents: re-arm
  return `${exists ? "overwrote" : "created"} ${p} (${content.length} chars)`;
}
```

The rule sounds bureaucratic and is the difference between a safe agent and a
dangerous one: **you may not overwrite a file you have not read.** An LLM that
writes a file it never looked at will cheerfully delete your work based on a
hallucinated memory of what the file "probably" contained, and it will sound
confident doing it. Creating a *new* file is exempt — there is nothing to
destroy.

### 2b. `edit_file` — six guards

```ts
// tools/edit.ts — the sharpest tool in the box, and therefore the one with the
// most guards.
//
// The design is exact-string replacement: the model hands over an `old_string`
// and a `new_string`, and we swap the first for the second — but only after six
// checks pass. Every guard is here because the failure it prevents WILL happen
// in real use, usually in the first hour.
//
// Why exact-match rather than the alternatives:
//   - "regenerate the whole file" burns tokens, produces an unreviewable diff,
//     and quietly drops the parts of the file the model forgot.
//   - "patch at line 42" breaks the moment any earlier edit shifts the lines.
//   - exact-match is small, reviewable, and fails LOUDLY when the model's idea
//     of the file no longer matches the disk.
import fs from "node:fs";
import { READ_STATE } from "./fs.js";

export interface EditArgs {
  path: string;
  old_string: string;
  new_string: string;
}

export function editFile({ path: p, old_string, new_string }: EditArgs): string {
  // 1. a no-op edit. Costs a whole step and changes nothing.
  if (old_string === new_string) {
    return "<tool_error>old_string and new_string are identical — nothing to do</tool_error>";
  }

  // 2. the file has to exist. write_file creates; edit_file changes.
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return `<tool_error>not found: ${p}. Use write_file to create a new file.</tool_error>`;
  }

  // 3. read-before-edit. Without this the model edits its own memory of the file.
  if (!READ_STATE.has(p)) {
    return "<tool_error>this file has not been read yet. Call read_file on it " +
      "first so your edit is based on what is actually there.</tool_error>";
  }

  // 4. staleness. Between the read and the edit, a test run, a formatter or a
  //    human may have changed the file. Applying a stale edit clobbers them.
  if (fs.statSync(p).mtimeMs > READ_STATE.get(p)! + 1e-6) {
    return `<tool_error>${p} changed on disk since you read it. ` +
      `read_file it again before editing.</tool_error>`;
  }

  const text = fs.readFileSync(p, "utf8");
  const count = text.split(old_string).length - 1;

  // 5. no match. The silent killer: without this check the model believes an
  //    edit succeeded and goes on to "verify" a change that never happened.
  if (count === 0) {
    return "<tool_error>old_string was not found. It must match EXACTLY, " +
      "including whitespace and indentation. read_file the region again and " +
      "copy the text verbatim.</tool_error>";
  }

  // 6. ambiguity. Three identical lines and a one-line old_string means we
  //    would edit the first one, which is a coin flip. Make the model decide.
  if (count > 1) {
    return `<tool_error>old_string appears ${count} times in ${p}. Include ` +
      `surrounding lines to make it unique.</tool_error>`;
  }

  fs.writeFileSync(p, text.replace(old_string, new_string));
  // Re-arm rather than clear: two edits in a row to the same file are normal,
  // and the second one should not be rejected as stale by the first.
  READ_STATE.set(p, fs.statSync(p).mtimeMs);

  // Terse on purpose. The diff is for the human, drawn by the interface from
  // the arguments it already has. Echoing it back to the model is paying twice
  // for text it wrote itself.
  return `edited ${p}`;
}
```

| # | Guard | The failure it prevents |
|---|---|---|
| 1 | `old ≠ new` | a no-op edit that costs a whole step |
| 2 | file exists | editing something that was never there |
| 3 | read-before-edit | editing a hallucinated version of the file |
| 4 | not modified since read | clobbering a change made by a test run, a formatter, or you |
| 5 | found at all | a silent no-match the model believes succeeded, then "verifies" |
| 6 | exactly one match | changing the wrong one of several identical lines |

Guard 5 is the one people leave out, and it is the worst: without it the model
reports success, moves on, and the bug is still there.

Note the terse success string. `edited utils.ts` — no diff. The diff is for the
human, drawn by the interface from arguments it already has; echoing it back to
the model means paying for text the model wrote itself.

> **Why exact-match at all?** The alternatives are worse. "Regenerate the whole
> file" burns tokens, produces an unreviewable diff, and quietly drops the parts
> the model forgot. "Patch at line 42" breaks the moment an earlier edit shifts
> the lines. Exact-match is small, reviewable, and fails **loudly** when the
> model's idea of the file no longer matches the disk.

### 2c. Tell the model

Add the two specs (`part2-write-edit/tools/specs.ts`) and register the
functions. Then extend the system prompt — this is the cheap half of safety:

```ts
"ALWAYS read_file a file before editing it; edit_file refuses otherwise.\n" +
"Prefer edit_file (a surgical change) over write_file (a full rewrite).\n"
```

Guards catch the model. Descriptions teach it. You want both, and you want the
description to do most of the work.

### Check

```bash
npm run sandbox:reset && npm run part2
› read utils.ts and fix parseDuration so it multiplies by the unit
```

Then, deliberately, break it:

```
› change the word "total" to "sum" in utils.ts
```

Guard 6 fires — `old_string appears 4 times` — and the model recovers by adding
surrounding lines. **Now make the error message vaguer** (just "bad edit") and
run it again. Watch the model flail. That contrast is the most useful ninety
seconds in the week.

---

## Step 3 — the shell

**Add:** `tools/shell.ts`, one spec, one registry entry, two lines of prompt.

```ts
// tools/shell.ts — run_bash. The most powerful tool you own and the easiest to
// get killed by.
//
// Three rules keep it survivable, and each one maps to a specific way a live
// demo dies:
//
//   always a timeout — the model runs `npm run dev`, the server never exits,
//                      and your agent hangs forever with a spinner on screen.
//   always a cap     — a command that prints two million lines should not be
//                      allowed to spend your entire context window. We keep the
//                      head AND the tail, because errors live at the ends: the
//                      command that failed is at the start, the stack trace is
//                      at the end, and the middle is usually noise.
//   never a crash    — a non-zero exit code and a page of stderr are exactly
//                      the information the model needs to fix its next move.
//                      Return them as data. An exception ends the loop; an
//                      error message continues it.
import { spawnSync } from "node:child_process";

const MAX_OUT = 30_000;      // characters of combined stdout+stderr
const DEFAULT_TIMEOUT = 120; // seconds
const MAX_TIMEOUT = 600;

export interface BashArgs {
  command: string;
  /** Why the model wants to run it. Shown to the human in the permission prompt. */
  reason?: string;
  timeout_s?: number;
}

export function runBash({ command, timeout_s = DEFAULT_TIMEOUT }: BashArgs): string {
  const seconds = Math.min(timeout_s || DEFAULT_TIMEOUT, MAX_TIMEOUT);

  const r = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    timeout: seconds * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  // A killed-by-timeout process reports SIGTERM here. Say so plainly, and tell
  // the model what to do differently — an error message is a second prompt.
  if (r.error?.message?.includes("ETIMEDOUT") || r.signal === "SIGTERM") {
    return `<tool_error>timed out after ${seconds}s. If this is a server, a ` +
      `watcher or an interactive prompt it will never exit — do not run it here. ` +
      `Run the one-shot version instead.</tool_error>`;
  }
  if (r.error) return `<tool_error>could not run: ${r.error.message}</tool_error>`;

  let out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (out.length > MAX_OUT) {
    const half = Math.floor(MAX_OUT / 2);
    out = `${out.slice(0, half)}\n… [output trimmed] …\n${out.slice(-half)}`;
  }
  // Never return an empty string: a model reading "" tends to assume the tool
  // is broken and run the command again.
  if (!out) out = "(command completed with no output)";

  return `exit code: ${r.status ?? "killed"}\n${out}`;
}
```

Three rules, each one a specific way a live demo dies:

- **Always a timeout.** The model runs `npm run dev`, the server never exits,
  your agent hangs forever with a spinner on screen.
- **Always a cap, keeping head *and* tail.** Errors live at the ends: the
  command that failed is at the start, the stack trace at the end, and the
  middle is noise.
- **Never a crash.** A non-zero exit code and a page of stderr are exactly what
  the model needs to fix its next move.

Add to the prompt the sentence that turns a code-changer into an engineer:

```
After a change that can be tested, run the test with run_bash and read the
output. Never claim a test passed without running it.
```

### Check

```bash
npm run sandbox:reset && npm run part3
› run the tests with: node --test --experimental-strip-types utils.test.ts
  then fix whatever fails and run them again.
```

Reproduce → read → edit → verify, in one turn, with no human in the loop. Which
is exactly the problem: **nobody asked you about any of it.** Stop the class
here for a moment and let that sit.

---

## Step 4 — permissions: the adult in the room

**Add:** `tools/permissions.ts`, an `approve` handler in `session.ts`, a
permission box in `ui.ts`. This is the most important step of the week.

### 4a. The ladder

```ts
// tools/permissions.ts — the gate between a language model and your machine.
//
// You have just handed an LLM a shell. Without this file, "clean up the temp
// files" can become an `rm -rf` in the wrong directory, and "reset my branch"
// can throw away a day's work. The permission system is the adult in the room.
//
// Every tool call is classified into exactly one of three outcomes:
//
//   ALLOW — read-only tools. They cannot change anything, so they never ask.
//           This set IS your trust boundary: keep it small and obviously safe.
//   DENY  — a short list of catastrophes, refused outright. This is a backstop,
//           not security: it means an obvious disaster needs a human to
//           deliberately override it, not that the list is complete.
//   ASK   — everything else. Show the user exactly what will happen, and wait.
//
// The ladder is the design. Deny rules are checked before ask rules, ask rules
// before allow rules, and anything unrecognised falls through to ASK — the
// system FAILS CLOSED. A permission system that fails open is decoration.

/** Read-only tools never need to ask. This set is the trust boundary. */
export const SAFE_TOOLS = new Set(["read_file", "glob_files", "grep_search"]);

/**
 * Shell commands matching any of these are denied outright, always, even if the
 * user has said "always allow" for that program. These are the operations where
 * a mistake is not recoverable by ctrl-Z or a git checkout.
 */
const DANGEROUS: [RegExp, string][] = [
  [/\brm\s+-[a-z]*[rf]/i, "recursive or forced delete"],
  [/:\s*\(\s*\)\s*\{/, "fork bomb"],
  [/\bgit\s+push\b[^\n]*--force/i, "force push"],
  [/\bgit\s+reset\b[^\n]*--hard/i, "hard reset — discards uncommitted work"],
  [/\bsudo\b/, "sudo"],
  [/>\s*\/dev\/(sd|nvme|disk)/i, "writing to a raw device"],
  [/\bmkfs\b/i, "formatting a filesystem"],
  [/\bdd\s+if=/i, "dd"],
  [/curl[^|]*\|\s*(sudo\s+)?(ba)?sh/i, "piping a download into a shell"],
  [/\bchmod\s+-R\s+777/i, "recursive chmod 777"],
];

export type Decision = "allow" | "ask" | "deny";
export const ALLOW = "allow" as const;
export const ASK = "ask" as const;
export const DENY = "deny" as const;

/** What the user is being asked to approve, in their words rather than JSON. */
export interface Verdict {
  decision: Decision;
  why: string;
}

/**
 * The allowlist grows when the user answers "always". It holds two shapes of
 * key: a bare tool name ("edit_file") and a bash command prefix
 * ("run_bash:npm"). Per-program is the right granularity for a shell — saying
 * "always" to `npm test` should not also approve `curl`.
 */
export type Allowlist = Set<string>;

export function allowKey(tool: string, args: Record<string, any>): string {
  if (tool !== "run_bash") return tool;
  const program = String(args.command ?? "").trim().split(/\s+/)[0] ?? "";
  return `run_bash:${program}`;
}

export function classify(
  tool: string,
  args: Record<string, any>,
  allowlist: Allowlist,
): Verdict {
  if (SAFE_TOOLS.has(tool)) return { decision: ALLOW, why: "read-only" };

  if (tool === "run_bash") {
    const command = String(args.command ?? "");
    // Deny first. A denied pattern is never overridable by the allowlist —
    // that ordering is the whole reason to write the ladder in this direction.
    for (const [pattern, label] of DANGEROUS) {
      if (pattern.test(command)) return { decision: DENY, why: label };
    }
    const key = allowKey(tool, args);
    if (allowlist.has(key)) return { decision: ALLOW, why: `allowlisted: ${key.slice(9)}` };
    return { decision: ASK, why: args.reason ? String(args.reason) : "run a shell command" };
  }

  if (allowlist.has(tool)) return { decision: ALLOW, why: "allowlisted" };

  // Anything we do not recognise — including a tool added next month by someone
  // who never read this file — asks. Fail closed.
  return { decision: ASK, why: tool === "edit_file" ? "modify a file" : "write to disk" };
}
```

- **Allow** — read-only tools. They cannot change anything, so they never ask.
  `SAFE_TOOLS` *is* your trust boundary: keep it small and obviously safe.
- **Deny** — a short list of catastrophes, refused outright. This is a backstop,
  not security. It does not mean the list is complete; it means an obvious
  disaster needs a human to deliberately override it.
- **Ask** — everything else, including anything unrecognised. The system **fails
  closed**. A permission system that fails open is decoration.

Order matters: deny is checked *before* the allowlist, so saying "always allow
sudo" cannot talk the gate into `sudo rm -rf /`.

### 4b. The session asks somebody else

The session cannot ask a question — it does not know what a terminal is. So it
hands the question **out** and waits on a promise:

```ts
  /**
   * Where a tool call meets the permission gate — the single most important
   * function in the whole agent, because it is the one standing between a
   * language model and your filesystem.
   *
   * Classify, then deny / ask / allow, and only then run. Every path returns a
   * string: a denial is a tool RESULT, not an exception. The model reads "the
   * user denied this" and takes another route, which is exactly what you want
   * it to do.
   */
  private async dispatch(
    call: { id: string; name: string; args: string },
    args: Record<string, any>,
    handlers: TurnHandlers,
  ): Promise<{ result: string; decision: Decision; why: string; ms: number }> {
    const { decision, why } = classify(call.name, args, this.allowlist);

    if (decision === DENY) {
      return {
        decision, why, ms: 0,
        result: `<tool_error>denied: ${why}. This is blocked by policy and ` +
          `asking again will not change it. Find another way, or ask the user ` +
          `to do it themselves.</tool_error>`,
      };
    }

    if (decision === ASK) {
      // No approval handler means no human is watching. Fail closed.
      if (!handlers.approve) {
        return { decision, why, ms: 0, result: "<tool_error>denied: this interface cannot ask for approval</tool_error>" };
      }
      const answer = await handlers.approve({ id: call.id, name: call.name, args, why });
      if (answer === "always") this.allowlist.add(allowKey(call.name, args));
      else if (answer !== "yes") {
        return {
          decision, why, ms: 0,
          result: "<tool_error>the user denied this action. Do not retry it. " +
            "Explain what you wanted to do and why, or propose something else." +
            "</tool_error>",
        };
      }
    }

    const t0 = Date.now();
    const result = await runTool(call.name, call.args);
    return { result, decision, why, ms: Date.now() - t0 };
  }
```

`dispatch` is the single most important function in your agent, because it is
the one standing between a language model and your filesystem. Parse
defensively, classify, deny / ask / allow, and only then run.

Note the shape of a denial: it is a **tool result**, not an exception. The model
reads "the user denied this action" and takes another route, which is exactly
what you want it to do.

And note the failure mode when no `approve` handler is supplied: everything that
would ask becomes a denial. Fail closed, again.

### 4c. The prompt a human actually sees

```ts
// ---------------------------------------------------------------------------
// Part 4: the permission prompt.
//
// This is where trust is built or destroyed. Show the user EXACTLY what is
// about to happen — the command, the path, the two lines of the diff — before
// anything runs. A vague "the agent wants to do something. Allow?" teaches
// people to press y without reading, which is worse than having no gate at all.
export interface ApprovalView {
  name: string;
  args: Record<string, any>;
  why: string;
}

/** The box, as lines. Kept separate from the asking so it is easy to test. */
export function permissionBox(req: ApprovalView): string[] {
  const bar = c.amber("│");
  const lines = [
    `\n${c.amber("┌─ permission needed")}`,
    `${bar} ${c.bold(req.name)} ${c.dim(`— ${req.why}`)}`,
  ];
  const { name, args } = req;
  if (name === "run_bash") {
    lines.push(`${bar}   ${c.bold("$")} ${args.command}`);
  } else if (name === "edit_file") {
    lines.push(`${bar}   ${args.path}`);
    for (const l of String(args.old_string ?? "").split("\n").slice(0, 6)) {
      lines.push(`${bar}   ${c.red(`- ${l.slice(0, 90)}`)}`);
    }
    for (const l of String(args.new_string ?? "").split("\n").slice(0, 6)) {
      lines.push(`${bar}   ${c.green(`+ ${l.slice(0, 90)}`)}`);
    }
  } else if (name === "write_file") {
    const content = String(args.content ?? "");
    const n = content.split("\n").length;
    lines.push(`${bar}   ${args.path} ${c.dim(`(${n} lines, ${content.length} chars)`)}`);
    for (const l of content.split("\n").slice(0, 6)) {
      lines.push(`${bar}   ${c.green(`+ ${l.slice(0, 90)}`)}`);
    }
  } else {
    lines.push(`${bar}   ${c.dim(JSON.stringify(args).slice(0, 120))}`);
  }
  return lines;
}

/** Draw the box and block until the human answers. */
export async function askApproval(
  rl: { question(q: string): Promise<string> },
  req: ApprovalView,
): Promise<"yes" | "always" | "no"> {
  for (const line of permissionBox(req)) console.log(line);
  let answer: string;
  try {
    answer = await rl.question(`${c.amber("└─")} ${c.green("[y]es")} · ${c.violet("[a]lways")} · ${c.dim("[N]o")} `);
  } catch {
    return "no";                    // stdin closed mid-question: deny
  }
  // Default is NO. The capital N in the prompt is not decoration — pressing
  // Enter without reading must never approve anything.
  const key = answer.trim().toLowerCase();
  if (key === "y" || key === "yes") return "yes";
  if (key === "a" || key === "always") return "always";
  return "no";
}
```

This is where trust is built or destroyed. Show the **exact** thing that will
happen — the command, the path, the two sides of the diff — before it happens. A
vague "the agent wants to do something, allow?" teaches people to press `y`
without reading, which is worse than having no gate at all.

Default is **no**. The capital N is not decoration: pressing Enter without
reading must never approve anything.

Then in `repl.ts`, one handler:

```ts
approve: async (req) => {
  spinner.stop();                       // or it repaints over the question
  const choice = await askApproval(rl, req);
  spinner.start();
  return choice;
},
```

### Check

```bash
npm run sandbox:reset && npm run part4
› run the tests, fix the bug, run them again
```

Say `y` to the first command, `y` to the edit, `a` to the re-run — and watch the
second `node` command execute with `[allowlisted: node]` and no prompt. Then:

```
› delete every .ts file in this directory with rm -rf
```

Denied outright, no prompt, and the agent explains itself instead of crashing.

---

## Step 5 — the system prompt grows up, and the tools become visible

**Add:** the v0.2 prompt, `commands.ts` (Week 4's, plus three), the `smoke.ts`
test file.

### 5a. The prompt

```ts
// The system prompt grows up.
//
// v0.1 said "you are a chat assistant". This is v0.2, and every line of it is
// there because of a specific failure mode observed in a live session:
//
//   read before edit      — the model editing its memory of a file
//   search tools not grep — `run_bash("grep -r foo .")`, uncapped, 40k tokens
//   edit over write       — a "small fix" that silently drops half the file
//   run the test          — "I've fixed it and the tests now pass" (untested)
//   small verified steps  — six edits in one turn, none of them checked
//   stop when done        — a model that keeps finding one more improvement
//
// A model with good tools and a bad working style thrashes. This paragraph is
// the difference between an eager intern and an engineer, and it costs about
// 150 tokens a turn. Week 6 is entirely about what belongs in here and what
// should be loaded on demand.
export const SYSTEM_PROMPT = `You are mycode, a coding agent working in the user's project directory.
You have tools: read_file, write_file, edit_file, run_bash, glob_files, grep_search.

How to work:
- Before editing a file, ALWAYS read_file it first. edit_file will refuse otherwise.
- To find things use grep_search and glob_files, never \`grep\` or \`find\` through run_bash.
- Prefer edit_file (a surgical change) over write_file (a full rewrite).
- After a change that can be tested, run the test with run_bash and read the output.
- Work in small verified steps: make one change, verify it, then make the next.
- When you are done, STOP and summarise what you changed and how you verified it.

Never claim a test passed without running it. If a tool returns <tool_error>, read
the message and fix your next call — do not repeat the call that just failed.
If the user denies a permission, do not ask again for the same thing: say what you
wanted to do and why, and offer an alternative.`;
```

Every line is there because of a specific observed failure. A model with good
tools and a bad working style thrashes; this paragraph is the difference between
an eager intern and an engineer, and it costs about 150 tokens a turn.

> **This prompt is a placeholder for a whole week.** Week 6 is entirely about
> what belongs in the system prompt, what should be loaded on demand, how to
> read a project's `AGENTS.md` automatically, and how to keep a long
> conversation from overflowing the context window.

### 5b. Three new commands

Week 4's `commands.ts` comes across unchanged except for the context type — it
now carries the allowlist — plus three commands an agent with hands needs:

| command | kind | what it answers |
|---|---|---|
| `/tools` | render | what can this thing actually do, and which of those ask first? |
| `/allowed` | render | what have I already agreed to? |
| `/revoke` | local | forget all of it |

`/allowed` matters more than it looks. "Always allow" is a decision users make
in half a second while reading something else; a way to see and undo those
decisions is what makes it safe to offer at all.

### 5c. Prove it works — two tiers

```bash
npm run guards     # 32 assertions, offline, free, no API key
npm run smoke      # the above, plus one real agent run
```

The split is the point:

- **Guards** are deterministic. Every guard in `edit.ts` and every branch of
  `classify()` is a pure function of its inputs, so it is testable like ordinary
  code. Most of your safety story never needs a network.
- **Live** is one real run. It is slow, costs a fraction of a cent, and is
  non-deterministic — so it asserts on **outcomes** (the bug is fixed, the tests
  pass, nothing ran without approval, the denial reached the model as a result)
  and never on the exact sequence of tool calls the model chose.

Writing a test that asserts "the model calls grep, then read, then edit" is how
you get a test suite that fails every time OpenAI ships a checkpoint.

### Check — the demo the whole week was for

```bash
npm run sandbox:reset && npm start
› The test in utils.test.ts fails. Run it with
  `node --test --experimental-strip-types utils.test.ts`, fix the bug, and run
  it again to prove it passes.
```

```
  $ run_bash node --test --experimental-strip-types utils.test.ts
┌─ permission needed
│ run_bash — check whether the tests currently pass
│   $ node --test --experimental-strip-types utils.test.ts
└─ [y]es · [a]lways · [N]o y
    ✔ 32 lines (183ms) [ask]
  ◇ read_file utils.ts
    ✔ 16 lines (0ms) [read-only]
  ✎ edit_file utils.ts
┌─ permission needed
│ edit_file — modify a file
│   utils.ts
│   - total += Number(value);
│   + total += Number(value) * { h: 3600, m: 60, s: 1 }[unit];
└─ [y]es · [a]lways · [N]o y
    ✔ edited utils.ts (0ms) [ask]
  $ run_bash node --test --experimental-strip-types utils.test.ts
    ✔ 11 lines (147ms) [allowlisted: node]

parseDuration added the numbers and ignored the unit. It now multiplies by
3600 / 60 / 1, and both tests pass.
  6 step(s) · 5 tool call(s) · 8.2s · 3462 in (+4096 cached) · 253 out · $0.00098
```

Five tool calls, two questions asked, one bug fixed, verified by running it, for
a tenth of a cent.

---

## Step 6 — the same agent in a browser

`../week5-gui/` is the proof that the split held. Its server imports
`part5-agent/session.ts`, `commands.ts` and `tools/permissions.ts`
**unmodified**:

```bash
cd ../week5-gui
npm install && (cd client && npm install)
npm run gui                      # → http://127.0.0.1:3478
```

One thing genuinely is harder in a browser, and it is worth the whole week.

In the terminal, `approve` is `rl.question` — the agent blocks on a keypress on
a stream it is already reading. In a browser there is no keypress to block on.
So the server creates a promise, parks its `resolve` in a map keyed by the tool
call id, and streams the question to the client:

```ts
approve: (request) => new Promise((resolve) => {
  pending.set(request.id, resolve);
  send({ type: "approval", request });
}),
```

…and the agent sits there, mid-turn, until `POST /api/approve` calls that
resolver. Two completely different mechanisms for saying yes; one unchanged
core. That shape — park a promise, ask a human, resume — is every
human-in-the-loop system you will ever build.

Three details in the GUI worth pointing at in class:

- **The workspace is in the header.** `WORKSPACE=~/code/thing npm run gui` is how
  you point it somewhere real, and the header always says where it is pointed.
- **A closed tab denies everything and cancels the turn.** Otherwise you leak a
  promise nobody will ever resolve and keep paying for tokens nobody will read.
- **The model gets the whole tool result; the browser gets the first 2,000
  characters behind a disclosure triangle.** Same rule as the terminal's
  one-line receipt. An interface that dumps 2,000 lines of grep output into the
  transcript is not being transparent, it is being unreadable.

---

## Things that will bite you

- **A dangling tool call poisons the whole conversation.** Interrupt an agent
  between the request and the results and every later request 400s. Synthesize
  a result for each unanswered call.
- **`finish_reason` is not how you decide to loop.** Branch on "did it request
  tools", which is what the real Claude Code loop does too.
- **The spinner must come down before you ask a question**, or it repaints over
  the prompt and the user types into a moving target.
- **Time the tool, not the human.** If your receipt measures from the request,
  a call that waited ninety seconds for someone to read a diff reports 90,000ms.
- **An agent turn is several model calls.** Week 4's meter is still here for a
  reason: a five-step turn costs roughly five replies, and the whole history is
  re-sent every step. Watch the `cached` number climb.
- **`process.cwd()` is the blast radius.** Not a config setting. Not a prompt
  instruction. The directory you started in.
- **Never let "always" outrank a denial.** Check deny rules first, unconditionally.

---

## Exercises

1. **Break your own edit tool.** Ask the agent to change a line that appears
   three times without saying which. Watch guard 6 fire and the model recover.
   Then make the message vaguer and watch it flail. Your error messages are a
   prompt.
2. **Parallel reads.** Ask it to "read these five files and summarise each".
   Count the round-trips. Now run independent read-only calls concurrently
   (`Promise.all` over the calls in one step) and measure the wall clock. Why is
   it only safe for the read-only set?
3. **A tiny sandbox.** Add a `--safe` flag that rejects any bash command
   containing an absolute path outside the project root. Where does that check
   belong — in `classify` or in `runBash`? Argue for one.
4. **Persist the allowlist.** "Always" currently forgets everything on restart.
   Write it to a JSON file scoped to the project directory and load it on
   startup. You have just built project-scoped permission settings.
5. **A read-only mode.** Add `/readonly` that *removes* write, edit and bash from
   `TOOL_SPECS` entirely rather than denying them. Why is removing a tool safer
   than denying it? (The model cannot be tempted by a tool it cannot see — and
   it stops wasting turns asking.)
6. **`/undo`.** Snapshot a file before every write, and add a command that
   restores the last one. Notice how much of "an agent you can trust" is really
   "an action you can take back".

---

## Milestone — mycode gets hands

- [ ] Six tools: `read_file` · `write_file` · `edit_file` · `run_bash` ·
      `glob_files` · `grep_search`
- [ ] `edit_file` enforces read-before-edit, staleness, exact match and unique
      match — with a test for each guard
- [ ] The loop runs multi-step tasks, always terminates, and answers every tool
      call
- [ ] Every call is classified allow / ask / deny; read-only tools never prompt
- [ ] The prompt shows the exact command or diff before anything runs
- [ ] "Always" is remembered for the session, visible in `/allowed`, undoable
- [ ] A dangerous command is denied outright
- [ ] mycode fixes a genuine bug in a repo you did not pre-clean, and verifies
      the fix by running it
- [ ] You recorded the session (asciinema, or a screenshot of the GUI)

**Next week:** context and prompt engineering — what belongs in the system
prompt, project conventions the agent reads by itself, and compaction. The agent
you just built is about to get a great deal smarter without gaining a single
tool.
