# Design — `remove-api-apscheduler`

Status: design finalized (SDD auto mode). Inputs: `explore.md`, `proposal.md`,
`specs/api-runtime/spec.md` (all read in full), `openspec/config.yaml` (strict-TDD,
400-line review budget, red→green→refactor plan rules), `AGENTS.md`, and the live
source files (`app/main.py`, `app/core/scheduler.py`, `pyproject.toml`, doc targets).
Next phase: `sdd-tasks`.

---

## 1. Context

The proposal (confirmed, not re-negotiable) makes the Go worker the official and only
polling engine and reduces `sentinel-api` to a pure REST service: delete
`app/core/scheduler.py` (103 lines, zero importers outside `app/main.py:7,9`), drop the
`apscheduler` dependency, add a RED-first REST-only invariant test, and update every live
doc/comment. Spec requirements REQ-APIRUN-001..007 pin the WHAT; this design pins the HOW.

Verified against the current tree (grep + file reads):

- `app/main.py` L7 `from app.core.scheduler import lifespan`, L9
  `app = FastAPI(title="Sentinel API", lifespan=lifespan)`, L11
  `from app.core.checkers import http_checker  # noqa: F401` (stays). No
  `contextlib`/`asynccontextmanager` import exists in `main.py` (that import lives only in
  `scheduler.py` and dies with the file).
- `.github/workflows/ci.yml` contains **no** `apscheduler`/scheduler references (verified
  grep over `.github/`) — no CI edit needed; pip-audit simply audits one fewer dependency.
- `pyproject.toml` L21 is the only dependency declaration; `uv.lock` mentions
  `apscheduler` only as the locked package itself and as a dependency of `sentinel-api`.
- `conftest.py` uses `ASGITransport` (never runs FastAPI lifespan); no test imports
  `app.core.scheduler`. Existing tests are unaffected.
- Doc targets confirmed at the lines listed in §6. All touched files are English
  (`main.py`'s Spanish root-endpoint message and `scheduler.py`'s Spanish strings are
  deleted/untouched respectively — no language mixing introduced).

## 2. Design decisions

### D1 — `main.py` constructor form: plain `FastAPI(title=...)`, no lifespan wrapper

**Decision.** After the edit, `app/main.py` reads:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.checkers import http_checker  # noqa: F401
from app.core.config import settings

app = FastAPI(title="Sentinel API")
```

(the CORS middleware, root endpoint, and `include_router` lines are unchanged).

**Rejected alternative:** keeping an explicit `@asynccontextmanager async def
lifespan(app): yield` no-op in `main.py` and passing `lifespan=lifespan`. Rejected
because it is dead ceremony: FastAPI/Starlette already install a default no-op lifespan,
an explicit no-op adds a symbol that docs and the invariant test would then have to
explain, and it invites someone to "usefully" put code inside it later — recreating the
hazard this change removes. REQ-APIRUN-002 explicitly asks for *no custom lifespan*.

**Uvicorn `--reload` impact:** none. The dev command
(`uv run uvicorn app.main:app --reload`) works identically with the default lifespan;
reload only watches files and re-imports the app — there is no scheduler startup hook
left to run (REQ-APIRUN-002 scenario 2 is satisfied by construction).

**Import-order/registration concern:** removing line 7 leaves the isort grouping intact
(`app.api…`, `app.core.checkers`, `app.core.config` stay in sorted order — deletion of a
line cannot break `I` rules). The `http_checker` import (REQ-APIRUN-004) stays exactly
where it is: checker modules self-register on import, so the registry population side
effect is preserved even though no production Python code calls `get_checker` anymore
(known consequence, documented — proposal §7).

### D2 — Dependency removal: `uv remove apscheduler`, not manual edit + `uv lock`

**Decision.** Run from `sentinel-api/`:

```bash
uv remove apscheduler
```

**Justification.** `uv remove` edits `pyproject.toml` and regenerates `uv.lock` in one
atomic step, keeping the lock's resolution hash and dependency entries consistent.
Hand-editing `pyproject.toml` then `uv lock` achieves the same result but adds a step and
risks a stale lock if the second command is forgotten. `uv remove` performs a minimal
re-resolution (it does not upgrade unrelated pins), so the `uv.lock` diff stays tight —
only `apscheduler` and its now-orphaned transitive deps drop out. REQ-APIRUN-003's
"not importable in the API venv" scenario is satisfied because `uv remove` syncs the
project environment.

**Gotcha to verify at implement time:** confirm the `uv.lock` diff removes `apscheduler`
(and `tzlocal`-style orphans if any) and touches nothing unrelated; if the diff churns
other entries, fall back to manual `pyproject.toml` edit + `uv lock` and re-check.

### D3 — REST-only invariant test: `app/tests/test_rest_only.py`

**Location.** `sentinel-api/app/tests/test_rest_only.py` (the spec's suggested path,
which also sits under `testpaths = ["app/tests"]` so plain `uv run pytest` picks it up).

**Four assertions, pinned exactly:**

```python
"""REST-only invariant: the API runs no in-process checking engine (REQ-APIRUN-001..003).

The Go worker (sentinel-worker) is the sole polling engine. These tests fail if the
Python scheduler module, its dependency, or its wiring ever comes back.
"""

