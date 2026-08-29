# Week 4 — The Chat Interface · Live Demo Guide

Everything in this folder has been run end-to-end and works. All commands are
`npm run …` from **this folder** (`week4-workshop/`). The API key is read from
`.env` (already in place; `.env.example` shows the format).

**The one-line thesis of the day** — say it early, repeat it often:

> The model is not the product. **The interface is the product.**
> An agent that thinks brilliantly but goes silent for forty seconds is broken.

Weeks 1–3 made the agent *correct*. This week makes it *usable*, and the two
are different engineering problems with different failure modes. Nothing this
week makes the model smarter. Everything this week changes how it feels.

The rhythm of every part: *name the thing that feels broken → watch it feel
broken live → fix it in ~30 lines → point at how the real Claude Code does the
industrial version*.

---

## Before the call (5 minutes)

```bash
cd ~/code/agent/week4-workshop
npm install          # already done, but harmless
npm run smoke        # 17 assertions, no terminal needed — proves the key works
npm run part1        # warm-up; Ctrl+D to quit
```

- **Font size up.** Every demo today is about what the terminal looks like.
  If they cannot read the spinner, they cannot see the lesson.
- Have `part2-streaming/session.ts` and `part5-cost/cost.ts` open in editor
  tabs — those are the two files you walk through line by line.
- Each part is a **self-contained folder** (part1 → part5, cumulative). To show
  "what changed since last part", diff the same filename across folders:
  ```bash
  diff part3-commands/session.ts part4-interrupts/session.ts
  ```
- Every run costs a fraction of a cent on gpt-4o-mini. By Part 5 the class can
  read that number off the screen themselves.

**The spine** — draw this before Part 1, and add one line per part:

```
loop forever:
    line = await read()          # Part 1 · readline gives us this free
    if line starts with "/":     # Part 3 · dispatch, before anything expensive
        handle locally; continue
    for await delta in stream:   # Part 2 · tokens as they are produced
        write(delta)             #          cancellable — Part 4
    print(cost_of_that_turn)     # Part 5 · the bill is a feature
```

---

## Part 1 — The REPL skeleton (~10 min)

**The pain:** the loop works and the program feels dead.

**Show the code** (`part1-repl/`):
- `ui.ts` — the entire "UI framework" is `\r` and `\x1b[2K`: return to column 0,
  erase the line. That is every terminal spinner ever written. Say it out loud —
  the class expects a library and there isn't one.
- `repl.ts` — read, eval, print, loop. Point at the single `await` on
  `completeTurn()` and name it: *this is the whole problem of the week.*

**Run:**
```bash
npm run part1
```
Ask something big — `explain how TCP congestion control works`. Let the silence
run. Count it out loud. The spinner proves the process is alive and tells you
**nothing** about the answer.

> The question to leave hanging: *the model started producing words half a
> second in. Why are we hiding them?*

**Note what we did NOT build:** backspace, arrow keys, history, Ctrl+D. `readline`
gave us all of it. Good interface work is mostly knowing what is already free.

---

## Part 2 — Streaming output (~15 min) · the core demo of the day

**The pain:** a wall of text that appears from nowhere.

**Show the code first** (`part2-streaming/`):
- `model.ts` — the diff from Part 1 is **one option**: `stream: true`. Same
  model, same tokens, same price. Only *when you may look* changes.
- `session.ts` — the most important file of the week. Read the header comment
  aloud. `Session` owns the conversation and **knows nothing about terminals**.
  It hands out deltas through a callback.

**Run:**
```bash
npm run part2
```
Same big question as Part 1. Then read the footer:

```
first token 340ms · complete 11.4s
```

**Two numbers, and only one of them is the product.** Total time barely moved.
The wait went from 11 seconds to a third of a second, and that is the only
number a user can feel. Streaming does not make the model faster; it makes the
*waiting* shorter, which is a different thing entirely.

**The handover to point at** — in `repl.ts`, `onFirstToken` stops the spinner
before the first character is written. Miss that and the spinner and the answer
fight over the same line. It is three lines of code and it is the difference
between polished and amateur.

---

## Part 3 — Slash commands (~10 min)

