# Week 5 — Tool Use & Function Calling · Live Demo Guide

Everything in this folder has been run end-to-end and works. All commands are
`npm run …` from **this folder** (`week5-workshop/`). The key is read from `.env`.

**The one-line thesis of the day** — say it early, repeat it often:

> A chatbot talks about your code. An agent **changes** it.
> The distance between them is one `for` loop and one permission gate.

Week 4 made mycode usable. This week it grows hands, and the interesting
engineering is not "how do I call a function" — the API does that. It is: what do
you do when the model asks for something wrong, something stale, something
ambiguous, or something catastrophic?

The rhythm of every part: *name the thing that will go wrong → let it go wrong
live → fix it in twenty lines → point at how the real Claude Code does the
industrial version.*

---

## Before the call (5 minutes)

```bash
cd ~/code/agent/week5-workshop
npm install
npm run guards            # 32 assertions, offline — proves the guards work
npm run sandbox:reset     # put the bug back in sandbox/
npm run part1             # warm-up; Ctrl+D to quit
```

- **Font size up.** Half of today is reading tool receipts and a diff in a
  permission box.
- Editor tabs to have open: `part1-read-only/session.ts` (the loop),
  `part2-write-edit/tools/edit.ts` (the guards),
  `part4-permissions/tools/permissions.ts` (the ladder).
- Each part is a self-contained folder. To show what a part added:
  ```bash
  diff -r part3-bash part4-permissions
  ```
- Every run costs a fraction of a cent on `gpt-4o-mini`, and the footer prints
  it. By Part 5 the class reads their own bill off the screen.

**The spine** — draw this before Part 1, add one line per part:

```
loop up to MAX_STEPS:                 # Part 1 · the whole game
    reply = model(history, TOOLS)     #          streaming, tools reassembled
    if no tool calls: return          #          NOT finish_reason
    for call in reply.tool_calls:
        decision = classify(call)     # Part 4 · allow / ask / deny
        result   = run(call)          # Parts 1-3 · six tools, guards, caps
        history.append(result)        #          ALWAYS. every call. no exceptions.
```

---

## Part 1 — The loop, with tools that cannot hurt anyone (~15 min)

**The pain:** the model can only tell you what it remembers about your project,
which is nothing.

**Show `tools/specs.ts` first, before any implementation.** This is the whole
lesson of the hour: the model never sees your code, it sees this file. Read one
description aloud and ask the class what *they* would do with it.

> Ninety percent of "the model uses tools badly" is "my tool descriptions are
> vague". Fix the description before you touch the code.

**Show `session.ts`** — read only the `for` loop, twice. Then name the two
absolute rules:

1. **Every tool call gets a result.** Show `closeDanglingCalls()` and explain
   the 400 you get otherwise — the one that arrives on the *next* request and
   looks unrelated to the interrupt that caused it.
2. **Always a step limit.** "An agent that can loop forever will, eventually, at
   3am, on your account."

**Run:**

```bash
npm run part1
› which files define the tool specs, and how many tools are declared?
```

Point at the receipts scrolling past: `grep_search` → `read_file` → answer.
**Four steps, four model calls, one turn.** Point at the footer: this is why
Week 4's cost meter is still here.

Then break it on purpose:

```
› read the file src/nope.ts
```

It gets `<tool_error>not found`, and recovers by searching instead. That is idea
#2 of the week: **the result is the teacher**.

---

## Part 2 — Write, edit, and six guards (~20 min)

**The pain:** an LLM that overwrites a file it never read will delete your work
based on a hallucinated memory of what the file probably contained — confidently.

**Show `READ_STATE`** in `tools/fs.ts` and call it the invisible star of the
week: fifteen characters of state, shared between three tools, that turn "the
model is usually right about files" into a rule you can enforce.

**Walk the six guards in `tools/edit.ts`**, one line each, and for each one name
the failure it prevents. Do not skip guard 5 (no match): it is the worst one,
because without it the model reports success and then "verifies" a change that
never happened.

**Run — the good case:**

```bash
npm run sandbox:reset && npm run part2
› read utils.ts and fix parseDuration so it multiplies by the unit
```

**Run — the failure that teaches (do not skip this):**

```
› change the word "total" to "sum" in utils.ts
```

Guard 6 fires — `old_string appears 4 times` — and the model recovers by adding
surrounding lines. **Then edit the message to just "bad edit" and run it again.**
It flails. Ninety seconds, and nobody in the room ever writes a lazy tool error
again.

**Inside Claude Code:** the real Edit tool adds curly-quote normalisation
(models love to "fix" your quotes), a 1 GiB OOM guard, and a re-check of
staleness in the microseconds before writing — but the shape is exactly this.

---

## Part 3 — The shell (~10 min)

**The pain:** the shell is the most powerful tool you own and the easiest to get
killed by.

**Three rules, three stories** (`tools/shell.ts`):

- *always a timeout* — the model runs `npm run dev`, it never exits, the demo
  dies in front of everyone;
