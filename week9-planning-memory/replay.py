"""Replay mode: answers every model call without a key or a network.

Each step has a script: the replies a model gives for the example input,
one per turn of the loop. The tools still run for real, so files really
change and the tests really pass or fail. Other inputs get a message
asking you to switch to Live.
"""
from llm import Reply, ToolCall

NO_RECORDING = "(Replay has no recorded answer for this input. Switch to Live (M) to ask the model.)"


class Replay:
    def __init__(self, step):
        self.step = step.split("_")[0]
        self.ids = 0

    def chat(self, messages, tools):
        system = messages[0]["content"]
        user = last_user_message(messages)
        turn = turns_since_user(messages)
        script = pick_script(self.step, system, user, first_user_message(messages))
        if script is None:
            return Reply(NO_RECORDING)
        if turn >= len(script):
            return Reply("Done.")
        return self.reply(script[turn])

    def reply(self, turn):
        """A script turn is a string (the answer) or a list of (tool, args)."""
        if isinstance(turn, str):
            return Reply(turn)
        calls = []
        for name, args in turn:
            self.ids += 1
            calls.append(ToolCall(f"call_{self.ids}", name, args))
        return Reply("", calls)


def first_user_message(messages):
    return next(m["content"] for m in messages if m["role"] == "user")


def last_user_message(messages):
    return [m for m in messages if m["role"] == "user"][-1]["content"]


def turns_since_user(messages):
    start = max(i for i, m in enumerate(messages) if m["role"] == "user")
    return sum(1 for m in messages[start:] if m["role"] == "assistant")


def pick_script(step, system, user, first):
    """The script for this conversation, or None when this input has no recording."""
    rate_limit = "rate limit" in first.lower()
    if step == "step5":
        if "find a user" in user:
            return MONDAY
        return TUESDAY if "yesterday" in user.lower() else None
    if step == "step6":
        if user.startswith("I'm Sara"):
            return MEMORY_SESSION_1
        return MEMORY_SESSION_2 if "average" in user else None
    if step == "step7":
        if user.startswith("Continue the work"):
            return HANDOFF_SESSION_2 if (workspace() / "PROGRESS.md").exists() else None
        if user.startswith("Time to stop"):
            return HANDOFF_WRITE if rate_limit else None
        return HANDOFF_SESSION_1 if rate_limit and "only write ratelimit.py" in user else None
    if step != "step3" and not rate_limit:
        return None
    if step == "step0":
        return EAGER
    if step == "step1":
        return TODO_RUN
    if step == "step2":
        return PLAN if system.startswith("You are in PLAN MODE") else BUILD
    if step == "step3":
        if user.startswith("Feature F2"):
            return F2
        return F3_RETRY if "FAILED" in user else F3_FIRST_TRY
    if step == "step4":
        if system.startswith("You are a strict reviewer"):
            return CHECK_ROUND_2 if "Rate limiting" in readme() else CHECK_ROUND_1
        return MAKER_ROUND_2 if "reviewer" in user else MAKER_ROUND_1
    return None


def workspace():
    from tools import WORKSPACE
    return WORKSPACE


def readme():
    return (workspace() / "README.md").read_text()


def todos(*lines):
    return ("write_todos", {"todos": "\n".join(lines)})


# ---------------------------------------------------------------- the code it writes

RATELIMIT = '''# ratelimit.py — at most LIMIT requests per client in each WINDOW of seconds.
import time

LIMIT = 5        # requests
WINDOW = 60      # seconds

_requests = {}   # client_ip -> the times of its recent requests


def allow(client_ip):
    """True if this client may make another request now."""
    now = time.time()
    recent = [t for t in _requests.get(client_ip, []) if now - t < WINDOW]
    if len(recent) >= LIMIT:
        _requests[client_ip] = recent
        return False
    _requests[client_ip] = recent + [now]
    return True


def reset():
    """Forget every client. Used by the tests."""
    _requests.clear()
'''

