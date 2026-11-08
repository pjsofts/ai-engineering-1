# Step 4 — Maker and checker
# Some goals are not one test command. So a second agent checks the work:
# a fresh conversation, told to be strict, that answers PASSED or FAILED.
# The maker never grades its own work. After MAX_ROUNDS, a person takes over.
from agent import run_agent
from todos import write_todos
from tools import CHANGE, CHECK, LOOK, reset_workspace

MAX_ROUNDS = 3

MAKER = """You are a coding agent working on a small Python project.
Reach the goal. Keep a todo list with write_todos. Run the tests."""

CHECKER = """You are a strict reviewer. Check if the goal is REALLY met:
run the tests and read the files. Do not trust what anyone says.
Reply with one line: "PASSED: <why>" or "FAILED: <what is missing>".
If you are not sure, it FAILED."""


def run(goal):
    feedback = ""
    for round_number in range(1, MAX_ROUNDS + 1):
        make(goal, feedback)                # the maker works
        verdict = check(goal)               # a different agent decides
        if verdict.startswith("PASSED"):
            return f"Goal met in round {round_number}. {verdict}"
        feedback = verdict                  # the maker sees why

    return (f"Not met after {MAX_ROUNDS} rounds. A person should look.\n"
            f"Last verdict: {feedback}")


def make(goal, feedback):
    task = goal
    if feedback:
        task += f"\n\nA reviewer checked your work and said:\n{feedback}"
    messages = [
        {"role": "system", "content": MAKER},
        {"role": "user", "content": task},
    ]
    return run_agent(messages, LOOK + CHANGE + CHECK + [write_todos])


def check(goal):
    messages = [
        {"role": "system", "content": CHECKER},
        {"role": "user", "content": f"The goal: {goal}"},
    ]
    return run_agent(messages, LOOK + CHECK).strip()   # look, not change


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("Rate limit the API: 5 requests per minute per client, then 429 with a "
              "Retry-After header. Add tests, and document the limit in README.md."))
