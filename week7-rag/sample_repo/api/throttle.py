import time

REQUESTS_PER_MINUTE = 60
buckets = {}


class TokenBucket:
    """Each client gets a bucket of tokens. A request spends one token.
    Tokens refill slowly, so a client can burst a little but not flood us."""

    def __init__(self, capacity, refill_per_second):
        self.capacity = capacity
        self.tokens = capacity
        self.refill_per_second = refill_per_second
        self.last_refill = time.time()

    def take(self):
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_second)
        self.last_refill = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


def allow_request(client_id):
    if client_id not in buckets:
        buckets[client_id] = TokenBucket(REQUESTS_PER_MINUTE, REQUESTS_PER_MINUTE / 60)
    return buckets[client_id].take()


def too_many_requests_response(retry_after_seconds=30):
    return {"status": 429, "headers": {"Retry-After": str(retry_after_seconds)},
            "body": "Slow down. Try again in a moment."}
