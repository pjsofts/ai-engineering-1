# Step 4 — Incremental indexing
# Index a copy of the repo four times and watch how much gets embedded:
#   1. first run          every file
#   2. nothing changed    no file
#   3. one file edited    that one file
#   4. one file deleted   no file, and its chunks are gone
import os
import shutil

from indexer import build_index
from tools import REPO

WORKSPACE = os.path.join(os.path.dirname(__file__), "..", ".index", "workspace")
INDEX = os.path.join(os.path.dirname(__file__), "..", ".index", "workspace.json")


def run(file_to_edit):
    start_fresh()

    first = build_index(WORKSPACE, INDEX)
    again = build_index(WORKSPACE, INDEX)

    edit_file(file_to_edit)
    after_edit = build_index(WORKSPACE, INDEX)

    os.remove(os.path.join(WORKSPACE, "web", "navbar.js"))
    after_delete = build_index(WORKSPACE, INDEX)

    return "\n".join([
        summary("1. first run", first),
        summary("2. run again", again),
        summary(f"3. after editing {file_to_edit}", after_edit),
        summary("4. after deleting web/navbar.js", after_delete),
    ])


def start_fresh():
    shutil.rmtree(WORKSPACE, ignore_errors=True)
    if os.path.exists(INDEX):
        os.remove(INDEX)
    shutil.copytree(REPO, WORKSPACE)


def edit_file(path):
    with open(os.path.join(WORKSPACE, path), "a") as file:
        file.write("\n\ndef audit_log(event):\n    print('audit:', event)\n")


def summary(label, report):
    return (f"{label}: embedded {len(report['embedded'])}, "
            f"reused {len(report['unchanged'])}, deleted {len(report['deleted'])}")


if __name__ == "__main__":
    print(run("auth/session.py"))
