# Apply Progress — `remove-api-apscheduler`

Phase: sdd-apply (executor, strict TDD). Status: implementation complete (28/29
tasks checked; the single-commit task is delegated to the orchestrator, which
owns commits per the apply prompt).

## TDD Cycle Evidence

| # | Cycle | Command (cwd) | Result |
|---|-------|---------------|--------|
| 1 | RED | `uv run pytest app/tests/test_rest_only.py -v` (sentinel-api/) | **4 failed in 0.03s** — module spec found for `app.core.scheduler`; `'lifespan' in vars(main_module)`; ModuleSpec found for `apscheduler` (`.venv/.../apscheduler`); offender `app/core/scheduler.py` in the resurrection scan |
| 2 | GREEN (code) | `git rm app/core/scheduler.py` + edit `app/main.py` (drop `lifespan` import & arg); focused rerun | 3 passed, 1 failed — `apscheduler` still importable (stale venv), exactly the sequenced RED per tasks.md |
| 3 | GREEN (deps) | `uv remove apscheduler` → `uv sync --frozen` → focused rerun | `Checked 72 packages`, exit 0 → **4 passed in 0.01s** |
| 4 | Full suite | `uv run pytest` (sentinel-api/) | **27 passed, 31 warnings** (warnings are pre-existing pyjwt key-length warnings) |
| 5 | Static | `uv run ruff check .` / `ruff format --check .` / `uv run pyright` | All clean; pyright `0 errors, 0 warnings, 0 informations`. One transient E501 (89-char docstring line) in the new test was fixed by rewrapping the docstring — assertions untouched. |
| 6 | Worker sanity | `go vet ./...` + `go build ./cmd/worker/` (sentinel-worker/) | Both green (comment-only diff). |
| 7 | Frontend (optional) | `npm run typecheck` (frontend/) | `tsc -b` exit 0. |

## Completed tasks (persisted in tasks.md as `- [x]`)

- Task 1: RED invariant test (`app/tests/test_rest_only.py`, 4 pinned assertions
  with the `p != THIS_FILE` self-exclusion) + RED run recorded above.
- Task 2: `git rm sentinel-api/app/core/scheduler.py` (zero remaining importers;
  only the invariant test's own find_spec/comment reference it) + `main.py` unwired
  per D1 (plain `FastAPI(title="Sentinel API")`; `http_checker` import, CORS, root
  endpoint, router untouched).
- Task 3: `uv remove apscheduler` — pyproject diff is exactly the one removed line;
  `uv.lock` diff is tight (−35 lines: apscheduler + orphaned `tzlocal`/`tzdata`);
  `grep apscheduler uv.lock` → no matches; `uv sync --frozen` exit 0.
- Task 4: full suite + ruff check + ruff format --check + pyright, all green.
- Task 5: docs/comments updated in root `README.md` (tree comment, ASCII box
  "In-process Cron" row dropped, "polling engine" wording), `sentinel-api/README.md`
  (6 targets incl. deleted `scheduler.py` tree entry), `sentinel-worker/README.md`
  (3 targets), `AGENTS.md` (4 targets), `openspec/config.yaml` (4 targets incl.
  risks_known line RE-WORDED as RESOLVED, never deleted), `useMonitors.ts` comment,
  `loop.go` header comment. `.env.example`: direct read blocked by agent safety
  policy; orchestrator pre-verified env-vars-only content — no edit made. Archive
  untouched.
- Task 6: worker sanity (vet+build green), frontend typecheck (green), drift grep
  (see below), CI walkthrough (`ci.yml` has zero scheduler/apscheduler references;
  CI steps map 1:1 to the local gates above; no CI edit needed).
- Task 7: refactor check (none — nothing to refactor; suite green), `git status`/
  `git diff --stat` audit (only intended files), changed-line total ≈ 203 (budget
  400). **Commit intentionally NOT created** — the apply prompt delegates commits
  to the orchestrator.

## Drift grep survivors (all non-claiming, REQ-APIRUN-006 scenario 1)

- `sentinel-api/app/tests/test_rest_only.py` — the invariant test itself (required).
- `AGENTS.md`, `openspec/config.yaml` — the change-name string
  `remove-api-apscheduler` inside the re-worded single-engine / RESOLVED lines
  (expected per tasks.md).
- `openspec/config.yaml:138` — review-phase rule "Flag any dual-engine
  double-check..." (process instruction, not an engine claim).
- Generated noise: `.pytest_cache`, `.venv`, `node_modules`, `package-lock.json`
  (`scheduler` npm package), `.codegraph/codegraph.db` — not live docs.

## Files changed

- Deleted: `sentinel-api/app/core/scheduler.py`
- Modified: `sentinel-api/app/main.py`, `sentinel-api/pyproject.toml`,
  `sentinel-api/uv.lock`, `README.md`, `sentinel-api/README.md`,
  `sentinel-worker/README.md`, `AGENTS.md`, `openspec/config.yaml`,
  `frontend/src/features/monitors/useMonitors.ts`,
  `sentinel-worker/internal/worker/loop.go`
- Added: `sentinel-api/app/tests/test_rest_only.py`
- SDD artifacts: `tasks.md` (checkboxes + evidence notes), this file.

## Deviations from design

- None functional. The module docstring of `test_rest_only.py` was rewrapped
  (REQ tag moved to line 3) to satisfy ruff E501; the four pinned assertions are
  byte-identical to the tasks.md pin.
- The single commit (D5 step 7) was not created: orchestrator owns commits per the
  apply prompt. Rollback boundary remains the single revert once it lands.

## Remaining tasks

- `- [ ] Single commit (per D5 and config.yaml implement rule “one work unit per
  commit; tests and docs in the same commit as the code”) ...` — delegated to the
  orchestrator (checkbox kept open deliberately; suggested message:
  `feat(api): remove in-process APScheduler — API is REST-only; Go worker is the sole polling engine`).

## Workload / PR boundary

Single PR, single work unit, ≈ 203 authored changed lines (< 400 budget). No chain.
Dual-engine/double-check risk: RESOLVED by this change — only the Go worker writes
check results now; worker-mandatory wording is present in all touched docs
(REQ-APIRUN-006).
