# Sentinel worker load test

This harness runs an isolated five-thousand-monitor workload without changing API or worker source. It uses the existing SSRF policy and a local synthetic HTTP target; it does not validate real external network behavior.

## Quick path

Prerequisites: Docker Engine with Compose v2 support for `!reset`/`!override`, Python 3.10+ on the host, and enough disk/memory to build and run the API, worker, and PostgreSQL. The `python:3.13-alpine` target image must be available locally or pullable. Choose a free loopback API port other than the development stack's port 8000.

For repeated runs, use this nondestructive sequence from the repository root. Each invocation selects a new retained database volume; previous test volumes and artifacts are left untouched:

```sh
./scripts/loadtest/loadtest.sh --duration 120 --delay 10 --fresh-volume
./scripts/loadtest/loadtest.sh --delay 10 --fresh-volume
./scripts/loadtest/loadtest.sh --delay 300 --fresh-volume
```

The first command is the short validation; the following commands are the operator-owned 15-minute runs. Do not interpret an unrun mode as measured evidence. Each invocation performs preparation, target/API health checks, dedicated user registration, exact SQL seeding, first-check startup measurement, a bounded warmup, then its steady window. The harness captures evidence under `scripts/loadtest/results/<UTC timestamp>/`; it stops only the `sentinel-load` worker afterward and intentionally leaves its DB/API/target running. It prints and records the selected DB volume name in the summary.

Set the port and target delay through command arguments or environment. The environment example below keeps the API off the development stack's 8000 port:

```sh
env LOADTEST_API_PORT=18001 TARGET_DELAY_MS=300 \
  ./scripts/loadtest/loadtest.sh --api-port 18001 --delay 300 --fresh-volume
```

Use a short validation only when explicitly authorized:

```sh
./scripts/loadtest/loadtest.sh --duration 120 --delay 10 --fresh-volume
```

The two-minute run is a validation exercise, not a substitute for either full 15-minute run.

## Isolation and startup order

- Every Compose invocation uses `--env-file /dev/null -p sentinel-load` and the root development Compose file plus `docker-compose.loadtest.yml`. The harness supplies explicit test-only DB URL/password, secret key, demo/status identities, API port, and target delay in its child-process environment. No host dotenv files or credentials are read or copied into artifacts.
- The API is bound only to `127.0.0.1:<LOADTEST_API_PORT>` (default 18000); database and target have no host ports. The project-specific database volume is named `sentinel-load_sentinel_load_data`. The target is `198.51.100.10:8080` on `198.51.100.0/24`; the worker is attached to that network and the default DB network. It does not change `ALLOWED_PORTS` or any worker/API code.
- Demo and status use empty test manifests and distinct test identities. API readiness at `/api/v1/health` is required after migration/seeding. The harness then registers a unique non-demo test user through `POST /api/v1/users`, checks the Docker project/service labels before SQL writes, and inserts exactly 5,000 active private HTTP monitors. Demo/status monitors in this database are paused. Worker startup happens only after the SQL assertions pass and the Docker stats sampler has collected its pre-start sample.
- The built API runtime image copies only selected source/build files and does not copy `.env*`; the override sets `NODE_ENV=test` and `IGNORE_ENV_FILE=true` so Nest does not load dotenv files. Compose interpolation is independently disabled from host dotenv with `--env-file /dev/null`. Prisma's entrypoint migration runs inside the image, which has no copied dotenv files.
- By default, an existing sentinel-load container or `sentinel-load_sentinel_load_data` volume is refused. Repeated runs should use `--fresh-volume`: each invocation generates a unique `sentinel-load_data_<UTC timestamp>_<suffix>` name, verifies labels on existing services, rejects a running worker, and force-recreates only the owned DB/API/target containers needed for the new empty database. The previous named volume and all artifacts remain intact; no reset or volume removal is performed. Old volumes are retained for later operator-managed cleanup.

## What the measurement means

The worker's effective concurrency is fixed at 10 (`sentinel-worker/internal/config/config.go`, `concurrency := 10`). The target's `/ok` endpoint returns a small `200` response after the configured delay; `/health` is delay-free. Its threaded server handles at least ten concurrent requests. Results use checker states `healthy` and `unhealthy` as success/failure.

