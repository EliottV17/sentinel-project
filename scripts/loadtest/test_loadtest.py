import concurrent.futures
import json
import threading
import re
import time
import unittest
from unittest.mock import patch
from urllib.request import urlopen

import loadtest
from loadtest import Sampler, compose_command, compose_environment, get_container, preflight_compose_resources, validate_compose_identity
from metrics import docker_memory_bytes, minute_buckets, percentile_summary
from target import make_server


class MetricsTests(unittest.TestCase):
    def test_docker_memory_units_are_converted_without_losing_raw_value(self):
        raw = "1.5GiB / 2GiB"
        self.assertEqual(docker_memory_bytes(raw), (1610612736, 2147483648))

    def test_window_buckets_mark_partial_edges_and_count_half_open_window(self):
        start = 75.0
        end = 196.0
        rows = [(60.0, 1, 0, 0), (120.0, 0, 1, 0), (180.0, 1, 0, 0), (240.0, 0, 0, 1)]
        buckets = minute_buckets(rows, start, end)
        self.assertEqual(
            buckets,
            [
                {"minute_utc": "1970-01-01T00:01:00Z", "successful": 1, "failed": 0, "unknown": 0, "window_seconds": 45.0, "partial": True},
                {"minute_utc": "1970-01-01T00:02:00Z", "successful": 0, "failed": 1, "unknown": 0, "window_seconds": 60.0, "partial": False},
                {"minute_utc": "1970-01-01T00:03:00Z", "successful": 1, "failed": 0, "unknown": 0, "window_seconds": 16.0, "partial": True},
            ],
        )

    def test_unknown_state_is_not_misreported_as_failed(self):
        buckets = minute_buckets([(0.0, 0, 0, 1)], 0.0, 60.0)
        self.assertEqual(buckets[0]["unknown"], 1)
        self.assertEqual(buckets[0]["failed"], 0)

    def test_non_minute_aligned_window_uses_calendar_minutes_and_partial_edges(self):
        buckets = minute_buckets(
            [(60.0, 1, 0, 0), (120.0, 0, 1, 0), (180.0, 1, 0, 0)],
            75.0,
            196.0,
        )
        self.assertEqual(
            buckets,
            [
                {"minute_utc": "1970-01-01T00:01:00Z", "successful": 1, "failed": 0, "unknown": 0, "window_seconds": 45.0, "partial": True},
                {"minute_utc": "1970-01-01T00:02:00Z", "successful": 0, "failed": 1, "unknown": 0, "window_seconds": 60.0, "partial": False},
                {"minute_utc": "1970-01-01T00:03:00Z", "successful": 1, "failed": 0, "unknown": 0, "window_seconds": 16.0, "partial": True},
            ],
        )

    def test_measurement_sql_groups_calendar_minutes_after_exact_window_filter(self):
        query_builder = getattr(loadtest, "measurement_query_sql", None)
        self.assertTrue(callable(query_builder), "measurement query builder must expose the calendar-minute SQL")
        query = query_builder("worker@example.test", 75.0, 196.0)
        self.assertIn("date_trunc('minute', c.created_at)", query)
        self.assertIn("c.created_at >= timestamp", query)
        self.assertIn("c.created_at < timestamp", query)
        self.assertLess(query.index("lag(c.created_at)"), query.index("WHERE created_at >= timestamp"))

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


class ContainerInspectTests(unittest.TestCase):
    def inspect_container(self, health):
        fields = ["id", "image", "sha256:image", "running", health, "0", "0", "0", "sentinel-load", "worker"]
        with patch("loadtest.compose", return_value="container-id"), patch("loadtest.safe_run") as safe_run:
            def render(command, _env, **_kwargs):
                template = command[3]
                if health == "" and ".State.Health.Status" in template:
                    raise RuntimeError('template error: map has no entry for key "Health"')
                return "\t".join(fields)
            safe_run.side_effect = render
            record = get_container("worker", {})
            return record, safe_run.call_args.args[0][3]

    def test_inspect_supports_containers_without_healthcheck(self):
        record, template = self.inspect_container("")
        self.assertEqual(record["State"]["Health"]["Status"], "")
        self.assertIn('{{with index .State "Health"}}{{.Status}}{{end}}', template)
        self.assertNotIn(".State.Health", template)

    def test_inspect_supports_containers_with_healthcheck(self):
        record, template = self.inspect_container("healthy")
        self.assertEqual(record["State"]["Health"]["Status"], "healthy")
        self.assertIn('{{with index .State "Health"}}{{.Status}}{{end}}', template)
        self.assertNotIn(".State.Health", template)


