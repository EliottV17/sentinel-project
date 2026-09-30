# Sentinel Worker

Independent Go poller for the Sentinel monitoring engine. It shares the same PostgreSQL schema as `sentinel-api` and mirrors the Python scheduler's logic — no message queue or service coupling required.

```text
sentinel/
├── sentinel-api/      # Python/FastAPI (API + in-process scheduler)
└── sentinel-worker/   # This package — Go poller
```

## How It Works

Every 2 seconds the worker loop queries `monitor` for rows where `state = 'Active'` and `last_checked_at + frequency` has passed, then for each due monitor it:

1. Runs the registered checker (`check_type`) against `monitor.target`.
2. Inserts a `check_result` row.
3. Updates `monitor.last_state`, `last_checked_at`, and `consecutive_failures`.
4. Inserts an `alert` row **only on state transitions** (`healthy → unhealthy` = "down", `unhealthy → healthy` = "recovery").

This is the same state machine as the API's APScheduler. Running both simultaneously double-checks every monitor — there is no locking/claiming.

## Project Layout

```text
cmd/worker/main.go        # entrypoint: config, pgx pool, checker registration, loop
internal/checker/         # Checker interface, registry, and http checker
internal/config/          # DATABASE_URL from env (defaults to local sentinel_db)
internal/db/              # pgx connection pool
internal/models/          # Monitor struct mirroring the DB schema
internal/worker/          # poll loop + check/persist logic
```

## Build and Run

From `sentinel-worker/`:

```bash
# Build binary
go build ./cmd/worker/

# Run with custom DB URL (or omit to use default sentinel_db)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/sentinel_db go run ./cmd/worker/
```

Without `DATABASE_URL`, it defaults to `postgres://postgres:postgres@127.0.0.1:5432/sentinel_db`. Concurrency is set to 10 workers.

## Docker

From the repository root, build and run the full stack:

```bash
docker compose up -d --build
```

Or build the worker standalone from the repo root:

```bash
docker build -t sentinel-worker ./sentinel-worker
```

## Gotchas

- **Schema dependency:** Requires the database schema created by `sentinel-api` migrations (`alembic upgrade head`) — the worker does not create or migrate tables.