**The pain:** not everything the user types is a question for the model.
"Clear the history" is not worth an API call, and `/help` answered by an LLM is
a joke with a price tag.

**Show the code** (`part3-commands/commands.ts`). The taxonomy is lifted
straight from the real Claude Code (`src/types/command.ts`), which sorts every
command into three kinds:

| kind | what it does | what it costs | example |
|---|---|---|---|
| `local` | runs code, prints a result | nothing | `/clear`, `/exit` |
| `render` | draws a block of UI | nothing | `/help`, `/status` |
| `prompt` | expands into a message and goes to the model | a full turn | `/review`, `/explain` |

**Why the taxonomy matters:** it tells you where each command's cost lives. Two
of the three kinds never touch the network. Skip the distinction and you end up
billing the user to render `/help`.

> Claude Code calls the middle one `local-jsx` because it returns a React
> element. We return styled strings, because our renderer is `console.log`.
> Same idea; the kind exists because a command's **output** is
> interface-specific even when its logic is not. This becomes concrete in the
> GUI (below), where `/cost` is a real HTML table.

**Run:**
```bash
npm run part3
```
- `/help` → instant, free.
- `/he<TAB>` → completes. One `completer` function passed to readline.
- `/review src/index.ts` → watch it echo the expansion, then stream a real turn.
- `/nope` → an unknown command is *not* sent to the model. Say why: the moment
  you send unknown slash commands to an LLM, typos cost money.

---

## Part 4 — Safe interrupts (~10 min)

**The pain:** the model is off writing 900 words you do not want, and your only
option is to kill the program and lose the conversation.

**Show the code** (`part4-interrupts/`):
- `model.ts` — one option again: `{ signal }`. `AbortSignal` tears down the
  HTTP request at the socket. Not "ignore the answer" — the request stops, and
  the tokens stop being generated.
- `repl.ts` — the handler is an explicit priority list, exactly as the real
  Claude Code writes it in `src/hooks/useCancelRequest.ts`:
  ```
  busy → cancel the turn.  The session survives.
  idle → once warns, twice within 1.5s exits.
  ```
  The double-press is not a gimmick. Ctrl+C is muscle memory for "make it
  stop"; a program that dies from the reflex you use to stop it is a program
  people learn to be afraid of.
- `session.ts` — **the subtle part, and the reason this is a whole part of the
  week.** Read this rule aloud:

  > Whatever was actually shown to the user is part of history.
  > The user read those tokens. The model must know it said them.

  A cancelled turn appends the partial text plus
  `[interrupted by the user before finishing]`. The naive version throws the
  partial away and leaves `messages` ending on a user turn with no reply — so
  the next turn silently re-answers the question you just cancelled.

**Run:**
```bash
npm run part4
```
Ask for something long. Press **Ctrl+C** after two lines:
```
  ⨯ interrupted after 214 chars — kept in history
```
Now ask a follow-up — *"finish that thought"* — and show that the model has the
partial text and knows it was cut off. Then press Ctrl+C twice at the idle
prompt to exit.

**The bug worth showing them:** we found this while writing the tests. Aborting
does not reliably *throw* — some clients throw, some just stop iterating. So
the code does not trust the exception:

```ts
if (controller.signal.aborted) interrupted = true;
```
The signal is the one source of truth that is correct in both cases. `npm run
smoke` catches it if you break it.

---

## Part 5 — The cost meter (~10 min) · mycode v0.1 ships

**The pain:** nobody knows what any of this costs until the invoice arrives.

**Show the code** (`part5-cost/cost.ts`). Three reasons cost is invisible:
1. Prices are quoted **per million tokens**, so every number looks like zero.
2. Input and output are billed at different rates — output is 4–8× input.
3. Cached input is discounted, but only if you can see the cache hit at all.

Then the gotcha in `model.ts`:
```ts
stream_options: { include_usage: true }   // ask, or your meter reads zero
```
With `stream: true` the usage block is omitted by default — the response is
over before the totals are known. **You have to ask for the final chunk.**

And the one in the same file:
```ts
input: chunk.usage.prompt_tokens - cached   // prompt_tokens INCLUDES cached
```
Forget the subtraction and you bill the discounted tokens twice.

