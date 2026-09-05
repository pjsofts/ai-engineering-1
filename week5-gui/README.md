# Week 5 GUI — the same agent, in a browser

A small React + Node app that runs **the existing `week5-workshop` core** and
draws it as a web app: streaming tokens, live tool receipts, diffs, a permission
card that halts the agent until you answer, an allowlist you can see, and the
cost of every turn.

Nothing here is a reimplementation. `server/server.ts` imports
`../week5-workshop/part5-agent/session.ts`, `commands.ts` and
`tools/permissions.ts` **unmodified**:

```ts
const { Session, MAX_STEPS } = await import(".../part5-agent/session.js");
```

Same agent loop, same six guards, same allow/ask/deny ladder.

## Run it

```bash
cd ~/code/agent/week5-gui
npm install && (cd client && npm install)   # first time only
npm run gui                                 # build the client + start the server
```

Open **http://127.0.0.1:3478**. The API key is read from
`../week5-workshop/.env` — the same file the CLI parts use.

During development, `npm run start` (server) plus `cd client && npm run dev`
(Vite on :5173, proxying `/api`) gives hot reload.

## Where it works — read this before pointing it at anything

The tools resolve paths against `process.cwd()`, so **the directory the server
starts in is the blast radius**. It defaults to `week5-workshop/sandbox` (a
throwaway copy of the fixture project, created if missing). To aim it somewhere
real, say so explicitly:

```bash
WORKSPACE=~/code/some-project npm run gui
```

The header always shows where it is pointed. That is deliberate.

## The one hard part

In the terminal, `approve` is `rl.question` — the agent blocks on a keypress on
a stream it is already reading. A browser has no keypress to block on. So the
server creates a promise, parks its `resolve` in a map keyed by the tool-call id,
and streams the question to the page:

```ts
approve: (request) => new Promise((resolve) => {
  pending.set(request.id, resolve);
  send({ type: "approval", request });
}),
```

The agent then sits mid-turn until `POST /api/approve` calls that resolver. Two
completely different mechanisms for saying yes; one unchanged core. **Park a
promise, ask a human, resume** is the shape of every human-in-the-loop system.

Consequences worth noticing in the code:

- **A closed tab denies everything and interrupts the turn** (`res.on("close")`)
  — otherwise you leak a promise nobody will resolve and keep paying for tokens
  nobody will read.
- **Stop also answers every open question**, for the same reason.
- **The model gets the whole tool result; the browser gets 2,000 characters**
  behind a disclosure triangle. Same rule as the terminal's one-line receipt.

## The mapping

| `part5-agent/repl.ts` | `client/src/` |
|---|---|
| `toolLine()` / `resultLine()` | `ToolCall.tsx` |
| the `- / +` lines of the box | `Diff` in `ToolCall.tsx` |
| `askApproval(rl, req)` | `Approval.tsx` + `POST /api/approve` |
| `y` · `a` · `N` keys | the same three keys, bound on `window` |
| the dim footer line | the rail on the right |
| `Ctrl+C` | Stop, and `Esc` |
| `/tools`, `/allowed` | the rail, always visible |

## API

| route | |
|---|---|
| `GET /api/state` | model, workspace, tools, allowlist, meter, messages |
| `GET /api/commands` | the slash commands and their kinds |
| `POST /api/send` | the turn — an SSE stream on the POST itself |
| `POST /api/approve` | `{id, choice}` — resolves one parked promise |
| `POST /api/interrupt` | cancel the turn, deny every open question |
| `POST /api/command` | run a slash command |
| `POST /api/reset` | a fresh session (and a fresh allowlist) |

SSE event types: `start · step · ttft · delta · tool_start · approval ·
tool_end · usage · done · error`.

## Try this

1. *“Run the tests with `node --test --experimental-strip-types utils.test.ts`,
   fix whatever fails, then run them again.”* — approve the first command, watch
   the diff card, approve the edit, then say **Always** to the re-run and see it
   appear under **allowlisted** in the rail.
2. *“Delete every file in this directory.”* — denied outright, no card, and the
   agent explains itself.
3. Ask for something long, then hit **Stop** mid-tool. The turn ends, history
   stays valid, and the next message still works — that is
   `closeDanglingCalls()` doing its job.
