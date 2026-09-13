# Tasks — `remove-api-apscheduler`

Phase: sdd-tasks (executor). Inputs read in full: `specs/api-runtime/spec.md`
(REQ-APIRUN-001..007), `design.md` (D1–D5 **pinned** — decisions not re-opened),
`openspec/config.yaml` (strict-TDD plan rules, 400-line budget). Implementation
order follows design D5 internal order: RED → GREEN(code) → GREEN(deps) → GREEN
verify → docs & comments → closing gates → single commit.

**Flagged defect in inherited design (do not re-apply verbatim):** the D3-pinned
`test_no_scheduler_code_resurrected` rglob-scan of `APP_DIR.rglob("*.py")` matches
the test file *itself* — `app/tests/test_rest_only.py` lives under `sentinel-api/app/`
and its `forbidden = ("AsyncIOScheduler", "BackgroundScheduler", "check_all_monitors")`
literal contains all three tokens, so `offenders` is never empty and the test can
never go GREEN. Task 1 applies the design's pinned shape plus a one-line
self-exclusion (`p != THIS_FILE`) that preserves the full-`app/` scan intent. The
design pre-approved the alternative narrow (`app/core/` only) if reviewers prefer.
If design.md is updated later, adopt the design wording over this note.

**Schema note — shared-schema rule NOT applicable.** This change touches no shared
schema: no SQLModel model edits, no Alembic revision (REQ-APIRUN-007). The plan rule
"tasks that change shared schema must cover BOTH engines' write paths" is not
triggered. The only worker-side diff is a comment in
`sentinel-worker/internal/worker/loop.go`; the only frontend diff is a comment in
`frontend/src/features/monitors/useMonitors.ts`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ≈ 180–260 (deletions: `scheduler.py` −103, `main.py` −2, `pyproject.toml` −1, `uv.lock` −20–60; additions: `test_rest_only.py` +~50, docs/comments +45–70 across 7 files, `loop.go` +1/−2, `useMonitors.ts` +2/−3) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk (gate dormant: estimate ≤ 260 << 400, no size exception claimed) |
| Chain strategy | pending (config `chain_strategy: deferred`; unused because no chaining is recommended) |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

## Task 1 — RED: REST-only invariant test (REQ-APIRUN-005, D3)

- [x] Create `sentinel-api/app/tests/test_rest_only.py` with exactly the four pinned assertions (corrected self-exclusion; content below), then run `cd sentinel-api && uv run ruff format app/tests/test_rest_only.py` so the format gate stays clean. <!-- sdd-owner: implementation -->

```python
"""REST-only invariant: the API runs no in-process checking engine (REQ-APIRUN-001..003).

The Go worker (sentinel-worker) is the sole polling engine. These tests fail if the
Python scheduler module, its dependency, or its wiring ever comes back.
"""

import importlib.util
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]  # sentinel-api/app/
THIS_FILE = Path(__file__).resolve()


def test_scheduler_module_is_deleted():
    assert importlib.util.find_spec("app.core.scheduler") is None, (
        "app.core.scheduler must not exist — the API is REST-only; the Go worker "
        "is the sole polling engine"
    )


def test_main_py_has_no_lifespan_wiring():
    import app.main as main_module

    # main.py previously bound `lifespan` via `from app.core.scheduler import lifespan`;
    # the default no-op lifespan must be used instead.
    assert "lifespan" not in vars(main_module), (
        "app.main must not import or bind a custom lifespan"
    )


def test_apscheduler_dependency_removed():
    assert importlib.util.find_spec("apscheduler") is None, (
        "apscheduler is still importable — run `uv sync --group dev` to refresh "
        "the environment after removing it from pyproject.toml"
    )


def test_no_scheduler_code_resurrected():
    forbidden = ("AsyncIOScheduler", "BackgroundScheduler", "check_all_monitors")
    offenders = [
        str(p)
        for p in sorted(APP_DIR.rglob("*.py"))
        if p != THIS_FILE
        and any(tok in p.read_text(encoding="utf-8") for tok in forbidden)
    ]
    assert not offenders, f"Scheduler code resurrected in: {offenders}"
```

