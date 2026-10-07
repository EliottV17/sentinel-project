# Sentinel worker load-test evidence

**Status: the two-minute harness validation passed. Both full 15-minute runs remain pending.** The current evidence does not establish the combined claim “5,000 monitors, 75,000 results, ~25 MB of memory.” No API or worker code was changed, and the existing SSRF policy remains enabled.

## Reproduce the full runs

From the `sentinel-project-loadtest` worktree on `chore/load-test`, run these **sequentially**, not concurrently:

```sh
./scripts/loadtest/loadtest.sh --duration 900 --delay 10 --fresh-volume
./scripts/loadtest/loadtest.sh --duration 900 --delay 300 --fresh-volume
```

Each command builds/starts only `db`, `api`, `target`, then `worker` in project `sentinel-load`. It supplies explicit test-only environment values to Compose with `--env-file /dev/null`; no `.env*` files are needed. Each fresh volume preserves earlier databases instead of deleting them. The worker must be stopped before another run. At completion the harness stops the worker, but retains DB/API/target, volumes and artifacts. No push or PR is part of this procedure.

Preparation waits for API health after migrations and bootstrap seeds, registers a distinct non-demo/non-status user through `POST /api/v1/users`, then seeds exactly 5,000 private HTTP monitors via SQL `generate_series`. Their frequency is 60 seconds, state is `Active`, config is `{}`, and initial `last_checked_at` is NULL. Empty test manifests keep unrelated monitors out of the workload. The target at `198.51.100.10:8080` is permitted by the existing SSRF filter; worker and target share the isolated `198.51.100.0/24` network, while the worker also uses the default DB network.

The 900-second measurement begins **after** every monitor has a first result and at least 60 seconds of additional warmup. First-check completion has a bounded timeout of 600 seconds. This warmup criterion does not prove convergence; for the overloaded 300 ms case it is a bounded observation window, not a promise of stable service at the required rate.

See [the detailed procedure](../scripts/loadtest/README.md) for prerequisites, optional API port, artifacts, environment isolation and operator-only cleanup. Send the complete `summary.json` and CSV set for each full run before replacing the pending rows below.

## Measured and pending runs

Memory values here are conversions of Docker's rounded display strings, **not exact process RSS or Go heap measurements**. MB means 1,000,000 bytes; MiB means 1,048,576 bytes. Peaks are sampled, not continuous maxima.

| Run | Target delay | Window | Monitors | Healthy results / failures | Maximum sampled overdue monitors (>30 s beyond due) | Worker startup sampled peak (display-derived bytes) | Worker window memory median / sampled peak (display-derived bytes) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Short validation, completed | 10 ms | 120 s | 5,000 | 6,920 / 0 | 0 | 7,638,876 | 24,080,547 / 25,249,710 |
| Full run, **pending operator execution** | 10 ms | 900 s planned | 5,000 planned | Pending | Pending | Pending | Pending |
| Full run, **pending operator execution** | 300 ms | 900 s planned | 5,000 planned | Pending | Pending | Pending | Pending |

The short window had zero unknown-state results. It does not justify multiplying by 7.5 to claim a measured 15-minute count. Checks arrive in bursts, and the observed median cadence exceeds 60 seconds.

### Validation identity and timing

