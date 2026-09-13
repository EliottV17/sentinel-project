# Proposal — `remove-api-apscheduler`

Status: proposal finalized (SDD auto mode). Inputs: `explore.md` (same change,
read in full) + CONFIRMED pre-proposal handoff (user-owned decisions, not re-negotiated).
Next phase: `sdd-spec`.

---

## 1. Problem and goal

**Problem.** Sentinel runs **two independent checking engines** that write the same tables
with no locking or claim protocol: an in-process APScheduler engine inside `sentinel-api`
(ticks every 10 s, checks every `state = "Active"` monitor regardless of `frequency`) and
the Go worker (`sentinel-worker`, polls every 2 s for monitors **due** by `frequency`).
The Go worker is the design-intended engine — it is the only one that honors
`monitor.frequency` — while the Python scheduler silently double-checks every monitor,
duplicating `check_result` rows, racing `monitor` updates, and contradicting the
frequency-based cadence the product actually expresses. The API's scheduler is a
maintenance hazard: `sentinel-api/app/core/scheduler.py` (103 lines, SEMAPHORE +
`_check_and_persist` + `check_all_monitors` + `AsyncIOScheduler` + `lifespan`) exists
solely to keep a redundant engine alive, and the repo's docs (`README.md`,
`sentinel-api/README.md`, `sentinel-worker/README.md`, `AGENTS.md`,
`openspec/config.yaml`) all still claim the API runs a scheduler.

**Goal.** Make the **Go worker the official and only polling engine**, and reduce the API
to a pure REST service: endpoints only, no in-process checking. Delete the entire Python
checking engine outright (explore confirmed **zero importers** outside `app/main.py:7–9`),
drop the `apscheduler` dependency, and update every live doc/comment so the repo stops
claiming the API runs a scheduler. The `app/core/checkers/` extension point stays intact
(see §7 — out of scope).

Confirmed product decisions carried here unchanged:

1. The Go worker (`sentinel-worker`) is the OFFICIAL polling engine and the only one
   honoring `monitor.frequency`.
2. Remove APScheduler cleanly from the FastAPI application; the API remains REST-only
   (endpoints only, no in-process checking engine).
3. The whole Python checking engine confined to `app/core/scheduler.py` is deleted
   outright (SEMAPHORE, `_check_and_persist`, `check_all_monitors`, `AsyncIOScheduler`,
   `lifespan`). The `app/core/checkers/` extension point is OUT OF SCOPE and must be
   preserved.
4. Docs updates are in scope so the repo stops claiming the API runs a scheduler.
   Archived openspec changes are historical and MUST NOT be rewritten.
5. Components touched: api, worker (comment only), frontend (comment only), repo-meta
   (docs). **No schema change → no Alembic revision is involved** (the same DB tables and
   state machine are untouched; the Go worker already writes them identically).

---

## 2. Goals / Non-goals

**Goals**

- Delete `sentinel-api/app/core/scheduler.py` (all 103 lines) — no dead code left behind.
- `app/main.py` drops the `lifespan` import and the `FastAPI(lifespan=...)` argument
  (FastAPI default no-op lifespan applies); keep the `http_checker` registry import.
- Remove `apscheduler>=3.11.2` from `pyproject.toml` and refresh `uv.lock` via
  `uv lock` (explore: no other consumer of the package).
- Add a strict-TDD RED test pinning the new REST-only invariant: `app.core.scheduler` is
  findable nowhere and/or `apscheduler` is no longer importable in the API venv.
- Docs/comments stop claiming the API runs a scheduler:
  - `sentinel-api/README.md` (lines 7, 10, 19, 30, 54, 95, 132)
  - root `README.md` (lines 14, 46)
  - `sentinel-worker/README.md` (lines 3, 7, 20)
  - `AGENTS.md` (lines 21, 60, 62 — dev-server note, checker note, "two independent engines")
  - `openspec/config.yaml` (lines 16, 30, 34–35, 152 — APScheduler context + the
    `risks_known` dual-engine duplicate-row line, which this change resolves)
  - `frontend/src/features/monitors/useMonitors.ts` (L5–7 comment: re-justify the 10 s
    poll from UI freshness, not the engine tick)
  - `sentinel-worker/internal/worker/loop.go` (L1–2 comment: "alongside the API scheduler")
- State in docs that the Go worker is now **mandatory**: if it is not running, no monitor
  is ever checked.

**Non-goals**

- No change to the Go worker's logic (comment-only touch).
- No behavioural frontend change (comment-only update).
- No removal of `app/core/checkers/` (`base.py`, `registry.py`, `http_checker.py`) or the
  `http_checker` import in `main.py` — see §7.
- No schema or migration work (no Alembic revision).
- No edits to archived openspec changes (`openspec/changes/archive/`).
- Not fixing the stale `frontend/` note in `openspec/config.yaml` (flagged, separate
  housekeeping — see §7).
- No new monitoring/alerting affordance for "worker down" (documented, not engineered —
  see §8 risk 1).

---

## 3. Affected areas

