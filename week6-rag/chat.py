"""Interactive RAG chat over Upstash Vector.

Default: the cafe guide. With --docs: question answering over the PDF chunks
indexed by ingest_pdf.py.

In cafe mode, the vector search casts a wide net and TypeSafe's Jev model then
re-ranks those candidates by how well each one fits the request. Only the best
fits reach the answering model, and the re-ranking is printed on every turn.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from openai import OpenAI
from typesafe_sdk import Noul, TypeSafeClient
from upstash_vector import Index

load_dotenv()

client = OpenAI()
index = Index.from_env()
typesafe = TypeSafeClient()  # reads TYPESAFE_API_KEY

CHAT_MODEL = "gpt-4o-mini"
# The index stores OpenAI vectors (1536 dims), so queries must use the same model.
EMBED_MODEL = "text-embedding-3-small"
TOP_K = 4

# Re-ranking (cafe mode): fetch more candidates than we answer from, let Jev
# judge each one against the request, and keep the best that clear MIN_FIT.
RERANK_CANDIDATES = 8
MIN_FIT = 0.5

FITS_REQUEST = Noul(
    instructions="Would the cafe described in `cafe` be a good recommendation "
                 "for the person asking `request`?",
    criteria={
        "true": "The cafe offers what the request asks for and does not break "
                "any requirement it states, such as wifi or laptop use, price, "
                "opening days or hours, food and drink, pets, location or "
                "atmosphere.",
        "false": "The cafe lacks something the request needs, or directly "
                 "contradicts one of its requirements, even if it is on a "
                 "similar topic.",
    },
)

DOCS_NAMESPACE = "docs"

CAFE_PROMPT = """You are a friendly local guide who recommends cafes.

Answer only from the cafe entries given to you in the context. If none of them
fit what the user asked for, say so plainly and mention the closest alternative
instead of inventing a cafe. Name the cafes you recommend, and give the one or
two concrete details (hours, price, atmosphere, facilities) that explain why
they match. Keep answers short — a couple of sentences per cafe."""

DOCS_PROMPT = """You answer questions about a course PDF.

Answer only from the excerpts given to you in the context. Each excerpt starts
with its source file and page number. If the excerpts do not cover the
question, say so rather than guessing. Cite the page you drew each claim from,
like (page 4). Keep answers short and concrete."""


def embed(text):
    return client.embeddings.create(input=[text], model=EMBED_MODEL).data[0].embedding


def hit_text(hit):
    """Cafes keep their text in metadata; PDF chunks keep it in data."""
    return hit.data or hit.metadata["text"]


def cafe_facts(hit):
    """The cafe's structured fields, which give Jev more to judge than prose."""
    return {k: v for k, v in hit.metadata.items() if k not in ("id", "text")}


def jev_fit(question, hit):
    """Probability (0-1) that Jev judges this cafe a good fit for the request."""
    resp = typesafe.system_one(state={"request": question, "cafe": cafe_facts(hit)},
                               questions={"fits": FITS_REQUEST})
    return resp.nouls["fits"].noul


def rerank(question, hits):
    """Score every candidate with Jev in parallel, print the before/after
    ranking, and return the hits worth answering from."""
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=len(hits)) as pool:
        fits = list(pool.map(lambda hit: jev_fit(question, hit), hits))
    elapsed = time.perf_counter() - started

    # hits arrive in vector order, so a hit's index is its vector rank.
    ranked = sorted(zip(range(len(hits)), hits, fits), key=lambda r: r[2], reverse=True)
    kept = [hit for _, hit, fit in ranked if fit >= MIN_FIT][:TOP_K]
    if not kept:
        # Nothing clears the bar: pass the closest match so the guide can say
        # so and offer it as the nearest alternative, as the prompt asks.
        kept = [ranked[0][1]]

    print(f"\n  re-ranking {len(hits)} vector candidates with Jev "
          f"({elapsed:.1f}s, keep fit >= {MIN_FIT}, max {TOP_K}):")
    print(f"    {'jev':<3} {'fit':>5}   {'vector':<6} {'sim':>5}   {'move':>4}   cafe")
    for new_rank, (old_rank, hit, fit) in enumerate(ranked):
        shift = old_rank - new_rank
        move = f"↑{shift}" if shift > 0 else f"↓{-shift}" if shift < 0 else "="
        status = "→ sent to guide" if hit in kept else "dropped"
        print(f"    #{new_rank + 1:<2} {fit:5.2f}   #{old_rank + 1:<5} {hit.score:5.3f}   "
              f"{move:>4}   {hit.metadata['name']:<28} {status}")
    print()
    return kept


def retrieve(question, namespace="", use_jev=True):
    """The hits the guide answers from. With use_jev, cast a wider net and let
    Jev re-rank it; without, keep the plain vector top TOP_K."""
    # Embed the question with OpenAI and let Upstash return the nearest entries
    # by cosine similarity.
    hits = index.query(vector=embed(question),
                       top_k=RERANK_CANDIDATES if use_jev else TOP_K,
                       namespace=namespace,
                       include_data=True, include_metadata=True)
    return rerank(question, hits) if use_jev and hits else hits


def answer(question, history, namespace, system_prompt, label):
    # Re-rank cafes; PDF chunks keep vector order.
    hits = retrieve(question, namespace, use_jev=namespace == "")
    if not hits:
        return "Nothing is indexed to answer from — run ingest_pdf.py first.", hits
    context = "\n\n".join(hit_text(hit) for hit in hits)

    messages = [{"role": "system", "content": system_prompt}]
    messages += history
    messages.append({
        "role": "user",
        "content": f"{label}:\n\n{context}\n\nQuestion: {question}",
    })
    resp = client.chat.completions.create(model=CHAT_MODEL, messages=messages)
    return resp.choices[0].message.content, hits


def main():
    docs_mode = "--docs" in sys.argv
    if docs_mode:
        namespace, system_prompt, label = DOCS_NAMESPACE, DOCS_PROMPT, "Excerpts"
        count = index.info().namespaces.get(DOCS_NAMESPACE)
        count = count.vector_count if count else 0
        banner = f"{count} PDF chunks in Upstash. Ask about the course material"
    else:
        namespace, system_prompt, label = "", CAFE_PROMPT, "Cafe options"
        banner = f"{index.info().namespaces[''].vector_count} cafes in Upstash. Ask me for a cafe"

    show_sources = "--sources" in sys.argv
    history = []

    print(f"{banner} — Ctrl-C or 'quit' to exit.\n")
    while True:
        try:
            question = input("you > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not question:
            continue
        if question.lower() in {"quit", "exit"}:
            break

        reply, hits = answer(question, history, namespace, system_prompt, label)
        if show_sources:
            print("\n  retrieved:")
            for hit in hits:
                label = hit.metadata.get("name") or \
                    f"{hit.metadata['source']} p{hit.metadata['page']}"
                print(f"    {hit.score:.3f}  {label}")
        print(f"\nguide > {reply}\n")

        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": reply})
        history = history[-8:]


if __name__ == "__main__":
    main()