IMPORT_OLD = "from users import find_user, list_users"
IMPORT_NEW = "from ratelimit import WINDOW, allow\nfrom users import find_user, list_users"
HEALTH = '''        return 200, {}, "ok"
'''
LIMIT_CHECK = HEALTH + '''
    if not allow(client_ip):
        return 429, {"Retry-After": str(WINDOW)}, "too many requests"
'''
LIMIT_CHECK_NO_HEADER = HEALTH + '''
    if not allow(client_ip):
        return 429, {}, "too many requests"
'''

TESTS = '''import unittest

import ratelimit
from api import handle


class TestRateLimit(unittest.TestCase):
    def setUp(self):
        ratelimit.reset()

    def test_five_requests_are_fine(self):
        for _ in range(5):
            self.assertEqual(handle("GET", "/users", "5.5.5.5")[0], 200)

    def test_sixth_request_gets_429(self):
        for _ in range(5):
            handle("GET", "/users", "5.5.5.5")
        status, headers, body = handle("GET", "/users", "5.5.5.5")
        self.assertEqual(status, 429)
        self.assertEqual(headers["Retry-After"], "60")

    def test_health_is_never_limited(self):
        for _ in range(10):
            self.assertEqual(handle("GET", "/health", "5.5.5.5")[0], 200)
'''

README_SECTION = '''
## Rate limiting

Each client (by IP address) can make **5 requests per minute**. The 6th request
in a minute gets `429 Too Many Requests` with a `Retry-After: 60` header.
`/health` is never limited. The numbers are `LIMIT` and `WINDOW` in `ratelimit.py`.
'''

# ---------------------------------------------------------------- step 0: the eager agent
# What an eager model really does with "Add rate limiting to the API.":
# a framework nobody asked for, a refactor "while I'm here", and no test run.

EAGER_RATELIMIT = '''# ratelimit.py — a flexible, pluggable rate limiting framework.
import time
from abc import ABC, abstractmethod

from config import RATE_LIMIT


class Strategy(ABC):
    @abstractmethod
    def allow(self, key): ...


class TokenBucket(Strategy):
    def __init__(self, rate, burst):
        self.rate, self.burst, self.buckets = rate, burst, {}

    def allow(self, key):
        tokens, last = self.buckets.get(key, (self.burst, time.time()))
        now = time.time()
        tokens = min(self.burst, tokens + (now - last) * self.rate)
        if tokens < 1:
            return False
        self.buckets[key] = (tokens - 1, now)
        return True


class SlidingWindow(Strategy):
    def __init__(self, limit, window):
        self.limit, self.window, self.hits = limit, window, {}

    def allow(self, key):
        now = time.time()
        hits = [t for t in self.hits.get(key, []) if now - t < self.window]
        self.hits[key] = hits + [now]
        return len(hits) < self.limit


STRATEGIES = {"token_bucket": TokenBucket, "sliding_window": SlidingWindow}


def make_limiter():
    options = RATE_LIMIT[RATE_LIMIT["strategy"]]
    return STRATEGIES[RATE_LIMIT["strategy"]](**options)
'''

EAGER_CONFIG = '''# config.py — every setting in one place, for flexibility.
RATE_LIMIT = {
    "strategy": "token_bucket",
    "token_bucket": {"rate": 1.0, "burst": 10},
    "sliding_window": {"limit": 60, "window": 60},
}
'''

EAGER_MIDDLEWARE = '''# middleware.py — wraps any handler with rate limiting.
import functools

from ratelimit import make_limiter

limiter = make_limiter()


def rate_limited(handler):
    @functools.wraps(handler)
    def wrapper(method, path, client_ip):
        if not limiter.allow(client_ip):
            return 429, {}, "too many requests"
        return handler(method, path, client_ip)
    return wrapper
'''

