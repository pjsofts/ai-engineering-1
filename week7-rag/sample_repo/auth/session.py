import secrets
import time

SESSION_LIFETIME = 7 * 24 * 3600   # a normal session lasts a week
SENSITIVE_TTL = 5 * 60             # sensitive actions need a login from the last 5 minutes
SENSITIVE_ENDPOINTS = {"/checkout", "/account/email", "/account/password"}


def start_session(user_id):
    now = time.time()
    return {"id": secrets.token_hex(16), "user_id": user_id,
            "created_at": now, "logged_in_at": now}


def is_expired(session):
    return time.time() - session["created_at"] > SESSION_LIFETIME


def needs_reauth(session, endpoint):
    """True when the user must type their password again before we continue."""
    if is_expired(session):
        return True
    if endpoint in SENSITIVE_ENDPOINTS:
        return time.time() - session["logged_in_at"] > SENSITIVE_TTL
    return False
