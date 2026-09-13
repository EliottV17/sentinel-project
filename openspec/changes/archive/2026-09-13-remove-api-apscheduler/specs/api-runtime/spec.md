# api-runtime Specification

## Purpose

Define the runtime contract of the `sentinel-api` service after the
`remove-api-apscheduler` change: the API is a **pure REST service** with no
in-process monitoring engine. All monitor checking is performed by the Go
worker (`sentinel-worker`), which is the official — and mandatory — polling
engine. This spec pins WHAT must be true after the change (absence of the
Python scheduler, absence of the `apscheduler` dependency, preserved checker
extension point, accurate documentation) without prescribing HOW to implement
it. It does NOT govern Go worker logic, frontend behaviour, or the database
schema, all of which stay unchanged.

## Requirements

### Requirement: REQ-APIRUN-001 — No in-process checking engine

The `sentinel-api` application MUST NOT contain any in-process monitor
checking engine. The module `app.core.scheduler` (SEMAPHORE,
`_check_and_persist`, `check_all_monitors`, `AsyncIOScheduler`, lifespan
startup) SHALL be deleted outright, and no equivalent Python scheduler code
MUST remain anywhere in the API package.

#### Scenario: Scheduler module absent

- GIVEN the `sentinel-api` codebase at any commit after this change
- WHEN `importlib.util.find_spec("app.core.scheduler")` is executed in the API environment
- THEN it returns `None` (the module does not exist)

#### Scenario: No scheduler resurrection

- GIVEN the API codebase
- WHEN the repository is searched for `AsyncIOScheduler`, `BackgroundScheduler`, or `check_all_monitors` under `sentinel-api/app/`
- THEN there are no matches (the engine left no dead code behind)

### Requirement: REQ-APIRUN-002 — Default (no-op) application lifespan

`sentinel-api/app/main.py` MUST construct the FastAPI application without a
custom lifespan: the `lifespan` import and the `FastAPI(lifespan=...)`
argument SHALL be removed, so the app starts and shuts down via FastAPI's
default no-op lifespan with no scheduler side effects.

#### Scenario: App starts without scheduler startup

- GIVEN the edited `app/main.py`
- WHEN the module is inspected (or the app is constructed under test)
- THEN no `lifespan=` keyword argument is passed to `FastAPI(...)`, no import of `app.core.scheduler` or `lifespan` from it exists, and no scheduler task is started at startup

#### Scenario: Dev server keeps working

- GIVEN the change is applied
- WHEN `cd sentinel-api && uv run uvicorn app.main:app --reload` is started
- THEN the server boots cleanly with the default lifespan (no startup hook runs a check cycle)

### Requirement: REQ-APIRUN-003 — apscheduler dependency removed

`apscheduler` MUST NOT be a dependency of `sentinel-api`. It SHALL be absent
from `pyproject.toml` and from the resolved `uv.lock`, and SHALL not be
importable in the API environment.

#### Scenario: Dependency absent from manifests

- GIVEN the updated `sentinel-api/pyproject.toml` and `uv.lock`
- WHEN both files are searched for `apscheduler`
- THEN there are no occurrences of the package as a dependency

#### Scenario: Package not importable in the API venv

- GIVEN the API environment after `uv sync --group dev`
- WHEN `importlib.util.find_spec("apscheduler")` is executed in that environment
- THEN it returns `None`

### Requirement: REQ-APIRUN-004 — Checker extension point preserved

The `app/core/checkers/` package (`base.py`, `registry.py`,
`http_checker.py`) MUST be preserved untouched: `BaseChecker`, `@register`,
and `get_checker` remain available as the API-side checker extension point,
and the `http_checker` import in `app/main.py` SHALL be retained.

#### Scenario: Checker registry still functional

- GIVEN the post-change API codebase
- WHEN `get_checker` is called with a registered check type (e.g. the `http` checker imported by `main.py`)
- THEN it resolves the registered checker class (the extension point is not broken by the scheduler removal)

#### Scenario: Registry import retained

- GIVEN `app/main.py` after the change
- WHEN its imports are inspected
- THEN the `app.core.checkers.http_checker` import is still present (checker modules register on import)

