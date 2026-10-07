#!/usr/bin/env python3
"""Safe Compose orchestration and bounded measurement for Sentinel's worker."""

from __future__ import annotations

import argparse
import csv
from contextlib import ExitStack
import json
import os
import platform
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from metrics import docker_memory_bytes, minute_buckets, percentile_summary

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "sentinel-load"
SERVICES = ("worker", "db", "target")
BASE_ENV = {
    "LOADTEST_DB_PASSWORD": "sentinel-load-db-only",
    "LOADTEST_DATABASE_URL": "postgresql://postgres:sentinel-load-db-only@db:5432/sentinel_db",
    "LOADTEST_SECRET_KEY": "sentinel-load-test-only-secret-key-never-use-outside-this-stack",
    "LOADTEST_DEMO_EMAIL": "loadtest-demo@example.test",
    "LOADTEST_DEMO_PASSWORD": "LoadTestDemo9x",
    "LOADTEST_STATUS_EMAIL": "loadtest-status@example.test",
}


def compose_command() -> list[str]:
    return [
        "docker", "compose", "--env-file", "/dev/null", "-p", PROJECT,
        "-f", str(ROOT / "docker-compose.yml"),
        "-f", str(ROOT / "docker-compose.loadtest.yml"),
    ]


def compose_environment(delay_ms: int, api_port: int) -> dict[str, str]:
    # Preserve Docker connection settings, but do not pass ambient app secrets to Compose.
    allowed = (
        "PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
    )
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env.update(BASE_ENV)
    env["LOADTEST_API_PORT"] = str(api_port)
    env["TARGET_DELAY_MS"] = str(delay_ms)
    return env


def validate_compose_identity(labels: dict[str, str], expected_project: str = PROJECT) -> None:
    if labels.get("com.docker.compose.project") != expected_project:
        raise RuntimeError("refusing database operation: wrong Docker Compose project label")
    if labels.get("com.docker.compose.service") != "db":
        raise RuntimeError("refusing database operation: inspected container is not the database service")


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_run(command: list[str], env: dict[str, str], *, check: bool = True, timeout: int = 120) -> str:
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        message = result.stderr or result.stdout or f"exit code {result.returncode}"
        for secret in BASE_ENV.values():
            message = message.replace(secret, "[redacted-test-value]")
        raise RuntimeError(f"command failed ({' '.join(command)}): {message.strip()}")
    return result.stdout.strip()


def compose(*args: str, env: dict[str, str], check: bool = True, timeout: int = 120) -> str:
    return safe_run(compose_command() + list(args), env, check=check, timeout=timeout)


def get_container(service: str, env: dict[str, str], *, required: bool = True) -> dict[str, Any] | None:
    container_id = compose("ps", "-q", service, env=env, check=False).strip()
    if not container_id:
        if required:
            raise RuntimeError(f"Compose service {service} has no container")
        return None
    # Inspect only safe fields; never request Config.Env or dump a complete inspect record.
    template = (
        '{{.Id}}{{"\\t"}}{{.Config.Image}}{{"\\t"}}{{.Image}}{{"\\t"}}{{.State.Status}}{{"\\t"}}'
        '{{if .State.Health}}{{.State.Health.Status}}{{end}}{{"\\t"}}{{.RestartCount}}{{"\\t"}}'
        '{{.HostConfig.Memory}}{{"\\t"}}{{.HostConfig.NanoCpus}}{{"\\t"}}'
        '{{index .Config.Labels "com.docker.compose.project"}}{{"\\t"}}'
        '{{index .Config.Labels "com.docker.compose.service"}}'
    )
    fields = safe_run(["docker", "inspect", "--format", template, container_id], env).split("\t")
    if len(fields) != 10:
        raise RuntimeError(f"docker inspect returned unexpected safe-field count for {service}")
    record = {
        "Id": fields[0],
        "Config": {"Image": fields[1], "Labels": {
            "com.docker.compose.project": fields[8],
            "com.docker.compose.service": fields[9],
        }},
        "Image": fields[2],
        "State": {"Status": fields[3], "Health": {"Status": fields[4]}},
        "RestartCount": int(fields[5]),
        "HostConfig": {"Memory": int(fields[6]), "NanoCpus": int(fields[7])},
    }
    labels = record["Config"]["Labels"]
    if labels["com.docker.compose.project"] != PROJECT or labels["com.docker.compose.service"] != service:
        raise RuntimeError(f"refusing to use non-owned {service} container {container_id}")
    return record


