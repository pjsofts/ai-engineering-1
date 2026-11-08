# Week 9 · Planning & Memory: live visualizer + slides

*Think before you act, never lose your place.* Eight small steps of plain
Python, no framework: an agent that plans before it changes code, lets the
harness (not the model) decide when it is done, and remembers across sessions.

Pick a step, press **Enter**, and watch it run: the diagram lights up each
function, the code view highlights the line that is running, and the **Data**
panel shows the conversation the model sees, the agent's todo list, test runs,
changed files, the feature list, the session file, the memory file and PROGRESS.md.

The code in `planning/` is plain Python with no tracing in it. Every step also
runs on its own:

```bash
cd planning && python step2_plan_mode.py
```

## Run it

Requires Python 3.10+.

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt                      # openai, python-dotenv
cp .env.example .env          # only needed for Live mode
python server.py              # → http://127.0.0.1:8770
```

The slides are served by the same server at **http://127.0.0.1:8770/slides/**
(or open `slides/index.html` directly). `←` `→` to move, `F` fullscreen, `PDF` to print.
Slides marked **▶ Demo · Step N** are where you switch to the visualizer.

## Replay vs Live

- **Replay** (default) needs no key and no network. The model's replies are
  scripted for the example inputs, but **the tools run for real**: files really
  change, and the tests really pass or fail. Other inputs ask you to switch to Live.
- **Live** calls `MODEL` from `.env` (any OpenAI-compatible endpoint).
  With `gpt-4o-mini`, the planning and memory mechanics all work, but the
  coding itself is hit and miss: expect failed edits, retries, and sometimes
  "A person should look." That is the harness doing its job. For a smoother
  live demo, use a stronger model.

The agent can only touch `planning/workspace/`, a fresh copy of
`planning/sample_project/` made before every run. `planning/home/` stands in
for `~/.mycode` (sessions and user memory) and is also cleared before every run.

## The steps

| | File | Shows | Try |
|---|---|---|---|
| 0 | `step0_eager_agent.py` | the problem: every tool, no plan | 5 files changed, tests fail |
| 1 | `step1_todo_list.py` | `write_todos`: one task in progress | the first list is rejected |
| 2 | `step2_plan_mode.py` | read-only tools, approve, then build | answer **N**, then **Y** |
| 3 | `step3_feature_list.py` | `features.json`: a passing check marks "done" | F3 fails once, then passes |
| 4 | `step4_maker_checker.py` | a fresh, strict checker agent | round 1 FAILED (README) |
| 5 | `step5_sessions.py` | a session is a `.jsonl` file, resumed next day | Tuesday answers with no tools |
| 6 | `step6_user_memory.py` | `remember()` + `memory.md` in every new session | it saves Sara, not the port |
| 7 | `step7_handoff.py` | `PROGRESS.md` for a fresh session | read PROGRESS.md in the Data panel |

Shared code:

```
planning/
  llm.py        chat(): the only code that talks to the model
  agent.py      run_agent(): the week 1 loop, unchanged all week
  tools.py      list/read/grep, write/edit, run_tests; the workspace
  todos.py      write_todos (step 1+)
  features.py   the feature list the harness owns (step 3)
  sessions.py   Session: a list that saves each message to a file (step 5)
  memory.py     remember() and load_memory() (step 6)
  sample_project/   the tiny API every step works on, with tests/ and checks/
catalog.py   titles, example inputs and the diagram of each step
replay.py    scripted model replies for Replay mode
server.py    runs a step under sys.settrace and streams events (SSE)
ui/          the visualizer page
slides/      the slides
```

You can edit the files in `planning/` while the server is running. Each run reloads them.

## On stage

Same keys as the earlier weeks: `Enter` run, `S` step mode, `Space` next,
`↑` `↓` change step, `-` `=` speed, `1` `2` `3` layout, `[` `]` code file,
`D` Data / Trace panel, `L` hide it, `T` theme, `?` help.
In step 2, the `input()` call becomes a dialog showing the plan: **`Y`** yes, **`N`** no.

Good live moments:
- Step 0, then step 2 with Yes: 5 files and failing tests, against 3 files that match the plan.
- Step 1: the rejected todo list (two tasks `[>]`), then the fix.
- Step 2: answer No. "Files changed: 0."
- Step 3: F3 says "done", its check fails, the error goes back, the retry passes.
- Step 4: round 1, the tests pass and the checker still says FAILED.
- Step 5: the Tuesday answer with zero tool calls. Open the `monday.jsonl` card.
- Step 6: the port is *not* in memory.md.
- Step 7: the "a new conversation" tag on session 2, and the PROGRESS.md card before it.
