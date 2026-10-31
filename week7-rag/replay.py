"""Replay mode: answers every API call without the network.

Embeddings
    If recordings/embeddings.json exists (made by `python record.py` with a
    working key), Replay uses those real vectors. Otherwise it uses a small
    offline stand-in: 64 numbers per text, built from concept keywords and
    hashed words. It gets the important pairs right (payment ≈ charge,
    "rate limiting" ≈ throttle.py) but its scores are only illustrative.

Chat replies
    Recorded replies (recordings/replies.json) win; otherwise the scripted
    replies below, matched by a piece of text in the request.
"""
import hashlib
import json
import math
import re
from pathlib import Path

from llm import Reply, ToolCall

ROOT = Path(__file__).parent
RECORDINGS = ROOT / "recordings"
NO_RECORDING = "(Replay has no recorded answer for this input. Switch to Live to use the model.)"

# ---------------------------------------------------------------- embeddings

CONCEPTS = {
    "payment": "pay payment charge card money bill billed gateway amount deduct cent price processor",
    "throttle": "rate limit throttle request often many flood burst bucket token minute 429 slow "
                "retry-after call api client",
    "auth": "login log password session reauth authenticate auth sensitive expire lifetime ttl "
            "trusted again",
    "time": "time minute second week day last old ttl elapsed",
    "email": "email mail receipt send notify message subject template",
    "ui": "navbar navigation render menu page link html nav top bar greeting",
    "cart": "cart item coupon tax discount subtotal total product quantity order",
    "retry": "retry backoff attempt fail error timeout twice idempotency again",
    "refund": "refund window return refunded money back",
    "crypto": "hash salt pbkdf2 digest password secret compare",
    "route": "route handle endpoint request response status checkout",
    "database": "database sql query table postgres mysql sqlite mongo db",
}
STOP = set("the a an of to and or in on is it we our do does for from with by be this that "
           "at as if not no where what how when which who why can has have are you i self "
           "return def import class".split())
WORD_DIMS = 52


def words(text):
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)          # camelCase -> camel Case
    found = []
    for word in re.findall(r"[a-z0-9\-]+", text.lower().replace("_", " ")):
        for suffix in ("ing", "ed", "es", "s"):
            if len(word) > 4 and word.endswith(suffix):
                word = word[: -len(suffix)]
                break
        if word not in STOP and len(word) > 1:
            found.append(word)
    return found


CONCEPT_WORDS = {name: set(words(text)) for name, text in CONCEPTS.items()}


def offline_vector(text):
    found = words(text)
    vector = [0.0] * (len(CONCEPTS) + WORD_DIMS)
    vector[-1] = 1.0              # every text is "some text": real embeddings are never fully unrelated
    for i, vocab in enumerate(CONCEPT_WORDS.values()):
        hits = sum(1 for word in found if word in vocab)
        vector[i] = 3 * math.log1p(hits)
    for word in found:
        slot = int(hashlib.md5(word.encode()).hexdigest(), 16) % (WORD_DIMS - 1)
        vector[len(CONCEPTS) + slot] += 0.6
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [round(x / norm, 4) for x in vector]


def text_key(text):
    return hashlib.sha256(text.encode()).hexdigest()[:20]


class Replay:
    def __init__(self):
        self.vectors = self.load("embeddings.json")
        self.replies = self.load("replies.json")
        self.model = "recorded " + self.vectors.get("_model", "") if self.vectors else "offline stand-in (64 numbers)"

    @staticmethod
    def load(name):
        path = RECORDINGS / name
        return json.loads(path.read_text()) if path.exists() else {}

    def embed(self, texts):
        if not self.vectors:
            return [offline_vector(text) for text in texts]
        missing = [text for text in texts if text_key(text) not in self.vectors]
        if missing:
            raise LookupError(f"No recorded embedding for {missing[0][:60]!r}. Switch to Live.")
        return [self.vectors[text_key(text)] for text in texts]

    def ask(self, system, prompt):
        recorded = self.replies.get(text_key(system + prompt))
        if recorded is not None:
            return recorded
        return scripted_answer(prompt)

    def chat(self, messages):
        recorded = self.replies.get(text_key(json.dumps(messages, sort_keys=True, default=str)))
        if recorded is not None:
            return Reply(recorded["text"], [ToolCall(**call) for call in recorded["calls"]])
        return scripted_turn(messages)


# ---------------------------------------------------------------- scripted replies

ANSWERS = [
    (("log in again", "re-auth", "reauth", "password again"),
     "A user must log in again in two cases (`needs_reauth`, `auth/session.py:19-25`):\n\n"
     "1. The session is older than `SESSION_LIFETIME`, one week (`auth/session.py:4`, checked by "
     "`is_expired` at `auth/session.py:15`).\n"
     "2. The endpoint is sensitive (`/checkout`, `/account/email`, `/account/password`, "
     "`auth/session.py:6`) and the last login was more than `SENSITIVE_TTL`, 5 minutes, ago "
     "(`auth/session.py:5`, `auth/session.py:24`).\n\n"
     "`api/routes.py:10-11` calls `needs_reauth` on every request and answers 401 when it returns True."),
    (("database",), "Not in the provided code."),
    (("rate", "too often", "requests per minute"),
     "Clients are limited by a token bucket in `api/throttle.py:7-25`: each client gets "
     "`REQUESTS_PER_MINUTE` = 60 tokens (`api/throttle.py:3`) that refill at one per second. "
     "`api/routes.py:8-9` checks `allow_request` first and answers 429 when the bucket is empty "
     "(`api/throttle.py:35`)."),
]


def scripted_answer(prompt):
    question = prompt.rsplit("Question:", 1)[-1].lower()
    for keys, answer in ANSWERS:
        if any(key in question for key in keys):
            return answer
    return NO_RECORDING


def scripted_turn(messages):
    """The agent demo: semantic search first (the question has no names in it),
    then grep for the constant it found, then answer."""
    question = messages[1]["content"].lower()
    turns = sum(1 for m in messages if m["role"] == "assistant")
    if not any(word in question for word in ("request", "rate", "often", "limit")):
        return Reply(NO_RECORDING)
    if turns == 0:
        return Reply("I don't know what the code calls this, so I'll search by meaning.",
                     [ToolCall("call_1", "semantic_search", {"query": "limit how many requests a client can make"})])
    if turns == 1:
        return Reply("The limit is a constant, REQUESTS_PER_MINUTE. Now I know the name, so grep is enough.",
                     [ToolCall("call_2", "grep_search", {"pattern": "REQUESTS_PER_MINUTE"})])
    return Reply(
        "One client can make **60 requests per minute** (`REQUESTS_PER_MINUTE`, `api/throttle.py:3`). "
        "Each client has a token bucket (`api/throttle.py:7`) that refills at one token per second, so "
        "short bursts are fine. When the bucket is empty, `allow_request` returns False "
        "(`api/throttle.py:23`, via `allow_request` at `api/throttle.py:28`) and `api/routes.py:8-9` answers **429 Too Many Requests** with a "
        "`Retry-After: 30` header (`api/throttle.py:34-36`).")