EAGER_USERS = '''# users.py — the users, kept in memory. Now a dict: O(1) lookups.
USERS = {
    "1": {"id": "1", "name": "Sara"},
    "2": {"id": "2", "name": "Reza"},
    "3": {"id": "3", "name": "Mina"},
}


def list_users():
    return list(USERS.values())


def get_user(user_id):
    """Renamed from find_user: a clearer name."""
    return USERS.get(user_id)
'''

EAGER = [
    [("read_file", {"path": "api.py"})],
    [("write_file", {"path": "config.py", "content": EAGER_CONFIG}),
     ("write_file", {"path": "ratelimit.py", "content": EAGER_RATELIMIT})],
    [("write_file", {"path": "middleware.py", "content": EAGER_MIDDLEWARE})],
    [("edit_file", {"path": "api.py", "old": IMPORT_OLD,
                    "new": "from middleware import rate_limited\n" + IMPORT_OLD}),
     ("edit_file", {"path": "api.py", "old": "def handle(", "new": "@rate_limited\ndef handle("})],
    [("read_file", {"path": "users.py"})],
    [("write_file", {"path": "users.py", "content": EAGER_USERS})],
    "Done! I added a flexible rate limiting system: two strategies (token bucket and "
    "sliding window), a config file, and middleware that wraps the API. While I was there, "
    "I also cleaned up users.py: users are a dict now, and find_user is called get_user, "
    "a clearer name. Everything should work.",
]

# ---------------------------------------------------------------- step 1: the todo list

STEPS = ["Read api.py to see where requests come in",
         "Write ratelimit.py with allow(client_ip)",
         "Call allow() in api.handle, answer 429",
         "Add tests/test_ratelimit.py",
         "Run all the tests"]


def todo_list(doing):
    """The list with tasks before `doing` done, `doing` in progress, the rest pending."""
    marks = ["[x]" if i < doing else "[>]" if i == doing else "[ ]" for i in range(len(STEPS))]
    return todos(*[f"{mark} {task}" for mark, task in zip(marks, STEPS)])


TODO_RUN = [
    [todos("[>] " + STEPS[0], "[>] " + STEPS[1], *("[ ] " + s for s in STEPS[2:]))],   # breaks the rule
    [todo_list(0), ("read_file", {"path": "api.py"})],
    [todo_list(1), ("write_file", {"path": "ratelimit.py", "content": RATELIMIT})],
    [todo_list(2), ("edit_file", {"path": "api.py", "old": IMPORT_OLD, "new": IMPORT_NEW}),
     ("edit_file", {"path": "api.py", "old": HEALTH, "new": LIMIT_CHECK})],
    [todo_list(3), ("write_file", {"path": "tests/test_ratelimit.py", "content": TESTS})],
    [todo_list(4), ("run_tests", {})],
    [todo_list(5)],
    "Done. Each client can make 5 requests per minute; the 6th gets 429 with a "
    "Retry-After header. /health is never limited. All 7 tests pass.",
]

# ---------------------------------------------------------------- step 2: plan mode

PLAN = [
    [("list_files", {})],
    [("read_file", {"path": "api.py"})],
    [("grep_search", {"pattern": "client_ip"})],
    "Plan:\n"
    "1. New file ratelimit.py: allow(client_ip) lets 5 requests per minute through "
    "per client; reset() clears it for tests.\n"
    "2. api.py: in handle(), right after /health, call allow(). Over the limit, "
    "answer 429 with a Retry-After header.\n"
    "3. New file tests/test_ratelimit.py: 5 requests pass, the 6th gets 429, "
    "/health is never limited.\n"
    "4. Run all the tests.\n\n"
    "Not changing: users.py, the existing tests.",
]

