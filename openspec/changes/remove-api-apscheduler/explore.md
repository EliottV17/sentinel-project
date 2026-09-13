# Explore — `remove-api-apscheduler`

Date: explore phase, SDD auto mode. Store: openspec.
Linkage: consumed in full by `proposal.md` (same change, status success); findings confirmed.

Phase status: explore done — status success.
Scope: full blast radius of disabling/removing the in-process APScheduler engine from
`sentinel-api` so the API becomes REST-only and the Go worker is the sole polling engine.
Read-only exploration; nothing edited outside `openspec/changes/remove-api-apscheduler/`.

## 0. Method

CodeGraph (`explore` on lifespan / check_all_monitors / _check_and_persist / SEMAPHORE /
get_checker) first, then targeted greps over `sentinel-api`, docs, frontend, and openspec.
All line numbers below are from the current on-disk files.

## 1. `sentinel-api/app/core/scheduler.py` — inventory (103 lines)

| Symbol | Lines | Purpose | Python callers | Verdict |
|---|---|---|---|---|
| logger setup | 18–23 | stdout logging for state transitions | none | delete |
| `SEMAPHORE` | 25 | `asyncio.Semaphore(10)` concurrency cap | only `_check_and_persist` | delete |
| `_check_and_persist` | 28–72 | run checker, write `check_result`, update monitor, insert `alert` on transition | only `check_all_monitors` | delete |
| `check_all_monitors` | 75–85 | select all `state == "Active"` monitors, gather checks | only `lifespan` (scheduler.add_job) | delete |
| `scheduler = AsyncIOScheduler()` | 88 | APScheduler instance | only `lifespan` | delete |
| `lifespan` | 91–103 | registers 10 s interval job, starts/stops scheduler | only `app/main.py` | delete; main.py drops the import and passes no lifespan |

**Grep + CodeGraph confirm nothing outside this file imports or references
`check_all_monitors`, `_check_and_persist`, `SEMAPHORE`, or `app.core.scheduler`.**
Clean outright deletion of the whole module is safe and preferred over leaving dead code.

## 2. `sentinel-api/app/main.py` — the only wiring point

- L7: `from app.core.scheduler import lifespan`
- L9: `app = FastAPI(title="Sentinel API", lifespan=lifespan)`
- L11: `from app.core.checkers import http_checker  # noqa: F401`

Change: drop the import and the `lifespan=` argument (FastAPI's default no-op lifespan
applies). The `http_checker` import is **not** part of the scheduler — it populates the
checker registry. After this change no Python code calls `get_checker`, but the checker
package is a documented extension point (openspec/config.yaml, AGENTS.md) and its removal
would be a separate, larger decision. Recommendation: **keep `app/core/checkers/`**
(`base.py`, `registry.py`, `http_checker.py`) and keep the `http_checker` import in
`main.py`; deleting the scheduler must NOT delete the registry. Flag "Python checkers are
now uncalled from production code" as a known consequence; if the project later wants them
gone, that is its own change.

## 3. Dependency: `apscheduler>=3.11.2`

- `sentinel-api/pyproject.toml` L21 — only dependency declaration; remove it.
- `sentinel-api/uv.lock`: `apscheduler` appears only as the locked package itself and as a
  dependency of the `sentinel-api` package (L62, 68, 70, 1209, 1236). No other consumer.
  After removing from `pyproject.toml`, run `uv lock` / `uv sync` to update the lockfile.
- Grep over `app/` and `app/tests/`: `apscheduler` is imported **only** in
  `app/core/scheduler.py:8`. Safe to remove the dependency entirely; also shrinks
  pip-audit surface in CI.

## 4. Tests — `sentinel-api/app/tests/`

- `conftest.py` imports `app.main` (which imports lifespan) and builds
  `transport = ASGITransport(app=app)`. **httpx `ASGITransport` does not run FastAPI
  lifespan events**, and there is no `LifespanManager`/startup fixture — so no test depends
  on the scheduler running.
- No file in `app/tests/` imports `app.core.scheduler` or asserts startup semantics
  (grep across `sentinel-api` for `scheduler|lifespan|apscheduler` matched only
  `main.py`, `scheduler.py`, README, pyproject, uv.lock).
- Existing tests are therefore unaffected; they exercise REST endpoints against the
  overridden session dependency only.
- **Strict-TDD note:** the removal deletes behaviour, so the RED test must pin the *new*
  invariant. Suggested test (write first, confirm it fails on current code):
  `app/tests/test_rest_only.py` asserting (a) `importlib.util.find_spec("app.core.scheduler") is None`
  and (b) the module-level import `apscheduler` is absent / `app` is constructible with the
  default lifespan (e.g. `"lifespan"` not in `FastAPI(...)` call semantics — simplest is
  asserting `app.router.lifespan_context is not None` won't work; instead assert the
  `apscheduler` package is no longer importable in the API venv or that
  `app.core.scheduler` cannot be found). Confirm the exact assertion shape in plan phase.
- `apscheduler` is not a dev/test dependency anywhere; its removal does not break the
  pytest toolchain.

## 5. Docs that state the API runs a scheduler (update required)

