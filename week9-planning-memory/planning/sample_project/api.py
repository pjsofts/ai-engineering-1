# api.py — the public API. handle() answers one request.
# It returns three things: a status code, the headers, and the body.
from users import find_user, list_users


def handle(method, path, client_ip):
    if path == "/health":
        return 200, {}, "ok"

    if method == "GET" and path == "/users":
        return 200, {}, list_users()

    if method == "GET" and path.startswith("/users/"):
        user = find_user(path.split("/")[-1])
        if user is None:
            return 404, {}, "no such user"
        return 200, {}, user

    return 404, {}, "not found"
