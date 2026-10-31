# Week 7 · RAG from scratch: live visualizer

Pick a step, press **Enter**, and watch it run: the diagram lights up each
function, the code view highlights the line that is running, and the **Data**
panel draws what the code produced: chunk boundaries, vectors, similarity
scores, and what each index run had to embed.

The code in `rag/` is plain Python with no tracing in it. Each step also runs on
its own: `cd rag && python step3_vector_store.py`.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # only needed for Live mode
python server.py              # → http://127.0.0.1:8766
```

The slides are served by the same server at **http://127.0.0.1:8766/slides/**
(or open `slides/index.html` directly). `←` `→` to move, `F` fullscreen, `PDF` to print.
Slides marked **▶ Demo · Step N** are where you switch to the visualizer.

## Replay vs Live

- **Replay** (default) needs no key and no network. Embeddings come from a small
  offline stand-in (64 numbers per text, built from keywords), so the right
  chunks win but the **scores are only illustrative**. Chat answers are scripted
  for the example inputs.
- **Live** calls `MODEL` and `EMBED_MODEL` from `.env`.
- **Real numbers in Replay:** with a working key, run `python record.py` once.
  It records real embeddings and answers for every example input into
  `recordings/`, and Replay uses them from then on.

## The steps

| | File | Shows |
|---|---|---|
| 1 | `step1_chunking.py` | fixed windows vs cutting at `def` / `class` |
| 2 | `step2_embeddings.py` | vectors + cosine similarity, no shared words needed |
| 3 | `step3_vector_store.py` | index time vs question time; the store is a JSON file |
| 4 | `step4_incremental.py` | hash per file: 10 → 0 → 1 embedded, deletes vanish |
| 5 | `step5_grep_vs_meaning.py` | `rate limiting`: grep finds nothing, semantic finds `throttle.py` |
| 6 | `step6_ask_codebase.py` | full RAG with `path:line` citations; refuses when it can't answer |
| 7 | `step7_agent.py` | the ReAct loop picks between grep and semantic search |

Library code: `chunking.py`, `vectors.py`, `store.py`, `indexer.py`, `tools.py`, `llm.py`.
`sample_repo/` is the small made-up codebase every step searches.

## On stage

Same keys as the workflows webinar: `Enter` run, `S` step mode, `Space` next,
`↑` `↓` change step, `-` `=` speed, `1` `2` `3` layout, `[` `]` code file,
**`D` Data / Trace panel**, `L` hide it, `T` theme, `?` help.

Good live moments:
- Step 1 with `api/throttle.py`: the 10-line cut lands inside `TokenBucket` (red ✂).
- Step 4: the three counts, 10 → 0 → 1. That is the whole idea of incremental indexing.
- Step 5 with `rate limiting`, then with `needs_reauth`: each tool wins once.
- Step 6 with `What database do we use?`: it says "Not in the provided code."
