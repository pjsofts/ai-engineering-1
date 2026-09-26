# Week 6: RAG cafe guide with Jev re-ranking

A command-line RAG chat over Upstash Vector. It recommends cafes, and with
`--docs` it answers questions about the course PDF.

In cafe mode, vector search fetches the 8 nearest cafes. TypeSafe's Jev model
then judges each one against the request ("would this cafe be a good
recommendation?") and returns a fit probability. The best fits (at most 4,
fit >= 0.5) go to `gpt-4o-mini` to write the answer. The re-ranking is printed
on every turn:

```
  re-ranking 8 vector candidates with Jev (0.9s, keep fit >= 0.5, max 4):
    jev   fit   vector   sim   move   cafe
    #1   0.95   #2     0.683     ↑1   Quiet Quarter Coffee         → sent to guide
    #2   0.94   #6     0.643     ↑4   The Roasted Bean             → sent to guide
    #3   0.85   #1     0.738     ↓2   Laptop Lane                  → sent to guide
    #4   0.76   #4     0.659      =   Byte & Brew                  → sent to guide
    #5   0.52   #5     0.655      =   Nightowl Espresso            dropped
    #6   0.01   #3     0.681     ↓3   The Work Shop                dropped
    ...
```

## Setup

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in OpenAI, Upstash and TypeSafe keys
```

The Upstash index stores OpenAI `text-embedding-3-small` vectors (1536 dims,
no built-in embedding model). Each cafe's text and fields live in its vector
metadata.

## Run

```sh
python chat.py                 # cafe guide
python chat.py --sources       # also list what the guide answered from
python ingest_pdf.py path.pdf  # index a PDF into the "docs" namespace
python chat.py --docs          # ask about the PDF (no re-ranking)
```

## Eval: does Jev improve retrieval?

`tests/evals/` scores retrieval with DeepEval's three contextual metrics
(precision, recall, relevancy), once with the plain vector top 4 and once with
Jev re-ranking. The dataset holds a single hand-written test case, so it
demonstrates the effect rather than proving it.

```sh
deepeval test run tests/evals/test_retrieval.py -s
```

One run (judge: gpt-5.4; scores vary a little between runs):

| Metric | Vector only | Vector + Jev |
|---|---|---|
| Contextual Precision | 0.50 | 1.00 |
| Contextual Recall | 0.50 | 1.00 |
| Contextual Relevancy | 0.59 | 0.56 |

`cafes.json` is an older cafe list from before the switch to the current
index; `chat.py` no longer reads it.
