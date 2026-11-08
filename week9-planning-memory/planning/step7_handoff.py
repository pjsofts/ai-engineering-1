# Step 7 — The handoff
# Big work takes more than one session. Before a session ends, the harness
# asks the agent to write PROGRESS.md: what is done, what is next, and what
# to watch out for. The next session is a fresh agent. It knows NOTHING
# except what is in the repo, and PROGRESS.md is in the repo.
from agent import run_agent
from tools import CHANGE, CHECK, LOOK, reset_workspace

SYSTEM = "You are a coding agent working on a small Python project."

HANDOFF = """Time to stop. Write PROGRESS.md for the next session with
three parts: ## Done, ## Next, ## Notes.
Short and concrete: file names, commands."""

CONTINUE = """Continue the work. Read PROGRESS.md, then do everything
under ## Next. When you are done, update PROGRESS.md."""


def run(task):
    first_session(task)
    return next_session()


def first_session(task):
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]
    run_agent(messages, LOOK + CHANGE + CHECK)

    # The harness asks for the handoff. It doesn't hope the model remembers.
    messages.append({"role": "user", "content": HANDOFF})
    return run_agent(messages, LOOK + CHANGE)


def next_session():
    messages = [                       # a fresh conversation: no history
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": CONTINUE},
    ]
    return run_agent(messages, LOOK + CHANGE + CHECK)


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("Add rate limiting to the API: 5 requests per minute per "
              "client, then 429 with a Retry-After header, and tests. "
              "Today, only write ratelimit.py."))
