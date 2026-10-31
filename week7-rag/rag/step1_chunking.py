# Step 1 — Chunking
# Split one file two ways and compare. Fixed windows cut functions in half;
# cutting at definitions keeps each function whole.
from chunking import chunk_by_definition, chunk_by_lines
from indexer import read_source
from tools import REPO


def run(path):
    text = read_source(REPO, path)

    naive = chunk_by_lines(path, text, size=10)
    smart = chunk_by_definition(path, text)

    return (f"{path}: {len(text.splitlines())} lines\n"
            f"by lines:      {len(naive)} chunks, cut wherever line 10, 20, 30... falls\n"
            f"by definition: {len(smart)} chunks, one per function or class")


if __name__ == "__main__":
    print(run("api/throttle.py"))
