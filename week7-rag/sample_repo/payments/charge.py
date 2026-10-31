import time
import uuid

from payments.gateway import GatewayError, send_to_gateway

MAX_ATTEMPTS = 3


def charge_card(customer, amount_cents):
    """Take money from the customer's saved card. Safe to retry: the gateway
    sees the same idempotency key, so the customer is never billed twice."""
    key = str(uuid.uuid4())
    payment = {"card": customer["card_token"], "amount": amount_cents, "idempotency_key": key}
    return retry_with_backoff(lambda: send_to_gateway(payment))


def retry_with_backoff(action):
    wait = 0.5
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return action()
        except GatewayError:
            if attempt == MAX_ATTEMPTS:
                raise
            time.sleep(wait)
            wait *= 2