BUILD = [
    [todos("[>] Write ratelimit.py", "[ ] Call allow() in api.py, answer 429",
           "[ ] Add tests/test_ratelimit.py", "[ ] Run all the tests"),
     ("write_file", {"path": "ratelimit.py", "content": RATELIMIT})],
    [todos("[x] Write ratelimit.py", "[>] Call allow() in api.py, answer 429",
           "[ ] Add tests/test_ratelimit.py", "[ ] Run all the tests"),
     ("edit_file", {"path": "api.py", "old": IMPORT_OLD, "new": IMPORT_NEW}),
     ("edit_file", {"path": "api.py", "old": HEALTH, "new": LIMIT_CHECK})],
    [todos("[x] Write ratelimit.py", "[x] Call allow() in api.py, answer 429",
           "[>] Add tests/test_ratelimit.py", "[ ] Run all the tests"),
     ("write_file", {"path": "tests/test_ratelimit.py", "content": TESTS})],
    [todos("[x] Write ratelimit.py", "[x] Call allow() in api.py, answer 429",
           "[x] Add tests/test_ratelimit.py", "[>] Run all the tests"),
     ("run_tests", {})],
    [todos("[x] Write ratelimit.py", "[x] Call allow() in api.py, answer 429",
           "[x] Add tests/test_ratelimit.py", "[x] Run all the tests")],
    "Done, as planned: ratelimit.py is new, api.py answers 429 with Retry-After "
    "after 5 requests a minute, and the 3 new tests pass with the old ones (7 in total). "
    "users.py is untouched.",
]

# ---------------------------------------------------------------- step 3: the feature list

F2 = [
    [("read_file", {"path": "checks/test_limiter.py"})],
    [("write_file", {"path": "ratelimit.py", "content": RATELIMIT})],
    "F2 is done: ratelimit.py has allow(client_ip) and reset().",
]

F3_FIRST_TRY = [
    [("read_file", {"path": "api.py"})],
    [("edit_file", {"path": "api.py", "old": IMPORT_OLD, "new": IMPORT_NEW}),
     ("edit_file", {"path": "api.py", "old": HEALTH, "new": LIMIT_CHECK_NO_HEADER})],
    "F3 is done! The API answers 429 when a client goes over the limit.",
]

F3_RETRY = [
    [("read_file", {"path": "checks/test_429.py"})],
    [("edit_file", {"path": "api.py", "old": 'return 429, {}, "too many requests"',
                    "new": 'return 429, {"Retry-After": str(WINDOW)}, "too many requests"'})],
    "Fixed: the 429 answer now has a Retry-After header.",
]

# ---------------------------------------------------------------- step 4: maker and checker

MAKER_ROUND_1 = [
    [todos("[>] Write ratelimit.py", "[ ] Answer 429 with Retry-After in api.py",
           "[ ] Add tests", "[ ] Run the tests"),
     ("write_file", {"path": "ratelimit.py", "content": RATELIMIT})],
    [todos("[x] Write ratelimit.py", "[>] Answer 429 with Retry-After in api.py",
           "[ ] Add tests", "[ ] Run the tests"),
     ("edit_file", {"path": "api.py", "old": IMPORT_OLD, "new": IMPORT_NEW}),
     ("edit_file", {"path": "api.py", "old": HEALTH, "new": LIMIT_CHECK})],
    [todos("[x] Write ratelimit.py", "[x] Answer 429 with Retry-After in api.py",
           "[>] Add tests", "[ ] Run the tests"),
     ("write_file", {"path": "tests/test_ratelimit.py", "content": TESTS})],
    [todos("[x] Write ratelimit.py", "[x] Answer 429 with Retry-After in api.py",
           "[x] Add tests", "[x] Run the tests"),
     ("run_tests", {})],
    "Done! Rate limiting works and all 7 tests pass.",
]

CHECK_ROUND_1 = [
    [("run_tests", {})],
    [("read_file", {"path": "api.py"}), ("read_file", {"path": "README.md"})],
    "FAILED: the 7 tests pass and api.py answers 429 with Retry-After, "
    "but README.md does not mention the rate limit.",
]

MAKER_ROUND_2 = [
    [("read_file", {"path": "README.md"})],
    [("edit_file", {"path": "README.md", "old": "| GET | /users/<id> | 200 the user, or 404 |\n",
                    "new": "| GET | /users/<id> | 200 the user, or 404 |\n" + README_SECTION})],
    "README.md now documents the rate limit.",
]

