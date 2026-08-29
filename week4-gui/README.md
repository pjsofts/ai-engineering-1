# Week 4 GUI — the same agent, in a browser

A small React + Node app that runs **the existing `week4-workshop` core** and
draws it as a web app: streaming tokens, a slash-command palette, a Stop button,
and a live cost breakdown.

Nothing here is a reimplementation. `server/server.ts` imports
`../week4-workshop/part5-cost/session.ts` and `commands.ts` **unmodified**:

```ts
const { Session } = await import(".../week4-workshop/part5-cost/session.ts");
```

That single line is the point of the folder. Streaming, cancellation, slash
commands and cost accounting were never terminal features — they were `Session`
features that the terminal happened to be drawing.

## Run it

```bash
cd ~/code/agent/week4-gui
npm install && (cd client && npm install)   # first time only
npm run gui                                 # build the client + start the server
```

Open **http://127.0.0.1:3477**. The API key is read from
`../week4-workshop/.env` — the same file the CLI parts use.

During development, `npm run start` (server) plus `cd client && npm run dev`
(Vite on :5173, proxying `/api`) gives hot reload.

## What you see

- **Centre — the conversation.** Assistant text streams in with a caret, the
  way it does in the terminal. Under each reply: time to first token, total
  time, tokens in/out, and what that turn cost.
- **Right — the cost meter.** The same numbers `/cost` prints, as a table,
  updating every turn. Below it, every command tagged with its **kind** —
  `local` and `render` are green and blue and cost nothing; `prompt` is violet
  and costs a full turn.
- **Bottom — the composer.** Type `/` for the palette; `Tab` completes. `Enter`
  sends, `Shift+Enter` newlines. While a turn is streaming the Send button
  becomes **Stop**, and `Esc` does the same thing — the browser's Ctrl+C.

## The mapping

| `part5-cost/repl.ts` | `client/src/App.tsx` |
|---|---|
| `Spinner` | a pulsing `<div>` |
| `process.stdout.write(delta)` | `setStreaming(s => s + delta)` |
| readline `completer` | the slash-command palette |
| `rl.on("SIGINT")` → `session.interrupt()` | Stop button → `POST /api/interrupt` |
| the dim footer line | the cost rail |

Two files, same five ideas, zero shared UI code — and both of them call the
same `Session`.

## API

| route | |
|---|---|
| `GET /api/state` | model, messages, meter totals, busy flag |
| `GET /api/commands` | command metadata, including each command's kind |
| `POST /api/send` | the turn, returned as an SSE stream on the POST itself |
| `POST /api/command` | dispatch a slash command; `local`/`render` answer here |
| `POST /api/interrupt` | cancel the turn in flight |
| `POST /api/reset` | a fresh session |

## Notes

- **One session, one turn at a time**, on purpose — a second `send` while busy
  returns `409`, so a class demo cannot overlap itself.
- **Closing the tab cancels the turn.** `res.on("close")` calls
  `session.interrupt()`; otherwise you keep paying for tokens nobody will read.
  Same rule as Ctrl+C, different key.
- The workshop's `render` commands return ANSI-styled strings, so the server
  strips the escape codes and the client draws `/cost` and `/help` as real UI.
  This is exactly why Claude Code gives those commands their own kind
  (`local-jsx`): a command's **output** is interface-specific even when its
  logic is not.
