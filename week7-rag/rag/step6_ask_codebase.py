# Step 6 — Ask the codebase (full RAG)
# Retrieve the relevant chunks, put them in the prompt, and let the model
# answer from them only, with path:line citations.
from indexer import build_index
from llm import ask
from tools import INDEX, REPO, retrieve

SYSTEM = """You answer questions about a codebase.
Use ONLY the code excerpts below. Cite each fact as path:line.
If the excerpts do not contain the answer, reply exactly:
"Not in the provided code." Never guess."""


def run(question):
    build_index(REPO, INDEX)

    hits = retrieve(question, k=4)                      # R: retrieve
    excerpts = format_excerpts(hits)                    # A: augment the prompt
    prompt = f"Code excerpts:\n\n{excerpts}\n\nQuestion: {question}"
    return ask(prompt, system=SYSTEM)                   # G: generate


def format_excerpts(hits):
    blocks = []
    for hit in hits:
        blocks.append(f"--- {hit['path']}:{hit['start']}-{hit['end']} ---\n{hit['text']}")
    return "\n\n".join(blocks)


if __name__ == "__main__":
    print(run("When does a user have to log in again?"))
