# users.py — the users, kept in memory.
USERS = [
    {"id": "1", "name": "Sara"},
    {"id": "2", "name": "Reza"},
    {"id": "3", "name": "Mina"},
]


def list_users():
    return USERS


def find_user(user_id):
    for user in USERS:
        if user["id"] == user_id:
            return user
    return None
