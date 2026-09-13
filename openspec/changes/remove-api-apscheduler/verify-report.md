```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:f02ff7fc5d3c3cbd1e24701a329f28590639407aff22c6f540bba3c2833dc90d
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 16/16
test_command: cd sentinel-api && uv run pytest
test_exit_code: 0
test_output_hash: sha256:ab35ab26403e0e914ea032003934fd4b7f9dcedad3ba24214d12d0dc12779fc7
build_command: cd sentinel-worker && go build ./cmd/worker/
build_exit_code: 0
build_output_hash: sha256:895bc7411740100a005fefe2a307fac6fc9655f7e43fd9456a94af3bad563637
```

# Verify Report — `remove-api-apscheduler`

Phase: sdd-verify (executor). Verified against the **live working tree** (no commit
exists — the single-commit task is orchestrator-delegated). Read-only verification;
no code was edited by this phase.

## Verdict

**pass_with_warnings** — all 7 requirements (REQ-APIRUN-001..007) and all 16 spec
scenarios are verified against the working tree with exact command evidence.
Implementation, tests, docs, and design coherence are clean: zero verification
blockers, zero critical findings. One warning remains (see Warnings): the
orchestrator-delegated single-commit task is unchecked by design, because no
commit exists yet and commits are delegated to the orchestrator. This is not a
verification defect (the parent phase contract verifies against the working
tree), but **archive is NOT ready** until that commit lands and its checkbox is
closed.

## Task completion status

28/29 implementation tasks checked in `tasks.md`. Exact remaining unchecked line:

- `- [ ] Single commit (per D5 and config.yaml implement rule “one work unit per`
  (commit; tests and docs in the same commit as the code) — **deliberately open**;
  the apply prompt forbids the apply executor from committing and delegates commit/PR
  creation to the orchestrator. Apply-progress documents this as `DELEGATED`. Not
  treated as an implementation defect per the parent phase contract, but it remains
  an archive blocker per the strict checkbox rule.

No other unchecked `- [ ]` implementation task markers exist.

## Requirement-by-requirement evidence (exact commands run this phase)

### REQ-APIRUN-001 — No in-process checking engine — PASS

- `ls sentinel-api/app/core/scheduler.py` → `No such file or directory` (exit 2).
- Focused test `uv run pytest app/tests/test_rest_only.py -v` (sentinel-api/):
  `4 passed in 0.01s`, including `test_scheduler_module_is_deleted`
  (`find_spec("app.core.scheduler") is None`).
- `grep -rnE 'AsyncIOScheduler|BackgroundScheduler|check_all_monitors' sentinel-api/app/`
  → only the invariant test's own `forbidden` tuple literal (self-excluded by
  `p != THIS_FILE`) plus stale gitignored `__pycache__` binaries
  (`scheduler.cpython-314.pyc`; confirmed `git check-ignore` → ignored; the spec's
  "no matches" scenario concerns source code, and `test_no_scheduler_code_resurrected`
  rglob-scans `*.py` only). No dead scheduler code remains.

### REQ-APIRUN-002 — Default (no-op) lifespan — PASS

- `app/main.py` inspected: `app = FastAPI(title="Sentinel API")` — no `lifespan`
  import, no `lifespan=` argument, no scheduler wiring. CORS middleware, root
  endpoint, `include_router` unchanged.
- Test `test_main_py_has_no_lifespan_wiring` (`"lifespan" not in vars(main_module)`) green.

### REQ-APIRUN-003 — apscheduler dependency removed — PASS

- `grep -n "apscheduler" sentinel-api/pyproject.toml` → no matches.
- `grep -n "apscheduler" sentinel-api/uv.lock` → no matches.
- `cd sentinel-api && uv sync --frozen` → `Checked 72 packages in 0.33ms`, exit 0.
- `find_spec("apscheduler")` in the synced venv → None (test 3 green).