| File | Lines | Claim |
|---|---|---|
| `sentinel-api/README.md` | 7, 10, 19, 30, 54, 95, 132 | "lifespan-managed background scheduler", "APScheduler interval-based job execution", scheduler auto-starts in FastAPI lifespan, tree lists `scheduler.py` |
| root `README.md` | 14, 46 | "REST API, auth & in-process scheduler"; "without touching the core scheduler" |
| `sentinel-worker/README.md` | 3, 7, 20 | "mirrors the Python scheduler's logic"; tree: "API + in-process scheduler"; "same state machine as the API's APScheduler. Running both simultaneously double-checks" |
| `AGENTS.md` | 21, 60, 62 | "dev server (APScheduler starts in-process)"; checker-registry note phrased around the scheduler; "Two independent engines" paragraph |
| `openspec/config.yaml` | 16, 30, 34–35, 152 | context says "APScheduler in-process checker", "scheduler resolves via get_checker", "running API scheduler and Go worker concurrently double-checks"; `risks_known` lists the dual-engine duplicate-row risk |
| `sentinel-worker/internal/worker/loop.go` | 1–2 (comment) | "persists the results alongside the API scheduler" — code comment, small touch, same commit as docs |
| `frontend/src/features/monitors/useMonitors.ts` | 5–7 | see §6 |

**Archived changes** (`openspec/changes/archive/2026-09-12-web-frontend/{explore,design,proposal}.md`):
multiple references to the API engine and the 10 s tick. **Historical record — do NOT
rewrite.** The proposal should only note that archive artifacts stay untouched.

`openspec/config.yaml` is also stale beyond this change (it claims `frontend/` is empty;
a full React frontend now exists). Updating the APScheduler sentences is in scope for this
change; the stale frontend note should be flagged but may be a separate housekeeping edit.

## 6. Frontend coupling — actual data flow

`frontend/src/features/monitors/useMonitors.ts` uses TanStack Query:
`useQuery({ queryKey: ["monitors"], queryFn: fetchMonitors, refetchInterval: 10_000 })`.
`fetchMonitors` calls the REST endpoint (`GET /api/v1/monitors/`, see
`src/app/api/endpoints.ts`). The frontend **polls REST only** and never assumes the API
runs a checker engine — the DB rows it reads are written by whichever engine is active
(after this change: exclusively the Go worker). The only coupling is the comment on
L5–7 ("aligning with the in-process APScheduler engine tick"). Action for the proposal:
update the comment to justify the 10 s cadence independently (e.g. UI freshness vs. the
Go worker's `frequency`-honoring due-ness poll); no behavioural frontend change required.

## 7. Other references checked and found clean

- `.github/workflows/ci.yml`: no scheduler/apscheduler references (repo-wide grep
  excluding `sentinel-api` matched none). CI keeps running ruff/format/pyright/pytest;
  pip-audit simply loses one auditable dependency.
- `app/api/v1/endpoints/*`, `app/services/*`, `app/api/deps.py`: no checker or scheduler
  usage (CodeGraph: `get_checker` has exactly 2 callers, both in `scheduler.py`).
- No Alembic migration or schema change is involved — the monitor/check_result/alert
  tables are untouched; the Go worker already writes the identical state machine.
- No other package (Go, frontend) imports anything from Python.

## 8. Risk assessment

- Deleting `check_all_monitors` / `_check_and_persist` / `SEMAPHORE`: zero external
  callers (CodeGraph blast radius + grep). Delete outright; leaving dead code would rot
  and mislead (AGENTS.md would contradict the tree). Clean removal = delete
  `app/core/scheduler.py`, edit `main.py`, drop the dependency, `uv lock`.
- **Top risk — operational:** after the change, if the Go worker is not running, monitors
  are never checked at all (previously the API silently kept them fresh). Docs must state
  that the worker is now mandatory for checking. No code guard exists (and none should:
  REST-only is the goal); flag as a deployment-doc risk.
- **Behaviour change visible in data cadence:** today the API's 10 s all-monitors tick
  dominates `check_result` cadence; after removal cadence is governed purely by
  `frequency` (Go worker, 2 s due-ness poll). Any consumer assuming a 10 s lattice (UI
  comment, archived docs) sees slower cadence for `frequency > 10` monitors.
- The dual-engine duplicate-check risk listed in `openspec/config.yaml risks_known`
  disappears with this change — update that line.
- Test-DB prerequisites unchanged; no migration needed; strict-TDD RED test shape needs
  pinning in plan (asserting absence of module/dependency, not a behaviour mock).

## 9. Component map for the proposal

- **api** (sentinel-api): delete `app/core/scheduler.py`; edit `app/main.py` (drop lifespan);
  remove `apscheduler` from `pyproject.toml` + refresh `uv.lock`; add RED-first test
  pinning REST-only invariant; update `sentinel-api/README.md`.
- **worker** (sentinel-worker): no code change; optional one-line comment fix in
  `internal/worker/loop.go` and `sentinel-worker/README.md` doc updates. Worker becomes the
  sole engine — document it as required.
- **frontend**: comment-only update in `src/features/monitors/useMonitors.ts`; no code path
  change.
- **schema**: none (no Alembic revision).
- **repo/meta**: root `README.md`, `AGENTS.md`, `openspec/config.yaml` (APScheduler +
  dual-engine risk lines); archived openspec changes explicitly NOT touched.

Estimated diff: well under the 400-line review budget (≈ 100–150 changed lines incl. docs).
