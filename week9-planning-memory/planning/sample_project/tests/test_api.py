import unittest

from api import handle


class TestApi(unittest.TestCase):
    def test_health(self):
        self.assertEqual(handle("GET", "/health", "1.1.1.1")[0], 200)

    def test_list_users(self):
        status, headers, body = handle("GET", "/users", "1.1.1.1")
        self.assertEqual(status, 200)
        self.assertEqual(len(body), 3)

    def test_find_user(self):
        status, headers, body = handle("GET", "/users/2", "1.1.1.1")
        self.assertEqual(body["name"], "Reza")

    def test_missing_user(self):
        self.assertEqual(handle("GET", "/users/99", "1.1.1.1")[0], 404)
