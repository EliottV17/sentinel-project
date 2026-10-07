# Sentinel worker load-test evidence

**The combined claim “5,000 monitors, 75,000 results, ~25 MB” is not supported by either full run.** At 10 ms, the 900-second window produced 70,960 successful checks (not 75,000) and a 52,785,315-byte sampled worker-memory peak. At 300 ms, it produced 28,270 checks, with a 190.9495485-second median interval and 2,340 monitors overdue at the worst sample. All results were healthy; the 300 ms run did not meet the requested 60-second cadence.

## Full-run results

| Measure | 10 ms target | 300 ms target |
|---|---:|---:|
| Artifact directory | `scripts/loadtest/results/20261007T035935Z/` | `scripts/loadtest/results/20261007T041737Z/` |
| Measurement window (UTC, half-open) | `[2026-10-07T04:01:00.082Z, 2026-10-07T04:16:00.082Z)` | `[2026-10-07T04:21:52.250Z, 2026-10-07T04:36:52.250Z)` |
| Startup to first checks complete | 9.513 s (1 sample) | 168.698 s (17 samples) |
| Post-startup warmup | 60 s | 60 s |
| Monitors in scoped SQL results | 5,000 | 5,000 |
| Results in window | 70,960 healthy; 0 failed; 0 unknown | 28,270 healthy; 0 failed; 0 unknown |
| Exact average result rate | 70,960 / 900 = 78.8444…/s | 28,270 / 900 = 31.4111…/s |
| Inter-check interval, median / p95 | 61.994875 / 62.055171099999995 s | 190.9495485 / 210.26961054999998 s |
| HTTP latency, median / p95 | 10.378 / 10.522 ms | 300.345 / 300.685 ms |
| Maximum sampled overdue monitors (>30 s past due) | 0 of 5,000; 15 window samples (16 across phases) | 2,340 of 5,000; 15 window samples (18 across phases) |
| Worker memory, strict-window median / sampled peak | 37,654,364 / 52,785,315 bytes | 32,033,996 / 36,458,987 bytes |
| Worker CPU, strict-window median / sampled peak | 0.05 / 40.91% | 1.55 / 2.22% |

The delay-only upper bound is `concurrency / latency in seconds`; the requested rate is `5,000 / 60 = 83.333… checks/s`. At 10 ms, the ceiling is `10 / 0.010 = 1,000 checks/s` before overhead; the measured run falls short of 75,000 by 4,040 checks. At 300 ms, the ceiling is `10 / 0.300 = 33.333… checks/s`, or 30,000 in 900 seconds before overhead; measured output was 28,270. These runs show observed behavior, not why the difference occurred: SQL, locks, scheduling, and ticker contributions were not individually measured. They do not prove an unbounded backlog.

The 14 full calendar-minute result buckets in each run (UTC, `date_trunc('minute', created_at)`) ranged from **3,473 to 5,000** for 10 ms and **1,840 to 1,910** for 300 ms. These ranges exclude the two partial buckets at each window's boundaries. Counts alone do not prove that every one of 5,000 distinct monitors reported in every full bucket; do not infer that without verifying distinct monitor IDs in raw results.

## Resources and provenance

Resource figures below use strict timestamp filtering of raw `container-stats.csv`, not phase labels. Values are Docker rounded display strings converted to bytes; they are not process RSS or Go heap. Byte values are primary; MiB uses 1,048,576 bytes/MiB. Median values may be fractional, so do not round midpoint bytes upward. Peaks are sampled, not continuous maxima.

| Run / container | Window samples | Memory median / sampled peak (bytes) | CPU median / sampled peak |
|---|---:|---:|---:|
| 10 ms / worker | 90 | 37,654,364 / 52,785,315 | 0.05 / 40.91% |
| 10 ms / PostgreSQL | 90 | 61,949,869.5 / 70,170,705 | 0.17 / 37.74% |
| 10 ms / target | 90 | 12,619,611.5 / 23,330,816 | 0.03 / 31.76% |
| 300 ms / worker | 90 | 32,033,996 / 36,458,987 | 1.55 / 2.22% |
| 300 ms / PostgreSQL | 90 | 58,028,195 / 61,215,866 | 0.99 / 3.30% |
| 300 ms / target | 90 | 13,631,488 / 14,648,606 | 0.98 / 8.24% |

Worker sampled peaks are 50.34 MiB (52.785315 decimal MB) and 34.77 MiB (36.458987 decimal MB), respectively. These are also the largest raw worker samples in the corresponding files, but sampling cannot establish a continuous maximum. Startup samples are separate: at 10 ms, worker/DB/target peaked at 5,476,712 / 48,853,155 / 23,267,901 bytes with one sample each; at 300 ms they peaked at 23,907,532 / 54,746,152 / 22,114,467 bytes with 17 samples each. Sub-10-second transients may be missed; it is not established that one was missed.

