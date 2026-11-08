# todos.py — a todo list that the AGENT writes and keeps up to date.
#
# Writing the plan down makes the model commit to it. Seeing it again every
# turn keeps it on track. And you can watch its progress.
#
# The one rule, checked by the tool: only ONE task is in progress at a time.
TODOS = []   # the current list: [{"task": ..., "status": ...}, ...]

MARKS = {"[ ]": "pending", "[>]": "in_progress", "[x]": "done"}


def write_todos(todos: str) -> str:
    """Write your todo list. Use it for any task with more than two steps.
    Send the WHOLE list every time, one task per line:
        [x] a task that is done
        [>] the ONE task you are working on now
        [ ] a task for later
    Mark a task [>] before you start it and [x] as soon as it is done."""
    items = []
    for line in todos.strip().splitlines():
        mark, task = line.strip()[:3], line.strip()[3:].strip()
        if mark not in MARKS:
            return f"Error: start every line with [ ], [>] or [x], not: {line!r}"
        items.append({"task": task, "status": MARKS[mark]})

    in_progress = [item for item in items if item["status"] == "in_progress"]
    if len(in_progress) > 1:                                        # the rule
        return f"Error: only ONE task can be [>]. You marked {len(in_progress)}."

    TODOS[:] = items
    return "Saved. Your list:\n" + show_todos()


def show_todos():
    icons = {"pending": "○", "in_progress": "▶", "done": "✔"}
    return "\n".join(f"{icons[item['status']]} {item['task']}" for item in TODOS)
