# Tasks — `web-frontend`

Greenfield React + Vite (TS) SPA for sentinel plus the single backend CORS change.
Delivery decision (locked, do not re-open): **auto-chain**, **stacked-to-main**, split
into 3 chained PRs with **PR 1 applied first and in isolation**. Grouping below follows
design §2 slice boundaries; task detail follows design §3 (CORS), §4 (scaffold + auth),
§5 (monitors), §6 (risks).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,400–2,100 (PR1 ≈150–300; PR2 ≈600–750; PR3 ≈550–750) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

Note: PR 2 and PR 3 individually exceed 400 changed lines; this is accepted by the
locked auto-chain decision (design §12 argues a strict per-PR cap would force a 4th chain
for marginal review benefit). No `size:exception` is requested or inferred. PR 1 is
independently deployable; PR 2/PR 3 stack on top and never modify PR 1 files.

Shared prerequisites for all gates below (config.yaml testing requirements): `docker
compose up -d` (repo root, `sentinel_db`), `CREATE DATABASE sentinel_tests_db` (manual,
once), and `cd sentinel-api && uv sync --group dev` for API commands; `cd frontend && npm
install` once PR 2 scaffolding lands.

---

## PR 1 — CORS backend slice (apply first, in isolation)

Scope boundary: exactly four files — `sentinel-api/app/core/config.py`,
`sentinel-api/app/main.py`, `sentinel-api/.env.example`,
`sentinel-api/app/tests/api/test_cors.py`. Touches NO JWT/auth code, NO schema/router/
service/model/migration code, NO worker, NO CI. Rollback = revert two hunks or set
`CORS_ORIGINS=""`.

- [x] RED: write `sentinel-api/app/tests/api/test_cors.py`. Middleware captures
  `allow_origins` at registration and `config.settings` instantiates at import time, so
  the module uses the design §3.3 reload pattern: `cors_app(monkeypatch, origins)` →
  `monkeypatch.setenv("CORS_ORIGINS", ...)` → `importlib.reload(app.core.config)` →
  `importlib.reload(app.main)` → yield `AsyncClient(ASGITransport(app.main.app))`;
  teardown re-reloads both modules with the env unset to restore the session default.
  Cases: (1) configured origin GET `/` gets `Access-Control-Allow-Origin` + credentials
  header; (2) preflight `OPTIONS /api/v1/monitors/` with `Origin` +
  `Access-Control-Request-Method: GET` succeeds **without** an Authorization header; (3)
  unconfigured origin gets no allow-origin header; (4) explicit `CORS_ORIGINS=""` blocks.
  No DB fixtures (`override_session_db`, `auth_headers`) are used. Run and record the
  failing output: `cd sentinel-api && uv run pytest app/tests/api/test_cors.py -v` — must
  be RED on the header assertions (no middleware exists today). <!-- sdd-owner: implementation -->
- [x] GREEN: add `CORS_ORIGINS: str = ""` field plus
  `cors_origins_list -> list[str]` property (split on `,`, strip whitespace, drop empty
  entries) to `sentinel-api/app/core/config.py`; register
  `app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list,
  allow_credentials=True, allow_methods=["*"], allow_headers=["*"])` in
  `sentinel-api/app/main.py` immediately after `app = FastAPI(...)`. Re-run
  `cd sentinel-api && uv run pytest app/tests/api/test_cors.py -v` → GREEN (all four
  cases; `allow_credentials=True` forbids any wildcard, and it is never used). <!-- sdd-owner: implementation -->
- [x] Docs: add a `CORS_ORIGINS` line to `sentinel-api/.env.example` (empty default,
  comma-separated origins, example SPA origin, noting `CORS_ORIGINS=""` disables
  cross-origin access at any time). No dedicated test; empty-default behavior is already
  covered by CORS case (4). <!-- sdd-owner: implementation -->
- [x] PR 1 gate (refactor/verify): run the full backend suite and static checks —
  `cd sentinel-api && uv run pytest` and
  `uv run ruff check . && uv run ruff format --check . && uv run pyright`. Confirm
  `git diff --stat` is ≤ ~300 lines and only the four PR 1 files changed; if the reload
  fixture shows duplication while green, refactor it and re-run the focused test then the
  full suite. Worker untouched (`go vet && go build ./cmd/worker/` must stay green by
  construction). <!-- sdd-owner: implementation -->

---

## PR 2 — Frontend scaffold, API client, auth

Scope boundary: new `frontend/` tree only, plus `openspec/config.yaml`
(`testing.runners.frontend`), `README.md`, `.github/workflows/ci.yml`. No
`sentinel-api` production edits. Deliverable state: PR 2 builds and its suite passes with
the monitors feature **absent** (`/` shows a placeholder); `src/app/api/endpoints.ts` in
this PR contains `login()` only; `src/lib/api/schema.ts` is committed here and covers the
whole contract, so PR 3 adds no codegen step.