> Claude Code's `src/utils/modelCost.ts` keeps **five** meters — input, output,
> cache-write, cache-read, web-search — for exactly these reasons. We keep the
> three the Chat Completions API reports.

**Run:**
```bash
npm run part5      # or: npm start
```
Ask two or three questions, then:
```
  718ms · 1.8s · 45 in · 89 out · $0.00006 · session $0.00006
```
```
/cost
```
Point at the breakdown: **output is a handful of tokens and most of the money.**
That single fact changes how people write system prompts.

Then, for the lesson that lands hardest — ask the same question twice and watch
the input tokens climb. The conversation is resent every turn. *That* is why
Week 6 is about memory and compaction.

**Ctrl+D** on the way out prints the session total.

---

## The GUI — the same agent, in a browser (~5 min, optional but worth it)

```bash
cd ~/code/agent/week4-gui
npm install && (cd client && npm install)   # first time only
npm run gui                                 # build client + start server
```
Open **http://127.0.0.1:3477**.

Then show them `week4-gui/server/server.ts`, line 31:

```ts
const { Session } = await import(".../week4-workshop/part5-cost/session.ts");
```

**No fork. No copy. No changes.** The browser app imports the same file
`npm run part5` runs. Streaming, slash commands, interrupt and the cost meter
all work, because none of them were ever terminal features — they were Session
features that the terminal happened to be drawing.

The mapping to put on screen:

| terminal | browser |
|---|---|
| `Spinner` | a pulsing `<div>` |
| `process.stdout.write(delta)` | `setStreaming(s => s + delta)` |
| readline `completer` | the slash-command palette |
| `rl.on("SIGINT")` | the Stop button (and `Esc`) |
| the dim footer line | the cost rail on the right |

**If you can do this, the split is real. If you cannot, you have a terminal
program with an agent trapped inside it.** That is the whole lesson of Week 4,
expressed as an import statement.

---

## Reading the real thing (~15 min)

Close the editor tabs and open the reference implementation. The reading list
lives in `../week4-claude-code-reading-list.md` and on the blog:
**Reading the real Claude Code: six files that teach you the REPL.**

Six files, ~400 lines total, in this order:

1. `src/utils/stream.ts` (76) — push→pull: how a callback API becomes `for await`.
2. `src/types/command.ts` (216) — the three command kinds, in the original.
3. `src/commands/cost/cost.ts` (24) — one complete real command.
4. `src/utils/abortController.ts` (99) — cancellation as a *tree*, with `WeakRef`.
5. `src/hooks/useCancelRequest.ts` (276) — the Ctrl+C priority list we copied.
6. `src/utils/modelCost.ts` (231) — five meters, and a bug worth finding.

**The one file NOT to open:** `src/screens/REPL.tsx` is 5,005 lines. Two
surgical excerpts only (`#L2106-L2162`, `#L2996-L3022`). Send them in there
unguided and you lose the room.

**The closing question**, if they ask why the real thing is 5,005 lines and
ours is 500: it isn't smarter, it is *older*. Every one of those lines is a
bug report someone filed. Our 500 lines are the shape; theirs are the shape
plus four years of reality.

---

## Homework — mycode v0.1 is yours now

Ship these three; the rest are stretch:

1. **`/model`** — switch models mid-session. The meter must re-price correctly
   (`getModelCosts` already handles unknown models; make the UI honest about it).
2. **A context warning** — when the conversation passes ~50% of the model's
   window, print a dim warning. You need a token estimate; `chars ÷ 4` is fine
   and you should say so in a comment.
3. **`/save` and `/resume`** — write `messages` to JSON and read it back.
   Careful: an interrupted turn must survive the round trip intact. This is
   where Week 3's durable-execution habits start paying rent.

Stretch: syntax-highlight fenced code blocks in the terminal · multi-line input
with a continuation prompt · `/retry` that re-runs the last user turn without
duplicating it in history · make the spinner turn red after 3 seconds of no
tokens, the way Claude Code's `useStalledAnimation.ts` does.

**Next week** the agent stops talking and starts touching your files.
