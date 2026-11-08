"""Every step the page can show: title, example input, diagram and data views.

A diagram node lights up when the function in `fn` runs. Two extra rules
pick between nodes for the same function:
    "in":     the function that called it directly   ({"fn": "run_tests", "in": "run"})
    "within": a function anywhere above it           ({"fn": "chat", "within": "check"})

Positions are grid units (x to the right, y down). Edges are
(from, to, decided_by, label); decided_by is "code" or "model".

`views` maps a function name to how its result is drawn in the Data panel:
todos, tests, files, features, verdict, session, memory or progress.
"""

MODULES = [
    ("The problem", ["step0_eager_agent"]),
    ("Plan before you act", ["step1_todo_list", "step2_plan_mode"]),
    ("Prove it is done", ["step3_feature_list", "step4_maker_checker"]),
    ("Remember", ["step5_sessions", "step6_user_memory", "step7_handoff"]),
]

RATE_LIMIT = "Add rate limiting to the API: 5 requests per minute per client, then answer 429."


def node(id, label, kind, x, y, fn=None, **match):
    return {"id": id, "label": label, "kind": kind, "x": x, "y": y, "match": {"fn": fn or id, **match}}


def code(id, label, x, y, **kw):
    return node(id, label, "code", x, y, **kw)


def agent(id, label, x, y, **kw):
    return node(id, label, "agent", x, y, **kw)


def llm(id, label, x, y, **kw):
    return node(id, label, "llm", x, y, fn="chat", **kw)


def tool(fn, x, y, id=None, **kw):
    return node(id or fn, f"{fn}()", "tool", x, y, fn=fn, **kw)


def io(x_in, y_in, x_out, y_out):
    return [{"id": "input", "label": "Input", "kind": "io", "x": x_in, "y": y_in},
            {"id": "output", "label": "Output", "kind": "io", "x": x_out, "y": y_out}]


def tool_row(llm_id, names, y, x0, gap=1.25, suffix="", **match):
    """A row of tools under an LLM node: the model asks, the code runs and answers."""
    nodes, edges = [], []
    for i, name in enumerate(names):
        id = name + suffix
        nodes.append(tool(name, x0 + i * gap, y, id=id, **match))
        edges += [(llm_id, id, "model", "act" if i == 0 else ""), (id, llm_id, "code", "observe" if i == 0 else "")]
    return nodes, edges


EAGER_TOOLS, EAGER_EDGES = tool_row("chat", ["read_file", "write_file", "edit_file"], 2.35, 1.35, **{"in": "run_tool"})
TODO_TOOLS, TODO_EDGES = tool_row("chat", ["read_file", "write_file", "edit_file", "run_tests"], 2.35, 0.75)
PLAN_TOOLS, PLAN_EDGES = tool_row("chat_plan", ["list_files", "read_file", "grep_search"], -1.2, 1.55,
                                  suffix="_plan", within="plan_mode")
BUILD_TOOLS, BUILD_EDGES = tool_row("chat_build", ["write_todos", "write_file", "edit_file", "run_tests"], 3.75, 1.3,
                                    suffix="_build", within="build_mode")
FEATURE_TOOLS, FEATURE_EDGES = tool_row("chat", ["read_file", "write_file", "edit_file"], 3.55, 2.5)
MAKER_TOOLS, MAKER_EDGES = tool_row("chat_make", ["read_file", "write_todos", "write_file", "edit_file", "run_tests"],
                                    -1.15, 0.55, gap=1.2, suffix="_make", within="make")
MONDAY_TOOLS, MONDAY_EDGES = tool_row("chat_monday", ["read_file"], -1.2, 2.7, suffix="_monday", within="monday")
FIRST_TOOLS, FIRST_EDGES = tool_row("chat_first", ["read_file", "write_file"], -1.15, 2.15,
                                    suffix="_first", within="first_session")
NEXT_TOOLS, NEXT_EDGES = tool_row("chat_next", ["read_file", "edit_file", "write_file", "run_tests"], 3.55, 0.9,
                                  suffix="_next", within="next_session")
CHECKER_TOOLS, CHECKER_EDGES = tool_row("chat_check", ["run_tests", "read_file"], 3.5, 2.1, suffix="_check", within="check")