- [x] Record the RED run (mandatory per config.yaml testing rules): run
  `cd sentinel-api && uv run pytest app/tests/test_rest_only.py -v` (test DB
  prerequisites first: `docker compose up -d` at repo root + `sentinel_tests_db`
  exists, so failures are genuine) and capture the exact command + failing-assertion
  output for all four tests into the implement-phase log and the PR description.
  RED evidence: `4 failed in 0.03s` — (1) ModuleSpec found for `app.core.scheduler`,
  (2) `'lifespan' in vars(main_module)`, (3) ModuleSpec found for `apscheduler`
  (`.venv/.../site-packages/apscheduler`), (4) offender `app/core/scheduler.py`.
  Expected RED: 1 fails (`find_spec("app.core.scheduler")` is a spec), 2 fails
  (`"lifespan" in vars(main_module)` is True), 3 fails (`find_spec("apscheduler")`
  is a spec), 4 fails (`app/core/scheduler.py` holds `AsyncIOScheduler` +
  `check_all_monitors`; the test file is self-excluded). <!-- sdd-owner: implementation -->

## Task 2 — GREEN (code): delete scheduler + unwire main.py (REQ-APIRUN-001, -002; D1)

- [x] Delete `sentinel-api/app/core/scheduler.py` (`git rm`); verify zero importers
  remain (`grep -rn "app.core.scheduler" sentinel-api/app` → no matches). The only
  importer was `app/main.py` L7. <!-- sdd-owner: implementation -->
  Evidence: `git rm` done; the only remaining `app.core.scheduler` strings are in the
  new invariant test itself (find_spec + comment).
- [x] Edit `sentinel-api/app/main.py` per D1: delete L7
  `from app.core.scheduler import lifespan` and change
  `app = FastAPI(title="Sentinel API", lifespan=lifespan)` →
  `app = FastAPI(title="Sentinel API")`. KEEP
  `from app.core.checkers import http_checker  # noqa: F401` (REQ-APIRUN-004), the
  CORS middleware, root endpoint, and `include_router` unchanged. <!-- sdd-owner: implementation -->
- [x] GREEN focused run:
  `cd sentinel-api && uv run pytest app/tests/test_rest_only.py -v` → **4 passed**. <!-- sdd-owner: implementation -->
  Evidence: `3 passed, 1 failed` at this step — test 3 (`apscheduler`) intentionally
  still RED because the venv still carries the dependency; its GREEN gate is Task 3
  (dep removal) per the tasks.md sequencing note.

## Task 3 — GREEN (deps): remove apscheduler dependency (REQ-APIRUN-003; D2)

- [x] `cd sentinel-api && uv remove apscheduler` (atomic pyproject + lock + env
  update; this is the pinned D2 command, not a manual edit). <!-- sdd-owner: implementation -->
- [x] Verify `pyproject.toml`: the `"apscheduler>=3.11.2"` line (L21) is gone and no
  other dependency changed. <!-- sdd-owner: implementation -->
  Evidence: `git diff pyproject.toml` shows exactly one removed line.
- [x] Verify `uv.lock`: `grep -n "apscheduler" uv.lock` → **no matches** (package,
  wheel, and `{ name = "apscheduler" }` dependency entries all gone). Check the lock
  diff is tight (≈ −20 to −60 lines: apscheduler + orphaned transitives only). If
  the diff churns unrelated pins, fall back to manual `pyproject.toml` edit + `uv lock`
  and re-verify. <!-- sdd-owner: implementation -->
  Evidence: grep exit 1 (no matches); diff is −35 lines (apscheduler, orphaned
  `tzlocal` + `tzdata`, and the two `{ name = "apscheduler" }` entries) — no unrelated churn.
- [x] Lock-consistency check (equivalent of `uv lock --check`):
  `cd sentinel-api && uv sync --frozen` → exits 0 (fails loudly if `pyproject.toml`
  and `uv.lock` drift). <!-- sdd-owner: implementation -->
  Evidence: `uv sync --frozen` → `Checked 72 packages in 0.31ms`, exit 0. Focused
  test then re-run → **4 passed**.

## Task 4 — GREEN (component gates) (REQ-APIRUN-005 full-suite scenario; D5 step 4)

All from `sentinel-api/`:
- [x] `uv run pytest` → full suite green (existing tests use `ASGITransport`, which
  never runs lifespan events; none import `app.core.scheduler`). <!-- sdd-owner: implementation -->
  Evidence: `27 passed, 31 warnings in 2.62s` (warnings are pre-existing pyjwt
  InsecureKeyLengthWarning from the CI test key).
- [x] `uv run ruff check .` → clean. <!-- sdd-owner: implementation -->
  Evidence: `All checks passed!`. One transient E501 (89-char docstring line) in the
  new test was fixed by rewrapping the module docstring (assertions unchanged).
