# indexer.py — build the index, and keep it fresh.
#
# Embedding the whole repo on every run is slow and costs money, so we store
# a hash of each file. Next time, a file with the same hash keeps its old
# vectors. Only new or changed files are embedded again.
import hashlib
import os

from chunking import chunk_by_definition
from llm import EMBED_MODEL, embed
from store import empty_store, load_store, save_store

CODE_EXTENSIONS = {".py", ".js", ".ts"}
SKIP_FOLDERS = {".git", "node_modules", "__pycache__", ".venv", ".index"}


def build_index(repo, index_path):
    old = load_store(index_path)
    if old["model"] != EMBED_MODEL:
        old = empty_store()      # vectors from another model can't be compared: embed everything again

    new = empty_store()          # start empty, so deleted files simply vanish
    new["model"] = EMBED_MODEL
    report = {"embedded": [], "unchanged": [], "deleted": []}

    for path in find_code_files(repo):
        text = read_source(repo, path)
        fingerprint = file_hash(text)
        new["files"][path] = fingerprint

        if old["files"].get(path) == fingerprint:
            # Same content as last time: reuse the old chunks and vectors.
            new["chunks"] += [chunk for chunk in old["chunks"] if chunk["path"] == path]
            report["unchanged"].append(path)
        else:
            new["chunks"] += embed_file(path, text)
            report["embedded"].append(path)

    report["deleted"] = [path for path in old["files"] if path not in new["files"]]
    save_store(new, index_path)
    return report


def embed_file(path, text):
    chunks = chunk_by_definition(path, text)
    vectors = embed([chunk["text"] for chunk in chunks])   # one API call per file
    for chunk, vector in zip(chunks, vectors):
        chunk["vector"] = vector
    return chunks


def find_code_files(repo):
    paths = []
    for folder, subfolders, files in os.walk(repo):
        subfolders[:] = sorted(name for name in subfolders if name not in SKIP_FOLDERS)
        for name in sorted(files):
            if os.path.splitext(name)[1] in CODE_EXTENSIONS:
                paths.append(os.path.relpath(os.path.join(folder, name), repo))
    return paths


def read_source(repo, path):
    with open(os.path.join(repo, path), errors="replace") as file:
        return file.read()


def file_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()[:12]
