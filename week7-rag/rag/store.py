# store.py — a vector database, from scratch.
#
# A vector database does two things: keep vectors, and find the ones closest
# to a query. For a codebase (thousands of chunks, not billions) that is a
# JSON file and a loop.
import json
import os

from vectors import cosine_similarity


def empty_store():
    return {
        "model": None,   # which embedding model made the vectors
        "files": {},     # path -> hash of the file's content (for incremental indexing)
        "chunks": [],    # each chunk: path, start, end, text, vector
    }


def load_store(path):
    if not os.path.exists(path):
        return empty_store()
    with open(path) as file:
        return json.load(file)


def save_store(store, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as file:
        json.dump(store, file)


def search(store, query_vector, k=5):
    """Score every chunk against the query and return the k closest."""
    scored = []
    for chunk in store["chunks"]:
        score = cosine_similarity(query_vector, chunk["vector"])
        scored.append((score, chunk))

    scored.sort(key=lambda pair: pair[0], reverse=True)   # best first

    hits = []
    for score, chunk in scored[:k]:
        hits.append({"path": chunk["path"], "start": chunk["start"], "end": chunk["end"],
                     "text": chunk["text"], "score": round(score, 3)})
    return hits
