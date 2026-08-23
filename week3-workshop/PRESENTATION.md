# Week 3 — The Agent Harness · Live Demo Guide

Everything in this folder has been run end-to-end today and works. All commands
are `npm run …` from **this folder** (`week3-workshop/`). The API key is read
from `.env` (already in place; `.env.example` shows the format).

**The one-line thesis of the day** — say it early, repeat it often:

> The LLM decides the next semantic step; **the harness owns execution**.
> Everything this week hangs off that one split.

The rhythm of every part: *name a production failure mode → watch the naive
agent fail (or survive) live → point at the ~30 lines of harness code that make
the difference → map it to the production tool that does the industrial
version* (Temporal, LangGraph, Claude Code, the agent SDKs).

---

## Before the call (5 minutes)

```bash
cd ~/code/agent/week3-workshop
npm install            # already done, but harmless
npm run reset          # clears wf/, events.jsonl, decisions/ in every part
npm run part1          # one warm-up run to confirm the key works
npm run reset          # clean again so the class starts fresh
```

- Font size up in the terminal; the event glyphs (▶ ⚙ ✋ ↪ 🗜 ✔) are the star
  of the show — the class should be able to read them.
- Have `part2-durable/durable.ts` and `part7-approval/approvals.ts` open in
  editor tabs — those are the two files you'll walk through line by line.
- Each part is a **self-contained folder** (part1 → part7, cumulative): to show
  "what changed since the last part", diff the same filename across folders.
- Every run costs a few cents of gpt-4o-mini. Nothing here touches anything
  real — charges, refunds, and emails are all canned fakes.
- The demos call a live model, so traces vary slightly run to run. That's
  fine — narrate whatever the model does; every behavior below was reproduced
  today.

**The spine** — draw or paste this before Part 1; you'll return to it in every
part, adding one line at a time:

```
state   = store.load(workflow_id)          # Part 2 · durable state
loop until done:
    context = hydrate(state)               # Part 4 · memory
    step    = agent.next(context)          # the LLM decides (Parts 1, 5)
    check(step)                            # Part 3 · sandbox   Part 7 · approval
    log.append(step)                       # Part 2 · durable event log
    result  = execute(step)                # tool / handoff (5) / sub-agents (6)
    store.checkpoint(workflow_id, result)  # resume from exactly here
```

---

## Part 1 — The brittle agent (~10 min)

**The pain:** Week 1's loop works — until the process dies. State is a plain
in-memory array; a crash mid-task loses everything, mid-spend, mid-`sendReply`.

**Show the code** (`part1-brittle/`):
- `events.ts` — everything the harness does is an *event*; the terminal is our
  inspector. ~20 lines.
- `tools.ts` — fake support-triage toolbox. Point at `sendReply`: it "emails
  the customer" the **instant** the model asks. No sandbox, no approval.
  That recklessness is what the rest of the day fixes.
- `harness.ts` — Week 1's loop wearing a harness jacket. Point at the
  `messages` array and read the comment: *kill the process and it's gone*.

**Run:**
```bash
npm run part1
```
Narrate the event stream: classify ×3 → knowledge-base search → draft ×3 →
send ×3 → ✔ completed. Then ask the class: *"what happens if I pull the plug
after the first two sendReplys?"* Don't answer — that's Part 2.

---

## Part 2 — Durable execution (~15 min) · the core demo of the day

**The pain:** a crash mid-workflow. Re-running from scratch double-bills the
model and **double-emails the customer**.

**Show the code first** (`part2-durable/durable.ts` — the whole engine is ~40
lines):
- A workflow is a JSON file. A **step** is a named unit of work checkpointed
  the moment it finishes.
- `runStep`: *if the name is already in `steps`, return the cached result —
  don't execute.* That one `if` is the trick inside Temporal and every other
  durable-execution engine.
- Golden rule (top comment of `harness.ts`): the loop body is deterministic;
  all non-determinism (model, tools, clock) lives *inside* steps.

