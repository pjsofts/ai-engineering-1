TAX_RATE = 0.09
COUPONS = {"WELCOME10": 0.10, "VIP20": 0.20}


def add_item(cart, product, quantity=1):
    cart.setdefault("items", []).append({"product": product, "quantity": quantity})
    return cart


def subtotal(cart):
    return sum(item["product"]["price"] * item["quantity"] for item in cart.get("items", []))


def cart_total(cart, coupon=None):
    """Subtotal, minus the coupon discount, plus tax. In cents."""
    amount = subtotal(cart)
    if coupon in COUPONS:
        amount -= round(amount * COUPONS[coupon])
    return amount + round(amount * TAX_RATE)
