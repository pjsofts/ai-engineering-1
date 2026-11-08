# F3: the 6th request in a minute gets 429 Too Many Requests, with a Retry-After header
import unittest

import ratelimit
from api import handle


class Check429(unittest.TestCase):
    def setUp(self):
        ratelimit.reset()

    def test_sixth_request_is_429(self):
        for _ in range(5):
            self.assertEqual(handle("GET", "/users", "7.7.7.7")[0], 200)
        status, headers, body = handle("GET", "/users", "7.7.7.7")
        self.assertEqual(status, 429)
        self.assertIn("Retry-After", headers)

    def test_health_is_never_limited(self):
        for _ in range(10):
            self.assertEqual(handle("GET", "/health", "7.7.7.7")[0], 200)
