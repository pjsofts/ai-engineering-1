# Week 5 — Tool Use & Function Calling

**Ship:** `mycode v0.2` — a coding agent with six tools, six guards on the
sharpest one, an agent loop that terminates, and a permission gate you would
actually leave running on your own machine.

Week 4 made it usable. This week it stops talking about your code and starts
changing it.

> A chatbot talks about your code. An agent changes it. The distance between
> them is one `for` loop and one permission gate.

## Two ways to use this

- **Build it:** `BUILD.md` starts from an empty folder and adds one small piece
  at a time — five steps, each one runnable, with the answer key beside it.
- **Teach it:** `PRESENTATION.md` is the live script: what to type, what to say,
  and where to stop and let a failure land.

## Setup

```bash
cd ~/code/agent/week5-workshop
cp .env.example .env      # add your OPENAI_API_KEY
npm install
npm run guards            # 32 assertions, offline, no API key needed
npm run smoke             # the above plus one real agent run (~$0.001)
```

## The five parts

Each is a **self-contained folder**, cumulative. To see what a part added, diff
the same filename across two folders.

| | run | what it adds | the file to read |
|---|---|---|---|
| 1 | `npm run part1` | the agent loop, and three tools that cannot hurt you | `part1-read-only/session.ts` |
| 2 | `npm run part2` | `write_file`, and `edit_file` with six guards | `part2-write-edit/tools/edit.ts` |
| 3 | `npm run part3` | a shell that times out, caps its output and never crashes | `part3-bash/tools/shell.ts` |
| 4 | `npm run part4` | allow / ask / deny, and an "always" that is remembered | `part4-permissions/tools/permissions.ts` |
| 5 | `npm run part5` | the prompt that makes it work like an engineer | `part5-agent/model.ts` |

`npm start` runs Part 5. `../week5-gui/` runs the same core in a browser.

```bash
diff -r part3-bash part4-permissions    # exactly what the permission gate cost
```

## Where it runs

Every tool resolves paths against `process.cwd()`, so **the directory you start
in is the blast radius**. Parts 2–5 therefore start inside `sandbox/`, a
throwaway copy of `fixture/` — a tiny project with one real bug:
`parseDuration("1h30m")` returns `31` instead of `5400`, and there is a test
that catches it.

```bash
npm run sandbox:reset     # put the bug back
```

Point mycode at something real only after Part 4, and only once you have watched
the gate refuse something.

## The two ideas

**A tool is a contract, not a function.** The model never sees your code — it
sees a name, a paragraph saying when to reach for the tool, and a strict schema.
When the model uses a tool badly, fix the description before you touch the code.

**The result is the teacher.** Every failure comes back as `<tool_error>…` data,
never an exception. `old_string appears 3 times. Include surrounding lines to
make it unique.` is why the agent recovers instead of flailing. Your error
messages are a second prompt.

## Things that will bite you

- **A dangling tool call poisons the conversation.** Interrupt between "the model
  asked for three tools" and "we ran them" and every later request 400s.
  `closeDanglingCalls()` answers each one with a synthetic result.
- **Don't branch on `finish_reason`.** Loop on "did it request tools".
- **Take the spinner down before asking a question**, or it repaints over it.
- **Time the tool, not the human.** A call that waited ninety seconds for
  someone to read a diff did not take ninety seconds to run.
- **An agent turn is several model calls**, with the whole history re-sent each
  step. Week 4's cost meter is still here for a reason.
- **Deny outranks the allowlist.** Always. Check it first.

## The docs are generated

`BUILD.md` is produced from `BUILD.tmpl.md`, with every code listing spliced out
of the part folders, so the guide cannot drift from the code that runs:

```bash
node sync.mjs             # regenerate BUILD.md
node sync.mjs --check     # exit 1 if it is stale
```

Edit `BUILD.tmpl.md` (prose) and the part folders (code) — never `BUILD.md`.

## Milestone

`mycode` fixes a genuine bug in a repo you did not pre-clean, verifies the fix by
running it, and never touches anything you did not approve. The full checklist is
at the bottom of `BUILD.md`.
