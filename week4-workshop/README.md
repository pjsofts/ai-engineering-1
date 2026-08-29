# Week 4 — The Chat Interface

**Ship:** `mycode v0.1` — a streaming terminal chat agent with slash commands,
safe interrupts and a live cost meter.

Weeks 1–3 made the agent correct. This week makes it usable. Nothing here makes
the model smarter; everything here changes how it feels — and *feel* is the
part users experience.

> The model is not the product. The interface is the product.

## Two ways to use this

- **Read it:** `PRESENTATION.md` is the teaching script, part by part.
- **Build it:** `BUILD.md` starts from an empty folder and adds one small piece
  at a time — five steps, each one runnable. Use `part<N>-*/` as the answer key.

## Setup

```bash
cd ~/code/agent/week4-workshop
cp .env.example .env      # add your OPENAI_API_KEY
npm install
npm run smoke             # 17 assertions, no terminal required
```

## The five parts

Each is a **self-contained folder**, cumulative. To see what a part added, diff
the same filename across two folders.

| | run | what it adds | the file to read |
|---|---|---|---|
| 1 | `npm run part1` | the read-eval-print loop, and a spinner that lies | `part1-repl/ui.ts` |
| 2 | `npm run part2` | `stream: true` — tokens as they are produced | `part2-streaming/session.ts` |
| 3 | `npm run part3` | slash commands in three kinds: local / render / prompt | `part3-commands/commands.ts` |
| 4 | `npm run part4` | Ctrl+C that cancels a turn without corrupting history | `part4-interrupts/session.ts` |
| 5 | `npm run part5` | token and dollar accounting, live | `part5-cost/cost.ts` |

`npm start` runs Part 5. `npm run smoke` runs the whole core headlessly.

```bash
diff part3-commands/session.ts part4-interrupts/session.ts   # what Part 4 changed
```

## The one idea

`session.ts` owns the conversation and **knows nothing about terminals**. It
streams text out through callbacks. `repl.ts` draws.

That split is not decoration — `../week4-gui/` imports `part5-cost/session.ts`
unchanged and renders the same agent in a browser, with streaming, slash
commands, interrupt and the cost meter all intact. If your core can do that,
the split is real.

## Things that will bite you

- **The spinner must stop before the first token is written**, or the two fight
  over the same line. That handover is `onFirstToken`.
- **`stream_options: { include_usage: true }`** — without it, a streaming
  response reports no usage at all and your cost meter silently reads zero.
- **`prompt_tokens` includes cached tokens.** Subtract, or you bill the
  discounted tokens at full price.
- **Aborting does not reliably throw.** Some clients throw; some just stop
  iterating. Check `controller.signal.aborted` after the loop.
- **A cancelled turn is still a real turn.** The user read those tokens. Commit
  them to history, marked as interrupted, or the next turn re-answers a
  question that was already abandoned.

## Reading the real thing

`../week4-claude-code-reading-list.md` — six files, ~400 lines, from the actual
Claude Code source. Start with `src/utils/stream.ts`. Do **not** open
`src/screens/REPL.tsx` unguided; it is 5,005 lines.

## Teaching

`PRESENTATION.md` — the live-demo script, timings, and what to say at each step.
