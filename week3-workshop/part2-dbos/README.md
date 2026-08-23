# Part 2, redone on DBOS — "now let a real engine do it"

Same agent, same crash demo, same guarantees as `part2-durable/` — but the
~40-line durable engine we hand-rolled is deleted and replaced by
[DBOS Transact](https://docs.dbos.dev/), a production durable-execution library
whose state lives in Postgres (here: your Neon database, from
`DBOS_DATABASE_URL` in `../.env`).

Run this **right after** the hand-rolled Part 2, while the class still has
`durable.ts` fresh in mind. The point isn't that DBOS is better — it's that
the thing they just built is the real thing, and here it is with the volume
turned up.

## The mapping is almost line-for-line

| We wrote (`part2-durable`) | DBOS gives you |
|---|---|
| `class Workflow` + `wf/<id>.json` | `DBOS.registerWorkflow(fn)` + Postgres tables |
| `wf.runStep(name, fn)` — cache by name | `DBOS.runStep(fn, { name })` — cache by position |
| `pending()` + a replay loop in the runner | automatic recovery inside `DBOS.launch()` |
| `wf.finish("suspended")` + `Suspended` | `DBOS.send`/`recv`, `sleep`, queues |
| `inspectLog.ts` over our JSONL | `listWorkflows` / `listWorkflowSteps` |
| (didn't have) | fork from step N, cancel, resume, queues, timeouts |

The **golden rule is identical**: the workflow body must be deterministic; all
non-determinism — the model call, the tool call, the clock — lives inside
steps. DBOS enforces it harder than we did: our steps were keyed by *name*,
DBOS matches them by *position*, so the body must issue the same steps in the
same order on replay.

## Run the demo

```bash
npm run part2dbos:reset     # cancel anything left pending from a previous demo
npm run part2dbos:crash     # press Enter; dies at step 2, after 6 real tool calls
npm run part2dbos:recover   # launch and DO NOTHING ELSE — watch it finish itself
npm run part2dbos:inspect   # list workflows; add an id to see its steps
```

The moment worth pausing on is `part2dbos:recover`. It takes **no task and no
workflow id** — it only calls `DBOS.launch()`. DBOS finds the `PENDING`
workflow in Postgres, resumes it in the background from the exact step where
the process died, and the drafts and sends go out. None of the six pre-crash
tool calls run twice.

Then `npm run part2dbos:inspect <wf-id>` prints the engine's own receipts —
every step, its output, and its duration:

```
  #   step                              ms     output
  8   tool-call_xVFHnK3Y9HLQTql5dIS4tz  556    "{\"articles\":[\"Team plans are $20/seat...
  ---- 21.0s gap: the process was dead here; everything above was replayed from Postgres ----
  9   model-2                           3868   {"role":"assistant","content":null,"tool_calls":...
```

That gap line is the whole lesson in one row.

## Two wrinkles worth knowing before you demo

**App version.** DBOS only recovers workflows whose *application version*
matches the running code — by default a hash of your code, so editing a file
between the crash and the recovery orphans the parked workflow. The npm
scripts pin `DBOS__APPVERSION=week3-demo`. It has to be set before the SDK is
imported, which is why it lives in the script and not in `harness.ts`.
(In production this behavior is a feature: a bad deploy can't half-replay
workflows written by different code.)

**State lives in Postgres, not in `wf/`.** `npm run reset` doesn't touch it —
use `npm run part2dbos:reset`, which cancels pending workflows. Cancelled and
completed workflows stay in the database as history; DBOS never deletes your
receipts.

## What you get that we didn't build

Fork a workflow from any step (`DBOS.forkWorkflow(id, 5)` — re-run from there
with new code), cancel and resume by id, queues with concurrency limits and
rate limits, durable `sleep` for days, `send`/`recv` for human input (that's
Part 7's approval gate, done properly), and cross-process recovery: run three
workers and a crashed workflow is picked up by whichever one launches next.

Everything on that list is a thing the class now understands, because they
built the 40-line version first.
