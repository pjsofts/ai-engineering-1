# Step 5 — Sessions and resume
# Monday: you and the agent read some code. Every message is written to a file
#         the moment it is added. Then the terminal closes: memory is gone.
# Tuesday: load the file, ask a follow-up. The agent knows what happened.
# The loop doesn't change: a Session is just a list that also saves itself.
from agent import run_agent
from sessions import resume_session, start_session
from tools import LOOK, reset_workspace

SYSTEM = "You are a coding agent working on a small Python project. Be brief."
FIRST_QUESTION = "Read api.py and users.py. How does the API find a user?"


def run(question):
    monday()
    return tuesday(question)


def monday():
    session = start_session("monday")
    session.append({"role": "system", "content": SYSTEM})
    session.append({"role": "user", "content": FIRST_QUESTION})
    run_agent(session, LOOK)
    # The terminal closes here. The session object is gone, the file stays.


def tuesday(question):
    session = resume_session("monday")       # the whole conversation, back
    session.append({"role": "user", "content": question})
    return run_agent(session, LOOK)


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("Yesterday you looked at how the API finds a user. "
              "Which function does it, and what happens when the id doesn't exist?"))