def assert_db_identity(env: dict[str, str]) -> dict[str, Any]:
    record = get_container("db", env)
    validate_compose_identity(record["Config"]["Labels"])
    if record["State"]["Status"] != "running":
        raise RuntimeError("load-test database container is not running")
    return record


def wait_for_container_health(env: dict[str, str], service: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        record = get_container(service, env)
        state = record["State"]
        if state["Status"] != "running":
            raise RuntimeError(f"{service} container is not running while waiting for health")
        if state["Health"]["Status"] == "healthy":
            return
        time.sleep(1)
    raise RuntimeError(f"timed out waiting for {service} container health")


def psql(
    env: dict[str, str], sql: str | None = None, *, file: str | None = None,
    variables: dict[str, str] | None = None, tuples: bool = False,
) -> str:
    command = compose_command() + ["exec", "-T", "db", "psql", "-X"]
    if tuples:
        command.extend(["-A", "-t"])
    command.extend(["-U", "postgres", "-d", "sentinel_db", "-v", "ON_ERROR_STOP=1"])
    for key, value in (variables or {}).items():
        command.extend(["-v", f"{key}={value}"])
    if file:
        command.extend(["-f", f"/loadtest/{file}"])
    elif sql is not None:
        command.extend(["-c", sql])
    else:
        raise ValueError("SQL text or file required")
    return safe_run(command, env, timeout=120)


def json_query(env: dict[str, str], query: str) -> Any:
    try:
        return json.loads(psql(env, query, tuples=True))
    except json.JSONDecodeError as exc:
        raise RuntimeError("database metrics query returned invalid JSON") from exc


def checked_count(env: dict[str, str], email: str) -> tuple[int, int]:
    escaped = email.replace("'", "''")
    row = json_query(env, f"""
      SELECT json_build_array(count(*) FILTER (WHERE last_checked_at IS NOT NULL), count(*))
      FROM monitor m JOIN users u ON u.id = m.user_id
      WHERE u.email = '{escaped}' AND m.state = 'Active'
    """)
    return int(row[0]), int(row[1])


def unrelated_active_count(env: dict[str, str], email: str) -> int:
    escaped = email.replace("'", "''")
    value = json_query(env, f"""
      SELECT count(*) FROM monitor m JOIN users u ON u.id = m.user_id
      WHERE m.state = 'Active' AND u.email <> '{escaped}'
    """)
    return int(value)


def overdue_snapshot(env: dict[str, str], email: str) -> tuple[int, float | None]:
    escaped = email.replace("'", "''")
    row = json_query(env, f"""
      SELECT json_build_array(
        count(*) FILTER (WHERE COALESCE(m.last_checked_at, m.created_at) <
          (now() AT TIME ZONE 'UTC') - make_interval(secs => m.frequency + 30)),
        max(extract(epoch FROM (now() AT TIME ZONE 'UTC') -
          COALESCE(m.last_checked_at, m.created_at))) FILTER (WHERE
          COALESCE(m.last_checked_at, m.created_at) <
          (now() AT TIME ZONE 'UTC') - make_interval(secs => m.frequency + 30))
      )
      FROM monitor m JOIN users u ON u.id = m.user_id
      WHERE u.email = '{escaped}' AND m.state = 'Active'
    """)
    return int(row[0] or 0), None if row[1] is None else float(row[1])


def query_measurement(env: dict[str, str], email: str, start: datetime, end: datetime) -> dict[str, Any]:
    escaped = email.replace("'", "''")
    start_sql = start.astimezone(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")
    end_sql = end.astimezone(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")
    return json_query(env, f"""
      WITH owner AS (
        SELECT id FROM users WHERE email = '{escaped}' AND is_demo = false
      ), workload AS (
        SELECT id FROM monitor WHERE user_id IN (SELECT id FROM owner)
      ), ordered AS (
        SELECT c.monitor_id, c.state, c.latency_ms, c.created_at,
               lag(c.created_at) OVER (PARTITION BY c.monitor_id ORDER BY c.created_at, c.id) AS previous_at
        FROM check_result c JOIN workload m ON m.id = c.monitor_id
        WHERE c.created_at < timestamp '{end_sql}'
      ), windowed AS (
        SELECT *, extract(epoch FROM (created_at - previous_at)) AS interval_seconds
        FROM ordered
        WHERE created_at >= timestamp '{start_sql}' AND created_at < timestamp '{end_sql}'
      )
      SELECT json_build_object(
        'monitor_count', (SELECT count(*) FROM workload),
        'total_results', count(*),
        'successful_results', count(*) FILTER (WHERE state = 'healthy'),
        'failed_results', count(*) FILTER (WHERE state = 'unhealthy'),
        'unknown_state_results', count(*) FILTER (WHERE state NOT IN ('healthy', 'unhealthy')),
        'latency_median_ms', percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL),
        'latency_p95_ms', percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL),
        'interval_median_seconds', percentile_cont(0.5) WITHIN GROUP (ORDER BY interval_seconds::double precision) FILTER (WHERE interval_seconds IS NOT NULL),
        'interval_p95_seconds', percentile_cont(0.95) WITHIN GROUP (ORDER BY interval_seconds::double precision) FILTER (WHERE interval_seconds IS NOT NULL),
        'latency_ms', COALESCE(json_agg(latency_ms ORDER BY created_at, monitor_id) FILTER (WHERE latency_ms IS NOT NULL), '[]'::json),
        'interval_seconds', COALESCE(json_agg(interval_seconds ORDER BY created_at, monitor_id) FILTER (WHERE interval_seconds IS NOT NULL), '[]'::json),
        'results', COALESCE(json_agg(json_build_array(extract(epoch FROM (created_at AT TIME ZONE 'UTC')), state, latency_ms) ORDER BY created_at, monitor_id), '[]'::json)
      )
      FROM windowed
    """)


def wait_for_http(url: str, timeout: float, label: str) -> None:
    deadline = time.monotonic() + timeout
    last_error = "no response"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    response.read(1024)
                    return
                last_error = f"HTTP {response.status}"
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(1)
    raise RuntimeError(f"timed out waiting for {label}: {last_error}")


def register_user(api_url: str) -> tuple[str, str]:
    token = uuid.uuid4().hex[:12]
    email = f"loadtest-{token}@example.test"
    password = "LoadTestPass9x"
    body = json.dumps({
        "name": "Loadtest", "last_name": "Worker", "username": f"loadtest{token}",
        "email": email, "password": password,
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{api_url}/api/v1/users", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 201:
                raise RuntimeError(f"user registration returned HTTP {response.status}")
            result = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"dedicated test-user registration failed with HTTP {exc.code}") from exc
    if not isinstance(result.get("id"), int):
        raise RuntimeError("registration did not return a numeric user id")
    return email, str(result["id"])


def docker_stats(service: str, env: dict[str, str]) -> dict[str, Any] | None:
    record = get_container(service, env, required=False)
    if record is None or record["State"]["Status"] != "running":
        return None
    output = safe_run([
        "docker", "stats", "--no-stream", "--format", "{{json .}}", record["Id"],
    ], env, check=False, timeout=30)
    if not output:
        return None
    stat = json.loads(output.splitlines()[0])
    memory_used, memory_limit = docker_memory_bytes(stat["MemUsage"])
    return {
        "container": service,
        "container_id": record["Id"],
        "sampled_at_utc": iso_utc(datetime.now(timezone.utc)),
        "cpu_raw": stat["CPUPerc"],
        "cpu_percent": float(stat["CPUPerc"].rstrip("%")),
        "memory_raw": stat["MemUsage"],
        "memory_used_bytes": memory_used,
        "memory_limit_bytes": memory_limit,
    }


class Sampler:
    def __init__(self, env: dict[str, str], output: Path):
        self.env = env
        self.output = output
        self.phase = "preparation"
        self.lock = threading.Lock()
        self.first_sample = threading.Event()
        self.sample_now = threading.Event()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="docker-stats-sampler", daemon=True)
        self.error: BaseException | None = None

    def set_phase(self, phase: str) -> None:
        with self.lock:
            self.phase = phase

    def request_sample(self) -> None:
        self.sample_now.set()

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=35)
        if self.thread.is_alive():
            raise RuntimeError("Docker stats sampler did not stop")
        if self.error:
            raise RuntimeError(f"Docker stats sampler failed: {self.error}")

    def _run(self) -> None:
        fields = ["sampled_at_utc", "phase", "container", "container_id", "cpu_raw", "cpu_percent", "memory_raw", "memory_used_bytes", "memory_limit_bytes"]
        try:
            with ExitStack() as stack:
                streams = {"all": stack.enter_context((self.output / "container-stats.csv").open("w", newline="", encoding="utf-8"))}
                streams.update({
                    service: stack.enter_context((self.output / f"{service}-stats.csv").open("w", newline="", encoding="utf-8"))
                    for service in SERVICES
                })
                writers = {name: csv.DictWriter(stream, fieldnames=fields) for name, stream in streams.items()}
                for writer in writers.values():
                    writer.writeheader()
                while not self.stop_event.is_set():
                    began = time.monotonic()
                    with self.lock:
                        phase = self.phase
                    for service in SERVICES:
                        sample = docker_stats(service, self.env)
                        if sample:
                            sample["phase"] = phase
                            writers["all"].writerow(sample)
                            writers[service].writerow(sample)
                            streams["all"].flush()
                            streams[service].flush()
                    self.first_sample.set()
                    self.sample_now.wait(max(0, 10 - (time.monotonic() - began)))
                    self.sample_now.clear()
        except BaseException as exc:
            self.error = exc
            self.first_sample.set()


def write_csv(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def summarize_samples(path: Path, phases: set[str]) -> dict[str, Any]:
    collected = {service: {"cpu": [], "memory": []} for service in SERVICES}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            if row["phase"] in phases:
                collected[row["container"]]["cpu"].append(float(row["cpu_percent"]))
                collected[row["container"]]["memory"].append(float(row["memory_used_bytes"]))
    result = {}
    for service, values in collected.items():
        result[service] = {
            "sample_count": len(values["cpu"]),
            "cpu_percent_median": statistics.median(values["cpu"]) if values["cpu"] else None,
            "cpu_percent_sampled_peak": max(values["cpu"]) if values["cpu"] else None,
            "memory_bytes_median": statistics.median(values["memory"]) if values["memory"] else None,
            "memory_bytes_sampled_peak": max(values["memory"]) if values["memory"] else None,
        }
    return result


def host_metadata() -> dict[str, Any]:
    cpu_model = None
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.lower().startswith("model name"):
                cpu_model = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    memory_bytes = None
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                memory_bytes = int(line.split()[1]) * 1024
                break
    except (OSError, ValueError):
        pass
    return {
        "uname": platform.uname()._asdict(), "os": platform.platform(),
        "cpu_model": cpu_model, "logical_cpus": os.cpu_count(),
        "host_memory_bytes": memory_bytes,
    }


def docker_metadata(env: dict[str, str]) -> dict[str, Any]:
    # Query only requested safe fields; never retrieve the container environment.
    docker_cpus = int(safe_run(["docker", "info", "--format", "{{.NCPU}}"], env))
    docker_memory = int(safe_run(["docker", "info", "--format", "{{.MemTotal}}"], env))
    docker_version = safe_run(["docker", "version", "--format", "{{.Server.Version}}"], env)
    containers = {}
    for service in ("db", "api", "worker", "target"):
        record = get_container(service, env, required=False)
        if record:
            containers[service] = {
                "container_id": record["Id"], "image": record["Config"]["Image"],
                "image_id": record["Image"], "status": record["State"]["Status"],
                "restart_count": record["RestartCount"],
                "memory_limit_bytes": record["HostConfig"]["Memory"],
                "nano_cpus": record["HostConfig"]["NanoCpus"],
            }
    return {
        "docker_server_version": docker_version,
        "docker_allocated_cpus": docker_cpus,
        "docker_allocated_memory_bytes": docker_memory,
        "containers": containers,
    }


def git_metadata(env: dict[str, str]) -> dict[str, Any]:
    commit = safe_run(["git", "rev-parse", "HEAD"], env)
    status = safe_run(["git", "status", "--porcelain", "--untracked-files=all"], env, check=False)
    dirty_paths = []
    for line in status.splitlines():
        path = line[3:].strip().strip('"')
        if Path(path).name.startswith(".env"):
            continue
        dirty_paths.append({"status": line[:2], "path": path})
    return {"commit": commit, "dirty_paths": dirty_paths}


def record_overdue(env: dict[str, str], email: str, rows: list[dict[str, Any]], startup_mono: float) -> None:
    sampled_at = datetime.now(timezone.utc)
    count, age = overdue_snapshot(env, email)
    rows.append({
        "sampled_at_utc": iso_utc(sampled_at),
        "elapsed_since_worker_start_seconds": round(time.monotonic() - startup_mono, 3),
        "overdue_monitors": count,
        "maximum_overdue_age_seconds": age,
    })


def run(args: argparse.Namespace) -> Path:
    if args.duration <= 0 or not 60 <= args.warmup_timeout <= 600:
        raise ValueError("duration must be positive and warmup timeout must be between 60 and 600 seconds")
    if not 60 <= args.warmup_seconds <= 600:
        raise ValueError("warmup seconds must be between 60 and 600")
    if not 0 <= args.delay <= 60_000:
        raise ValueError("delay must be between 0 and 60000 milliseconds")
    env = compose_environment(args.delay, args.api_port)
    output = ROOT / "scripts" / "loadtest" / "results" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output.mkdir(parents=True, exist_ok=False)
    (ROOT / "scripts" / "loadtest" / "results" / ".gitignore").write_text("*\n!.gitignore\n", encoding="utf-8")
    worker_started = False
    sampler: Sampler | None = None
    email: str | None = None
    phases: list[dict[str, str]] = []
    overdue_rows: list[dict[str, Any]] = []
    try:
        existing_worker = compose("ps", "-q", "worker", env=env, check=False).strip()
        if existing_worker:
            raise RuntimeError("refusing to reuse a sentinel-load project with an existing worker; inspect the isolated project before retrying")
        existing_db = compose("ps", "-q", "db", env=env, check=False).strip()
        if existing_db:
            assert_db_identity(env)
        compose("up", "-d", "db", env=env)
        assert_db_identity(env)
        wait_for_container_health(env, "db", 120)
        psql(env, "DO $$ BEGIN IF current_database() <> 'sentinel_db' THEN RAISE EXCEPTION 'unexpected database identity'; END IF; END $$;")
        compose("up", "-d", "api", "target", env=env)
        assert_db_identity(env)
        api_url = f"http://127.0.0.1:{args.api_port}"
        wait_for_http(f"{api_url}/api/v1/health", 300, "API database health")
        wait_for_container_health(env, "target", 60)

        prior = json_query(env, f"SELECT count(*) FROM users WHERE email LIKE 'loadtest-%@example.test' AND email NOT IN ('{BASE_ENV['LOADTEST_DEMO_EMAIL']}', '{BASE_ENV['LOADTEST_STATUS_EMAIL']}')")
        if int(prior) != 0:
            raise RuntimeError("refusing to reuse a sentinel-load database containing prior load-test users; follow dedicated reset instructions")
        email, user_id = register_user(api_url)
        psql(env, file="seed.sql", variables={
            "loadtest_email": email,
            "demo_email": BASE_ENV["LOADTEST_DEMO_EMAIL"],
            "status_email": BASE_ENV["LOADTEST_STATUS_EMAIL"],
        })
        escaped = email.replace("'", "''")
        exact = json_query(env, f"""
          SELECT json_build_array(count(*), count(*) FILTER (WHERE last_checked_at IS NULL),
            bool_and(state = 'Active' AND check_type = 'http' AND check_config::jsonb = '{{}}'::jsonb
              AND is_public = false AND consecutive_failures = 0 AND frequency = 60
              AND last_state IS NULL AND seed_key IS NULL
              AND target LIKE 'http://198.51.100.10:8080/ok?i=%'))
          FROM monitor WHERE user_id = {int(user_id)}
        """)
        if exact != [5000, 5000, True] or unrelated_active_count(env, email) != 0:
            raise RuntimeError(f"seed assertions failed: count={exact[0]}, unchecked={exact[1]}, contract={exact[2]}; unrelated active monitors are forbidden")

        sampler = Sampler(env, output)
        sampler.start()
        if not sampler.first_sample.wait(40):
            raise RuntimeError("initial Docker stats sample was not collected before worker startup")
        sampler.set_phase("startup")
        startup_mono = time.monotonic()
        startup_utc = datetime.now(timezone.utc)
        worker_started = True
        compose("up", "-d", "worker", env=env)
        sampler.request_sample()
        phases.append({"phase": "startup", "started_at_utc": iso_utc(startup_utc)})
        startup_deadline = startup_mono + args.warmup_timeout
        last_overdue_mono = 0.0
        while True:
            now_mono = time.monotonic()
            if now_mono - last_overdue_mono >= 60:
                record_overdue(env, email, overdue_rows, startup_mono)
                last_overdue_mono = time.monotonic()
            checked, total = checked_count(env, email)
            polled_mono = time.monotonic()
            if total != 5000:
                raise RuntimeError(f"workload monitor count changed during startup: {total}")
            if checked == 5000:
                if polled_mono > startup_deadline:
                    raise RuntimeError(f"startup timeout: all monitors first checked only after the {args.warmup_timeout}s deadline")
                break
            if polled_mono >= startup_deadline:
                raise RuntimeError(f"startup timeout: only {checked}/5000 monitors completed a first check within {args.warmup_timeout}s")
            time.sleep(3)

        startup_complete = datetime.now(timezone.utc)
        startup_elapsed = time.monotonic() - startup_mono
        phases[-1].update({"ended_at_utc": iso_utc(startup_complete), "elapsed_seconds": f"{startup_elapsed:.3f}"})
        phases.append({"phase": "warmup", "started_at_utc": iso_utc(startup_complete)})
        sampler.set_phase("warmup")
        sampler.request_sample()
        warmup_deadline = time.monotonic() + args.warmup_seconds
        while time.monotonic() < warmup_deadline:
            time.sleep(min(1, warmup_deadline - time.monotonic()))
        warmup_end = datetime.now(timezone.utc)
        phases[-1].update({"ended_at_utc": iso_utc(warmup_end), "elapsed_seconds": f"{args.warmup_seconds:.3f}"})

        sampler.set_phase("steady")
        sampler.request_sample()
        start_utc = datetime.now(timezone.utc)
        start_mono = time.monotonic()
        end_utc = start_utc + timedelta(seconds=args.duration)
        deadline = start_mono + args.duration
        phases.append({"phase": "steady", "started_at_utc": iso_utc(start_utc)})
        last_overdue_mono = 0.0
        while time.monotonic() < deadline:
            now_mono = time.monotonic()
            if now_mono - last_overdue_mono >= 60:
                record_overdue(env, email, overdue_rows, startup_mono)
                last_overdue_mono = time.monotonic()
            time.sleep(max(0, min(1, deadline - time.monotonic())))
        phases[-1].update({"ended_at_utc": iso_utc(end_utc), "elapsed_seconds": f"{args.duration:.3f}"})

        # This final SQL is outside the monotonic deadline; it cannot extend the window.
        measured = query_measurement(env, email, start_utc, end_utc)
        latencies = [float(value) for value in measured.pop("latency_ms")]
        intervals = [float(value) for value in measured.pop("interval_seconds")]
        result_rows = measured.pop("results")
        buckets = minute_buckets(
            [(float(row[0]), str(row[1])) for row in result_rows], start_utc.timestamp(), end_utc.timestamp()
        )
        write_csv(output / "results.csv", ["created_at_utc", "state", "latency_ms"], [
            {"created_at_utc": iso_utc(datetime.fromtimestamp(float(row[0]), timezone.utc)), "state": row[1], "latency_ms": row[2]}
            for row in result_rows
        ])
        write_csv(output / "minute-results.csv", ["minute", "successful", "failed", "unknown", "partial"], buckets)
        write_csv(output / "overdue.csv", ["sampled_at_utc", "elapsed_since_worker_start_seconds", "overdue_monitors", "maximum_overdue_age_seconds"], overdue_rows)
        write_csv(output / "latencies.csv", ["latency_ms"], [{"latency_ms": value} for value in latencies])
        write_csv(output / "intervals.csv", ["interval_seconds"], [{"interval_seconds": value} for value in intervals])

        current_checked, current_total = checked_count(env, email)
        if current_total != 5000 or current_checked != 5000:
            raise RuntimeError(f"final monitor assertion failed: checked={current_checked}, total={current_total}")
        if unrelated_active_count(env, email) != 0:
            raise RuntimeError("unrelated active monitors appeared in the isolated database")
        container_info = docker_metadata(env)
        for service in ("worker", "db", "target"):
            record = get_container(service, env)
            if record["State"]["Status"] != "running" or record["RestartCount"] != 0:
                raise RuntimeError(f"container invariant failed for {service}: status={record['State']['Status']} restarts={record['RestartCount']}")
        if measured["successful_results"] <= 0:
            raise RuntimeError("measurement contained no successful HTTP checks")
        startup_resources = summarize_samples(output / "container-stats.csv", {"startup"})
        steady_resources = summarize_samples(output / "container-stats.csv", {"steady"})
        if any(startup_resources[s]["sample_count"] == 0 for s in SERVICES):
            raise RuntimeError("startup phase lacks stats samples for one or more measured containers")
        if any(steady_resources[s]["sample_count"] == 0 for s in SERVICES):
            raise RuntimeError("steady phase lacks stats samples for one or more measured containers")

        metadata = {
            "schema_version": 1,
            "project": PROJECT,
            "artifact_directory": str(output.relative_to(ROOT)),
            "api_port": args.api_port,
            "target_delay_ms": args.delay,
            "requested_duration_seconds": args.duration,
            "warmup_seconds": args.warmup_seconds,
            "warmup_policy": "at least one 60-second frequency interval after every test monitor has completed a first check; not proof of convergence",
            "startup_timeout_seconds": args.warmup_timeout,
            "startup_first_check_elapsed_seconds": round(startup_elapsed, 3),
            "startup_first_check_completed_at_utc": iso_utc(startup_complete),
            "measurement_start_utc": iso_utc(start_utc),
            "measurement_end_utc": iso_utc(end_utc),
            "measurement_interval": "[start,end)",
            "worker_concurrency": 10,
            "worker_concurrency_source": "sentinel-worker/internal/config/config.go:69,123 (hardcoded concurrency := 10)",
            "registered_user_email": email,
            "seeded_monitors": 5000,
            "host": host_metadata(),
            "docker": container_info,
            "git": git_metadata(env),
            "commands": {
                "compose_base": "docker compose --env-file /dev/null -p sentinel-load -f docker-compose.yml -f docker-compose.loadtest.yml",
                "entrypoint": ["./scripts/loadtest/loadtest.sh", "--duration", str(args.duration), "--delay", str(args.delay), "--warmup-seconds", str(args.warmup_seconds), "--warmup-timeout", str(args.warmup_timeout), "--api-port", str(args.api_port)],
            },
            "phases": phases,
        }
        summary = {
            "status": "completed",
            "metadata": metadata,
            "result_counts": measured,
            "latency_ms": percentile_summary(latencies),
            "inter_check_interval_seconds": percentile_summary(intervals),
            "percentile_cont": {
                "latency_median_ms": measured["latency_median_ms"],
                "latency_p95_ms": measured["latency_p95_ms"],
                "interval_median_seconds": measured["interval_median_seconds"],
                "interval_p95_seconds": measured["interval_p95_seconds"],
            },
            "overdue": {
                "sample_count": len(overdue_rows),
                "maximum_overdue_monitors": max((row["overdue_monitors"] for row in overdue_rows), default=0),
                "maximum_overdue_sample_at_utc": max(overdue_rows, key=lambda row: row["overdue_monitors"])["sampled_at_utc"] if overdue_rows else None,
            },
            "startup_sampled_resource_peaks": startup_resources,
            "steady_sampled_resources": steady_resources,
            "sampling_caveats": [
                "Sampled peaks may miss short transients.",
                "Docker stats cache exclusion is not Go heap or process RSS accounting.",
                "Ten-second Docker stats and periodic SQL sampling add measurement overhead.",
                "A local synthetic target does not model external DNS, TLS, network latency, or remote behavior.",
            ],
        }
        (output / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return output
    except BaseException as exc:
        if overdue_rows:
            write_csv(output / "overdue.csv", ["sampled_at_utc", "elapsed_since_worker_start_seconds", "overdue_monitors", "maximum_overdue_age_seconds"], overdue_rows)
        (output / "failure.json").write_text(json.dumps({"status": "failed", "error": str(exc), "phases": phases}, indent=2) + "\n", encoding="utf-8")
        raise
    finally:
        if sampler is not None:
            sampler.stop()
        if worker_started:
            compose("stop", "worker", env=env, check=False, timeout=60)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=int, default=900, help="steady measurement-window seconds (default 900)")
    parser.add_argument("--delay", type=int, default=int(os.environ.get("TARGET_DELAY_MS", "10")), help="synthetic /ok delay in milliseconds")
    parser.add_argument("--warmup-seconds", type=int, default=60, help="warmup after first check; minimum 60 seconds")
    parser.add_argument("--warmup-timeout", type=int, default=600, help="bounded first-check startup deadline")
    parser.add_argument("--api-port", type=int, default=int(os.environ.get("LOADTEST_API_PORT", "18000")), help="free loopback host port, never 8000")
    args = parser.parse_args(argv)
    if not 1 <= args.api_port <= 65535 or args.api_port == 8000:
        parser.error("--api-port must be 1-65535 and must not be the development stack port 8000")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        output = run(args)
    except Exception as exc:
        print(f"load test failed: {exc}", file=sys.stderr)
        return 1
    print(f"Load test complete. Summary: {output / 'summary.json'}")
    print(f"Raw results: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
