# Week 3 GUI — the harness, visualized

A small React + Node app that runs the **existing** `week3-workshop` demos and
shows them live: chat on the left, the event stream on the right, a spinner
that says which tool is being called, and approve/deny buttons for Part 7.

Nothing here is a reimplementation. The server imports the real
`part1-brittle/ … part7-approval/` modules and runs them in-process, so the GUI
and the CLI share the same `wf/` state and `events.jsonl`. You can start a
workflow in the browser and resume it from the terminal, or the reverse.

## Run it

```bash
cd ~/code/agent/week3-gui
npm install && (cd client && npm install)   # first time only
npm run gui                                 # build client + start server
```

Open **http://127.0.0.1:3377**. The API key is read from
`../week3-workshop/.env` — the same file the CLI uses.

During development, `npm run start` (server) plus `cd client && npm run dev`
(Vite on :5173, proxying `/api`) gives hot reload.

## What you see

- **Tabs** — one per part, each with its own conversation, event stream, and
  status pill. Switching tabs never loses a part's history.
- **Left — Conversation.** Your task, the agent's final answer, drafted replies
  as they're written, handoff notices, crash banners, and approval cards.
  While the agent works, a spinner reports the *actual* current activity:
  `calling runCode…`, `handing off: triage → billing…`,
  `compacting memory (3 turns → summary)…`, `investigator "billing" working…`.
- **Right — Event stream.** Every harness event, glyphed and color-coded by
  kind (blue = lifecycle, amber = tool/approval, violet = handoff/compaction,
  green = success, red = failure). **Click any row to expand its full JSON** —
  arguments, charge ids, amounts, everything.
- **Per-part controls.** Part 2 has a “💥 crash mid-workflow” checkbox; Part 6
  has “☠ kill the technical investigator”. Every part except Part 1 has a
  **Resume** button (the recovery pass) and a **Reset part** button.

## The demos, in the browser

- **Part 2 (crash/recover):** tick *crash*, press **Run** → red crash banner.
  Untick it, press **Resume** → status goes `recovering`, cached steps replay
  instantly with no new tool events, and the workflow finishes. The event
  stream is the proof: no tool is requested twice.
- **Part 6 (chaos):** tick *kill the technical investigator*, press **Run** →
  `plan.created`, three `subagent.started` together, one red `subagent.failed`,
  and a complete synthesized reply anyway.
- **Part 7 (approval):** press **Run** → the run stops at an amber approval
  card showing the exact `issueRefund` arguments. The workflow is parked on
  disk; nothing is running. Press **✔ Approve** (or **✘ Deny**), then
  **Resume** → replay lands on the gate, `approval.resolved` appears, and the
  refund executes (or doesn't).

## Notes

- One run at a time, on purpose — a second `Run` returns `busy` so a class
  demo can't overlap itself.
- `Reset part` / restarting clears `wf/`, `decisions/`, and `events.jsonl` for
  that part, exactly like `npm run reset` in the workshop folder.
- The only change made to the workshop code is one additive line in each
  `events.ts`: `(globalThis as any).__emitHook?.(event)`. It's undefined when
  the CLI runs, so all terminal demos behave exactly as before.
