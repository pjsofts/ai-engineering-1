# Step 2 — Plan mode
#   1. Plan:     the agent explores with READ-ONLY tools and proposes a plan.
#                It can't change anything: those tools are not in its list.
#   2. Approve:  you read the plan and say yes or no.
#   3. Build:    the same conversation, now with every tool.
from agent import run_agent
from todos import write_todos
from tools import CHANGE, CHECK, LOOK, changed_files, reset_workspace

PLAN_MODE = """You are in PLAN MODE. You can only look: read and search.
Explore first, then reply with a short numbered plan: which files you
will change and how. Also say what you will NOT change.
Do not write any code yet."""

BUILD_MODE = """You are a coding agent. Carry out the approved plan.
Keep a todo list with write_todos. Do only what the plan says.
Run the tests before you say you are done."""


def run(goal):
    messages = [
        {"role": "system", "content": PLAN_MODE},
        {"role": "user", "content": goal},
    ]
    plan = plan_mode(messages)                 # 1. read-only

    if not approved(plan):                     # 2. a person decides
        return f"Plan rejected. Files changed: {len(changed_files())}"

    answer = build_mode(messages)              # 3. every tool
    return f"{answer}\n\nFiles changed: {', '.join(changed_files())}"


def plan_mode(messages):
    return run_agent(messages, LOOK)        # look: yes. change: impossible.


def build_mode(messages):
    messages[0] = {"role": "system", "content": BUILD_MODE}
    messages.append({"role": "user", "content": "Plan approved. Go ahead."})
    return run_agent(messages, LOOK + CHANGE + CHECK + [write_todos])


def approved(plan):
    answer = input(f"{plan}\n\nApprove this plan? [y/n] ")
    return answer.strip().lower() == "y"


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("Add rate limiting to the API: 5 requests per minute "
              "per client, then answer 429."))
