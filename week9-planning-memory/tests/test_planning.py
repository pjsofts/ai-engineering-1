"""Unit tests for the week 9 planning harness. No API key needed."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "planning"))

import todos  # noqa: E402
from features import next_feature, progress  # noqa: E402


def setup_function():
    todos.TODOS.clear()


def test_write_todos_saves_the_list():
    out = todos.write_todos("[x] read the code\n[>] add the rate limiter\n[ ] write tests")
    assert out.startswith("Saved.")
    assert [t["status"] for t in todos.TODOS] == ["done", "in_progress", "pending"]


def test_only_one_task_can_be_in_progress():
    out = todos.write_todos("[>] first\n[>] second")
    assert out.startswith("Error: only ONE task")
    assert todos.TODOS == []


def test_rejects_lines_without_a_mark():
    out = todos.write_todos("[x] done\nforgot the mark")
    assert out.startswith("Error: start every line")


def test_next_feature_waits_for_dependencies():
    features = [
        {"id": "a", "state": "failing", "deps": []},
        {"id": "b", "state": "failing", "deps": ["a"]},
    ]
    assert next_feature(features)["id"] == "a"
    features[0]["state"] = "passing"
    assert next_feature(features)["id"] == "b"
    features[1]["state"] = "passing"
    assert next_feature(features) is None


def test_progress_counts_passing_features():
    features = [{"state": "passing"}, {"state": "failing"}, {"state": "passing"}]
    assert progress(features) == "2 of 3 features passing"
