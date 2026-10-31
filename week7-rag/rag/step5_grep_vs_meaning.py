# Step 5 — grep vs semantic search
# Same words, two tools. grep needs the exact text to be in the code;
# semantic search only needs the meaning to be there.
from indexer import build_index
from tools import INDEX, REPO, grep_search, semantic_search


def run(words):
    build_index(REPO, INDEX)                   # nothing to do if it is already fresh

    exact = grep_search(words)
    by_meaning = semantic_search(words)

    return f"grep_search('{words}'):\n{exact}\n\nsemantic_search('{words}'):\n{by_meaning}"


if __name__ == "__main__":
    print(run("rate limiting"))
