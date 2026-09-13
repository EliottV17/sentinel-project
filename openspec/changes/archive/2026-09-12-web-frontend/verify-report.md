```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:5359f9e65997954879d220fa648a709715900215c22657090536396734b8cd6e
verdict: pass
blockers: 0
critical_findings: 0
requirements: 15/15
scenarios: 28/28
test_command: cd frontend && npm run test; cd sentinel-api && uv run pytest
test_exit_code: 0
test_output_hash: sha256:195388472ec5ee651dff68aab82fa5ff7bc4c84d95bdfa0436ecb04821be1af8
build_command: cd frontend && npm run build
build_exit_code: 0
build_output_hash: sha256:72175bf16b6c8d75fc73e1de717565fa6da37b8d49dc5f4a9210b52f7fe39b6a
```

# Verify Report — `web-frontend` (RE-RUN)

**Status: PASS — ready for sync + archive.** Re-run after the user completed the
Manual Acceptance browser smoke (login → create live+dead monitors → pill flips
within ~10 s → delete works, including the child-row cascade fix commit
`80b3b8f`). The prior run's single CRITICAL blocker (unchecked Acceptance task)
is resolved; this report is the admitted verdict and supersedes the prior
`fail` report, which is retained below for traceability.

## Re-run evidence (all commands executed this session, exit 0)

| Command | Result |
|---------|--------|
| `cd frontend && npm run lint` | eslint clean |
| `cd frontend && npm run typecheck` | `tsc -b` clean |
| `cd frontend && npm run test` | **79 passed (12 files)** |
| `cd frontend && npm run build` | vite OK, 485.29 kB raw / 151.79 kB gz |
| `cd sentinel-api && uv run pytest` | **23 passed** (auth 5, cors 4, monitors **14** — includes the new cascade regression test from `80b3b8f`) |
| `cd sentinel-api && uv run ruff check .` | All checks passed |
| `cd sentinel-api && uv run ruff format --check .` | 43 files already formatted |
| `cd sentinel-api && uv run pyright` | 0 errors, 0 warnings, 0 informations |

## 1. Unchecked-task blocker — RESOLVED

- `grep '^\s*- \[ \]' openspec/changes/web-frontend/tasks.md` → **0 matches**.
- tasks.md:243 — the Manual Acceptance line — is now `- [x]`, reconciled by the
  user after the successful browser smoke.
- 25/25 implementation tasks complete. No CRITICAL archive blockers remain.

## 2. Spec conformance — 15/15 requirements, 28/28 scenarios

- `specs/api-cors/spec.md` — 4/4 requirements PASS (configurable origins,
  middleware without wildcard origin, RED-first regression tests, operational
  documentation). Unchanged since the prior run.
- `specs/web-frontend/spec.md` — 11/11 requirements PASS (login, session-scoped
  token, route protection, live monitors list, freshness hint, naive-UTC
  normalization, create, delete, contract types + base URL, quality gates,
  scope boundary). Unchanged since the prior run.
- The cross-origin production-path CORS scenario's browser-level check is now
  covered by the completed Manual Acceptance smoke (devtools-verified
  `Access-Control-Allow-Origin` with `VITE_API_BASE_URL` + `CORS_ORIGINS`).

## 3. PR boundary integrity — INTACT

