# AGENTS.md

## Monorepo layout

```
sentinel/                    # Git root
├── sentinel-api/            # Python/FastAPI — full app, primary
└── sentinel-worker/         # Go — independent poller writing to the same DB
```

No root-level tooling. All Python commands run inside `sentinel-api/`.

## Commands

From `sentinel-api/`:

```bash
uv sync --group dev          # install deps
docker compose up -d         # start PostgreSQL 17 (compose file is at repo root, not here)
alembic upgrade head         # run migrations (requires .env with DATABASE_URL)
uv run uvicorn app.main:app --reload   # dev server (APScheduler starts in-process)

uv run ruff check .          # lint
uv run ruff format .         # format
uv run pyright               # type-check (installed via dev group)

uv run pytest                # all tests
uv run pytest app/tests/api/test_monitors.py::test_create_monitor  # single test
```

From `sentinel-worker/`:

```bash
go build ./cmd/worker/       # build
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/sentinel_db go run ./cmd/worker/
```

## Environment

Copy `.env.example` or create `.env` inside `sentinel-api/`:

```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_db
SECRET_KEY=...
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

Alembic's `migrations/env.py` imports `app.core.config.Settings`, which reads `.env` relative to CWD — so `alembic` and `uv run` must run from `sentinel-api/`.

## Test prerequisites

- `docker compose up` only creates `sentinel_db`. Tests need a separate `sentinel_tests_db` database — create it manually.
- The test DB URL is **hardcoded** in `conftest.py:13` (`postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_tests_db`).
- Tables are created/dropped per test function via `SQLModel.metadata.create_all`/`drop_all`. No migrations run for tests.
- `pytest` config: `asyncio_mode = "auto"`, `testpaths = ["app/tests"]`.

## Architecture

- **Checker registry**: New check types implement `BaseChecker` and self-register with `@register`; the scheduler discovers them via `get_checker(check_type)`. No API/scheduler changes needed. New checker modules must be imported somewhere (e.g. `main.py` imports `app.core.checkers.http_checker`) or they never register.
- **State machine**: Alerts fire **only on transitions** (healthy→unhealthy = "down", unhealthy→healthy = "recovery"). Every check writes a `check_result` row; `alert` rows only on state changes.
- **Two independent engines, one schema**: the API's APScheduler checks all `state = "Active"` monitors every 10 s in-process; the Go worker polls every 2 s for monitors that are *due* by `frequency` (seconds). Both write `check_result` + `alert` and update `monitor.last_state`. Running both simultaneously double-checks every monitor — there's no locking/claiming.
- **All DB access is async** (asyncpg, async SQLAlchemy sessions, async Alembic).

## sentinel-worker (Go)

Functional (not a stub). `cmd/worker/main.go` loads config, connects via pgx pool, registers the http checker, and runs the loop in `internal/worker/loop.go`: every 2 s it fetches Active monitors whose `last_checked_at + frequency` has passed, runs the checker, inserts `check_result`, updates `monitor`, and inserts `alert` on transition. Mirrors the Python scheduler's logic.

Gotchas:
- `Dockerfile` is a multi-stage build (`golang:1.25-alpine` → `alpine:3.20`) with `CGO_ENABLED=0`.
