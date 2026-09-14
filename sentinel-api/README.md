# Sentinel API

Asynchronous monitoring and alerting engine built with **FastAPI** and **PostgreSQL**. Periodically checks external targets, detects state transitions, and records a full audit trail — designed for extensibility via a pluggable checker architecture.

## Tech Stack

- **FastAPI** — fully async REST API
- **SQLModel + Alembic** — ORM and async migrations
- **PostgreSQL 17** — persistent storage with JSON columns for per-checker configuration
- **sentinel-worker (Go)** — official polling engine: the only component that checks monitors and the only one honoring `monitor.frequency` (required — without it, no monitor is ever checked and no alerts fire)
- **Docker Compose** — local infrastructure (Postgres, API, worker)
- **uv** — package and environment management
- **Ruff & Pyright** — linting, formatting, and type checking

## Architecture

### State machine for alerting

Each check produces a `CheckResult` persisted in the `check_result` table. The worker compares `monitor.last_state` against the new result — alerts fire **only on transitions** (`healthy → unhealthy` or vice versa), not on every failed ping.

```text
healthy   ──(check fails)──► unhealthy  →  INSERT alert (type: "down")
unhealthy ──(check passes)─► healthy    →  INSERT alert (type: "recovery")
```

### Data model

```text
monitor ──1:N──► check_result    (every ping, full audit trail)
monitor ──1:N──► alert           (state transitions only)
user    ──1:N──► monitor
```

| Table | Purpose |
|---|---|
| `users` | JWT-authenticated accounts |
| `monitor` | Target configuration (`check_type`, `check_config` as JSON, frequency, ownership) |
| `check_result` | Immutable log of every check (state, latency, status code, error) |
| `alert` | State transition events (`down` / `recovery`) |

### Go worker

The companion [sentinel-worker](../sentinel-worker/README.md) is an independent Go poller against the same database and schema. It is the sole polling engine and is required — the API performs no checks itself.

## Setup (local development)

### 1. Clone and install dependencies

```bash
git clone https://github.com/EliottV17/sentinel-project.git
cd sentinel-project/sentinel-api
uv sync --group dev
```

### 2. Environment

Create a `.env` file inside `sentinel-api/`:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_db
SECRET_KEY=your-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
CORS_ORIGINS=  # empty disables cross-origin access; SPA origins here (comma-separated)
```

### 3. Start infrastructure and run migrations

The `docker-compose.yml` lives at the **repo root**. Start PostgreSQL from there, then apply migrations:

```bash
# Start Postgres from repo root
docker compose up -d db

# Run migrations from sentinel-api/
uv run alembic upgrade head
```

### 4. Run the server

```bash
uv run uvicorn app.main:app --reload
```

The API is REST-only. Monitoring requires the Go worker (`sentinel-worker`) — without it, no monitor is ever checked.

## Docker (full stack)

From the repo root, build and start the whole stack (Postgres + API + worker):

```bash
docker compose up -d --build
```

- API exposed on `http://localhost:8000`, runs `alembic upgrade head` automatically on startup.
- Postgres only listens on localhost. `SECRET_KEY` is read from the host env (defaults to `change-me`).
- The Go worker service is built too — see its [README](../sentinel-worker/README.md).

## Commands

```bash
uv run ruff check .                     # lint
uv run ruff format .                    # format
uv run pyright                          # type-check
uv run pytest                           # run tests (requires sentinel_tests_db)
uv run pytest app/tests/api/test_monitors.py::test_create_monitor   # single test
```

### Tests

Tests require a real PostgreSQL database (`sentinel_tests_db` must exist on the same server). Tables are created and dropped per test function via `SQLModel.metadata`. Authentication flows use the async test client from `conftest.py`.

## Project structure

```text
app/
├── api/v1/endpoints/   # REST route handlers (auth, users, monitors; history/alerts live under /monitors)
├── api/deps.py          # FastAPI dependency injection (get_db, get_current_user)
├── core/
│   ├── config.py        # pydantic-settings from .env
│   └── security.py      # Argon2 password hashing + JWT
├── db/database.py       # asyncpg engine and session factory
├── models/              # SQLModel table definitions (User, Monitor, CheckResult, Alert)
├── schemas/             # Pydantic request/response models
├── services/            # Business logic layer (UserService, MonitorService, AuthService)
