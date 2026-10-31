RECEIPT_TEMPLATE = """Hi {name},

Thanks for your order! We charged {amount} to your card.
Order number: {order_id}
"""


def format_price(cents):
    return f"${cents / 100:,.2f}"


def send_receipt(order, customer, mailer):
    body = RECEIPT_TEMPLATE.format(name=customer["name"], amount=format_price(order["total"]),
                                   order_id=order["id"])
    mailer.send(to=customer["email"], subject="Your receipt", body=body)