### REQ-APIRUN-004 — Checker extension point preserved — PASS

- `sentinel-api/app/core/checkers/` intact: `base.py`, `registry.py`,
  `http_checker.py`, `__init__.py`.
- `uv run python -c "from app.core.checkers.registry import get_checker; from
  app.core.checkers import http_checker; print(get_checker('http'))"` →
  `<app.core.checkers.http_checker.HttpChecker object at 0x…>` — registry functional.
- `app/main.py` line 5 retains `from app.core.checkers import http_checker  # noqa: F401`.

### REQ-APIRUN-005 — REST-only invariant test — PASS

- `sentinel-api/app/tests/test_rest_only.py` exists (47 lines) with the 4 pinned
  assertions, including the `p != THIS_FILE` self-exclusion reconciled in
  design D3/tasks.md.
- RED evidence cross-referenced: `apply-progress.md` TDD Cycle Evidence row 1
  records `4 failed in 0.03s` with the exact failing assertions for all four
  tests against the pre-change code (module spec found, `lifespan` in
  `vars(main_module)`, `apscheduler` importable, `app/core/scheduler.py` offender).
- GREEN this phase: focused run `4 passed in 0.01s`; full suite `27 passed in 2.59s`.

### REQ-APIRUN-006 — Docs state worker-only checking — PASS

- Stale-claim grep across all 7 target files
  (`grep -nEi 'apscheduler|in-process scheduler|scheduler\.py|dual-engine|…'`):
  the only match is `AGENTS.md:62`, whose text is the reworded single-engine
  claim containing the change-name string `remove-api-apscheduler` — a non-claiming
  survivor allowed by the spec scenario.