**Run the crash** (deterministic — a demo helper env var, clearly marked in
the code, kills the process at step 2, after real side effects ran):
```bash
npm run part2:crash        # press Enter at the "task >" prompt
```
It classifies, searches the KB… then `💥 simulated crash before step 2`.
Show the class the corpse: `cat part2-durable/wf/*.json` — every completed
step is sitting there with its result.

**Run the recovery:**
```bash
npm run part2              # recovers FIRST, then asks for new work
```
Narrate: `recovering <id> from its last completed step …` — watch it fly
through the replay **without re-running the six completed calls** and finish
the task. (Press Ctrl+C at the `task >` prompt, or press Enter to run one
more workflow.)

**Prove it** — the receipts:
```bash
npm run part2:inspect
```
Point at the line: `DUPLICATED calls: 0 []`. The crash cost nothing and
repeated nothing. This is the number the whole part exists for.

**Production mapping:** Temporal / Restate / Inngest / DBOS do exactly this
with a real database, workers, and versioning. LangGraph checkpointers are the
same idea inside a graph. — and you can *show* that, next:

### Part 2b (optional, ~8 min) — the same demo on DBOS

Run this straight after, while `durable.ts` is still on screen. Same agent,
same crash, but the hand-rolled engine is replaced by
[DBOS Transact](https://docs.dbos.dev/) with state in Postgres (your Neon
database, via `DBOS_DATABASE_URL` in `.env`).

```bash
npm run part2dbos:reset     # clear anything pending from an earlier demo
npm run part2dbos:crash     # press Enter → dies at step 2, after 6 real tool calls
npm run part2dbos:recover   # launch and NOTHING else — it finishes itself
npm run part2dbos:inspect   # workflows; add an id for the step table
```

Show `part2-dbos/harness.ts` side by side with `part2-durable/`: `wf.runStep(name, fn)`
became `DBOS.runStep(fn, {name})`, the `Workflow` class became
`DBOS.registerWorkflow`, and the runner's `pending()` replay loop **disappeared
entirely** — `DBOS.launch()` is the recovery pass.

The line to land: *"the thing you built this morning is the real thing — here
it is with a database under it."* Then `npm run part2dbos:inspect <wf-id>`
prints DBOS's own step table, including a
`---- 21.0s gap: the process was dead here ----` marker exactly where your
crash was.

Details and the full comparison table: `part2-dbos/README.md`. Two gotchas:
demo state lives in Postgres (use `part2dbos:reset`, not `npm run reset`), and
the scripts pin `DBOS__APPVERSION` so an edit between crash and recovery can't
orphan the parked workflow.

---

## Part 3 — Sandboxing & code mode (~10 min)

**The pain:** the model is a great programmer, so let it write code — but
model-written code running in your host process can `require("fs")` your
secrets or loop forever.

**Run the boundary tests first** (no agent, instant):
```bash
npm run part3:sandbox
```
Four numbered results to narrate:
1. **Code mode** — one program fetches charges, groups, dedupes, computes:
   finds the duplicate `ch_002`, $49 refund. One tool call instead of five.
2. Infinite loop → **killed by timeout** (800 ms).
3. `require("fs")` → **ReferenceError** — `require` simply doesn't exist in
   the little world we built (`sandbox.ts`: the vm context contains `tools`
   and `console.log` — nothing else).
4. A plain bug → a **structured error** the model can read and fix.

