# Tiny Shop API

A very small HTTP-style API, used to practise coding agents.

- `api.py`: `handle(method, path, client_ip)` answers one request.
- `users.py`: the users, kept in memory.
- `tests/`: run them with `python -m unittest discover -s tests -t .`

## Endpoints

| Method | Path | Answer |
|---|---|---|
| GET | /health | 200 `ok` |
| GET | /users | 200, every user |
| GET | /users/<id> | 200 the user, or 404 |
