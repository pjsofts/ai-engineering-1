# Step 3 — The vector store
# Index the whole sample repo (chunk, embed, save), then search it.
import os

from indexer import build_index
from tools import INDEX, REPO, retrieve


def run(question):
    if os.path.exists(INDEX):
        os.remove(INDEX)              # start from nothing, so we see every file get embedded
    build_index(REPO, INDEX)          # chunk + embed every file, save to a JSON file

    hits = retrieve(question, k=3)    # embed the question, find the closest chunks
    return "\n".join(f"{hit['score']:.3f}  {hit['path']}:{hit['start']}-{hit['end']}" for hit in hits)


if __name__ == "__main__":
    print(run("where do we stop people from calling the API too often?"))
