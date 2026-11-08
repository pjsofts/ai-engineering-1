# Step 0 — The eager agent
# Every tool, no plan, a vague task. Then WE check its work:
# how many files did it touch, and do the tests still pass?
from agent import run_agent
from tools import CHANGE, CHECK, LOOK, changed_files, reset_workspace, run_tests

SYSTEM = """You are a coding agent working on a small Python project.
Do the user's task."""


def run(task):
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]
    answer = run_agent(messages, LOOK + CHANGE + CHECK)

    changed = changed_files()      # what did it touch?
    tests = run_tests()            # does it still work?

    return (f"The agent says: {answer}\n\n"
            f"Files changed: {len(changed)}  ({', '.join(changed)})\n"
            f"Tests: {tests.splitlines()[0]}")


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("Add rate limiting to the API."))