| Area | Change | Type |
|------|--------|------|
| **api** (`sentinel-api/`) | Delete `app/core/scheduler.py`; edit `app/main.py` (drop lifespan import + arg); remove `apscheduler` from `pyproject.toml`; regenerate `uv.lock`; add strict-TDD REST-only test (`app/tests/test_rest_only.py`); update `sentinel-api/README.md` + `.env.example` if it claims a scheduler | code + test + docs |
| **worker** (`sentinel-worker/`) | Comment-only fix in `internal/worker/loop.go` L1–2; doc updates in `sentinel-worker/README.md`. Worker becomes the sole engine — documented as required. No Go logic change. | comment/docs |
| **frontend** (`frontend/`) | Comment-only update in `src/features/monitors/useMonitors.ts` re-justifying 10 s cadence; no code path change | comment |
| **schema** | **None.** No Alembic revision, no model change, no migration — the DB schema and the Go worker's write path are untouched | none |
| **repo-meta** | Root `README.md`; `AGENTS.md`; `openspec/config.yaml` (APScheduler context lines 16/30/34–35/152 + `risks_known` double-check line) | docs |

Net diff estimate: **≈ 100–150 changed lines** (docs-heavy), well under the 400-line
review budget → a single PR; chain strategy stays `deferred` (no `size:exception` implied).

---

## 4. Enforcement detail (strict TDD)

Removal changes delete behaviour, so the RED test must pin the **new invariant** rather
than exercise a deleted path (per `openspec/config.yaml` testing policy:
red-green-refactor). Suggested shape for `sentinel-api/app/tests/test_rest_only.py` —
written first, confirmed RED against current code, then satisfied by the deletion:

- `importlib.util.find_spec("app.core.scheduler") is None` (module no longer exists), and
- `importlib.util.find_spec("apscheduler") is None` (dependency gone; also naturally fails
  once `uv lock` removes it) or equivalent absence assertion.

The exact assertion shape is pinned in the plan phase (explore §4 flagged this). Existing
tests are unaffected: `conftest.py` uses `ASGITransport`, which never runs FastAPI lifespan
events, and no test imports `app.core.scheduler` (explore grep evidence). The service
layer, deps, and `/api/v1/endpoints/*` touch neither checker nor scheduler.

---

## 5. Edge cases

- **Go worker not running** → after this change no monitor is ever checked and no alerts
  fire; previously the API silently kept things fresh. **This is the dominant operational
  edge case**: docs must state the worker is now mandatory. No code guard is added —
  REST-only is the confirmed goal; the guard would be a separate product decision.
- **Cadence change for `frequency > 10` monitors** — today the API's 10 s all-monitors
  tick dominates `check_result` cadence; after removal, cadence is governed purely by
  `frequency` via the worker's 2 s due-ness poll. Any consumer that assumed a 10 s lattice
  (the frontend comment, archived docs) sees slower updates for such monitors. The
  frontend's 10 s poll is unaffected: it reads REST rows written by whichever engine is
  active (now exclusively the worker).
- **Dual-engine duplicate rows** — the `risks_known` double-check risk in
  `openspec/config.yaml` disappears with this change; the line is updated, not deleted
  blindly (an inline note explains it is resolved by single-engine operation).
- **`uv.lock` refresh** — `apscheduler` appears only as the package itself and as a
  dependency of the `sentinel-api` project; removing it from `pyproject.toml` and running
  `uv lock` cleanly drops it. No other package consumes it.
- **`alembic` / startup** — migrations don't run in tests and are untouched; the dev
  server command (`uv run uvicorn app.main:app --reload`) keeps working with the default
  no-op lifespan.
- **Empty/degraded states** — no first-check or alert-table semantics change (the worker
  already implements the identical state machine); tests unchanged and green.

---

## 6. First-slice scope

Everything in this change is one coherent slice (deletion + dep + test + docs); it lands as
one work unit (code + test + docs in the same commit, per implement rules):

1. RED test (`app/tests/test_rest_only.py`) pinning absence of `app.core.scheduler` /
   `apscheduler`, confirmed failing.
2. Delete `app/core/scheduler.py`; edit `app/main.py` (remove import + `lifespan=`);
   keep `http_checker` import.
3. Remove `apscheduler` from `pyproject.toml`; run `uv lock`.
4. Docs/comments: root `README.md`, `sentinel-api/README.md`, `sentinel-worker/README.md`,
   `AGENTS.md`, `openspec/config.yaml` (APScheduler + `risks_known` lines),
   `frontend/src/features/monitors/useMonitors.ts` comment,
   `sentinel-worker/internal/worker/loop.go` comment. Worker mandatory-language included.
5. Green gate: focused test → full `uv run pytest` → `ruff check`/`format --check`/`pyright`;
   run `go vet`/`go build` if the loop.go comment edit is applied (comment-only, no Go
   behaviour change).

---

## 7. Out of scope (deliberately excluded)

- **`app/core/checkers/` registry removal** — the extension point is preserved and the
  `http_checker` import stays in `main.py`. Known consequence (to state in docs): from
  production Python code `get_checker` has no caller anymore; if the project later wants
  the Python checker package gone, that is its own, larger change.