| Field | Observed value |
|---|---|
| Tested commit | `5ef5fdbcd5e47c05fead4933cb5658e13a396222` |
| Git state at capture | Clean; zero dirty paths |
| Invocation | `./scripts/loadtest/loadtest.sh --duration 120 --delay 10 --fresh-volume` |
| Local evidence directory | `scripts/loadtest/results/20261007T032218Z/` (ignored by Git) |
| Command log | `scripts/loadtest/results/validation-retry-command.log` |
| First-check startup duration | 9.519 s (metadata millisecond precision) |
| Additional warmup | 60.000 s |
| Measurement window | `[2026-10-07T03:23:53.843Z, 2026-10-07T03:25:53.843Z)` (metadata millisecond precision; CSV overlaps preserve finer precision) |
| Inter-check intervals | 6,920 samples; median 61.9688225 s; p95 62.285953049999996 s (`percentile_cont`) |
| HTTP latency | 6,920 samples; median 10.352 ms; p95 10.459 ms |
| Overdue sampling | Three samples across startup/warmup/window; all zero; not a continuous bound |
| Final worker state | Exited; zero restarts; no run or cleanup errors |
| Retained new DB volume | `sentinel-load_data_20261007T032218Z_6f0f2db3` |
| Retained previous failed-run DB volume | `sentinel-load_sentinel_load_data` |

### Results by UTC calendar minute

The SQL uses `date_trunc('minute', created_at)`, scoped to the test user's monitors and the half-open measurement window. Do not compare partial buckets as full minutes.

| Minute (UTC) | Window overlap (s) | Healthy results | Failed / unknown | Partial bucket |
|---|---:|---:|---:|---|
| 2026-10-07 03:23:00 | 6.156762 | 924 | 0 / 0 | Yes |
| 2026-10-07 03:24:00 | 60 | 5,000 | 0 / 0 | No |
| 2026-10-07 03:25:00 | 53.843238 | 996 | 0 / 0 | Yes |

These sum to 6,920. One full minute contained 5,000 results; that is an observation, not evidence of a sustained 15-minute rate. Intervals are computed with `lag()` over each monitor's history **before** filtering to the measurement window, retaining the predecessor across the start boundary. Unzoned DB timestamps are treated as UTC, matching worker writes.

### Worker, PostgreSQL and target resources

`docker stats --no-stream` is sampled every 10 seconds. There was only **one startup sample per container** and **12 samples per container within the exact measurement window**.

| Container | Startup sampled memory peak (display-derived bytes) | Window memory median (display-derived bytes) | Window sampled memory peak (display-derived bytes) | Window CPU median | Window sampled CPU peak |
|---|---:|---:|---:|---:|---:|
| Worker | 7,638,876 | 24,080,547 | 25,249,710 | 0.05% | 38.52% |
| PostgreSQL | 48,958,013 | 55,275,683 | 56,581,160 | 0.13% | 29.65% |
| Target | 23,425,187 | 12,955,156 | 13,547,601 | 0.025% | 0.03% |

The worker's raw startup display was **7.285 MiB**. Its window median corresponds to **22.965 MiB** (median of display-derived bytes); its window sampled peak was **24.08 MiB**, or **25.249710 decimal MB**. Do not round this down to a 25 MB ceiling.

**An additional worker sample at `03:25:54.920Z`, after the measurement end, displayed 26.36 MiB (27,640,463 display-derived bytes) and 41.88% CPU.** It remains in the raw CSV, labeled `steady` because collection continued during reporting, but is correctly excluded from window statistics by timestamp. It is the largest worker display observed in the saved CSV, not proof of a continuous maximum. Disclose it rather than selecting the more favorable window peak.

The startup phase ended before the next regular 10-second sample. Its single sample cannot capture the all-due monitor allocation peak reliably. Therefore **the true startup peak is unresolved**, despite reporting the observed startup sample separately. CPU snapshots can also miss entire bursts; these values do not establish whether the worker, target or PostgreSQL was the bottleneck. Docker CPU percentages are not normalized to all 12 assigned CPUs. Sampling and SQL queries add measurement overhead; Docker's memory cache accounting is not a Go heap measurement.

## Machine and Docker conditions