class CleanupTests(unittest.TestCase):
    def test_final_worker_metadata_requires_stopped_zero_restarts_and_safe_provenance(self):
        record = {
            "Id": "worker-id",
            "State": {"Status": "exited"},
            "RestartCount": 0,
            "Config": {"Labels": {"com.docker.compose.project": "sentinel-load", "com.docker.compose.service": "worker"}},
        }
        build = getattr(loadtest, "final_worker_state", None)
        self.assertTrue(callable(build), "final worker state must be validated and provenance-tagged")
        result = build(record)
        self.assertEqual(result["status"], "exited")
        self.assertEqual(result["restart_count"], 0)
        self.assertIn("safe docker inspect", result["provenance"])
        record["State"]["Status"] = "running"
        with self.assertRaisesRegex(RuntimeError, "expected exited/0"):
            build(record)

    def test_worker_stop_is_attempted_even_when_sampler_stop_fails(self):
        events = []

        class BrokenSampler:
            def stop(self):
                events.append("sampler")
                raise RuntimeError("stats collector failed")

        with patch("loadtest.compose", side_effect=lambda *args, **kwargs: events.append("worker")):
            cleanup = getattr(loadtest, "cleanup_owned_resources", None)
            self.assertTrue(callable(cleanup), "owned-resource cleanup must be independently testable")
            failures = cleanup(BrokenSampler(), True, {})
        self.assertEqual(events, ["sampler", "worker"])
        self.assertEqual(failures, ["sampler stop failed: stats collector failed"])

    def test_original_run_failure_is_preserved_when_cleanup_also_fails(self):
        original = RuntimeError("startup polling failed")
        with self.assertRaisesRegex(RuntimeError, "startup polling failed.*worker stop failed") as raised:
            loadtest.raise_run_failure(original, ["worker stop failed: timeout"])
        self.assertIs(raised.exception.__cause__, original)

    def test_sampler_surfaces_error_without_waiting_for_sampling_timeout(self):
        sampler = Sampler.__new__(Sampler)
        sampler.error = RuntimeError("stats command failed")
        with self.assertRaisesRegex(RuntimeError, "stats command failed"):
            sampler.raise_if_failed()


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
        self.assertEqual(env["LOADTEST_VOLUME_NAME"], "sentinel-load_sentinel_load_data")
        self.assertTrue(loadtest.parse_args(["--fresh-volume"]).fresh_volume)

    def test_fresh_volume_is_project_scoped_and_ambient_name_is_ignored(self):
        generate = getattr(loadtest, "generate_fresh_volume_name", None)
        self.assertTrue(callable(generate), "fresh-volume mode must generate its own volume name")
        fresh = generate()
        self.assertRegex(fresh, re.compile(r"^sentinel-load_data_[0-9]{8}T[0-9]{6}Z_[a-f0-9]{8}$"))
        with patch.dict("os.environ", {"LOADTEST_VOLUME_NAME": "unsafe-ambient-volume"}, clear=True):
            default_env = compose_environment(10, 18000)
            fresh_env = compose_environment(10, 18000, volume_name=fresh)
        self.assertEqual(default_env["LOADTEST_VOLUME_NAME"], "sentinel-load_sentinel_load_data")
        self.assertEqual(fresh_env["LOADTEST_VOLUME_NAME"], fresh)

    def test_preflight_rejects_running_worker_before_replacement(self):
        worker = {"State": {"Status": "running"}}
        with patch("loadtest.get_container", side_effect=lambda service, _env, required=False: worker if service == "worker" else None), \
             patch("loadtest.docker_volume_exists") as volume_check:
            with self.assertRaisesRegex(RuntimeError, "worker is running"):
                preflight_compose_resources({}, "sentinel-load_data_20261007T020000Z_12345678", True)
        volume_check.assert_not_called()

    def test_default_volume_reuse_is_refused_and_fresh_volume_does_not_delete_old_volume(self):
        with patch("loadtest.get_container", return_value=None), patch("loadtest.docker_volume_exists", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "--fresh-volume"):
                preflight_compose_resources({}, "sentinel-load_sentinel_load_data", False)
        with patch("loadtest.get_container", return_value=None), patch("loadtest.docker_volume_exists", return_value=False) as volume_check:
            preflight_compose_resources({}, "sentinel-load_data_20261007T020000Z_12345678", True)
        volume_check.assert_called_once_with("sentinel-load_data_20261007T020000Z_12345678", {})

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