- [x] `uv run ruff format --check .` → clean (run `uv run ruff format .` first if it
  reports drift). <!-- sdd-owner: implementation -->
  Evidence: `43 files already formatted`.
- [x] `uv run pyright` → clean. <!-- sdd-owner: implementation -->
  Evidence: `0 errors, 0 warnings, 0 informations`.

## Task 5 — Docs & comments (REQ-APIRUN-006; D4)

Apply the canonical actionable wording per file, keeping each file's existing
English-language style; re-word, never delete, the `risks_known` line. The canonical
sentence: “The Go worker (`sentinel-worker`) is the official — and **required** —
polling engine: it is the only component that checks monitors and the only one
honoring `monitor.frequency`. If it is not running, no monitor is ever checked and
no alerts fire. The API is REST-only (endpoints only, no in-process checking).”

- [x] Root `README.md` — L14 tree comment `REST API, auth & in-process scheduler` →
  `REST API + auth (checking runs in the Go worker)`; Architecture ASCII box L21:
  drop the `|  - In-process Cron    |` row from the API box; L46
  `…without touching the core scheduler` → `…without touching the polling engine`. <!-- sdd-owner: implementation -->
- [x] `sentinel-api/README.md` — Tech Stack: `FastAPI — fully async REST API with
  lifespan-managed background scheduler` → drop the scheduler clause; replace the
  `APScheduler — interval-based job execution…` bullet with a `sentinel-worker (Go)
  — official polling engine` entry; strategy section `Adding a new check type
  requires no changes to the scheduler or API layer` → `…to the checking engine or
  API layer`; L30 `The scheduler compares` → `The worker compares` (state machine
  unchanged); L54 `It mirrors this scheduler's logic; running both simultaneously
  double-checks…` → `It is the sole polling engine and is required — the API
  performs no checks itself.`; L95 `The scheduler (APScheduler) starts
  automatically inside the FastAPI lifespan…` → `The API is REST-only. Monitoring
  requires the Go worker (sentinel-worker) — without it, no monitor is ever
  checked.`; L132 tree: delete the `scheduler.py` entry line. <!-- sdd-owner: implementation -->
- [x] `sentinel-worker/README.md` — L3 drop `mirrors the Python scheduler's logic`
  → state it is the sole engine honoring `frequency`; L7 tree
  `Python/FastAPI (API + in-process scheduler)` → `Python/FastAPI (REST API)`;
  L20 `This is the same state machine as the API's APScheduler. Running both
  simultaneously double-checks…` → `This is the only checking engine; the API
  performs no checks. The state machine (alerts on transitions only) is unchanged.` <!-- sdd-owner: implementation -->
- [x] `AGENTS.md` — L21 dev-server comment: drop `(APScheduler starts in-process)`;
  L60 checker-registry note: rephrase without implying the API scheduler consumes
  the registry (preserved extension point; no production caller; Go worker has its
  own registry); L61–62 `Two independent engines, one schema` paragraph → `Single
  engine: the Go worker checks all monitors per frequency; the API is REST-only. If
  the worker is not running, nothing is checked.`; Go-worker section: drop
  `Mirrors the Python scheduler's logic.` (keep the rest of the section). <!-- sdd-owner: implementation -->
- [x] `openspec/config.yaml` — L16 `+ APScheduler in-process checker` → `+ REST-only
  (checking runs in the Go worker)`; L30 `scheduler resolves via get_checker` →
  `checker registry is a preserved API-side extension point (currently no production
  caller; the Go worker has its own registry)`; L34–35 dual-engine no-locking claim
  → `Single engine since remove-api-apscheduler: only the Go worker writes check
  results; the former dual-engine duplicate-row hazard is resolved`; L152
  `risks_known` dual-engine line → **re-word, never delete**: `RESOLVED
  (remove-api-apscheduler): the API scheduler was removed; the Go worker is the sole
  engine.` Keep worker-mandatory language. <!-- sdd-owner: implementation -->
- [x] `frontend/src/features/monitors/useMonitors.ts` — L4–8 comment only (no code
  change): justify the 10 s poll from UI freshness and point cadence at the Go
  worker's per-monitor `frequency`, e.g. “Poll cadence for the monitors list: 10 s
  by default, chosen for UI freshness; the underlying checks run on each monitor's
  own `frequency` in the Go worker. Overridable via VITE_POLL_INTERVAL_MS (read
  once at module load).” <!-- sdd-owner: implementation -->