import importlib.util
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]  # sentinel-api/app/


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
    this_file = Path(__file__).resolve()
    offenders = [
        str(p)
        for p in APP_DIR.rglob("*.py")
        if p != this_file
        and any(tok in p.read_text(encoding="utf-8") for tok in forbidden)
    ]
    assert not offenders, f"Scheduler code resurrected in: {offenders}"
```

**Robustness analysis (why this is CI-green everywhere):**

- `find_spec("app.core.scheduler")` — deterministic: the module file is deleted, so it
  resolves to `None` in any environment. No dependence on which venv is active beyond the
  repo being importable (pytest already imports `app.*` throughout the suite).
- `find_spec("apscheduler")` — resolves against the *running interpreter's* `sys.path`,
  which under `uv run pytest` is the project venv (the one `uv remove apscheduler`
  synced). A machine where `apscheduler` is installed in some *other* env (global
  interpreter, another project's venv) is unaffected — that env is never on this suite's
  path. CI (`uv sync --group dev` → `pytest`) is green by construction. A stale local
  venv fails with the actionable message above — which is correct behavior, not
  flakiness: the invariant is violated until `uv sync` runs.
- The `vars(main_module)` assertion catches re-wiring (`from app.core.scheduler import
  lifespan`) even if someone recreates the module under a different name — it fails the
  moment `lifespan` is bound in `app.main`, which is the actual hazard surface.
- The rglob scan enforces REQ-APIRUN-001's "no resurrection" scenario as an executable
  invariant (no `AsyncIOScheduler`/`BackgroundScheduler`/`check_all_monitors` anywhere
  under `app/`). It is env-independent (pure filesystem). Size is bounded (the `app/`
  tree is small); if it ever matters, it can be narrowed to `app/core/` — not needed now.
    **Self-exclusion bug (reconciled):** the forbidden-token scan must exclude its own
      test file, which necessarily contains the literal tokens in its `forbidden` tuple —
      otherwise the scan matches the new test file itself and stays RED forever. The
      `p != this_file` filter in the snippet above preserves the full-`app/` scan intent;
      this fix is reflected in tasks.md.


**Deliberately NOT asserted:** FastAPI router internals (`app.router.lifespan_context`)
— both custom and default lifespans produce a non-None context manager, so such an
assertion cannot distinguish anything and would be a false guarantee. The
`vars(main_module)` + `find_spec` pair covers REQ-APIRUN-002's intent robustly.

### D4 — Documentation wording: one canonical "worker-mandatory" sentence

All doc edits are English (every touched file is already English; per `config.yaml`
style rule, each file keeps its existing language — none of these is Chinese/Spanish).

Canonical wording to adapt per file (keep it short; don't rewrite whole sections):

> The **Go worker** (`sentinel-worker`) is the official — and **required** — polling
> engine: it is the only component that checks monitors and the only one honoring
> `monitor.frequency`. If it is not running, no monitor is ever checked and no alerts
> fire. The API is REST-only (endpoints only, no in-process checking).

Exact per-file targets (lines from explore §5, re-verified on disk):

| File | Lines | Edit |
|---|---|---|
| `sentinel-api/README.md` | 7, 30 (APScheduler stack bullet), 54, 95, 132 | L7: "fully async REST API" (drop scheduler clause); remove/replace the APScheduler stack bullet with the Go worker as the checking engine; L30 "The scheduler compares" → "The worker compares" (state machine unchanged); L54: "It mirrors this scheduler's logic; running both simultaneously double-checks…" → "It is the sole polling engine and is required — the API performs no checks itself."; L95: "The scheduler (APScheduler) starts automatically…" → "The API is REST-only. Monitoring requires the Go worker (`sentinel-worker`) — without it, no monitor is ever checked."; L132 tree line: delete `scheduler.py` entry. |
| root `README.md` | 14, 21 ("In-process Cron" ASCII box), 46 | L14 tree comment → "Python / FastAPI — REST API + auth (checking runs in the Go worker)"; architecture ASCII box: remove "In-process Cron" row from the API box; L46 → "…without touching the polling engine" or "…extending checkers without touching the REST layer". |
| `sentinel-worker/README.md` | 3, 7, 20 | L3: "mirrors the Python scheduler's logic" → drop the mirror claim; state it is the sole engine honoring `frequency`; L7 tree: "Python/FastAPI (API + in-process scheduler)" → "Python/FastAPI (REST API)"; L20: "This is the same state machine as the API's APScheduler. Running both simultaneously double-checks…" → "This is the only checking engine; the API performs no checks. The state machine (alerts on transitions only) is unchanged." |
| `AGENTS.md` | 21, 60, 62 | L21 dev-server comment: drop "(APScheduler starts in-process)" → plain dev server; L60 checker note: rephrase registry note without implying the API scheduler consumes it (extension point preserved; Go worker has its own registry); L61-62 "Two independent engines" paragraph → "Single engine: the Go worker checks all monitors per `frequency`; the API is REST-only. If the worker is not running, nothing is checked." (Keep the rest of the architecture section intact.) |
| `openspec/config.yaml` | 16, 30, 34–35, 152 | L16: "+ APScheduler in-process checker" → "+ REST-only (checking runs in the Go worker)"; L30: "scheduler resolves via get_checker" → "checker registry is a preserved API-side extension point (currently no production caller; the Go worker has its own registry)"; L34–35 dual-engine no-locking claim → "Single engine since `remove-api-apscheduler`: only the Go worker writes check results; the former dual-engine duplicate-row hazard is resolved"; L152 `risks_known` dual-engine line → **re-word, do not delete**: "RESOLVED (remove-api-apscheduler): the API scheduler was removed; the Go worker is the sole engine." (per confirmed decision 3 in proposal §11). |
| `frontend/src/features/monitors/useMonitors.ts` | 5–7 (comment) | Comment-only, same language (English): justify 10 s from UI freshness — e.g. "Poll cadence for the monitors list: 10 s by default, chosen for UI freshness; the underlying checks run on each monitor's own `frequency` in the Go worker. Overridable via VITE_POLL_INTERVAL_MS…" No code change. |
| `sentinel-worker/internal/worker/loop.go` | 1–2 (comment) | "persists the results alongside the API scheduler" → "persists the results to the shared PostgreSQL database; it is the sole polling engine (the API is REST-only)". Comment only — `go vet`/`go build` must stay green. |

**Hard constraint:** `openspec/changes/archive/**` is NOT touched (REQ-APIRUN-006).
`.env.example` — the proposal says update it "if it claims a scheduler"; the design could
not verify it (sensitive-path read blocked by policy). Implement phase must check it with
user awareness; expected content (env vars only) suggests no edit, but confirm.

### D5 — Work-unit ordering: one commit, RED → GREEN → docs → gates

Per `config.yaml` implement rules ("one work unit per commit; tests and docs in the same
commit"), this change is a **single work unit / single commit** with this internal order:

1. **RED** — write `app/tests/test_rest_only.py` (D3). Run
   `uv run pytest app/tests/test_rest_only.py` and confirm all four tests fail against
   current code. Record command + failure output in the implement log (mandatory per
   testing rules). *(Expected RED: module exists → test 1 fails; `lifespan` bound →
   test 2 fails; apscheduler installed → test 3 fails; `scheduler.py` contains forbidden
   tokens → test 4 fails.)*
2. **GREEN (code)** — `git rm sentinel-api/app/core/scheduler.py`; edit `app/main.py`
   per D1 (drop L7 import and the `lifespan=` argument; keep `http_checker` import).
3. **GREEN (deps)** — `uv remove apscheduler` (D2) from `sentinel-api/`; verify the
   `uv.lock` diff per D2's gotcha.
4. **GREEN verify** — focused test (now passes) → `uv run pytest` (full suite) →
   `uv run ruff check .` → `uv run ruff format --check .` → `uv run pyright`.
5. **Docs & comments** (same commit) — apply all §D4 edits; then run
   `go vet ./...` and `go build ./cmd/worker/` in `sentinel-worker/` (comment-only diff,
   but the gate is cheap insurance); optionally `npm run typecheck` in `frontend/`
   (comment-only; no behavioural risk).
6. **Refactor check** — none expected; the deletion leaves nothing to refactor. Run the
   drift grep as the closing checklist:
   `grep -rn "scheduler\|lifespan\|apscheduler\|dual-engine\|double-check"` over the
   repo excluding `openspec/changes/archive/`, `openspec/changes/remove-api-apscheduler/`
   (this change's own artifacts), and `uv.lock` — matches must be only non-claiming
   references (REQ-APIRUN-006 scenario 1).

Rationale for interleaving docs into the same work unit rather than a separate docs
commit: the implement rules mandate it, the diff stays under budget, and a code-only
commit would leave the repo asserting a scheduler that no longer exists (docs-drift risk
#5 in the proposal).

## 3. Alternatives considered

| Alternative | Verdict |
|---|---|
| Keep `scheduler.py` but make `lifespan` conditional (env flag to disable the engine) | Rejected — confirmed decision 3 says delete outright; a flag preserves the hazard and the dead code. |
| Explicit no-op lifespan in `main.py` | Rejected — dead ceremony; default no-op lifespan is idiomatic (see D1). |
| Manual `pyproject.toml` edit + `uv lock` | Rejected in favor of `uv remove` (atomic, minimal lock churn — D2); kept as fallback if the lock diff churns. |
| Assert apscheduler absence via `pip list` / subprocess | Rejected — subprocess shells out to the wrong env easily; `find_spec` on the running interpreter is the correct resolution domain. |
| Assert via `FastAPI(...)` call-site source inspection (`inspect.getsource`) | Rejected — brittle to formatting; `vars(main_module)` is equivalent and robust. |
| Delete `app/core/checkers/` too (now caller-less) | Rejected — out of scope (proposal §7); extension point is a confirmed keep. |
| Re-word vs delete the `risks_known` dual-engine line | Re-word (confirmed decision 3) — preserves the audit history of the resolved risk. |
| Add a worker-down code guard / heartbeat endpoint | Rejected — explicitly out of scope (proposal §8.1); documented-mandatory posture only. |

## 4. Data flow / contracts after the change

- Checking: `sentinel-worker` loop → due monitors by `last_checked_at + frequency` →
  `check_result` insert → `monitor` update → `alert` on transition. **Unchanged.**
- API: REST endpoints + auth only; `app.core.checkers` registry populated at import by
  `main.py` but never called in production (documented extension point). **Unchanged
  except lifespan.**
- Frontend: TanStack Query polls `GET /api/v1/monitors/` every 10 s; reads rows written
  by the worker. **Unchanged (comment only).**
- Cadence: `check_result` cadence becomes purely `frequency`-driven (former 10 s
  all-monitors lattice gone) — REQ-APIRUN-007 scenario 2; no consumer depends on the
  lattice (explore §6).

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Worker becomes mandatory — with worker down, nothing is checked (top operational risk) | Canonical worker-mandatory sentence in all touched docs (D4); no code guard by confirmed scope. |
| Stale local venv keeps `apscheduler` importable → test 3 fails | Intentional; the assert message instructs `uv sync --group dev`. CI is green by construction. |
| `uv remove` churns unrelated `uv.lock` entries (uv version drift) | D2 verification step; fallback to manual edit + `uv lock`; review the lock diff before committing. |
| Docs drift — a scheduler claim survives | Closing repo-wide grep in work-unit step 6; REQ-APIRUN-006 scenario 1 is the acceptance check. |
| Checkers package later mistaken for dead code and deleted | D4 wording in `config.yaml` + `AGENTS.md` explicitly marks it a preserved extension point with no production caller. |
| `uv.lock` diff bloats the review count | `uv remove` minimal re-resolution; lock is generated output — if it still threatens the budget, it is mechanical (not review-relevant logic), but current estimate already fits (§6). |
| `.env.example` unverifiable in design phase (safety policy blocked read) | Implement-phase check with user awareness; expected no edit (env-var file). |

## 6. Review Workload Forecast inputs

- **Estimated changed lines:** deletions — `scheduler.py` −103, `main.py` −2,
  `pyproject.toml` −1, `uv.lock` ≈ −20 to −60 (apscheduler + orphaned transitives);
  additions — test file +~45, docs/comments ≈ +45–70 across 7 files (mostly 1–3 line
  replacements each), `loop.go` comment +1/−2, `useMonitors.ts` comment +2/−3.
  **Net total ≈ 180–260 changed lines** — within the 400-line review budget; single PR,
  no `size:exception`, chain strategy stays `deferred`.
- **Review surface:** one behavioral deletion (trivially reviewable — the module no
  longer exists), one mechanical lockfile diff, one new test file (the only logic worth
  review), and docs wording. No schema, no migrations, no Go logic, no frontend behavior.
- **Rollback:** single-commit git revert restores everything (proposal §9); no data
  touched at any point.

## Linkage

- Parent artifacts: `proposal.md`, `explore.md`, `specs/api-runtime/spec.md` (same change).
- Downstream: `sdd-tasks` reads this design; the RED test shape (D3), the constructor
  form (D1), the dep-removal command (D2), the per-file doc targets (D4), and the
  work-unit order (D5) are pinned here and must not be re-opened without a design update.