- Worker-mandatory language verified present: root `README.md` ("official polling
  engine … required — without it, no monitor is ever checked and no alerts fire"),
  `sentinel-api/README.md` ("sole polling engine and is required — the API performs
  no checks itself"; "The API is REST-only. Monitoring requires the Go worker"),
  `sentinel-worker/README.md` ("sole checking engine"; "the only checking engine"),
  `AGENTS.md` ("Single engine, one schema … If the worker is not running, nothing
  is checked").
- `openspec/config.yaml`: L16 `+ REST-only (checking runs in the Go worker)`;
  L35–36 single-engine resolution line; L153–154 `risks_known` dual-engine line
  **re-worded as RESOLVED, not deleted** — kept with worker-mandatory wording.
- `frontend/src/features/monitors/useMonitors.ts`: comment justifies the 10 s poll
  from UI freshness and points cadence at the Go worker's per-monitor `frequency`;
  no frontend code change (comment-only diff).

### REQ-APIRUN-007 — Schema and worker behaviour untouched — PASS

- `git status --porcelain sentinel-api/migrations sentinel-api/app/models
  sentinel-worker/` → only `sentinel-worker/README.md` (docs) and `loop.go`; no
  Alembic revision, no model change.
- `git diff sentinel-worker/internal/worker/loop.go` → comment-only (header comment
  reworded to "sole polling engine (the API is REST-only)").
- `go vet ./...` exit 0; `go build ./cmd/worker/` exit 0.

## Structured status and actionContext findings

- Native status: `applyState: ready`, `nextRecommended: sdd-apply` (pre-verify);
  verify/sync/archive dependencies reflect the open commit task. `actionContext.mode:
  repo-local` with `allowedEditRoots` covering the whole repo — no workspace-planning
  blocker. No unexpected warnings.
- The `nextRecommended: "sdd-apply"` is stale relative to this verify run: the
  orchestrator explicitly granted verify attempt authority; implementation is
  28/29 complete with the last item delegated.

## Test/validation commands run (exact)

From `sentinel-api/`:

- `uv run pytest app/tests/test_rest_only.py -v` → `4 passed in 0.01s`
- `uv run pytest` → `27 passed in 2.59s` (matches apply-progress's 27 passed)
- `uv run ruff check .` → `All checks passed!`, exit 0
- `uv run ruff format --check .` → `43 files already formatted`, exit 0
- `uv run pyright` → `0 errors, 0 warnings, 0 informations`, exit 0
- `uv sync --frozen` → `Checked 72 packages`, exit 0

From `sentinel-worker/`:

- `go vet ./...` → exit 0 (no output)
- `go build ./cmd/worker/` → exit 0 (no output; binary removed after check)

## Strict TDD compliance

- `apply-progress.md` contains a `TDD Cycle Evidence` table with RED (row 1,
  `4 failed in 0.03s`), sequenced GREEN-code (row 2), GREEN-deps (row 3), full
  suite (row 4), static (row 5), worker sanity (row 6), frontend typecheck (row 7).
- The RED test (`app/tests/test_rest_only.py`) exists in the working tree and
  cross-references correctly; RED-before/green-after is documented with exact
  failing assertions.
- All gates re-run this phase and still GREEN (see commands above).

### Assertion quality audit

- `test_rest_only.py`: four assertions are genuine absence/wiring checks
  (`find_spec is None`, `vars(main_module)` binding, `find_spec is None`,
  filesystem rglob scan). No tautologies, no ghost loops, no type-only or
  smoke-only assertions, no implementation-detail CSS assertions.
- The self-exclusion (`p != THIS_FILE`) is the reconciled D3 fix and is present.
- Deliberately-not-asserted router internals (design D3) correctly avoided — no
  false-guarantee assertion exists.
- No quality findings.

## Review workload / PR boundary

- Forecast: single PR, no chained PRs, no `size:exception`, chain strategy
  `deferred` (unused) — implementation matches: single work unit, no chain, no
  exception claimed.
- Diff accounting (measured this phase): tracked diff `+29 / −64` across 10 files
  = **93 lines**; plus the new 47-line `test_rest_only.py` → **≈140 authored
  code+docs lines** (the runtime ledger settled at 419 including SDD artifacts,
  which are excluded from the review budget). Code+docs are well under the
  400-line budget. No scope creep beyond assigned tasks: `git status` shows only
  the intended files plus this change's openspec artifacts (untracked).

## Drift check

Repo-wide `grep -rniE 'apscheduler|AsyncIOScheduler|check_all_monitors|"Starting engine"'
(excluding archive/.git/generated caches and this change's own artifacts) →
survivors are exactly the allowed non-claiming set: the invariant test file,
the `remove-api-apscheduler` change-name string inside reworded `AGENTS.md:62`
and `openspec/config.yaml:35,153`, and `config.yaml:143` ("resolved SDD session
preferences" — substring match, not an engine claim). No npm `scheduler` package
noise surfaced after excluding generated files. No docs drift.

## Warnings and remaining scope (no verification blockers)

- **Open task = remaining delivery scope, orchestrator-owned (not an
  implementation defect):** the single-commit task
  `- [ ] Single commit (per D5 and config.yaml implement rule “one work unit per
  commit; tests and docs in the same commit as the code”)` is unchecked. No
  commit exists (verification ran against the working tree by design; the apply
  prompt forbids the apply executor from committing). The orchestrator must
  create the commit (suggested message recorded in apply-progress.md / tasks.md),
  close the checkbox, and then proceed to sync → archive. Per the strict checkbox
  rule this keeps **archive not ready** despite the clean verification of the
  working-tree candidate; the delta-spec sync may proceed on the strength of this
  report once the orchestrator accepts the working-tree candidate.

## Risks remaining

- **Worker-mandatory posture:** with `sentinel-worker` not running, nothing is
  checked and no alerts fire — documented (not engineered) by design; all touched
  docs now state this. `sentinel-worker` still has zero Go tests (pre-existing
  `risks_known` item, untouched by this change).
- The verified candidate is the working tree; a commit hash does not exist yet,
  so archive must wait for the orchestrator's commit + checkbox close.