`git diff --name-only d39e5d6..HEAD -- sentinel-api/` (PR 1 baseline
`b46d24b`'s parent → HEAD) shows exactly six files:

- The four CORS PR 1 files: `.env.example`, `app/core/config.py`, `app/main.py`,
  `app/tests/api/test_cors.py` (unchanged since prior verify).
- Fix commit `80b3b8f` adds only `app/services/monitor_service.py` (+13/−1) and
  `app/tests/api/test_monitors.py` (+67) — the manual cascade-delete fix and its
  regression test. No other sentinel-api changes exist.
- `80b3b8f` regression test quality: genuinely behavioral — seeds real
  `CheckResult` + `Alert` children via a separate session, deletes the monitor,
  asserts children AND monitor are gone (would fail on `ForeignKeyViolationError`
  without the fix). No tautology, no smoke-only assertion.

## 4. Strict TDD compliance (config.yaml mode: strict_tdd)

- `apply-progress.md` retains TDD Cycle Evidence tables for PR 1/2/3; all test
  files cross-referenced against the codebase; 79 frontend + 23 API tests GREEN
  this session.
- The `80b3b8f` bug fix landed with its regression test in the same commit,
  satisfying the "bug fixes require a regression test" rule. Its RED cycle is
  evidenced by the commit itself (the FK-violation failure mode) rather than a
  logged apply-progress row, because the fix was user-committed after verify —
  noted as an observation, not a blocker; the test and fix are inseparable in
  one commit and the full suite is green.

## 5. Review workload / PR boundary

- Locked forecast (auto-chain, stacked-to-main, 3 PRs) unchanged; no
  `size:exception` requested or inferred; PR 1 applied in isolation first.
- PR 3's only PR 2 file modifications remain `main.tsx`, `App.tsx`,
  `endpoints.ts` as designed. No scope creep found in the re-run.

## Exact blockers

None. Sync (delta specs → `openspec/specs`) and archive
(`archive/2026-09-11-web-frontend` or current date) are unblocked.

---

# Prior verify report (fail) — retained for traceability

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:fbd755b20f3f7f003af37c4a81dbbaf40580676fb2a07e4fa48fc7adccff6457
verdict: fail
blockers: 1
critical_findings: 1
requirements: 15/15
scenarios: 28/28
test_command: cd frontend && npm run test; cd sentinel-api && uv run pytest
test_exit_code: 0
test_output_hash: sha256:d132ccb3451c29ca115d5a278bf340f1790779bdf4fcba8a4cb63885e15fd5af
build_command: cd frontend && npm run build
build_exit_code: 0
build_output_hash: sha256:95c37118803ea7058d00f1bfdae113c1812b8ddabc6df43ebc083c7c75a180a1
```

# Verify Report — `web-frontend`

**Status: FAIL (archive-gated) — implementation itself is verified sound.** All 15
requirements and 28 scenarios are covered by implementation + automated evidence. 24/25
tasks complete; the single unchecked task is the Manual Acceptance browser smoke, an
unchecked implementation task and therefore a CRITICAL archive blocker under the SDD
contract even though the parent brief scoped it out of this run's manual execution.
Next action is user-run acceptance, then checkbox reconciliation and a clean re-verify.

## Test and build evidence (all run this session, exit 0)

| Command | Result |
|---------|--------|
| `cd frontend && npm run lint` | eslint clean |
| `cd frontend && npm run typecheck` | `tsc -b` clean |
| `cd frontend && npm run test` | 79 tests passed (12 files) |
| `cd frontend && npm run build` | vite OK, 485.29 kB raw / 151.79 kB gz |
| `cd sentinel-api && uv run pytest` | 22 passed (auth 5, cors 4, monitors 13) |
| `cd sentinel-api && uv run ruff check .` | All checks passed |
| `cd sentinel-api && uv run ruff format --check .` | 43 files already formatted |
| `cd sentinel-api && uv run pyright` | 0 errors, 0 warnings, 0 informations |

## Spec coverage

### `specs/api-cors/spec.md` — 4/4 requirements PASS

| Requirement | Verdict | Evidence |
|---|---|---|
| Configurable allowed origins | PASS | `sentinel-api/app/core/config.py` — `CORS_ORIGINS: str = ""` + `cors_origins_list` property (split/strip/drop-empty). Tests cover empty default and configured parsing (`test_cors.py` cases 1, 4). |
| CORS middleware on the API app | PASS | `sentinel-api/app/main.py` — `CORSMiddleware` with `allow_origins=settings.cors_origins_list`, `allow_credentials=True`, `allow_methods/headers=["*"]`; no wildcard origin. Tests assert allow-origin, credentials header, preflight without Authorization, rejected origin. |
| Regression-tested CORS (strict TDD) | PASS | `sentinel-api/app/tests/api/test_cors.py` (4 cases, reload fixture, no DB fixtures); RED evidence in apply-progress PR 1 table; suite green (22 passed). |
| Operational documentation | PASS | `sentinel-api/.env.example` documents `CORS_ORIGINS=` (empty default, comma-separated, empty disables cross-origin). |

### `specs/web-frontend/spec.md` — 11/11 requirements PASS

| Requirement | Verdict | Evidence |
|---|---|---|
| Login with existing credentials | PASS | `features/login/LoginPage.tsx` (RHF+zod); `endpoints.ts` `login()` posts `application/x-www-form-urlencoded` via `URLSearchParams` with `onUnauthorized:"ignore"` so 401 stays inline; 4 LoginPage tests. |
| Session-scoped token handling | PASS | `app/api/token.ts` (memory + sessionStorage write-through, key `sentinel.access_token`, never localStorage); `app/auth/jwt.ts` derives expiry from `exp` only (no hardcoded 30-min constant — grep-verified); AuthProvider 30 s exp-watcher; 401 → clear + `/login?next=…`; Logout clears and navigates. |
| Route protection | PASS | `app/auth/guards.tsx` `RequireAuth` → `Navigate to /login state={{from}} replace`; wired in `App.tsx`. |
| Monitors list with live state | PASS | `MonitorRow.tsx` renders name/target/frequency/last_state/last_checked_at/consecutive_failures; `StatusPill.tsx` derives from `last_state` only (null→muted "Never checked"); `useMonitors.ts` polls `['monitors']` at 10 s (`REFETCH_INTERVAL_MS`), hidden-tab pause via `refetchIntervalInBackground: false`, error backoff 30 s keeping last data; mutations invalidate in `useMonitorMutations.ts`; `check_config` never rendered (only in the POST body and comments — grep-verified). |
| Freshness hint | PASS | `lib/datetime.ts` `isEngineStale` uses `max(frequency, 30) × 2` from data, not alerts; MonitorRow renders hint; boundary pinned in tests. |
| Naive-UTC normalization | PASS | `lib/datetime.ts` `parseApiDate` appends `Z` only when no TZ designator; `formatDateTime` uses user locale/timezone; 15 pinned-timezone tests. |
| Create monitor | PASS | `CreateMonitorForm.tsx` (1–100 name, `new URL()` target, frequency ≥ 10 default 60); `lib/checkers.ts` locks `check_type: "http"` + default `check_config {expected_status:200, timeout:10, method:"GET"}`; `lib/api/errors.ts` fields branch maps `[{loc,msg}]` → offending field (exercised by create-form tests); 201 → invalidate. |
| Delete monitor | PASS | `DeleteButton.tsx` two-step inline confirm (no native `confirm()` — grep-verified); 404 → "Monitor not found — refreshing list" + `onSettled` invalidate. |
| API contract types and base URL | PASS | `lib/api/schema.ts` (658 lines, committed, real operation ids used); `client.ts` `API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""`; dev proxy in `vite.config.ts`. Cross-origin browser path's API precondition (CORS headers) is test-verified; the browser-level check is the pending manual Acceptance task. |
| Quality gates for the new toolchain | PASS | All four frontend gates + all four API static gates green this session; `openspec/config.yaml` `testing.runners.frontend` documented; README frontend section present; CI frontend job added. |
| Scope boundary (non-goals) | PASS | No edit/PATCH, history, alerts, SSE/WebSocket, pagination, registration, or component-library surfaces exist in `frontend/src` (file inventory + grep verified). |

## Task completion

- 24/25 checked. Every checked task has matching artifacts (verified against the file tree and the TDD evidence in apply-progress.md).
- Remaining unchecked implementation task (exact line):
  `- [ ] Acceptance (verification, risk §6 CORS-silent-failure + dual-engine checks): manual`
- This is the manual browser smoke against the running stack — explicitly out of scope of this read-only verify run per the parent brief. **Archive is not ready** until the user runs it and the checkbox is reconciled.

## Structured status / actionContext findings

- Status: ready, artifactStore openspec, mode repo-local, allowedEditRoots = workspace root — consistent with observed files. No warnings.
- Sync and archive remain blocked pending a clean verify + the manual acceptance.

## Strict TDD compliance

- `apply-progress.md` contains `TDD Cycle Evidence` tables for all three PRs with per-cycle RED→GREEN→TRIANGULATE commands and outputs; test files cross-referenced against the codebase all exist.
- All 79 frontend tests and 22 API tests re-ran GREEN this session.
- Assertion quality: spot-audit found behavior assertions (form-encoding via MSW request body, pill mapping from `last_state`, fields-branch error mapping, hidden-tab no-fetch with `visibilityState` stub, 404 `onSettled` invalidation), boundary tests (exp skew, isEngineStale exact threshold), and negative paths (malformed JWT, non-JSON error body, never-localStorage access-bomb). No tautologies, ghost loops, or smoke-only tests found.

## Review workload / PR boundary

- Locked forecast: auto-chain, stacked-to-main, 3 PRs, no `size:exception` requested or inferred — consistent with tasks.md Forecast table.
- `git diff --stat` on tracked files: exactly `.github/workflows/ci.yml`, `README.md`, `sentinel-api/.env.example`, `sentinel-api/app/core/config.py`, `sentinel-api/app/main.py` (77 insertions, 2 deletions) + new untracked `sentinel-api/app/tests/api/test_cors.py` and `frontend/`. **No sentinel-api production code beyond the four CORS files.**
- PR 2 files other than the named hunks are unchanged: `errors.ts` needed no edit (its `fields` branch landed in PR 2 and is now exercised by the create-form tests); only `main.tsx` (QueryClient defaults), `App.tsx` (route hunk), and `endpoints.ts` (monitor calls appended; `login()` untouched) were modified, exactly as designed.

## Risks / security spot-checks

- No `dangerouslySetInnerHTML` anywhere in `frontend/src` (grep-verified). PASS
- `check_config` is never rendered — only posted in the create body and referenced in comments. PASS
- No `localStorage` usage in the token store (grep-verified; sessionStorage only). PASS
- JWT expiry derived solely from `exp` (`isExpired`/`isExpiringSoon`); no hardcoded 30-min lifetime constant in auth code. PASS

## Exact blockers

1. **CRITICAL — Manual Acceptance task unchecked** (`tasks.md`, PR 3): `- [ ] Acceptance (verification, risk §6 CORS-silent-failure + dual-engine checks): manual` — requires the user's browser smoke (login → create live/dead monitor → pill flips within ~10–15 s → delete; prod-path CORS check with `VITE_API_BASE_URL` + `CORS_ORIGINS`). Archive is not ready; after the user completes the smoke, tick the checkbox and re-run verify for a clean pass.