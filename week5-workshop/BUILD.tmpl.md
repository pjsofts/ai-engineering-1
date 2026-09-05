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
{{FILE:part1-read-only/tools/specs.ts}}
```

> **Why `additionalProperties: false` matters.** Without it you will eventually
> receive `{"path": "a.ts", "encoding": "utf-8"}` and crash on a parameter you
> never declared. Strict schemas are not pedantry — they are the difference
> between "the model cannot invent fields" and "the model can invent fields".

### 1b. `read_file`, and the invisible star

```ts
{{FILE:part1-read-only/tools/fs.ts}}
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
{{FILE:part1-read-only/tools/search.ts}}
```

The implementations are dull; the **policy** is the lesson. Newest-file-first is
relevance ranking for free, and the 100/250 caps are context-budget policy, not
laziness.

### 1d. Running a tool

```ts
{{FILE:part1-read-only/tools/registry.ts}}
```

Note that **every** failure path returns a string. This is idea #2 of the week
in twelve lines.

### 1e. The API call learns about tools

The only change to `model.ts` from Week 4 is that a stream can now carry tool
calls, and those arrive in fragments exactly like text does.

```ts
{{FILE:part1-read-only/model.ts}}
```

> **The one piece of real protocol handling this week.** The function name
> arrives in one chunk, the JSON arguments a few characters at a time across
> many more, and `index` is what tells you which call a fragment belongs to when
> the model asks for three things at once. Get this wrong and you will see
> `{"path": "src/ap` in your logs and blame the model.

### 1f. The loop

Here is the whole game.

```ts
{{FILE:part1-read-only/session.ts}}
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
{{FILE:part1-read-only/repl.ts}}
```

The tool receipt is printed in two halves at two different times — the call
before it runs, the result after — with the spinner turning in between. That is
how a user tells a slow `grep` from a hung program.

Add to `ui.ts`:

```ts
{{SLICE:part1-read-only/ui.ts:// ---------------------------------------------------------------------------
// Week 5 additions: drawing a tool call.}}
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
{{SLICE:part2-write-edit/tools/fs.ts:export interface WriteArgs}}
```

The rule sounds bureaucratic and is the difference between a safe agent and a
dangerous one: **you may not overwrite a file you have not read.** An LLM that
writes a file it never looked at will cheerfully delete your work based on a
hallucinated memory of what the file "probably" contained, and it will sound
confident doing it. Creating a *new* file is exempt — there is nothing to
destroy.

### 2b. `edit_file` — six guards

```ts
{{FILE:part2-write-edit/tools/edit.ts}}
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
{{FILE:part3-bash/tools/shell.ts}}
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
{{FILE:part4-permissions/tools/permissions.ts}}
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
{{SLICE:part4-permissions/session.ts:  /**
   * Where a tool call meets the permission gate:::  /** Give every unanswered tool_call}}
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
{{SLICE:part4-permissions/ui.ts:// ---------------------------------------------------------------------------
// Part 4: the permission prompt.}}
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
{{SLICE:part5-agent/model.ts:// The system prompt grows up.:::// Constructed on first use}}
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
