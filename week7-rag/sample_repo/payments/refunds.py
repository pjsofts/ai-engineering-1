from payments.gateway import send_to_gateway

REFUND_WINDOW_DAYS = 30


def can_refund(order, today):
    return (today - order["paid_on"]).days <= REFUND_WINDOW_DAYS and not order.get("refunded")


def refund_order(order, today):
    if not can_refund(order, today):
        return {"ok": False, "reason": "outside the refund window or already refunded"}
    payment = {"card": order["card_token"], "amount": -order["total"],
               "idempotency_key": "refund-" + order["id"]}
    result = send_to_gateway(payment)
    order["refunded"] = True
    return result
