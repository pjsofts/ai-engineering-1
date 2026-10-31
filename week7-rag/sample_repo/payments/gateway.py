import random


class GatewayError(Exception):
    pass


def send_to_gateway(payment):
    """Pretend card processor. Fails now and then, like a real one."""
    if random.random() < 0.1:
        raise GatewayError("gateway timeout")
    return {"ok": True, "amount": payment["amount"], "reference": payment["idempotency_key"][:8]}
