# AGENTS.md

## Setup & Run

```bash
uv sync --group dev          # install deps (Python >=3.12)
docker-compose up -d          # start PostgreSQL 17
alembic upgrade head          # run migrations (async engine)
uv run uvicorn app.main:app --reload  # dev server
```

## Commands

```bash
uv run ruff check .           # lint (selects E, F, B, I)
uv run ruff format .          # format (line-length=88)
pyright                       # type-check (uses .venv via pyrightconfig.json)
uv run pytest                 # run all tests (asyncio_mode=auto)
uv run pytest app/tests/api/test_auth.py::test_login_success  # single test
```

## Database

- PostgreSQL 17 via Docker (port 5432, user/postgres/pass: `postgres`, db: `sentinel_db`)
- Driver: `asyncpg` (async only — no sync engine)
- ORM: SQLModel with `SQLModel.metadata` as the Alembic target
- All imports must be loaded before `alembic revision --autogenerate` so SQLModel discovers table models
- Migrations live in `migrations/versions/`, env uses `app.core.config.settings.DATABASE_URL`

## Testing

- **Tests require a real PostgreSQL database** — the test database `sentinel_tests_db` must exist on the same server
- Test DB URL is hardcoded in `app/tests/conftest.py` (`postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sentinel_tests_db`)
- Each test function creates/drops all tables via `SQLModel.metadata.create_all` / `drop_all` fixtures
- Fixtures use `app.dependency_overrides` to swap the DB session — no test client factory, reuse `override_session_db` (an `AsyncClient`)
- Login returns `OAuth2PasswordRequestForm` style (`data=` with `username`/`password`), not JSON

## Architecture

```
app/
├── api/v1/endpoints/   # route handlers (thin, delegates to services)
├── api/deps.py          # Depends helpers (get_db, get_current_user, etc.)
├── core/                # config (pydantic-settings), security (JWT+Argon2), scheduler (APScheduler)
├── db/database.py       # async engine + session factory
├── models/              # SQLModel table definitions
├── schemas/             # Pydantic request/response schemas
├── services/            # business logic (UserService, MonitorService, AuthService)
└── main.py              # FastAPI app, lifespan, /api/v1 router
```

- Lifespan uses `@asynccontextmanager` (not `on_event`), starts APScheduler on startup
- `check_all_monitors()` runs every 10s, currently only prints — actual condition checking is not yet implemented
- Auth: OAuth2PasswordBearer at `/api/v1/auth/login`, JWT `sub` = user email
- Services are instantiated per-request with the DB session (no DI container)

## Conventions

- Python 3.12+ syntax (`str | None`, `list[X]`, no `Optional`)
- Models use `TYPE_CHECKING` imports for forward references in relationships
- `datetime` stored as naive UTC (`.replace(tzinfo=None)`)
- `uv` is the only package manager — no pip, no poetry