- [x] Scaffold (hand-written, NOT `npm create vite` output): create `frontend/package.json`
  (deps: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`,
  `react-hook-form`, `zod`, `tailwindcss`, `@tailwindcss/vite`; devDeps: `vite`,
  `typescript`, `@types/react`, `@types/react-dom`, eslint 9 flat config +
  `typescript-eslint` + `eslint-plugin-react-hooks`, `vitest`,
  `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw`,
  `openapi-typescript`; scripts per design §4.1: `dev`, `build` = `tsc -b && vite build`,
  `lint`, `typecheck` = `tsc -b`, `test` = `vitest run`, `test:watch`,
  `gen:api` = `openapi-typescript http://localhost:8000/openapi.json -o src/lib/api/schema.ts`),
  plus `frontend/tsconfig.json` (+ project refs), `frontend/vite.config.ts` (react +
  tailwind plugins; `server.proxy { "/api": "http://localhost:8000" }`; vitest jsdom
  config), `frontend/index.html`, `frontend/.env.example` (`VITE_API_BASE_URL=` empty),
  `frontend/.gitignore`, `frontend/src/main.tsx` (QueryClientProvider + RouterProvider),
  `frontend/src/App.tsx` (route tree: `/login`, guarded `/` placeholder, `*` → `/`), and
  `frontend/src/app/styles/globals.css` (`@import "tailwindcss"`). Verify:
  `cd frontend && npm install && npm run build`. <!-- sdd-owner: implementation -->
- [x] Toolchain registration: replace the `status: none` block in
  `openspec/config.yaml` `testing.runners.frontend` verbatim with the design §4.1 YAML
  (`cwd: frontend; setup: npm ci; focused: npx vitest run {test_path}; full: npm run
  test; build: npm run build; static: [npm run lint, npm run typecheck]`); validate the
  file still parses (e.g. `python3 -c "import yaml,sys; yaml.safe_load(open('openspec/config.yaml'))"`).
  Add frontend run instructions (install, dev server, build, test) to `README.md`. Add a
  `frontend` job to `.github/workflows/ci.yml` (`npm ci` → lint → typecheck → test →
  build); API gates unchanged. <!-- sdd-owner: implementation -->
- [x] Codegen: with a running dev API (`cd sentinel-api && uv run uvicorn app.main:app`),
  run `cd frontend && npm run gen:api` and commit `frontend/src/lib/api/schema.ts`
  (deterministic output, no build-time network). Verify it contains types for
  `auth_login` and the `/api/v1/monitors/` operations. Regenerated only when the API
  contract changes. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/app/api/token.test.ts` (set/get/clear; sessionStorage
  write-through on key `sentinel.access_token`; restore-on-first-read after simulated
  refresh; no `localStorage` usage) → GREEN `frontend/src/app/api/token.ts` (module-level
  singleton store, pure module with no router/React imports). Run:
  `cd frontend && npx vitest run src/app/api/token.test.ts` — RED first (module missing),
  GREEN after implementation. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/app/api/client.test.ts` (MSW: Bearer header attached when a token
  is set; `ApiError` normalization for both string `detail` and `[{loc,msg,type}]` list;
  a 401 invokes the registered unauthorized handler AND clears `tokenStore`) → GREEN
  `frontend/src/lib/api/errors.ts` (`normalizeDetail` → `{message?, fields}`; string
  normalization cases only here — field mapping is exercised in PR 3) and
  `frontend/src/app/api/client.ts` (`apiFetch<T>`, `setUnauthorizedHandler(fn)`, no
  client→router import cycle, base URL from `import.meta.env.VITE_API_BASE_URL ?? ""`).
  Run `npx vitest run src/app/api/client.test.ts` RED → implement → GREEN. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE `client.test.ts`: assert unauthenticated calls send no Authorization
  header and that a non-JSON error body degrades to a form-level message — then re-run
  `npx vitest run src/app/api/client.test.ts` while green. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/app/auth/jwt.test.ts` (pad-safe base64url decode of a real-shape
  token fixture → `{exp, sub}`; malformed payload → `null`; `isExpired` and
  `isExpiringSoon(payload, skewSeconds = 60)` boundary cases, no hardcoded 30-min
  constant) → GREEN `frontend/src/app/auth/jwt.ts`. Run
  `npx vitest run src/app/auth/jwt.test.ts` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/app/auth/guards.test.tsx` (unauthenticated visit to protected
  route → `<Navigate to="/login" state={{from: pathname}} replace/>`) → GREEN
  `frontend/src/app/auth/guards.tsx` (`RequireAuth`) and the `frontend/src/App.tsx` route
  tree: `/login`, `/` wrapped in `RequireAuth` rendering a "Monitors — PR 3" placeholder,
  `*` → `/`. Run `npx vitest run src/app/auth/guards.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/app/auth/AuthProvider.test.tsx` (login success stores token +
  `isAuthenticated`; login 401 surfaces `ApiError` to the caller, no redirect; logout
  clears token + navigates to `/login`; 30 s exp-watcher auto-logout via `isExpiringSoon`;
  on mount registers the `client.ts` unauthorized handler → `/login?next=…`; MSW
  assertions that login posts `application/x-www-form-urlencoded` via `URLSearchParams`,
  NOT JSON) → GREEN `frontend/src/app/auth/AuthProvider.tsx` (`useAuth`), an `AppShell`
  (app name + Logout button) around the protected outlet, and `frontend/src/app/api/endpoints.ts`
  (`login(username, password)` typed from `schema.ts`; monitor calls deferred to PR 3).
  Run `npx vitest run src/app/auth/AuthProvider.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/features/login/LoginPage.test.tsx` (valid submit navigates to
  `location.state.from`; 401 → inline "Invalid credentials or email", stays on the form,
  no redirect; network/5xx → form-level "API unreachable" message) → GREEN
  `frontend/src/features/login/LoginPage.tsx` (react-hook-form + zod: `username` and
  `password` nonempty). Run `npx vitest run src/features/login/LoginPage.test.tsx` RED →
  GREEN. <!-- sdd-owner: implementation -->
- [x] PR 2 gate (refactor/verify): `cd frontend && npm run lint && npm run typecheck &&
  npm run test && npm run build`; re-run `cd sentinel-api && uv run pytest` (must stay
  green — no API edits in this PR). Confirm `git diff --stat` ≤ ~750 lines and that no
  `sentinel-api/` file other than (unchanged) docs is touched; refactor only while green,
  then re-run the frontend full suite. <!-- sdd-owner: implementation -->

---

## PR 3 — Monitors feature (list, poll, create, delete)

Scope boundary: `features/monitors/`, `lib/datetime.ts`, `lib/checkers.ts`,
`src/components/` primitives, QueryClient defaults in `src/main.tsx`; the only PR 2 files
touched are `frontend/src/App.tsx` (one route-wiring hunk) and
`frontend/src/app/api/endpoints.ts` (append monitor calls). No backend changes at all.

- [x] RED `frontend/src/lib/datetime.test.ts` (pinned timezone via injected `now`/`Intl`:
  `parseApiDate` appends `Z` only when the string has no timezone designator —
  `"2025-01-15T10:00:00"` must render as 10:00 UTC with no local shift; already-designated
  `Z`/`±HH:MM` strings pass through untouched; `formatDateTime` uses user locale/timezone;
  `formatRelative` "x s/min/h ago"; `isEngineStale` true when age >
  `max(frequency, 30) × 2`) → GREEN `frontend/src/lib/datetime.ts` — the single
  normalization chokepoint every render path uses. Run
  `npx vitest run src/lib/datetime.test.ts` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE `datetime.test.ts`: add exact-threshold boundary and pre-designated
  timezone cases, then re-run `npx vitest run src/lib/datetime.test.ts` while green. <!-- sdd-owner: implementation -->
- [x] GREEN `frontend/src/components/{Button,Input,Spinner,Card}.tsx` — five small
  Tailwind primitives (StatusPill lives under `features/monitors/`); no standalone tests:
  they are exercised through the feature tests below (no component library in MVP). <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/features/monitors/useMonitors.test.tsx` (MSW + fake timers:
  initial fetch; default 10 s `refetchInterval`; hidden-tab pause with
  `refetchIntervalInBackground: false` — advance timers while `document.hidden` → no
  fetch, and resume on visibility; persistent error retains last data with the error
  state and returns a 30 s backoff interval; success restores 10 s) → GREEN
  `frontend/src/features/monitors/useMonitors.ts` (`useQuery({queryKey: ['monitors'], …,
  refetchInterval: (q) => q.state.error ? 30_000 : REFETCH_INTERVAL_MS})`,
  `REFETCH_INTERVAL_MS = 10_000` optionally overridden by `VITE_POLL_INTERVAL_MS`) and
  the QueryClient defaults in `frontend/src/main.tsx` (`staleTime: 5_000`, `retry: 2`,
  `retryDelay: min(1000·2^a, 4000)`, `refetchOnWindowFocus: true`,
  `refetchIntervalInBackground: false`). Run
  `npx vitest run src/features/monitors/useMonitors.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/features/monitors/MonitorList.test.tsx` (pill mapping from
  `last_state` only: `null` → muted "Never checked", `"healthy"` → green Healthy,
  `"unhealthy"` → red Unhealthy; fields `name`/`target`/`frequency`/
  `consecutive_failures` rendered; `check_config` NEVER rendered; freshness hint shown
  when `isEngineStale`; frequency tooltip for slow monitors) → GREEN
  `frontend/src/features/monitors/MonitorList.tsx`, `MonitorRow.tsx`, and
  `frontend/src/features/monitors/StatusPill.tsx` (pure `last_state` → label + Tailwind
  classes). Run `npx vitest run src/features/monitors/MonitorList.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/features/monitors/CreateMonitorForm.test.tsx` (client validation
  mirrors server: empty `name`, non-URL `target` via `new URL()`, `frequency` < 10
  rejected, default 60; posted body has `check_type: "http"` locked + `check_config`
  `{expected_status: 200, timeout: 10, method: "GET"}`; 201 → `['monitors']` invalidated
  and refetched immediately; 400 `[{loc,msg}]` list maps to the offending field — e.g.
  `frequency`; string `detail` → form-level message) → GREEN
  `frontend/src/features/monitors/CreateMonitorForm.tsx` (RHF + zod),
  `frontend/src/lib/checkers.ts` (`CHECKER_CONFIG_SCHEMA` + `DEFAULT_CHECK_TYPE =
  "http"` — the future-checker extension point), `useCreateMonitor` in
  `frontend/src/features/monitors/useMonitorMutations.ts` (`onSuccess` → invalidate), the
  `fields` mapping branch in `frontend/src/lib/api/errors.ts`, and `createMonitor` in
  `frontend/src/app/api/endpoints.ts`. Run
  `npx vitest run src/features/monitors/CreateMonitorForm.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/features/monitors/DeleteButton.test.tsx` (two-step inline confirm
  — first click asks, second click deletes; no native `confirm()`; success → row removed
  via invalidation; 404 → "Monitor not found — refreshing list" message + invalidation in
  `onSettled`) → GREEN `frontend/src/features/monitors/DeleteButton.tsx`,
  `useDeleteMonitor` in `useMonitorMutations.ts` (`onSettled` invalidates `['monitors']`;
  `onError` maps `ApiError.status === 404`), and `deleteMonitor(id)` in
  `frontend/src/app/api/endpoints.ts`. Run
  `npx vitest run src/features/monitors/DeleteButton.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] RED `frontend/src/features/monitors/MonitorsPage.test.tsx` (renders last known data
  even in error state and shows the stale/offline banner; success state renders list +
  create form) → GREEN `frontend/src/features/monitors/MonitorsPage.tsx` (compose
  `useMonitors` + banner + `CreateMonitorForm` + `MonitorList`) and the single
  `frontend/src/App.tsx` hunk replacing the PR 2 placeholder with `MonitorsPage` (all
  PR 2 files otherwise untouched). Run
  `npx vitest run src/features/monitors/MonitorsPage.test.tsx` RED → GREEN. <!-- sdd-owner: implementation -->