Be honest with the class (it's in the code comment): Node's `vm` stops
*accidents*, not attackers — production uses micro-VMs/containers (Firecracker,
gVisor, E2B). The harness lesson is identical either way: **one mediated
boundary** for every dangerous capability.

**Then run the agent with runCode:**
```bash
npm run part3               # press Enter at the prompt
```
Nice teachable moment that happened today: the model's first `runCode` had no
`return`, the harness answered with a structured hint
(`"your code returned no value - end with return"`), and the model fixed its
own code on the next call. Structured errors → self-repair.

**Production mapping:** Claude Code's sandboxed bash, OpenAI Code Interpreter,
E2B. Also note the durability composition: the sandboxed code only gets READ
tools, so replaying it after a crash is harmless.

---

## Part 4 — Memory & context hydration (~10 min)

**The pain:** long tasks overflow the context window, and cost grows
quadratically if you resend everything every turn.

**The three-way split** (top of `memory.ts` — worth reading aloud):
- **HISTORY** = everything that happened → the durable event log (Part 2)
- **STATE** = a running summary of old work → compacted working memory
- **CONTEXT** = what the model sees *this* turn → assembled fresh, on demand

**Show in `memory.ts`:** compaction is by **token budget**, not turn count
(`estimateTokens` = chars/4 — the same heuristic production agents use); the
thresholds are deliberately tiny (500/200) so it fires on a demo task; the
**goal is pinned** in `buildContext` and never summarized away.

**Run:**
```bash
npm run part4               # press Enter at the prompt
```
Watch for the `🗜 memory.compacted {"summarized_turns":3, ...}` line
mid-run — then point out the agent **still sends the right drafts
afterwards**, because the summarizer was told to preserve item ids and draft
ids. Also note in `harness.ts`: `summarize` is a checkpointed step — a crash
never pays for the same summary twice.

**Production mapping:** Claude Code compacts at ~80–85% of the window with a
structured summary — the numbers in this toy are tiny, the shape is identical.

---

## Part 5 — Routing & handoffs (~10 min)

**The pain:** one agent with every tool is over-privileged. The triage agent
shouldn't be *able* to move money — not "instructed not to": **unable**.

**Show `agents.ts`:** an agent is **data** — name, prompt, tool subset. Triage
has `handoff` but not `issueRefund`. Least privilege by construction. Then
`harness.ts`: the loop is now a *runtime* — it hydrates with the **current**
agent's prompt+tools, and `handoff` is intercepted by the harness (it swaps
`current`), never executed as a tool.

**Run:**
```bash
npm run part5               # press Enter at the prompt
```
The trace to narrate: triage classifies → `runCode` finds the duplicate →
`↪ agent.handoff {"from":"triage","to":"billing"}` → billing **re-verifies**
with its own `runCode` → `issueRefund` (note: executes instantly — hold that
thought for Part 7) → confirmation drafted and sent.

**Production mapping:** OpenAI Agents SDK handoffs, LangGraph command routing.
The typed control transfer + tool subsetting is the whole pattern.

---

## Part 6 — Supervision (~10 min)

**The pain:** serial sub-tasks are slow, and one sub-agent failure shouldn't
kill the whole job.

**Show `supervisor.ts`:** PLAN → DISPATCH (parallel) → FAN-IN → SYNTHESIZE.
The plan is a **first-class artifact** — a structured object via JSON-schema
mode, checkpointed like everything else. `Promise.allSettled` = one crash
can't take the supervisor down. Unlike a handoff (lateral transfer), the
supervisor **keeps control** — sub-agents are function calls
(`investigators.ts`: tiny read-only loops, each in its own context).

**Run the happy path:**
```bash
npm run part6               # press Enter at the prompt
```
`🗺 plan.created {"steps":["billing","technical","sales"]}` → three
`subagent.started` lines fire **together** → three completions → one
synthesized reply that answers all three areas (it prints in full at the end).

**Run the chaos version** (kills the technical investigator, reproducibly):
```bash
npm run part6:chaos         # press Enter at the prompt
```
`✘ subagent.failed {"agent":"technical", …CHAOS_FAIL}` — and the workflow
**still completes**: the reply covers billing and sales and honestly says the
technical part needs a follow-up. Partial results beat no results.

**Production mapping:** Claude Code subagents, LangGraph map-reduce fan-out.

---

## Part 7 — Human-in-the-loop (~15 min) · the finale — the whole week pays off