### Requirement: REQ-APIRUN-005 — REST-only invariant test

The API test suite MUST include a test (suggested path
`sentinel-api/app/tests/test_rest_only.py`, exact assertion shape pinned in
plan) that fails if any REST-only invariant from REQ-APIRUN-001 /
REQ-APIRUN-003 is violated. Per the strict-TDD policy, this test is written
first and confirmed RED against the pre-change code, then green after the
deletion.

#### Scenario: Invariant test red before, green after

- GIVEN the pre-change codebase
- WHEN the REST-only test runs
- THEN it fails (RED) because `app.core.scheduler` and `apscheduler` still exist
- GIVEN the post-change codebase
- WHEN the same test runs
- THEN it passes (GREEN) with the absence assertions satisfied

#### Scenario: Full suite stays green

- GIVEN the post-change codebase
- WHEN `cd sentinel-api && uv run pytest` runs
- THEN all existing and new tests pass (existing tests use `ASGITransport`, which never executes FastAPI lifespan events, and none import `app.core.scheduler`)

### Requirement: REQ-APIRUN-006 — Documentation states worker-only checking

Every live doc and code comment that currently claims the API runs a
scheduler MUST be updated so that the repository no longer asserts dual-engine
operation. Specifically: the root `README.md`, `sentinel-api/README.md`,
`sentinel-worker/README.md`, `AGENTS.md`, `openspec/config.yaml` (APScheduler
context lines and the `risks_known` dual-engine duplicate-row line, re-worded
as resolved rather than blindly deleted), the
`frontend/src/features/monitors/useMonitors.ts` comment (10 s poll re-justified
from UI freshness, not an engine tick), and the
`sentinel-worker/internal/worker/loop.go` header comment. Docs MUST state
that: the Go worker is the official polling engine, it is the only engine
honoring `monitor.frequency`, it is **required** (if it is not running, no
monitor is ever checked and no alerts fire), and the API is REST-only.
Archived openspec changes (`openspec/changes/archive/**`) MUST NOT be edited.

#### Scenario: No live scheduler claims remain

- GIVEN the post-change repository
- WHEN a repo-wide search for `scheduler|lifespan|apscheduler|dual-engine|double-check` runs
- THEN matches occur only in archived openspec changes, non-claiming references (e.g. this spec and its change artifacts), and updated wording that no longer claims the API runs a scheduler

#### Scenario: Worker-mandatory language present

- GIVEN the post-change docs (root and component READMEs, AGENTS.md, `openspec/config.yaml` context)
- WHEN they are read
- THEN they state the Go worker is required for checking, honors `monitor.frequency`, and that without it monitors are never checked

#### Scenario: Frontend comment re-justified

- GIVEN `frontend/src/features/monitors/useMonitors.ts` after the change
- WHEN its 10 s poll comment is read
- THEN it justifies the cadence from UI freshness only, with no reference to an API scheduler tick, and no frontend code path is changed

### Requirement: REQ-APIRUN-007 — Schema and worker behaviour untouched

This change MUST NOT alter the database schema, SQLModel models, Alembic
migrations, or the Go worker's logic. No Alembic revision is introduced; the
only worker-side edit is a comment in `internal/worker/loop.go`.

#### Scenario: No migration and no Go logic diff

- GIVEN the change diff
- WHEN it is reviewed
- THEN it contains no `alembic/revision` files, no model changes, and the only `sentinel-worker/` Go diff is the header comment (verified by `go vet ./...` and `go build ./cmd/worker/` remaining green)

#### Scenario: Check cadence now frequency-driven only

- GIVEN the post-change system with the worker running and the API deployed
- WHEN monitors with `frequency > 10` seconds are polled
- THEN their check cadence is governed solely by `monitor.frequency` via the worker's due-ness poll (the former API 10 s all-monitors lattice no longer exists)

#### Scenario: Worker-down degraded state is documented, not engineered

- GIVEN the Go worker is not running
- WHEN the system is observed
- THEN no monitor is checked and no alert fires; this behaviour is stated as mandatory-worker documentation (REQ-APIRUN-006) and no code guard is added in this change
