# Step 7 — An agent with both search tools
# The same ReAct loop as the workflows webinar. The model picks the tool;
# the tool descriptions (docstrings in tools.py) tell it when to pick which.
from indexer import build_index
from llm import chat, tool_result
from tools import INDEX, REPO, grep_search, read_file, semantic_search

TOOLS = {"grep_search": grep_search, "semantic_search": semantic_search, "read_file": read_file}
MAX_STEPS = 6

SYSTEM = """You are a coding assistant exploring an unfamiliar codebase.
Find the answer with the tools, then answer briefly with path:line citations."""


def run(question):
    build_index(REPO, INDEX)
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": question},
    ]
    for step in range(MAX_STEPS):
        reply = chat(messages, tools=TOOLS.values())
        messages.append(reply.message)

        if not reply.tool_calls:
            return reply.text

        for call in reply.tool_calls:
            result = TOOLS[call.name](**call.args)
            messages.append(tool_result(call, result))

    return "Stopped: too many steps."


if __name__ == "__main__":
    print(run("How many requests per minute can one client make, and what happens after that?"))