- **Archived openspec changes** (`openspec/changes/archive/2026-09-12-web-frontend/*`) —
  historical record of the dual-engine era; referenced here only to state they are NOT
  rewritten.
- **Frontend behaviour** — no code path changes; poll cadence and data flow stay as they
  are (REST-only via TanStack Query, 10 s).
- **Go worker logic** — the worker is the target engine, never modified here (comment only).
- **Other `openspec/config.yaml` staleness** — the "frontend/ is empty" note is outdated
  but unrelated; flagged for a separate housekeeping edit, not included in this change.
- **"Worker-down" alerting/guardrails** — documented as mandatory, not instrumented (see §8).

---

## 8. Risks

1. **Operational — worker becomes mandatory (highest).** After the change, if the Go
   worker is not running, monitors are never checked and state freezes (previously the API
   masked this). Mitigation: explicit "worker required" language in all touched docs
   (READMEs, AGENTS.md, config.yaml context). Accepted as a deployment-documentation risk;
   adding a code guard is out of confirmed scope.
2. **Cadence expectation shift.** Consumers assuming a 10 s check lattice across all
   monitors see frequency-driven cadence. Mitigation: docs + frontend comment re-justify
   cadence from UI freshness; no consumer in repo depends on the lattice (frontend polls
   REST only).
3. **Silent behavioural coupling** — the checkers package becomes callable-only-by-nothing
   in production; somebody may later mistake it for dead code and delete it as "cleanup".
   Mitigation: docs note it is a preserved extension point; not removed today by design.
4. **Test assertion fragility** — absence-based RED tests can be trivially satisfied or
   flaky across environments (e.g. `apscheduler` present in a shared venv). Mitigation:
   pin exact assertion shape in plan; assert on the API package/venv, run locally to
   confirm RED before deletion.
5. **Docs drift** — any claim of the API scheduler left behind contradicts the code.
   Mitigation: repo-wide grep for `scheduler|lifespan|apscheduler|dual-engine|double-check`
   as an implement-phase checklist item (explore §7 already swept `.github/`, endpoints,
   services, deps).

---

## 9. Rollback

Reverting is a small, safe git revert of one work unit:

- Restore `app/core/scheduler.py` and the `main.py` import + `FastAPI(lifespan=...)` lines
  (both were deleted, not modified).
- Re-add `apscheduler>=3.11.2` to `pyproject.toml` and `uv lock`.
- Revert the test and doc/comment hunks.
- No data is touched at any point (no migration, no schema, no `check_result`/`alert`
  rewrite), and the Go worker's operation is unaffected by both the change and its revert.
  The only lasting effect of not reverting quickly is documentation/behaviour drift and
  the worker-mandatory operating posture.

---

## 10. Success criteria

After this change:

- `app.core.scheduler` no longer exists; `app/main.py` constructs `FastAPI` with no
  `lifespan=`; `get_checker` still exists and `app/core/checkers/` is intact.
- `apscheduler` absent from `pyproject.toml` and `uv.lock`; `pip-audit` audits one fewer
  dependency.
- `app/tests/test_rest_only.py` passes (REST-only invariant) and the full suite
  (`uv run pytest`) plus `ruff check`, `ruff format --check`, `pyright` are green locally.
- Repo-wide grep for `scheduler|lifespan|apscheduler|dual-engine|double-check` matches
  only the archived openspec change and non-claiming references (e.g. this proposal).
- Every live doc/comments claim updated: worker is the official engine, honors
  `frequency`, and is **required** for checking; API is REST-only.
- Frontend behaviour unchanged; `useMonitors.ts` comment re-justified.
- Go worker: no logic change; `go vet`/`go build` green.
- **No Alembic revision involved; no schema change.**
- Net diff ≈ 100–150 lines — within the 400-line review budget (single PR, no exception
  needed; chain strategy remains `deferred` until delivery decides).

---

## 11. Proposal question round (auto mode — non-blocking)

Auto-mode execution with a confirmed pre-proposal handoff; per the proposal contract the
following residual product/scope questions are offered for user review but do **not** block
`spec`. The parent may forward answers to the user as a review opportunity:

1. Should the "worker is mandatory" posture be surfaced in the product itself (a
   heartbeat/staleness endpoint or banner) in a later change, or is documentation-only
   sufficient for now? (Proposal assumes documentation-only.)
2. Is a follow-up change to eventually retire the Python `app/core/checkers/` package
   desirable, or should it be kept indefinitely as the API-side extension point
   (proposal assumes keep indefinitely)?
3. Is removing the dual-engine `risks_known` line from `openspec/config.yaml` vs.
   re-wording it as "resolved by single-engine" the preferred edit? (Proposal assumes
   re-wording to preserve audit history of the risk.)
4. Should the unrelated stale "frontend/ is empty" note in `openspec/config.yaml` be
   fixed in this change or left for housekeeping? (Proposal assumes left out.)

## Linkage

- Parent artifact: `explore.md` (same change, read in full; status success).
- Handoff: confirmed pre-proposal product decisions (user-owned; listed in full in §1).
- Downstream: `sdd-spec` reads this proposal; nothing else may re-open the confirmed
  decisions in §1.