CHECK_ROUND_2 = [
    [("run_tests", {})],
    [("read_file", {"path": "README.md"})],
    "PASSED: the 7 tests pass, api.py answers 429 with Retry-After: 60 after "
    "5 requests a minute, and README.md documents the limit.",
]



# ---------------------------------------------------------------- step 5: sessions

MONDAY = [
    [("read_file", {"path": "api.py"}), ("read_file", {"path": "users.py"})],
    "handle() in api.py takes the id from the path (/users/<id>) and calls find_user(user_id) "
    "from users.py. find_user loops over USERS and returns the user with that id, or None. "
    "On None, handle() answers 404 \"no such user\".",
]

TUESDAY = [
    "It's find_user(user_id) in users.py, called from handle() in api.py. When the id doesn't "
    "exist, find_user returns None and handle() answers 404 with \"no such user\".",
]

# ---------------------------------------------------------------- step 6: user memory

MEMORY_SESSION_1 = [
    [("remember", {"fact": "The user's name is Sara."}),
     ("remember", {"fact": "Sara always wants type hints and a one-line docstring in code."})],
    "Nice to meet you, Sara. I'll remember your name and that you want type hints and a "
    "one-line docstring. I did not save the port: 8080 is about this project, not about you.",
]

MEMORY_SESSION_2 = [
    "Here you go, Sara:\n\n"
    "```python\n"
    "def average(numbers: list[float]) -> float:\n"
    "    \"\"\"Return the average of a list of numbers.\"\"\"\n"
    "    return sum(numbers) / len(numbers)\n"
    "```",
]

# ---------------------------------------------------------------- step 7: the handoff

PROGRESS_1 = """# Progress: rate limiting

## Done
- ratelimit.py: allow(client_ip), 5 requests per minute per client.
  reset() forgets every client.

## Next
1. api.py: in handle(), after /health, call allow().
   Over the limit: 429 with a Retry-After header.
2. tests/test_ratelimit.py: 5 pass, the 6th gets 429,
   /health is never limited.
3. Run: python -m unittest discover -s tests -t .

## Notes
- /health must never be limited.
- Call ratelimit.reset() in each test's setUp.
"""

PROGRESS_2 = """# Progress: rate limiting

## Done
- ratelimit.py: allow(client_ip), 5 requests per minute per client; reset() for tests.
- api.py: 429 with Retry-After after the limit. /health is never limited.
- tests/test_ratelimit.py: 3 tests. All 7 tests pass.

## Next
- Nothing left for rate limiting.

## Notes
- The limit is LIMIT and WINDOW in ratelimit.py.
"""

HANDOFF_SESSION_1 = [
    [("read_file", {"path": "api.py"})],
    [("write_file", {"path": "ratelimit.py", "content": RATELIMIT})],
    "ratelimit.py is written: allow(client_ip) and reset(). As asked, that's all for today.",
]

HANDOFF_WRITE = [
    [("write_file", {"path": "PROGRESS.md", "content": PROGRESS_1})],
    "PROGRESS.md is written. Next: wire allow() into api.py, add tests, run them.",
]

HANDOFF_SESSION_2 = [
    [("read_file", {"path": "PROGRESS.md"})],
    [("edit_file", {"path": "api.py", "old": IMPORT_OLD, "new": IMPORT_NEW}),
     ("edit_file", {"path": "api.py", "old": HEALTH, "new": LIMIT_CHECK})],
    [("write_file", {"path": "tests/test_ratelimit.py", "content": TESTS})],
    [("run_tests", {})],
    [("write_file", {"path": "PROGRESS.md", "content": PROGRESS_2})],
    "Picked up from PROGRESS.md: api.py now answers 429 with Retry-After, the new tests are in, "
    "and all 7 tests pass. PROGRESS.md is updated: nothing left for rate limiting.",
]
