# Step 1 — The todo list
# Same loop, one new tool: write_todos. The model writes its plan down,
# marks ONE task in progress, and ticks tasks off as it goes.
from agent import run_agent
from todos import show_todos, write_todos
from tools import CHANGE, CHECK, LOOK, reset_workspace

SYSTEM = """You are a coding agent working on a small Python project.
Before you change anything, write a todo list with write_todos.
Work on ONE task at a time and update the list as you go.
Run the tests before you say you are done."""


def run(task):
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]
    answer = run_agent(messages, LOOK + CHANGE + CHECK + [write_todos])

    return f"{answer}\n\nThe todo list at the end:\n{show_todos()}"


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("Add rate limiting to the API: 5 requests per minute "
              "per client, then answer 429."))
