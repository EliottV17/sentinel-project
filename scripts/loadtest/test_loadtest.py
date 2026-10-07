import concurrent.futures
import json
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import urlopen

from loadtest import compose_command, compose_environment, validate_compose_identity
from metrics import docker_memory_bytes, minute_buckets, percentile_summary
from target import make_server


class MetricsTests(unittest.TestCase):
    def test_docker_memory_units_are_converted_without_losing_raw_value(self):
        raw = "1.5GiB / 2GiB"
        self.assertEqual(docker_memory_bytes(raw), (1610612736, 2147483648))

    def test_window_buckets_mark_partial_edges_and_count_half_open_window(self):
        start = 75.0
        end = 196.0
        rows = [(75.0, "healthy"), (135.0, "unhealthy"), (195.0, "healthy"), (196.0, "unhealthy")]
        buckets = minute_buckets(rows, start, end)
        self.assertEqual(
            buckets,
            [
                {"minute": 0, "successful": 1, "failed": 0, "unknown": 0, "partial": False},
                {"minute": 1, "successful": 0, "failed": 1, "unknown": 0, "partial": False},
                {"minute": 2, "successful": 1, "failed": 0, "unknown": 0, "partial": True},
            ],
        )

    def test_unknown_state_is_not_misreported_as_failed(self):
        buckets = minute_buckets([(10.0, "unexpected")], 10.0, 11.0)
        self.assertEqual(buckets[0]["unknown"], 1)
        self.assertEqual(buckets[0]["failed"], 0)

    def test_percentiles_are_inclusive_and_empty_input_is_explicit(self):
        summary = percentile_summary([1, 2, 3, 4])
        self.assertEqual(summary["count"], 4)
        self.assertEqual(summary["median"], 2.5)
        self.assertAlmostEqual(summary["p95"], 3.85)
        self.assertEqual(percentile_summary([]), {"count": 0, "median": None, "p95": None})


class TargetTests(unittest.TestCase):
    def setUp(self):
        self.server = make_server(host="127.0.0.1", port=0, delay_ms=100)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()

    def test_health_is_delay_free_and_ok_route_has_small_success_body(self):
        started = time.monotonic()
        with urlopen(f"{self.base_url}/health", timeout=1) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {"status": "ok"})
        self.assertLess(time.monotonic() - started, 0.08)
        with urlopen(f"{self.base_url}/ok?i=1", timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b"ok\n")

    def test_target_serves_at_least_ten_requests_concurrently(self):
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            responses = list(pool.map(lambda _: urlopen(f"{self.base_url}/ok", timeout=3).read(), range(10)))
        self.assertEqual(responses, [b"ok\n"] * 10)
        self.assertLess(time.monotonic() - started, 0.8)


class OrchestrationSafetyTests(unittest.TestCase):
    def test_compose_always_uses_isolated_project_and_disables_default_dotenv(self):
        command = compose_command()
        self.assertEqual(command[2:4], ["--env-file", "/dev/null"])
        self.assertEqual(command[4:6], ["-p", "sentinel-load"])
        with patch.dict("os.environ", {"SECRET_KEY": "must-not-leak", "DATABASE_URL": "must-not-leak"}, clear=True):
            env = compose_environment(10, 18000)
        self.assertEqual(env["LOADTEST_DATABASE_URL"], "postgresql://postgres:sentinel-load-db-only@db:5432/sentinel_db")
        self.assertEqual(env["TARGET_DELAY_MS"], "10")
        self.assertNotIn("SECRET_KEY", env)
        self.assertNotIn("DATABASE_URL", env)

    def test_database_identity_rejects_main_or_non_database_container(self):
        validate_compose_identity({"com.docker.compose.project": "sentinel-load", "com.docker.compose.service": "db"})
        for labels in (
            {"com.docker.compose.project": "sentinel", "com.docker.compose.service": "db"},
            {"com.docker.compose.project": "sentinel-load", "com.docker.compose.service": "worker"},
        ):
            with self.assertRaises(RuntimeError):
                validate_compose_identity(labels)


if __name__ == "__main__":
    unittest.main()
