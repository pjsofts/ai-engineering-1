from api.throttle import allow_request, too_many_requests_response
from auth.session import needs_reauth
from orders.cart import cart_total
from payments.charge import charge_card


def handle(request):
    if not allow_request(request["client_id"]):
        return too_many_requests_response()
    if needs_reauth(request["session"], request["endpoint"]):
        return {"status": 401, "body": "Please log in again."}
    return ROUTES[request["endpoint"]](request)


def checkout(request):
    cart = request["cart"]
    total = cart_total(cart, coupon=request.get("coupon"))
    receipt = charge_card(request["customer"], total)
    return {"status": 200, "body": receipt}


def get_cart(request):
    return {"status": 200, "body": request["cart"]}


ROUTES = {"/checkout": checkout, "/cart": get_cart}