**The pain:** some actions must not run without a human — and the human might
answer in three days. You can't hold a process open for three days.

**Show `approvals.ts` (~25 lines):** a human decision is just another
**checkpointed step** — one whose value comes from a person instead of a
function. No decision on disk yet → emit `approval.requested`, mark the
workflow `suspended`, **throw** — the process exits. Waiting costs nothing and
survives restarts.

**The choreography (practice this once before the call):**

```bash
npm run part7               # press Enter at the prompt
```
Trace: triage → handoff → billing verifies with runCode →
`✋ approval.requested {"action":"issueRefund","args":{…"amount_cents":4900}}` →
```
<wf-id> is waiting for a human. Decide with: npx tsx approve.ts <wf-id> yes|no
```
**The process has exited.** Show the class: nothing is running, nothing was
refunded. Say: *"it can stay like this for a week."* (Optionally show the
parked file: `cat part7-approval/wf/<wf-id>.json` — `"status":"suspended"`.)

```bash
npm run part7:approve -- <wf-id> yes     # the human decides
npm run part7:resume                     # relaunch: recovery replays to the gate
```
Narrate the resume: replay flies through every cached step (no model calls, no
cost), lands **exactly on the gate**, reads the decision:
`🖊 approval.resolved {"approved":true}` → `issueRefund` finally executes →
confirmation sent → ✔ completed.

**If time allows, run the "no" path** (fresh run, then
`npm run part7:approve -- <id> no`, then `npm run part7:resume`): the refund
is never issued and the customer gets a "needs manual review" reply. If the
model ever gets pushy and asks again, the gate just parks it again — the
harness, not the model's good manners, is what holds the line. That sentence
is the perfect closing line for the day.

**Production mapping:** LangGraph interrupts, Temporal signals, Claude Code's
permission prompts — same state machine: request → suspend → human → resume.

---

## Closing (2 min)

Put the spine back on screen. Every line is now filled in, and the class has
watched each one earn its place against a live failure. What they built this
week *is* the tiny version of what Temporal, LangGraph, and the agent SDKs
sell — which is exactly what makes them dangerous with any of them.

---

## Quick reference — every command

| Demo | Command |
|---|---|
| Part 1 · brittle agent | `npm run part1` |
| Part 2 · crash mid-workflow | `npm run part2:crash` |
| Part 2 · recover + new task | `npm run part2` |
| Part 2 · receipts (no duplicates) | `npm run part2:inspect` |
| Part 2b · DBOS crash | `npm run part2dbos:crash` |
| Part 2b · DBOS self-recovery | `npm run part2dbos:recover` |
| Part 2b · DBOS step table | `npm run part2dbos:inspect [wf-id]` |
| Part 2b · clear pending workflows | `npm run part2dbos:reset` |
| Part 3 · sandbox boundary tests | `npm run part3:sandbox` |
| Part 3 · agent with code mode | `npm run part3` |
| Part 4 · compaction mid-task | `npm run part4` |
| Part 5 · handoff to billing | `npm run part5` |
| Part 6 · parallel fan-out | `npm run part6` |
| Part 6 · graceful degradation | `npm run part6:chaos` |
| Part 7 · run until suspended | `npm run part7` |
| Part 7 · human decision | `npm run part7:approve -- <wf-id> yes\|no` |
| Part 7 · resume after decision | `npm run part7:resume` |
| Wipe all demo state | `npm run reset` |

Prompts: pressing **Enter** at any `task >` prompt uses that part's built-in
sample task. Ctrl+C at a `task >` prompt just exits (recovery has already
happened by then).

## If something goes sideways mid-class

- Agent rambles or loops → Ctrl+C, `npm run reset`, run again. Model runs
  vary; every part also *recovers* cleanly, which is itself the lesson.
- A part "recovers" a stale workflow you don't want → `npm run reset`.
- Key problems → `.env` in this folder, format in `.env.example`.
- Each part folder is frozen and independent — breaking one can't break the
  others.