The startup phase ends only after all 5,000 monitors have a first `last_checked_at`, bounded by 600 seconds by default. A separate warmup of at least one monitor frequency interval (60 seconds) follows; this criterion is not proof of convergence. If the bounded first-check phase fails, the run fails clearly and preserves its artifacts. A `--warmup-timeout` below 60 seconds is invalid; the permitted warmup/startup bound is at most 600 seconds.

The steady window uses a monotonic deadline and is reported as the half-open UTC interval `[start,end)`. Final result SQL runs after the deadline, so query latency cannot silently extend the measured interval. Minute counts come from SQL `date_trunc('minute', created_at)` grouping inside the exact half-open window; UTC calendar-minute rows include overlap seconds and mark partial edge minutes (a non-minute-aligned start is not mislabeled as a full first minute). Inter-check intervals use `lag()` over each monitor's entire result history before filtering current results to the window, preserving a predecessor just before the start boundary. SQL compares unzoned PostgreSQL timestamps as UTC, consistent with worker writes.

The harness samples `docker stats --no-stream` every 10 seconds for worker, DB, and target. Per-container CSVs and `container-stats.csv` preserve Docker's raw CPU/memory strings plus normalized CPU percent and byte values. The converted memory byte values are derived from Docker's rounded human-readable display precision, not exact process or container memory; sampled peaks are labeled accordingly. Startup-phase sampled peaks are separate from steady-window median and sampled peak CPU/memory for each of the three containers. `overdue.csv` samples every 60 seconds, counting a monitor overdue only when its last check—or its seed creation time when never checked—is older than `frequency + 30` seconds.

`summary.json` includes the retained database volume name, actual image IDs, container IDs/restarts/status, verified final worker `exited` state/restart count with safe-inspect provenance, safe Docker resource limits, host OS/CPU/RAM, Docker version and allocated CPU/RAM, full Git SHA and dirty path/status list, fixed concurrency source, target delay, phase/window times, result counts, latency/interval medians and interpolated p95, and overdue maxima/sample time. It contains no database password, test secret, or registered user's password. Raw CSV and JSON evidence stays local and is ignored by the nested `.gitignore`.

Useful files:

| Artifact | Contents |
|---|---|
| `worker-stats.csv`, `db-stats.csv`, `target-stats.csv` | Per-container raw plus normalized Docker stats |
| `container-stats.csv` | Combined phase-labeled Docker stats |
| `results.csv` | Every window result timestamp, checker state, and measured latency |
| `minute-results.csv` | Successful, failed, unknown-state results, and partial-window flags |
| `overdue.csv` | Overdue count and oldest overdue age sampled over time |
| `latencies.csv`, `intervals.csv` | Individual measured values used by percentile summaries |
| `summary.json` | Metadata, exact window, counts, distributions, startup and steady resources |
| `failure.json` | Failure and phase evidence when a run aborts |

## Interpreting rates

At concurrency 10, `10 / 0.010 = 1000 checks/s` and `10 / 0.300 = 33.333333… checks/s` are delay-only ceilings before database, worker scheduling, polling and non-overlap overhead. Demand is `5000 / 60 = 83.333333… checks/s`. A 300 ms target therefore has a theoretical maximum of about 30,000 checks in 15 minutes before overhead and cannot justify a 75,000-check expectation. Record what the harness observes; never label a low-latency run as converged without evidence or extrapolate capacity from theoretical ceilings.

All sampled peaks may miss short transients. Docker stats cache exclusion is not equivalent to Go heap or process RSS accounting. Ten-second stats collection and periodic SQL sampling add overhead. A local synthetic target does not model external DNS, TLS, network latency, or remote service variance.

## Scope and cleanup

The harness starts only `db`, `api`, and `target` for preparation, then starts `worker` after successful registration and SQL checks. It never starts frontend. On normal completion or failure after worker startup, it stops only the Compose-owned worker; it retains the dedicated database, API, target, volume, and artifacts. No volume removal is part of this workflow. Each fresh run retains its named volume and results for later operator-managed cleanup; do not remove volumes as part of evidence capture.