STEPS = {
    "step0_eager_agent": {
        "title": "0 · The eager agent",
        "decides": "model, unchecked",
        "summary": "Every tool, no plan, a vague task. When the agent says \"done\", "
                   "we count the files it touched and run the tests ourselves.",
        "example": "Add rate limiting to the API.",
        "hint": "Watch the Data panel at the end: files changed, and do the tests pass?",
        "nodes": io(0, 1, 5.2, -0.3) + [
            agent("run_agent", "Agent loop", 1.25, 1),
            llm("chat", "LLM: think", 2.6, 1),
            code("changed_files", "Count changed files", 2.6, -0.3),
            code("run_tests", "We run the tests", 3.95, -0.3, **{"in": "run"}),
        ] + EAGER_TOOLS,
        "edges": [
            ("input", "run_agent", "code", ""),
            ("run_agent", "chat", "code", "messages"),
            ("run_agent", "changed_files", "code", "“done!”"),
            ("changed_files", "run_tests", "code", ""),
            ("run_tests", "output", "code", ""),
        ] + EAGER_EDGES,
        "views": {"changed_files": "files", "run_command": "tests"},
    },
    "step1_todo_list": {
        "title": "1 · The todo list",
        "decides": "one task at a time",
        "summary": "One new tool: write_todos. The model writes its plan down, keeps ONE task "
                   "in progress, and ticks tasks off. The tool rejects a list that breaks the rule.",
        "example": RATE_LIMIT,
        "hint": "The first list breaks the rule (two tasks in progress). Watch the tool say no.",
        "nodes": io(0, 1, 4.1, -0.35) + [
            agent("run_agent", "Agent loop", 1.25, 1),
            llm("chat", "LLM: think", 2.6, 1),
            tool("write_todos", 2.6, -0.35),
        ] + TODO_TOOLS,
        "edges": [
            ("input", "run_agent", "code", ""),
            ("run_agent", "chat", "code", "messages"),
            ("chat", "write_todos", "model", "plan"),
            ("write_todos", "chat", "code", "the list"),
            ("run_agent", "output", "code", "answer"),
        ] + TODO_EDGES,
        "views": {"write_todos": "todos", "run_command": "tests"},
    },
    "step2_plan_mode": {
        "title": "2 · Plan mode",
        "decides": "you approve the plan",
        "summary": "First the agent explores with read-only tools and proposes a plan. "
                   "You say yes or no. Only then does it get the tools that change files.",
        "example": RATE_LIMIT,
        "hint": "Answer No first: nothing changes. Then run again and answer Yes.",
        "nodes": io(0, 1.25, 5.2, 1.25) + [
            agent("plan_mode", "Plan mode", 1.3, 0),
            llm("chat_plan", "LLM: explore", 2.75, 0, within="plan_mode"),
            node("approved", "You: approve?", "human", 2.0, 1.25),
            agent("build_mode", "Build mode", 1.3, 2.5),
            llm("chat_build", "LLM: build", 2.75, 2.5, within="build_mode"),
        ] + PLAN_TOOLS + BUILD_TOOLS,
        "edges": [
            ("input", "plan_mode", "code", ""),
            ("plan_mode", "chat_plan", "code", "3 tools"),
            ("plan_mode", "approved", "code", "the plan"),
            ("approved", "build_mode", "code", "yes"),
            ("approved", "output", "code", "no"),
            ("build_mode", "chat_build", "code", "every tool"),
            ("build_mode", "output", "code", "answer"),
        ] + PLAN_EDGES + BUILD_EDGES,
        "views": {"write_todos": "todos", "run_command": "tests", "changed_files": "files"},
    },
    "step3_feature_list": {
        "title": "3 · The feature list",
        "decides": "a check passing",
        "summary": "The harness owns features.json. It picks the next feature, the agent builds it, "
                   "and the feature's check decides. The model's \"done\" counts for nothing.",
        "example": "features.json",
        "hint": "F3's first try says \"done\" but fails its check. The error goes back for a second try.",
        "nodes": io(0, 1, 1.2, -0.35) + [
            code("load_features", "Load features.json", 1.2, 1),
            code("next_feature", "Pick next feature", 2.5, 1),
            agent("build", "Agent: build it", 3.8, 1),
            llm("chat", "LLM: code", 3.8, 2.3),
            code("verify", "Run its check", 5.1, 1),
            code("save_features", "Save the state", 3.8, -0.35),
        ] + FEATURE_TOOLS,
        "edges": [
            ("input", "load_features", "code", ""),
            ("load_features", "next_feature", "code", ""),
            ("next_feature", "build", "code", "one feature"),
            ("build", "chat", "code", ""),
            ("build", "verify", "code", "“done”"),
            ("verify", "build", "code", "failed: retry"),
            ("verify", "save_features", "code", ""),
            ("save_features", "next_feature", "code", "next"),
            ("save_features", "output", "code", "stuck"),
            ("next_feature", "output", "code", "all pass"),
        ] + FEATURE_EDGES,
        "views": {"load_features": "features", "save_features": "features", "run_command": "tests"},
    },
    "step4_maker_checker": {
        "title": "4 · Maker and checker",
        "decides": "a second agent",
        "summary": "A maker agent works toward the goal. A separate, strict checker agent, in a fresh "
                   "conversation, runs the tests and reads the files. It says PASSED or FAILED.",
        "example": "Rate limit the API: 5 requests per minute per client, then 429 with a "
                   "Retry-After header. Add tests, and document the limit in README.md.",
        "hint": "Round 1: the maker forgets README.md and says \"done\". The checker doesn't believe it.",
        "nodes": io(0, 1.2, 4.6, 1.2) + [
            agent("make", "Maker", 1.3, 0.15),
            llm("chat_make", "LLM: maker", 2.95, 0.15, within="make"),
            agent("check", "Checker", 1.3, 2.3),
            llm("chat_check", "LLM: checker", 2.95, 2.3, within="check"),
        ] + MAKER_TOOLS + CHECKER_TOOLS,
        "edges": [
            ("input", "make", "code", ""),
            ("make", "chat_make", "code", ""),
            ("make", "check", "code", "“done”"),
            ("check", "chat_check", "code", "fresh chat"),
            ("check", "make", "code", "FAILED"),
            ("check", "output", "code", "PASSED"),
        ] + MAKER_EDGES + CHECKER_EDGES,
        "views": {"write_todos": "todos", "run_command": "tests", "check": "verdict"},
    },
    "step5_sessions": {
        "title": "5 · Sessions and resume",
        "decides": "a file, one line per message",
        "summary": "Monday: every message is written to monday.jsonl the moment it is added. "
                   "The terminal closes. Tuesday: load the file and ask a follow-up.",
        "example": "Yesterday you looked at how the API finds a user. "
                   "Which function does it, and what happens when the id doesn't exist?",
        "hint": "On Tuesday the model answers without reading any file: it is all in the session.",
        "nodes": io(0, 1.1, 4.3, 3.3) + [
            agent("monday", "Monday", 1.3, 0),
            llm("chat_monday", "LLM", 2.7, 0, within="monday"),
            code("append", "Save one line", 4.3, 1.1, fn="Session.append"),
            agent("tuesday", "Tuesday", 1.3, 2.2),
            code("resume_session", "Load monday.jsonl", 1.3, 3.4),
            llm("chat_tuesday", "LLM", 2.8, 2.2, within="tuesday"),
        ] + MONDAY_TOOLS,
        "edges": [
            ("input", "monday", "code", ""),
            ("monday", "chat_monday", "code", ""),
            ("monday", "append", "code", "every message"),
            ("monday", "tuesday", "code", "terminal closes"),
            ("tuesday", "resume_session", "code", "first"),
            ("tuesday", "append", "code", ""),
            ("tuesday", "chat_tuesday", "code", "the old messages"),
            ("tuesday", "output", "code", ""),
        ] + MONDAY_EDGES,
        "views": {"resume_session": "session"},
    },
    "step6_user_memory": {
        "title": "6 · User memory",
        "decides": "what lasts across projects",
        "summary": "In project A, the agent saves facts about the USER with remember(). "
                   "In project B, days later, memory.md goes into the system prompt of a fresh session.",
        "example": "Write a Python function that returns the average of a list of numbers.",
        "hint": "Session 1 saves Sara's preferences but not the port: that fact is about the project.",
        "nodes": io(0, 1, 4.2, 1) + [
            agent("new_session", "New session", 1.3, 1),
            code("load_memory", "Load memory.md", 2.3, -0.3),
            llm("chat", "LLM", 2.8, 1),
            tool("remember", 2.8, 2.35),
        ],
        "edges": [
            ("input", "new_session", "code", ""),
            ("new_session", "load_memory", "code", "first"),
            ("load_memory", "chat", "code", "system prompt"),
            ("new_session", "chat", "code", ""),
            ("chat", "remember", "model", "a fact about you"),
            ("remember", "chat", "code", ""),
            ("new_session", "new_session", "code", "days later"),
            ("new_session", "output", "code", ""),
        ],
        "views": {"load_memory": "memory", "remember": "memory"},
    },
    "step7_handoff": {
        "title": "7 · The handoff",
        "decides": "PROGRESS.md in the repo",
        "summary": "Session 1 does part of the work. Then the harness asks for PROGRESS.md: done, next, notes. "
                   "Session 2 is a fresh agent with no history. It reads PROGRESS.md and carries on.",
        "example": "Add rate limiting to the API: 5 requests per minute per client, then 429 with "
                   "a Retry-After header, and tests. Today, only write ratelimit.py.",
        "hint": "Read PROGRESS.md in the Data panel: it is the only thing session 2 knows.",
        "nodes": io(0, 1.2, 4.5, 1.2) + [
            agent("first_session", "Session 1", 1.3, 0.1),
            llm("chat_first", "LLM", 2.75, 0.1, within="first_session"),
            agent("next_session", "Session 2 · fresh", 1.3, 2.3),
            llm("chat_next", "LLM", 2.75, 2.3, within="next_session"),
        ] + FIRST_TOOLS + NEXT_TOOLS,
        "edges": [
            ("input", "first_session", "code", ""),
            ("first_session", "chat_first", "code", "task, then “write PROGRESS.md”"),
            ("first_session", "next_session", "code", "PROGRESS.md"),
            ("next_session", "chat_next", "code", "no history"),
            ("next_session", "output", "code", ""),
        ] + FIRST_EDGES + NEXT_EDGES,
        "views": {"write_file": "progress", "run_command": "tests"},
    },
}
