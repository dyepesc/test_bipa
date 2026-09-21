import json
import threading
import unittest
from urllib.request import urlopen
from urllib.error import HTTPError

from api import ApiHandler
from http.server import HTTPServer


class ApiServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), ApiHandler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def _get_json(self, path):
        with urlopen(f"http://127.0.0.1:{self.port}{path}") as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body)

    def test_health_endpoint(self):
        status, payload = self._get_json("/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"status": "ok"})

    def test_version_endpoint(self):
        status, payload = self._get_json("/version")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"version": "1.0.0"})

    def test_unknown_endpoint_returns_not_found(self):
        with self.assertRaises(HTTPError) as context:
            urlopen(f"http://127.0.0.1:{self.port}/unknown")

        error = context.exception
        self.assertEqual(error.code, 404)
        payload = json.loads(error.read().decode("utf-8"))
        self.assertEqual(payload, {"error": "not_found"})


if __name__ == "__main__":
    unittest.main()
