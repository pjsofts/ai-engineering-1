# AI Engineering, weeks 3–9: build a coding agent from scratch

Workshop code from my 12-week AI engineering mentorship. Each week adds one layer to the same agent, and each folder runs on its own.

## The problem

Most agent tutorials stop at "call the model in a loop". Real agents also need tools that can't wreck your machine, a loop that stops, a chat interface people will use, costs you can see, retrieval, planning and memory. This repo builds those pieces one week at a time, in plain code with no agent framework, so you can see how each part works.

## What's inside

| Folder | What you build |
|---|---|
| `week3-workshop`, `week3-gui` | The agent harness: from a brittle loop to durable runs, sandboxing, memory, handoffs and human approval. The GUI shows the event stream live, with approve/deny buttons. |
| `week4-workshop`, `week4-gui` | `mycode v0.1`: a streaming terminal chat agent with slash commands, safe interrupts and a live cost meter, plus the same agent in a browser. |
| `week5-workshop`, `week5-gui` | `mycode v0.2`: tool use and function calling. Six tools, guards on the risky ones, a loop that terminates, and a permission gate. |
| `week6-rag` | A command-line RAG chat over Upstash Vector, with a re-ranking step that scores each result before it reaches the model. |
| `week7-rag` | RAG from scratch with a live visualizer: chunking, embeddings, similarity scores and indexing, step by step. |
| `week9-planning-memory` | An agent that plans before it changes code, lets the harness decide when it's done, and remembers across sessions. Includes a live visualizer and slides. |

## Design decisions

- **No agent framework.** Every layer is plain TypeScript or Python, so you can see exactly what a harness does. Frameworks hide the parts this course is about.
- **The harness decides, not the model.** Permission gates, loop limits and "is it done?" checks live in code (week 5's guards, week 9's feature list), because a model's say-so isn't proof.
- **One agent that grows.** Each week extends the same `mycode` agent instead of starting over, so the trade-offs stay visible: a new feature has to fit what's already there.
- **GUIs reuse the real code.** The week 3–5 GUIs import the workshop modules unmodified; nothing is reimplemented for the demo.

## How to run it

Each folder has its own README with setup steps. In general:

```bash
cd week5-workshop            # TypeScript weeks
npm install
cp .env.example .env         # add your API key, where the folder has one
npm start                    # see the folder's README for its exact commands

cd week7-rag                 # Python weeks
pip install -r requirements.txt
cp .env.example .env
python server.py
```

## Tests

```bash
pip install pytest
pytest -q week9-planning-memory/tests   # todo-list rule and feature-list logic, no API key needed
```

CI runs them on every push.

Built by [Pouria Jahandideh](https://pouriajahandideh.com). Course: [pjsofts.github.io](https://pjsofts.github.io/).
