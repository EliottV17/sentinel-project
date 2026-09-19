# AGENTS.md

## Monorepo layout

```
sentinel/                    # Git root
├── sentinel-api/            # TypeScript/NestJS — REST API, primary
└── sentinel-worker/         # Go — independent poller writing to the same DB
```

No root-level tooling. All API commands run inside `sentinel-api/`.

## Commands

From `sentinel-api/`:

```bash
bun install                  # install deps
docker compose up -d         # start PostgreSQL 17 (compose file is at repo root, not here)
bunx prisma generate         # generate Prisma client
bun run start:dev            # dev server (REST API; checking runs in the Go worker)

bun run build                # build TypeScript
bun run test                 # unit tests (Jest)
bun run test:e2e             # end-to-end tests (Supertest + Jest)
```

From `sentinel-worker/`:

```bash
go build ./cmd/worker/       # build
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/sentinel_db go run ./cmd/worker/
```

## Environment

Copy `.env.example` or create `.env` inside `sentinel-api/`:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/sentinel_db
SECRET_KEY=...
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
CORS_ORIGINS=http://localhost:5173
PORT=8000
```

## Test prerequisites

- `docker compose up` only creates `sentinel_db`. Tests need a separate `sentinel_tests_db` database — create it manually.
- The test DB URL is **hardcoded** in `conftest.py:13` (`postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_tests_db`).
- Tables are created/dropped per test function via `SQLModel.metadata.create_all`/`drop_all`. No migrations run for tests.
- `pytest` config: `asyncio_mode = "auto"`, `testpaths = ["app/tests"]`.

## Architecture

- **Checker registry (Go worker)**: The strategy + registry pattern for checkers lives in `sentinel-worker/internal/checker/` — a `Checker` interface (`checker.go`), an HTTP implementation (`http.go`), and a type-name registry (`registry.go` with `Register`/`Get`) wired up in `cmd/worker/main.go`. The old `app/core/checkers` Python module was deleted; the API has no checker registry, so new check types are added in Go only.
- **State machine**: Alerts fire **only on transitions** (healthy→unhealthy = "down", unhealthy→healthy = "recovery"). Every check writes a `check_result` row; `alert` rows only on state changes.
- **Single engine, one schema**: since `remove-api-apscheduler` the Go worker is the sole polling engine — it polls every 2 s for monitors that are *due* by `frequency` (seconds), checks all `state = "Active"` monitors, and is the only writer of `check_result` + `alert` and `monitor.last_state`. The API is REST-only. If the worker is not running, nothing is checked.
- **All DB access is async** (asyncpg, async SQLAlchemy sessions, async Alembic).

## sentinel-worker (Go)

Functional (not a stub). `cmd/worker/main.go` loads config, connects via pgx pool, registers the http checker, and runs the loop in `internal/worker/loop.go`: every 2 s it fetches Active monitors whose `last_checked_at + frequency` has passed, runs the checker, inserts `check_result`, updates `monitor`, and inserts `alert` on transition. It is the sole polling engine and is required — the API performs no checks.

Gotchas:
- `Dockerfile` is a multi-stage build (`golang:1.25-alpine` → `alpine:3.20`) with `CGO_ENABLED=0`.