- [x] PR 3 gate (refactor/verify): `cd frontend && npm run lint && npm run typecheck &&
  npm run test && npm run build`; confirm `git diff --stat` ≤ ~750 lines and the only PR 2
  file changes are `src/App.tsx` + `src/app/api/endpoints.ts`; re-run the API suite
  `cd sentinel-api && uv run pytest` (untouched, but gate stays green); refactor only
  while green and re-run the frontend full suite. <!-- sdd-owner: implementation -->
- [x] Acceptance (verification, risk §6 CORS-silent-failure + dual-engine checks): manual
  browser smoke against the running stack — `cd sentinel-api && CORS_ORIGINS=http://localhost:5173
  uv run uvicorn app.main:app` and `cd frontend && npm run dev`; login → create a monitor
  against a live URL and one against a dead URL → verify the pill flips healthy/unhealthy
  within ~10–15 s (10 s engine lattice), "Never checked" before first check, and delete
  removes it; then validate the prod cross-origin path with
  `VITE_API_BASE_URL=http://localhost:8000` while `CORS_ORIGINS` lists the SPA origin
  (Access-Control-Allow-Origin present in devtools). Confirm no
  `dangerouslySetInnerHTML` anywhere and `check_config` renders nowhere. <!-- sdd-owner: implementation -->

---

## Standing review checklist (per design §6, not tasks)

- Dual-engine duplicate `check_result`/`alert` rows: MVP reads only `monitor.last_state`
  (last-writer-wins) — duplicates stay invisible; wave-2 history/alerts views must not be
  built on this schema without an engine-side fix.
- CORS misconfiguration fails silently in the browser and the dev proxy hides the class:
  PR 1 tests assert real + preflight + rejected-origin + empty-default; the PR 3
  acceptance task is the prod-path smoke.
- Naive-UTC normalization must only ever go through `lib/datetime.parseApiDate`; any
  render path bypassing it is a defect.