### Shared run conditions

| Field | Both runs |
|---|---|
| Completion / workload | Completed cleanly; 5,000 monitors; 900-second measurement; worker final state exited, 0 restarts |
| Tested source | Clean commit `6db4d0171da10c3edf7f08f2b2c87b738d9b9541` in both artifact metadata records (this documentation update is later and does not change tested source) |
| Host | 12th Gen Intel Core i5-12400F; 12 logical CPUs; 16,582,406,144 bytes RAM; Linux 7.2.3-arch1-3, x86_64, glibc 2.44 |
| Docker | Engine 29.7.2; 12 CPUs / 16,582,406,144 bytes assigned; no explicit container CPU or memory limits |
| Worker concurrency | 10, hardcoded (`sentinel-worker/internal/config/config.go:69,123`) |
| Image IDs | worker `sha256:5aebad55fa70e4af0c7fb62dc21dc83f2f365bebd964d719540e21fe7e1f3197`; API `sha256:0a4435290592570087d82dcf2f0c0cc3c9d842299982f7789af8939e7d854df2`; PostgreSQL `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`; target `sha256:2d9aefe2fef018a7eb2c13064c89c71929800fd2e5dccdbf52ea5da5bb8d929a` |

Each run used an isolated local synthetic HTTP target with the specified delay. It does not represent external DNS, TLS, network variability, or remote behavior. The ideal 300 ms limit (33.333… checks/s) is below the requested 83.333… checks/s, even before overhead; this theoretical fact is not attribution of observed losses to any specific component.

## Raw-data calculation and sampling caveat

The complete original files remain in each artifact directory: `summary.json`, `container-stats.csv`, per-container stats CSVs, `results.csv`, `minute-results.csv`, `overdue.csv`, `latencies.csv`, and `intervals.csv`. No artifact was overwritten. To reproduce the resource table, parse UTC timestamps from `container-stats.csv`; retain rows whose timestamps satisfy the corresponding `[start,end)` window above; group by container; calculate median and maximum of `memory_display_value_bytes` and `cpu_percent`. The phase label is **not** a time-window filter.

The harness summary currently filters samples by phase tag only (`summarize_samples` in `scripts/loadtest/loadtest.py`, around lines 485–503). Sampling continues while final queries and summary generation run. Consequently its counts differ from strict raw-window counts: for 10 ms summary counts worker/DB/target are 91/90/90 while the final stats CSV has 91 rows each; for 300 ms they are 90/90/90 in summary and 91 each in the final CSV. This is a known sampler-boundary defect for follow-up; do not use phase-only summary statistics as strict-window values. Raw timestamps allow the window results above to be independently recomputed. No harness fix was made here.

## Reproduction and short validation context

From the `sentinel-project-loadtest` worktree, run full observations sequentially, not concurrently:

```sh
./scripts/loadtest/loadtest.sh --duration 900 --delay 10 --warmup-seconds 60 --warmup-timeout 600 --api-port 18000 --fresh-volume
./scripts/loadtest/loadtest.sh --duration 900 --delay 300 --warmup-seconds 60 --warmup-timeout 600 --api-port 18000 --fresh-volume
```

The harness uses Compose project `sentinel-load`, supplies explicit test values with `--env-file /dev/null`, creates a new project-specific volume per run, and retains artifacts and previous volumes. No `.env*` file is needed. It seeds 5,000 private HTTP monitors for a dedicated user. The synthetic target `198.51.100.10:8080` is allowed by the existing SSRF policy for `198.51.100.0/24`; worker and target share that isolated network, and the worker also uses the default DB network. See [the procedure](../scripts/loadtest/README.md) for prerequisites and conditions. The runs above are already complete; do not run them again merely to reproduce this document.

Prior short validation (historical context, not a full-run substitute): `scripts/loadtest/results/20261007T032218Z/`, clean tested commit `5ef5fdbcd5e47c05fead4933cb5658e13a396222`, 120 seconds, 5,000 monitors, 6,920 healthy results, zero failures/unknown, zero sampled overdue, worker window median/peak 24,080,547 / 25,249,710 display-derived bytes. Its summary was also phase-filtered; no strict-window recalculation is claimed here. An earlier failed attempt at `scripts/loadtest/results/20261007T024129Z/` is invalid memory evidence (worker inspection failed and worker samples were absent); artifacts are retained.

The full-run evidence does not establish the original combined throughput/memory claim. CI, external target behavior, and profiling or attribution of limiting factors remain unverified.
