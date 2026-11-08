# F2: ratelimit.allow(client_ip) lets 5 requests a minute through, then says no
import unittest

import ratelimit


class CheckLimiter(unittest.TestCase):
    def setUp(self):
        ratelimit.reset()

    def test_five_then_no(self):
        answers = [ratelimit.allow("9.9.9.9") for _ in range(6)]
        self.assertEqual(answers, [True, True, True, True, True, False])

    def test_each_client_has_its_own_limit(self):
        for _ in range(5):
            ratelimit.allow("9.9.9.9")
        self.assertTrue(ratelimit.allow("8.8.8.8"))
