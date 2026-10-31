# Shopfront (sample codebase)

A small, made-up online-shop backend. The week 7 demos index it and search it.
The names in the code are chosen so that grep and semantic search give
different answers: rate limiting lives in `api/throttle.py` and never says
"rate limit"; re-authentication is decided by `needs_reauth` and `SENSITIVE_TTL`.