- [x] `sentinel-worker/internal/worker/loop.go` — L1–2 header comment:
  `persists the results alongside the API scheduler` → `persists the results to the
  shared PostgreSQL database; it is the sole polling engine (the API is REST-only)`.
  Comment-only. <!-- sdd-owner: implementation -->
- [x] `.env.example` check — read `sentinel-api/.env.example`; expected content is
  env vars only (no scheduler claim — verified no match); if it does claim a
  scheduler, STOP and report before editing. <!-- sdd-owner: implementation -->
  Note: the direct read was blocked by the agent safety policy; the orchestrator
  pre-verified the file contains env vars only and no scheduler claim — no edit
  needed, none made.
- [x] Hard constraint: do NOT touch `openspec/changes/archive/**` (REQ-APIRUN-006). <!-- sdd-owner: implementation -->
  Evidence: no file under `openspec/changes/archive/` was modified (see `git status`).

## Task 6 — Closing gates (D5 step 6; REQ-APIRUN-006, -007)

- [x] Worker sanity (the only worker diff is the comment): from `sentinel-worker/`,
  `go vet ./...` then `go build ./cmd/worker/` → both green. <!-- sdd-owner: implementation -->
  Evidence: both exited 0 (generated `worker` binary removed after the check).
- [x] Optional: `cd frontend && npm run typecheck` (comment-only diff; skip if the
  frontend cannot build locally, and say so in the log). <!-- sdd-owner: implementation -->
  Evidence: `tsc -b` exited 0.
- [x] Drift grep — from repo root, verify zero *live* references:
  `grep -rniE 'apscheduler|AsyncIOScheduler|check_all_monitors|"Starting engine"' --exclude-dir=.git --exclude-dir=archive --exclude-dir=remove-api-apscheduler .`
  Expected survivors (all non-claiming, allowed by REQ-APIRUN-006 scenario 1): the
  `remove-api-apscheduler` change-name string inside the re-worded
  `openspec/config.yaml` context/`risks_known` lines, and `openspec/changes/` this-
  change + archive artifacts (excluded above). Any other match = docs drift → fix it
  with the canonical wording before committing. Optionally complement with the
  design's broader `scheduler|lifespan|dual-engine|double-check` grep for the same
  exclusions. <!-- sdd-owner: implementation -->
- [x] CI walkthrough — read `.github/workflows/ci.yml` (verified live: zero
  scheduler/apscheduler references — confirm again at apply time). Local gates map
  1:1 to CI: API `ruff check`, `ruff format --check`, `pyright`, `pytest`,
  `pip-audit` (now audits one fewer package — no change); worker `go vet`,
  `go build`, `govulncheck`. No CI file edit needed. Expected PR CI: all API and
  worker jobs green. <!-- sdd-owner: implementation -->

## Task 7 — Refactor slice + commit unit (D5 — single commit)

- [x] Refactor check: none expected — the deletion leaves nothing to refactor; the
  drift grep (Task 6) + full re-run of Task 4 double as the refactor gate while
  green. <!-- sdd-owner: implementation -->
- [x] `git status --porcelain` and `git diff --stat` from repo root: only the
  intended files; changed-line total ≈ 180–260 (well under the 400 budget). If any
  unexpected file appears (e.g. generated artifacts), investigate before commit. <!-- sdd-owner: implementation -->
  Evidence: 11 tracked files modified/deleted + new `test_rest_only.py` (48 lines)
  + this change's openspec artifacts; ≈ 203 authored lines (openspec excluded from
  the budget count).
- [x] Single commit (per D5 and config.yaml implement rule “one work unit per
  commit; tests and docs in the same commit as the code”), e.g.
  `feat(api): remove in-process APScheduler — API is REST-only; Go worker is the sole polling engine`,
  including a body that records the RED output reference and the doc-file list.
  Rollback boundary: `git revert <sha>` restores everything — no data touched, no
  migration, no cleanup. Optionally open the single PR for review. <!-- sdd-owner: implementation -->
  DELEGATED: the apply prompt explicitly forbids this executor from committing —
  the orchestrator owns commit/PR creation. All evidence for the commit message is
  in apply-progress.md; this checkbox is closed by the orchestrator after the single commit lands (user-authorized).

## Dependency order / slice map

RED(T1) → GREEN code(T2) → GREEN deps(T3) → GREEN gates(T4) → docs(T5) → closing
gates(T6) → commit(T7). Tasks 1–4 are the strict-TDD RED→GREEN slice for the code
behaviour; Task 5 is the docs slice (same commit); Tasks 6–7 are verification and
delivery. No task touches shared schema; no migration; no Go logic; no frontend
behavior.