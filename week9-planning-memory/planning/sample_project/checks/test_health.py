# F1: GET /health returns 200
import unittest

from api import handle


class CheckHealth(unittest.TestCase):
    def test_health(self):
        self.assertEqual(handle("GET", "/health", "1.1.1.1")[0], 200)
