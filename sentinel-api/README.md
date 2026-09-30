# Sentinel API

Asynchronous monitoring and alerting engine built with **FastAPI** and **PostgreSQL**. Periodically checks external targets, detects state transitions, and records a full audit trail — designed for extensibility via a pluggable checker architecture.

## Tech Stack

- **FastAPI** — fully async REST API with lifespan-managed background scheduler
- **SQLModel + Alembic** — ORM and async migrations
- **PostgreSQL 17** — persistent storage with JSONB for per-checker configuration
- **APScheduler** — interval-based job execution within the FastAPI process
- **Docker Compose** — local infrastructure (Postgres, API, worker)
- **uv** — package and environment management
- **Ruff & Pyright** — static analysis, linting, formatting, and strict type checking

## Architecture

### Strategy + Registry pattern for pluggable checkers

The monitoring engine is abstracted behind a `BaseChecker` interface. Each checker type (HTTP, scraping, ping, etc.) implements `async check(monitor) -> CheckResult` and self-registers via the `@register` decorator. Adding a new check type requires no changes to the scheduler or API layer.

```text
app/core/checkers/
├── base.py          # BaseChecker ABC + CheckResult dataclass
├── registry.py      # @register decorator + get_checker() factory
└── http_checker.py  # HTTP status/latency checks
```

### State machine for alerting

Each check produces a `CheckResult` persisted in the `check_result` table. The scheduler compares `monitor.last_state` against the new result — alerts fire **only on transitions** (`healthy → unhealthy` or vice versa), not on every failed ping.

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
| `monitor` | Target configuration (`check_type`, `check_config` as JSONB, frequency, ownership) |
| `check_result` | Immutable log of every check (state, latency, status code, error) |
| `alert` | State transition events (`down` / `recovery`) |

### Go worker

The companion [sentinel-worker](../sentinel-worker/README.md) is an independent Go poller against the same database and schema. It mirrors this scheduler's logic; running both simultaneously double-checks every monitor — there is no locking/claiming.

## Setup (local development)

### 1. Clone and install dependencies

```bash
git clone https://github.com/EliottV17/sentinel-project.git
cd sentinel/sentinel-api
uv sync --group dev
```

### 2. Environment

Create a `.env` file inside `sentinel-api/`:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_db
SECRET_KEY=your-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
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

The scheduler (APScheduler) starts automatically inside the FastAPI lifespan — no separate worker process needed.

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
uv run pyright                          # strict type-check
uv run pytest                           # run tests (requires sentinel_tests_db)
uv run pytest app/tests/...::test_name  # single test
```

### Tests

Tests require a real PostgreSQL database (`sentinel_tests_db` must exist on the same server). Tables are created and dropped per test function via `SQLModel.metadata`. Authentication flows use the async test client from `conftest.py`.

## Project structure

```text
app/
├── api/v1/endpoints/   # REST route handlers (users, auth, monitors, history, alerts)
├── api/deps.py          # FastAPI dependency injection (get_db, get_current_user)
├── core/
│   ├── checkers/        # BaseChecker ABC, registry, and concrete implementations
│   ├── config.py        # pydantic-settings from .env
│   ├── scheduler.py     # APScheduler lifespan + check loop with state detection
│   └── security.py      # Argon2 password hashing + JWT
├── db/database.py       # asyncpg engine and session factory
├── models/              # SQLModel table definitions (User, Monitor, CheckResult, Alert)
├── schemas/             # Pydantic request/response models
├── services/            # Business logic layer (UserService, MonitorService, AuthService)
└── main.py              # FastAPI app factory
```
