# Step 6 — User memory
# Session 1, in project A: the user says who they are and how they like to work.
#           The agent saves what is true about the USER with remember().
# Session 2, in project B, days later: a fresh conversation. The memory file
#           goes into the system prompt, so the agent already knows them.
from agent import run_agent
from memory import load_memory, remember
from tools import reset_workspace

SYSTEM = """You are a coding agent. Be brief.
Use remember() for lasting facts about the USER, never about a project.
What you know about the user, from earlier sessions:
{memory}"""


def run(task):
    new_session("I'm Sara. I always want type hints and a one-line docstring. "
                "Also, this project runs on port 8080.")      # project A
    return new_session(task)                               # project B, later


def new_session(user_message):
    system = SYSTEM.format(memory=load_memory())   # every session starts here
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_message},
    ]
    return run_agent(messages, [remember])


if __name__ == "__main__":
    reset_workspace()      # start with an empty memory
    print(run("Write a Python function that returns the average "
              "of a list of numbers."))
