# sessions.py — a session is a file: one line per message, saved at once.
#
# Close the terminal, crash, come back next week: load the file and keep going.
# JSONL means one JSON object per line. Adding a line never rewrites what is
# already saved, so a crash loses at most the message that was being written.
import json

from tools import MYCODE_HOME

SESSIONS = MYCODE_HOME / "sessions"


class Session(list):
    """A list of messages that also writes each new message to a file."""

    def __init__(self, name, messages=()):
        super().__init__(messages)
        self.path = SESSIONS / f"{name}.jsonl"

    def append(self, message):
        super().append(message)                   # in memory, as before
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a") as file:        # and on disk, right away
            file.write(json.dumps(message) + "\n")


def start_session(name):
    return Session(name)


def resume_session(name):
    """Read the file back: one line, one message."""
    lines = (SESSIONS / f"{name}.jsonl").read_text().splitlines()
    return Session(name, [json.loads(line) for line in lines])
