# Sentinel Worker

Independent Go poller for the Sentinel monitoring engine. It shares the same PostgreSQL schema as `sentinel-api` and is the sole checking engine: the only component that runs checks and honors `monitor.frequency` — no message queue or service coupling required.

```text
sentinel/
├── sentinel-api/      # TypeScript / NestJS + Bun (REST API, Prisma ORM)
├── frontend/          # React + Vite SPA (login & monitors dashboard)
└── sentinel-worker/   # This package — Go poller
```

## How It Works

Every 2 seconds the worker loop queries `monitor` for rows where `state = 'Active'` and `last_checked_at + frequency` has passed, then for each due monitor it:

1. Runs the registered checker (`check_type`) against `monitor.target`.
2. Runs the network probe before opening a database transaction.
3. Atomically inserts the raw probe state in `check_result` and updates `monitor.last_state`, `last_checked_at`, and `consecutive_failures` in one `pgx.Tx`.
4. Inserts an `alert` row only for confirmed thresholded transitions (`healthy → unhealthy` = "down", `unhealthy → healthy` = "recovery").

This is the only checking engine; the API performs no checks. Alerts fire only on state transitions.

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
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/sentinel_db?sslmode=disable go run ./cmd/worker/
```

Without `DATABASE_URL`, it defaults to `postgres://postgres:postgres@127.0.0.1:5432/sentinel_db`. `WORKER_CONCURRENCY` controls concurrent monitor checks (default `100`, maximum `500`); `WORKER_FAILURE_THRESHOLD` controls consecutive failures before a down alert (default `3`, maximum `100`). Check results, monitor state, and any transition alert are persisted atomically in one `pgx.Tx`. Transient failures below the threshold do not alert; a confirmed recovery emits one recovery alert.

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

- **Schema dependency:** Requires the database schema created by `sentinel-api` (`bunx prisma db push`) — the worker does not create or migrate tables.
