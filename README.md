# Sentinel

[![CI](https://github.com/EliottV17/sentinel-project/actions/workflows/ci.yml/badge.svg)](https://github.com/EliottV17/sentinel-project/actions/workflows/ci.yml)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

An asynchronous uptime monitoring and alerting engine designed as a polyglot monorepo. It couples a REST API built with **NestJS (TypeScript/Bun)** and **Prisma ORM**, a high-throughput polling worker written in **Go**, a **React** dashboard, and a shared **PostgreSQL 17** schema — no message broker anywhere in the data path.

```text
sentinel/
├── sentinel-api/      # TypeScript / NestJS + Bun — REST API, auth, monitor CRUD, history
├── sentinel-worker/   # Go — concurrent polling engine & checker registry
└── frontend/          # React 19 + Vite + TypeScript SPA — dashboard (Nginx-served)
```

## Architecture & Data Flow

```text
                 +--------------------------------------------------+
                 |  Browser — React SPA (Nginx :5173)               |
                 |  login · monitors dashboard · history / alerts   |
                 +-------------------------+------------------------+
                                           |  REST /api (JSON + JWT)
                                           v
                 +--------------------------------------------------+
                 |  sentinel-api  (NestJS, TypeScript / Bun)        |
                 |  auth (JWT/Argon2) · monitor CRUD · queries      |
                 +-------------------------+------------------------+
                                           |  Prisma ORM
                                           v
                 +--------------------------------------------------+
                 |  PostgreSQL 17  (shared schema)                  |
                 |  monitor ─1:N─ check_result  (every ping)        |
                 |  monitor ─1:N─ alert         (transitions only)  |
                 +-------------------------+------------------------+
                 ^                         |
                 |   2 s due-monitor scan   | pgx pool (MaxConns = 25)
                 |   (indexed, no MQ)       v
                 +-------------------------+------------------------+
                 |  sentinel-worker (Go) — concurrency = 10         |
                 |  checker registry (Strategy) · log/slog (JSON)   |
                 +-------------------------+------------------------+
                                           |
                                           |  HTTP checks (per monitor.frequency)
                                           v
                                    [ External targets ]
```

## Core Highlights

* **Strategy & Registry Pattern (Go):** Pluggable `Checker` implementations registered by type name (`sentinel-worker/internal/checker/registry.go`) — currently an HTTP checker (`http.go`). Adding a check type touches neither the polling loop nor the API.
* **State-Machine Alerting (transitions only):** Alerts fire exclusively on state transitions (`healthy → unhealthy` = "down", `unhealthy → healthy` = "recovery"), never on every failed ping. Every check is still persisted as a `check_result` row — full audit trail without notification floods.
* **Database-Driven Scheduling, Zero MQ:** No message broker. The worker's 2 s loop scans for due monitors with an indexed predicate (`state = 'Active'` AND `last_checked_at + frequency <= NOW()`) and runs them through a bounded semaphore (concurrency = 10). The database is both the source of truth and the scheduler.

## Quick Start (Docker Compose)

Clone the repository and spin up the full stack (PostgreSQL 17, NestJS API, Go worker, and the React frontend served by nginx):

```bash
git clone https://github.com/EliottV17/sentinel-project.git
cd sentinel-project

# Build and start all services
docker compose up -d --build
```

* **Frontend (React SPA):** http://localhost:5173
* **API:** http://localhost:8000
* **PostgreSQL:** `localhost:5432`
* **Worker logs:** `docker logs -f sentinel_worker` (structured JSON)

## Structured Logging & Observability

The Go worker emits structured **JSON** logs to `stdout` using the standard library's `log/slog` with a JSON handler (`sentinel-worker/cmd/worker/main.go`), giving machine-readable, pipeline-indexable output with near-zero overhead.

Example — a completed check (`msg: "check completed"` from `internal/worker/loop.go`):

```json
{
  "time": "2026-09-14T02:38:29.65770987Z",
  "level": "INFO",
  "msg": "check completed",
  "monitor_id": 4,
  "target": "https://github.com/",
  "state": "healthy",
  "status_code": 200,
  "latency_ms": 289.045
}
```

State transitions are logged as a separate event, e.g. `"msg": "state transition alert emitted"` with `alertType`, `old_state`, and `new_state`.

Filtering with `jq` (worker runs as container `sentinel_worker`):

```bash
# Follow the log stream live
docker logs -f sentinel_worker

# Errors and warnings only
docker logs sentinel_worker | jq 'select(.level == "ERROR" or .level == "WARN")'

# Slow checks only (latency > 500 ms)
docker logs sentinel_worker | jq 'select(.msg == "check completed" and .latency_ms > 500)'

# Top 10 slowest checks
docker logs sentinel_worker | jq -s '[.[] | select(.msg == "check completed")] | sort_by(.latency_ms) | reverse | .[:10]'

# One readable line per completed check
docker logs sentinel_worker | jq -r 'select(.msg == "check completed") | "\(.time) monitor=\(.monitor_id) state=\(.state) status=\(.status_code) latency=\(.latency_ms)ms"'

# Full check history for a single monitor
docker logs sentinel_worker | jq -c 'select(.monitor_id == 42)'
```

## Load Testing & Benchmarks

The worker and pool were validated under saturation using [`sentinel-api/seed.py`](./sentinel-api/seed.py), which bulk-inserts mock monitors directly into the database via asyncpg (bypassing the API):

```bash
# Requires PostgreSQL running (docker compose up -d db)
cd sentinel-api
uv run python seed.py              # inserts 5,000 monitors (frequency 60 s, HTTP checker)
```

Results of the run:

* **5,000 monitors concurrently `Active`**, each with `frequency = 60 s` and `check_type = http` (target `https://httpbin.org/status/200`).
* **17,000+ rows persisted in `check_result`** — every ping recorded as an immutable audit row while only genuine state transitions emitted alerts.
* **Connection saturation mitigated via `pgxpool.MaxConns = 25`** (`sentinel-worker/internal/db/postgres.go`): the cap keeps PostgreSQL from being flooded as the 2 s loop fans out across thousands of due monitors, while the 10-worker semaphore bounds in-flight checks.

## Sub-Packages Documentation

For detailed per-service docs — local development, testing requirements, and internal architecture:

* [Sentinel API (NestJS / Bun)](./sentinel-api/README.md)
* [Sentinel Worker (Go)](./sentinel-worker/README.md)
* [Frontend (React SPA)](./frontend/README.md)