- *always a cap, head **and** tail* — errors live at the ends;
- *never a crash* — a non-zero exit code is information, returned as data.

**Run the full loop, no humans involved:**

```bash
npm run sandbox:reset && npm run part3
› run the tests with: node --test --experimental-strip-types utils.test.ts
  then fix whatever fails and run them again.
```

Reproduce → read → edit → verify. **Then stop and let the silence do the work:**
nobody was asked about any of that. It ran a command, rewrote a file, and ran
another command, on their machine. Ask what would have happened if the model had
decided the cleanest fix was `rm utils.ts`.

That is the setup for Part 4. Do not rush it.

---

## Part 4 — The permission gate (~25 min, the centrepiece)

**Show the ladder** (`tools/permissions.ts`) and name the three outcomes:

- **allow** — read-only tools. `SAFE_TOOLS` *is* the trust boundary. Keep it
  small and obviously safe.
- **deny** — a short list of catastrophes. Say plainly: **this is a backstop,
  not security.** It does not mean the list is complete.
- **ask** — everything else, *including anything unrecognised*. The system fails
  closed. A permission system that fails open is decoration.

Ask the class: *why is deny checked before the allowlist?* (Because "always
allow sudo" must not be able to talk the gate into `sudo rm -rf /`.)

**Show `dispatch()` in `session.ts`** and say it outright: this is the single
most important function in the whole agent, because it is the one standing
between a language model and their filesystem.

Then the architectural point, which is the real reason this week is not "add an
if-statement": **the session cannot ask a question.** It does not know what a
terminal is. So it hands the question out and blocks on a promise.

```ts
approve?: (request: ApprovalRequest) => Promise<Approval>;
```

**Run:**

```bash
npm run sandbox:reset && npm run part4
› run the tests, fix the bug, run them again
```

Answer `y`, `y`, then `a`. Point at `[allowlisted: node]` on the second test run
— that is what "always" bought. Then:

```
› delete every .ts file here with rm -rf
```

Denied outright, no prompt, and the agent explains itself instead of crashing.

**Inside Claude Code:** the real permission system is ~17,000 lines, and its
core is this same ladder. The details worth knowing: rules are strings like
`Bash(git *)` persisted at session / project / user scope (that is what "always"
writes); some paths (`.git/`, `.claude/`, shell configs) are bypass-immune even
in "skip all prompts" mode; and a small model extracts the safe prefix of a
compound command. You do not need 17k lines. You need the ladder, and you need
to fail closed.

---

## Part 5 — The prompt grows up, and proof (~15 min)

**Show the v0.2 prompt** (`part5-agent/model.ts`) and go line by line: each one
is a failure someone watched. Read before edit. Search tools, not shell grep.
Edit over write. Run the test. Small verified steps. Stop when done.

> Notice how much behaviour we are steering with six sentences, for about 150
> tokens a turn. Week 6 is entirely about this.

**Show the two tiers of test:**

```bash
npm run guards     # offline, free, deterministic — 32 assertions
npm run smoke      # the above plus one real agent run
```

Make the distinction explicit, because it is the transferable idea: guards are
pure functions and get exact assertions; the live tier asserts on **outcomes**
(the bug is fixed, the tests pass, nothing ran unapproved) and never on which
tools the model chose in what order. A test that asserts the tool sequence fails
every time the model changes.

**The finale:**

```bash
npm run sandbox:reset && npm start
› The test in utils.test.ts fails. Run it, fix the bug, and run it again to
  prove it passes.
```

Five tool calls, two questions asked, one real bug fixed and verified, for a
tenth of a cent. Then `/allowed` to show what they agreed to, and `/revoke` to
take it back.

---

## The browser (~10 min, optional but it lands)

```bash
cd ../week5-gui && npm run gui      # → http://127.0.0.1:3478
```

The server imports `part5-agent/session.ts` **unmodified**. Same loop, same
guards, same gate. The one thing that is genuinely harder:

In the terminal, approval is a keypress on a stream the agent is already
reading. In a browser there is no keypress to block on, so the server parks a
promise, streams the question to the page, and the agent sits there mid-turn
until a click travels back and resolves it.

Show the diff card in the browser next to the terminal's `y/a/N` box. Same
decision, same core, two vocabularies. **That shape — park a promise, ask a
human, resume — is every human-in-the-loop system they will ever build.**

---

## Homework framing (2 minutes)

The milestone is not "six tools implemented". It is: **mycode fixes a genuine
bug in a repo you did not pre-clean, verifies the fix by running it, and never
touches anything you did not approve.** Record it — asciinema, or a screenshot of
the GUI mid-approval. That recording is the portfolio piece for this week.

The two stretch goals that teach the most:

- persist the allowlist per project (you have just built permission settings);
- add `/readonly` that **removes** the dangerous tools rather than denying them,
  and be able to say why removing is safer than denying.

**Next week:** context and prompt engineering — the highest-leverage week of the
course. Same tools, much smarter agent.
