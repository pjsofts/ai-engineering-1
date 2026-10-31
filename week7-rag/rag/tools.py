# tools.py — two ways for the agent to find code.
#
#   grep_search      exact text. Instant and free. Use it when you know the name.
#   semantic_search  meaning. Costs one embedding call. Use it when you don't.
#
# The docstrings are the tool descriptions the model reads, so they say
# WHEN to use each tool, not just what it does.
import os

from indexer import find_code_files, read_source
from llm import embed
from store import load_store, search

REPO = os.path.join(os.path.dirname(__file__), "..", "sample_repo")
INDEX = os.path.join(os.path.dirname(__file__), "..", ".index", "sample_repo.json")


def grep_search(pattern):
    """Find lines that contain this exact text (case-insensitive).
    Fast and free. Use it when you know a name or string from the code,
    like a function name or an error message."""
    matches = []
    for path in find_code_files(REPO):
        for number, line in enumerate(read_source(REPO, path).splitlines(), start=1):
            if pattern.lower() in line.lower():
                matches.append(f"{path}:{number}: {line.strip()}")
    return "\n".join(matches) or f"No lines contain '{pattern}'."


def semantic_search(query):
    """Find code by MEANING, not exact text. Use it for questions like
    'where do we handle X?' when you don't know the names used in the code.
    For a known name or string, use grep_search instead."""
    hits = retrieve(query, k=3)
    results = []
    for hit in hits:
        results.append(f"{hit['path']}:{hit['start']}-{hit['end']} (similarity {hit['score']})\n{hit['text']}")
    return "\n\n".join(results)


def read_file(path):
    """Read one file from the codebase, with line numbers."""
    lines = read_source(REPO, path).splitlines()
    return "\n".join(f"{number}: {line}" for number, line in enumerate(lines, start=1))


def retrieve(query, k=5):
    """Embed the question, then find the k closest chunks in the index."""
    store = load_store(INDEX)
    query_vector = embed([query])[0]
    return search(store, query_vector, k)