| Resource | Observed value |
|---|---|
| Host CPU | 12th Gen Intel(R) Core(TM) i5-12400F; 12 logical CPUs |
| Host RAM | 16,582,406,144 bytes |
| Host OS | Linux 7.2.3-arch1-3, x86_64, glibc 2.44 |
| Docker Engine server | 29.7.2 |
| Docker assigned CPUs / RAM | 12 / 16,582,406,144 bytes |
| Container resource limits | No explicit memory or CPU caps (`memory_limit_bytes=0`, `nano_cpus=0`) |
| Effective worker concurrency | **10**, hardcoded in `sentinel-worker/internal/config/config.go:69,123`; not environment configurable |
| Target conditions | Local synthetic HTTP, configurable 10 ms delay, small 200 body; no real external DNS/TLS/network variance |

Image IDs used (full IDs and container IDs also retained in metadata):

- Worker: `sha256:5aebad55fa70e4af0c7fb62dc21dc83f2f365bebd964d719540e21fe7e1f3197`
- API: `sha256:0a4435290592570087d82dcf2f0c0cc3c9d842299982f7789af8939e7d854df2`
- PostgreSQL: `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`
- Target: `sha256:2d9aefe2fef018a7eb2c13064c89c71929800fd2e5dccdbf52ea5da5bb8d929a`

Image tags are mutable; record each run's actual IDs rather than assuming a later pull reproduces identical binaries.

## Theoretical capacity, not measured throughput

The delay-only upper bound is:

```text
maximum checks/second <= concurrency / target delay in seconds
required checks/second = monitor count / requested frequency
```

| Target delay | Effective concurrency | Delay-only ceiling | Ideal 900 s upper bound (before overhead) | Required rate |
|---|---:|---:|---:|---:|
| 10 ms | 10 | 10 / 0.010 = 1,000 checks/s | 900,000 | 5,000 / 60 = 83.333333… checks/s |
| 300 ms | 10 | 10 / 0.300 = 33.333333… checks/s | 30,000 | 5,000 / 60 = 83.333333… checks/s |

At 300 ms, ten concurrent checks cannot meet the requested 60-second cadence for 5,000 monitors even under ideal conditions. A first sweep alone has a delay-only minimum of `5,000 × 0.300 / 10 = 150 seconds`. PostgreSQL writes, scheduling, the 2-second ticker, and non-overlapping cycles add cost. **The full 300 ms run has not been measured**; no actual result count, delay or memory figure is claimed for it.

The worker's `fetchDueMonitors` loads all due monitors without a batch limit, so the initial NULL timestamps synchronize an all-due batch. Poll cycles do not overlap. These are findings, not changes: the fixed concurrency and batching behavior were left intact.

## Verification and invalidated attempt

- Focused test-first regressions: observed RED, then GREEN; **19 tests passed independently**. Bash syntax, four Python AST parses, merged Compose configuration and whitespace checks passed.
- API readiness, exact 5,000-monitor seed, no unrelated active monitors, real successful HTTP checks, scoped raw metrics, preserved old volume, zero restarts and final worker stop were checked in the successful short run. Main stack resources were not changed.
- An earlier attempt at `6eb47a2` produced HTTP/SQL results but failed Docker inspection because the worker has no healthcheck; the sampler captured no worker memory and teardown skipped its stop. The parent stopped only the owned worker. Those artifacts remain at `scripts/loadtest/results/20261007T024129Z/` and **are not valid memory evidence**. Optional health inspection and independent cleanup now have regression coverage.
- API/worker functional suites were not rerun: their source was unchanged; the real Compose/SQL/HTTP short validation checks the new harness boundary. Full 15-minute runs, CI and external target behavior remain unverified. RDD was clone-local off; no native review approval is claimed.

## Evidence needed before making a portfolio claim

Keep both complete run summaries, all raw CSVs, image IDs, commit/dirty-state metadata and machine/Docker resource conditions. Report exact counts, sampled overdue counts, interval distributions, startup sample coverage, median and sampled peak memory for both latencies. A claim must explicitly distinguish worker memory from PostgreSQL/target memory and MB from MiB. Until those full runs are supplied, the combined “75,000 results, ~25 MB” claim remains **unverified**.
