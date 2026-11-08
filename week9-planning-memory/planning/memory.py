# memory.py — what the agent knows about YOU, in every project.
#
# Three lifetimes of memory this week, three plain files:
#   one conversation    ~/.mycode/sessions/<name>.jsonl   (step 5)
#   you, the user       ~/.mycode/memory.md               (this file)
#   this project        PROGRESS.md, in the repo          (step 7)
from tools import MYCODE_HOME

MEMORY_FILE = MYCODE_HOME / "memory.md"


def remember(fact: str) -> str:
    """Save a lasting fact about the user: their name, a preference,
    how they like to work. Only save what will still be true next month,
    in a different project. Do NOT save facts about this task or project."""
    MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(MEMORY_FILE, "a") as file:
        file.write(f"- {fact}\n")
    return f"Saved to memory: {fact}"


def load_memory():
    if not MEMORY_FILE.exists():
        return "(nothing yet)"
    return MEMORY_FILE.read_text()
