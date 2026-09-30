# Design — `web-frontend`

Status: design (resolved HOW for the MVP)
Inputs: `proposal.md`, `specs/web-frontend/spec.md`, `specs/api-cors/spec.md`, `openspec/config.yaml`
Code verified against: `sentinel-api/app/core/config.py`, `sentinel-api/app/main.py`, `sentinel-api/app/tests/conftest.py`

> Config note: `openspec/config.yaml` has **no `rules.design` key** (rules exist for
> init/explore/plan/implement/review/archive). This design therefore follows the
> `plan` and `review` rules by inheritance: slices ≤ 400 changed lines where feasible,
> red → green ordering per behaviour, exact commands per slice. Confirmed product
> decisions (React 19 + Vite TS SPA; polling REST 10–15 s; API scope = CORS only;
> MVP = login + live list + create + delete) are treated as fixed and are not re-opened.

---

## 1. Confirmed decisions carried forward (not re-opened)

| Decision | Value |
|----------|-------|
| Stack | React 19 + Vite + TypeScript SPA, static files, no SSR |
| Server state | Polling REST, `refetchInterval` 10 s default (10–15 s band) |
| Backend scope | CORS middleware + `CORS_ORIGINS` setting only |
| MVP views | `/login`, protected `/` monitors list, create, delete |
| Out of scope | edit/PATCH, history/alerts, refresh token, realtime, pagination, registration, theming/i18n, multi-tab token sync, component library |

## 2. Delivery slices (matches the proposal's chained-PR plan)

The proposal forecasts ~1 400–2 100 changed lines total against a 400-line review
budget; chaining is the delivery input. The design organizes work into the same
three slices, and **PR 1 is fully self-contained and applies first, in isolation**:

| PR | Slice | Boundary | Est. lines |
|----|-------|----------|-----------|
| 1 | CORS backend slice | sentinel-api only + `.env.example`; touches NO JWT code, NO validation-schema code, NO router/service/migration/worker code | ~150–300 |
| 2 | Frontend scaffold + API client + auth/login | new `frontend/` tree (scaffold, configs, toolchain registration, API client, token store, JWT, guards, login page) + README/CI | ~600–750 |
| 3 | Monitors feature | features/monitors (list, poll config, create, delete), `lib/datetime`, `lib/checkers`, error-field mapping tests | ~550–750 |

Deliverable boundary rule: PR 2 must build and pass its suite with the monitors
feature absent (a placeholder empty state on `/` is acceptable); PR 3 adds the
feature without touching PR 2 files except `src/App.tsx` route wiring (one hunk)
and `endpoints.ts` (appending monitor calls). `lib/api/schema.ts` (generated) is
generated once in PR 2 — it covers the whole OpenAPI contract, so PR 3 adds no
codegen step.

---

## 3. PR 1 — CORS backend slice (the smallest self-contained unit)

### 3.1 What it does and does not touch

**Touches (exactly four files):**
1. `sentinel-api/app/core/config.py` — add setting + derived property.
2. `sentinel-api/app/main.py` — register `CORSMiddleware` after `app = FastAPI(...)`.
3. `sentinel-api/.env.example` — document `CORS_ORIGINS`.
4. `sentinel-api/app/tests/api/test_cors.py` — new RED-first API test.

**Explicitly does NOT touch:** any JWT/auth code (`app/api/v1/endpoints/auth*`,
`app/core/security*`), any Pydantic request/response schema (`app/schemas/`),
routers, services, models, Alembic migrations, the Go worker, CI (frontend job
lands with PR 2). The current `config.py` is a plain `pydantic_settings.BaseSettings`
with a module-level `settings` singleton, and `main.py` has no middleware today —
verified.

### 3.2 Production changes

`config.py`: add field `CORS_ORIGINS: str = ""` (comma-separated origins) and a
property `cors_origins_list -> list[str]` that splits on `,`, strips whitespace,
and drops empty entries (spec: `"https://ui.example.com, http://localhost:5173"`
→ two origins; `""` → `[]`).

`main.py`: after the `app = FastAPI(...)` line:

```python
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`allow_credentials=True` forbids `*`; origins are explicit and env-only. Empty
default = zero cross-origin access. Preflight (`OPTIONS`) is answered by the
middleware itself, before routing/auth dependency resolution.

### 3.3 Test design (RED first)

New file `sentinel-api/app/tests/api/test_cors.py` using the existing suite
pattern (`httpx.AsyncClient` + `ASGITransport`, per `conftest.py`).

**The snapshot problem (the one real design decision here).** `add_middleware`
captures `allow_origins` as a static list at registration time, and `config.py`
instantiates `settings` at import time; `conftest.py` imports `app.main` at module
level. So `monkeypatch.setenv("CORS_ORIGINS", ...)` alone cannot influence the
already-built middleware. Design: the test module reloads `app.core.config` and
then `app.main` under a controlled env, against a dedicated `AsyncClient` — the
DB-dependent fixtures (`override_session_db`, `auth_headers`) are **not** used, so
no DB is required and no dependency-override state is disturbed.

Test fixture (conceptual contract, not code):

- `cors_app(monkeypatch)` helper: takes a `CORS_ORIGINS` value, `monkeypatch.setenv`
  (env beats `.env` in pydantic-settings precedence), `importlib.reload` of
  `app.core.config` then `app.main` (main re-executes against the reloaded
  settings instance), yields an `AsyncClient` bound to a fresh `ASGITransport`
  around the reloaded `app.main.app`. Teardown: `monkeypatch` restores env;
  helper reloads both modules once more with the env unset so the session's
  global `settings` returns to the default state — preventing leakage into any
  test that runs after this file.

Cases (each written RED first — the first run must fail on the header assertion
because no middleware exists):

1. `test_cors_allows_configured_origin` — env `CORS_ORIGINS=https://ui.example.com`;
   GET `/` with `Origin: https://ui.example.com` → assert
   `Access-Control-Allow-Origin == "https://ui.example.com"` and
   `Access-Control-Allow-Credentials` present.
2. `test_cors_preflight_handled` — OPTIONS `/api/v1/monitors/` with
   `Origin` + `Access-Control-Request-Method: GET` → 200-class response with
   `Access-Control-Allow-Origin` and allowed methods/headers advertised, **without**
   an Authorization header (middleware answers pre-router).
3. `test_cors_rejects_unconfigured_origin` — env configured as in (1); GET with
   `Origin: https://evil.example.com` → assert the allow-origin header is absent.
4. `test_cors_empty_default_blocks_cross_origin` — env `CORS_ORIGINS=""` (explicitly
   set, so a developer's local `.env` cannot leak a value) → no allow-origin header.

Runbook (strict TDD):

```
cd sentinel-api
uv run pytest app/tests/api/test_cors.py            # RED: header assertions fail
# apply config.py + main.py + .env.example
uv run pytest app/tests/api/test_cors.py            # GREEN
uv run pytest                                       # full suite stays green
uv run ruff check . && uv run ruff format --check . && uv run pyright
```

`.env.example` line documents `CORS_ORIGINS` (empty default, comma-separated,
example SPA origin), noting `CORS_ORIGINS=""` disables cross-origin access at
any time.

---

## 4. PR 2 — Frontend scaffold, API client, auth

### 4.1 Toolchain (recorded in `openspec/config.yaml`)

Package manager: **npm** (no lockfile-format debates, universal CI). Fill
`testing.runners.frontend` with:

```yaml
frontend:
  cwd: frontend
  setup: npm ci
  focused: npx vitest run {test_path}
  full: npm run test            # vitest run
  build: npm run build          # tsc -b && vite build
  static: [npm run lint, npm run typecheck]
  note: replaces "status: none" once PR 2 lands
```

`package.json` scripts: `dev` (vite), `build` (`tsc -b && vite build`), `lint`
(eslint 9 flat config + typescript-eslint + eslint-plugin-react-hooks),
`typecheck` (`tsc -b`), `test` (`vitest run`), `test:watch`, `gen:api`
(`openapi-typescript http://localhost:8000/openapi.json -o src/lib/api/schema.ts`,
run manually when the API contract changes — committed output, no build-time
network). Dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
`jsdom`, `msw`. The scaffold is hand-written (not `npm create vite` output) per the
proposal. Dev proxy: `vite.config.ts` `server.proxy` `/api → http://localhost:8000`
(same-origin in dev, CORS never fires locally). `.env.example` documents
`VITE_API_BASE_URL=` (empty default). PR 2 adds the frontend CI job (lint +
typecheck + test + build) and README run instructions.

### 4.2 Module architecture

```
frontend/src/
├── main.tsx                     # QueryClientProvider + RouterProvider
├── App.tsx                      # route tree (createBrowserRouter)
├── app/
│   ├── api/
│   │   ├── client.ts            # apiFetch, ApiError, unauthorized-handler hook
│   │   ├── endpoints.ts         # login / monitors calls, typed via schema
│   │   └── token.ts             # in-memory + sessionStorage write-through store
│   ├── auth/
│   │   ├── AuthProvider.tsx     # useAuth(): token state, login/logout, exp watch
│   │   ├── guards.tsx           # <RequireAuth>
│   │   └── jwt.ts               # payload decode, exp helpers
│   └── styles/globals.css       # Tailwind v4 entry (@import "tailwindcss")
├── features/
│   ├── login/LoginPage.tsx      # RHF + zod form, inline 401 error
│   └── monitors/                # (PR 3)
└── lib/
    ├── api/schema.ts            # committed openapi-typescript output
    ├── api/errors.ts            # FastAPI detail normalization + field mapping
    ├── datetime.ts              # (PR 3) naive-UTC normalization
    └── checkers.ts              # (PR 3) CHECKER_CONFIG_SCHEMA
```

Responsibilities and key exports:

**`app/api/token.ts`** — the single source of truth for the credential.
Module-level `let token: string | null` plus write-through to
`sessionStorage` (key `sentinel.access_token`) and read-through restore on first
`get()` (browser-refresh session restore). Never `localStorage`. Exports:
`tokenStore = { get(): string | null, set(token): void, clear(): void }`. No
imports from the router or React — pure module, testable in isolation.

**`app/api/client.ts`** — one wrapper every protected call goes through.
`apiFetch<T>(path, init?)`: prefixes `import.meta.env.VITE_API_BASE_URL ?? ""`,
attaches `Authorization: Bearer <tokenStore.get()>` when present, sends
`Content-Type: application/json` unless the caller passes a pre-encoded body with
its own content type, parses the response, and on non-2xx builds a normalized
`ApiError { status, detail, fields? }` from FastAPI's `{"detail": string | [{loc,
msg, type}]}` shape (see `lib/api/errors.ts`). On `401`: `tokenStore.clear()` then
invoke the registered unauthorized handler. To avoid a client→router import cycle,
the client exposes `setUnauthorizedHandler(fn)`; `AuthProvider` registers a
handler that navigates to `/login?next=<current path>`. Exports: `apiFetch`,
`ApiError` (type + class), `setUnauthorizedHandler`.

**`app/api/endpoints.ts`** — typed call functions, one per endpoint, no business
logic: `login(username, password)` (POST `/api/v1/auth/login` with
`URLSearchParams` — the endpoint is `OAuth2PasswordRequestForm`, form-encoded, **not
JSON**), `fetchMonitors()`, `createMonitor(body)`, `deleteMonitor(id)`. Return
types come from `lib/api/schema.ts` (`operations['login_auth_login_api_v1_auth_login_post']`
etc.); `check_config` is typed `Record<string, unknown>` and is not rendered.

**`app/auth/jwt.ts`** — `decodeJwtPayload(token)` (pad-safe base64url decode of
the middle segment → `{ exp, sub }`; malformed payload → `null`), `isExpired(payload, now)`,
`isExpiringSoon(payload, skewSeconds = 60)`. No hardcoded 30-min constant — expiry
comes only from `exp`.

**`app/auth/AuthProvider.tsx`** — `useAuth(): { isAuthenticated, user sub, login(username, password), logout() }`.
Holds token presence in state, mirrored with `tokenStore`. `login()` calls the
endpoint, decodes the payload, stores the token; a 401 surfaces as `ApiError` to
the caller (the form), not a redirect. `logout()` clears the store and navigates
to `/login`. A slow interval (30 s) checks `isExpiringSoon`/expired and performs
an automatic logout-redirect — the proactive expiry path that keeps users off a
wall of 401s. On mount it registers the `client.ts` unauthorized handler
(clear → `/login?next=…`).

**`app/auth/guards.tsx`** — `<RequireAuth>` wraps protected elements; when
`!isAuthenticated` renders `<Navigate to="/login" state={{ from: location.pathname }} replace />`.
`LoginPage` reads `location.state.from` (falling back to `?next=`), so the
post-login return works from both the guard and the 401 interceptor.

**Routes (`App.tsx`)**:

```
/            → RequireAuth → MonitorsPage        (PR 2: placeholder "Monitors — PR 3")
/login       → LoginPage (redirects to / when already authenticated)
*            → Navigate to /
```

An `AppShell` (header with app name + Logout button) wraps the protected outlet.
PR 2 delivers login + guards + shell + placeholder; PR 3 swaps the placeholder
for the monitors feature — the only `App.tsx` hunk in PR 3.

**`features/login/LoginPage.tsx`** — react-hook-form + zod (`username` nonempty,
`password` nonempty). Submit → `auth.login()`; `ApiError.status === 401` →
`setError("root")` inline "Invalid credentials or email" (no navigation per spec);
network/5xx → form-level "API unreachable" message. On success → `navigate(from)`.

**`lib/api/errors.ts`** — `normalizeDetail(detail): { message?: string, fields:
Record<string, string> }`: string detail → form-level message; `[{loc, msg}]` list
→ last `loc` segment (e.g. `frequency`) mapped to field error. Shared by the login
form (PR 2) and the create form (PR 3); `fields` mapping is exercised in PR 3
where it matters, string-normalization tests land in PR 2.

### 4.3 PR 2 tests (Vitest + RTL, MSW)

- `token.test.ts` — set/get/clear, sessionStorage write-through, restore-on-read.
- `client.test.ts` — auth header attach, `ApiError` normalization for string and
  list `detail`, 401 triggers handler + token clear (MSW).
- `jwt.test.ts` — decode real-shape token fixture, `isExpiringSoon` boundaries.
- `AuthProvider.test.tsx` + `guards.test.tsx` — redirect on unauthenticated
  `/`, logout clears and navigates, expiring token auto-logout.
- `LoginPage.test.tsx` — success navigates to `from`; 401 keeps user on form with
  inline error (MSW 401 handler).

---

## 5. PR 3 — Monitors feature (list, poll, create, delete)

### 5.1 Component tree

```
MonitorsPage
├── offline/stale banner          (derived from query error state)
├── header row: title + Logout (AppShell already provides Logout)
├── CreateMonitorForm             (collapsible card)
└── MonitorList
    └── MonitorRow (per monitor)
        ├── StatusPill            last_state → pill
        ├── name / target / frequency / consecutive_failures
        ├── last_checked_at       lib/datetime formatted + "x ago"
        ├── freshness hint        (conditional, subdued)
        └── DeleteButton          (two-step inline confirm)
```

`components/` locals: `Button`, `Input`, `StatusPill`, `Spinner`, `Card` — five
small Tailwind primitives, no component library.

### 5.2 Polling plumbing (precise)

**Query key**: exactly one server-state key, `['monitors']`, holding the full
`GET /api/v1/monitors/` payload. No other query keys exist in the MVP.

**QueryClient defaults** (set in `main.tsx`):

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,              // list payloads are small and user-scoped
      retry: 2,
      retryDelay: (a) => Math.min(1_000 * 2 ** a, 4_000),   // ~1 s, 2 s
      refetchOnWindowFocus: true,    // returning tab refreshes instantly
      refetchIntervalInBackground: false,
    },
  },
})
```

**The list query — `useMonitors()`** (features/monitors/useMonitors.ts):

```ts
useQuery({
  queryKey: ['monitors'],
  queryFn: fetchMonitors,
  refetchInterval: (q) => (q.state.error ? 30_000 : REFETCH_INTERVAL_MS),
})
```

- `REFETCH_INTERVAL_MS = 10_000` (constant; optionally overridable via
  `VITE_POLL_INTERVAL_MS`, read once at module load). 10 s aligns with the
  in-process APScheduler engine tick (checks all Active monitors every 10 s), so
  state changes surface on a 10 s lattice; the Go engine's 2 s due-ness poll is
  covered by the same window.
- **Hidden-tab pause**: `refetchIntervalInBackground: false` makes TanStack Query
  v5 skip interval fetches while `document.hidden`; `refetchOnWindowFocus: true`
  resumes with an immediate refetch on visibility return. No manual
  `visibilitychange` listener is needed — the library behavior already matches
  the spec's pause/resume requirement, and it is pinned by a component test
  (document hidden → advance timers → no fetch call).
- **Error/backoff**: two retries (~1 s, 2 s); while errors persist the interval
  function returns 30 s; on the first success the interval function returns 10 s
  again automatically (it re-evaluates each cycle).
- **Keep last data**: query stays in `isError` with `data` retained (v5 keeps the
  last successful data); `MonitorsPage` renders `query.data` always, and shows the
  stale/offline banner when `query.isError` (or `query.data && query.isFetching`
  failures persist). The list is never blanked on failure.

**Mutations** (features/monitors/useMonitorMutations.ts):

- `useCreateMonitor()`: `useMutation({ mutationFn: createMonitor, onSuccess: () =>
  queryClient.invalidateQueries({ queryKey: ['monitors'] }) })`. The invalidation
  triggers an immediate refetch (the query is stale at 5 s < interval), so the new
  row appears now, and the 10 s poll continues afterwards.
- `useDeleteMonitor()`: same invalidation, but in `onSettled` (a 404 still means
  the cached list may be stale). `onError` inspects `ApiError.status === 404` →
  sets the "Monitor not found — refreshing" message; other errors → generic toast.
- Confirmation: `DeleteButton` is a two-step inline control (click → "Confirm
  delete?" with cancel) rather than a native `confirm()` dialog — RTL-testable
  without dialog mocking, and satisfies the explicit-confirmation requirement.
- Login is a mutation with **no** query and no invalidation (PR 2).

### 5.3 `lib/datetime.ts` — naive-UTC normalization

- `parseApiDate(s: string): Date` — if the string has no timezone designator
  (no `Z`/`z`, no `±HH:MM`/`±HHMM` suffix), append `Z` before `new Date(...)`.
  The API strips tzinfo (naive UTC), so this is the single correct interpretation;
  without it `Date.parse("2025-…T10:00:00")` silently reads local time.
- `formatDateTime(d: Date): string` — `Intl.DateTimeFormat` with the user's
  locale/timezone (no hardcoded format).
- `formatRelative(d: Date, now: Date): string` — "x s/min/h ago".
- `isEngineStale(lastCheckedAt: string, frequencySeconds: number, now: Date)` —
  true when age > `max(frequency, 30) × 2` seconds → the row's "engine may be
  down" hint. Derived from data, never from alerts.

Pinned by tests with a fixed timezone (`TZ` env or injected `Intl` format in
Vitest) — e.g. `"2025-01-15T10:00:00"` renders as 10:00 UTC, not local-shifted.

### 5.4 `lib/checkers.ts`

`CHECKER_CONFIG_SCHEMA` constant describing the only registered checker:
`http: { expected_status: 200, timeout: 10, method: "GET" }`, plus
`DEFAULT_CHECK_TYPE = "http"`. The create form posts `check_config` verbatim from
this constant; `check_type` is a locked hidden field (only one checker is
registered; no discovery endpoint exists). A future checker is a client-only
extension of this constant.

### 5.5 `features/monitors/` modules

- `MonitorsPage.tsx` — composes the query + banner + list + form.
- `MonitorList.tsx` / `MonitorRow.tsx` — renders `name`, `target`, `frequency`,
  `last_state`, `last_checked_at`, `consecutive_failures` (`check_config` is
  never rendered). Row tooltip shows `frequency` ("slow monitors are expected").
  `last_state === null` → muted "Never checked" pill.
- `StatusPill.tsx` — pure mapping of the three states to label + Tailwind classes.
- `CreateMonitorForm.tsx` — RHF + zod mirroring the server constraints: `name`
  1–100 required, `target` required + `new URL()`-valid, `frequency` int ≥ 10
  default 60. On 201 → invalidation (row appears immediately). On 400 →
  `normalizeDetail` maps `[{loc, msg}]` entries back onto the offending field
  (e.g. `frequency`), string details → form-level message.
- `useMonitors.ts`, `useMonitorMutations.ts` — as in §5.2.

### 5.6 PR 3 tests

- `datetime.test.ts` — UTC normalization (no local shift), formatting, relative
  time, `isEngineStale` threshold boundaries (fixed `now` injected).
- `useMonitors.test.tsx` — MSW: initial fetch, poll cadence with fake timers,
  hidden-tab pause, error keeps data + banner, backoff interval 30 s on error.
- `MonitorList/Row.test.tsx` — pill mapping (healthy/unhealthy/never-checked),
  freshness hint above threshold, freshness tooltip.
- `CreateMonitorForm.test.tsx` — client validation rejects empty name/bad
  URL/frequency < 10; 400 list-detail maps to the frequency field; 201 triggers
  list invalidation.
- `DeleteButton.test.tsx` — requires confirm step; 404 shows "not found" and
  invalidates; success removes row.

---

## 6. Risk register and mitigations

| Risk | Mitigation in this design |
|------|---------------------------|
| **Naive-UTC drift** — forgetting the `Z` shifts every timestamp by the local offset | Single `parseApiDate` chokepoint in `lib/datetime.ts`; every render path goes through it; tests pin a fixed timezone with injected `now` |
| **Token expiry UX** — expiry mid-form loses work | Proactive `exp` decode + 30 s watcher + `isExpiringSoon(60 s skew)` auto-logout before the wall of 401s; 401 interceptor carries `?next=`; login returns to `location.state.from` |
| **CORS silent failure** — wrong `CORS_ORIGINS` fails only as browser console noise; dev proxy hides the class entirely | RED-first API test asserts actual + preflight + rejected-origin + empty-default; prod-path smoke (login → list from the SPA origin against a CORS-configured API) is a polish-phase acceptance step; empty default blocks everything (fail closed) |
| **CORS middleware snapshot** — origins captured at import time (see §3.3) | Test module reload pattern makes the snapshot explicit and deterministic; documented as the reason the test cannot just `setenv` |
| **Dual-engine duplicate rows** — both engines append `check_result`/race `monitor` with no locking | MVP reads only `monitor.last_state` (last-writer-wins) — duplicates are invisible in this UI; wave-2 history/alerts views must not be built on this schema without an engine-side fix (documented non-goal, not silently absorbed) |
| **Stale/frozen data UX** — engine down freezes the list | `isEngineStale` per-row hint + offline banner; last data retained, never blanked; poll backs off to 30 s |
| **XSS via `check_config`** | Not rendered at all in the MVP; React default escaping; no `dangerouslySetInnerHTML` anywhere |
| **Multi-tab herd** | `refetchIntervalInBackground: false` pauses hidden tabs; endpoint is one per-user `SELECT`; the API's own 10 s engine dominates load |

## 7. Rollout

- PR 1 is independently deployable: additive middleware + setting; rollback =
  revert two hunks or set `CORS_ORIGINS=""`. No schema/migration/worker surface.
- PR 2 / PR 3 are additive (new `frontend/` tree, README/CI hunks). Rollback =
  remove the directory and hunks. No data layer interaction at any point.
- CI after PR 2: frontend job (`npm ci`, lint, typecheck, test, build) joins the
  API gates; API gates unchanged and must stay green throughout.

## 8. Contract summary (what each phase reads from here)

- Tasks phase derives its red→green task list from §3.3 (CORS), §4.3 (PR 2),
  §5.6 (PR 3) test specifications and the §2 slice boundaries.
- Implement phase runs the runners recorded in §4.1; it must update
  `openspec/config.yaml` `testing.runners.frontend` as part of PR 2's first commit
  (replacing the `status: none` block verbatim with the YAML above).
- Review phase checks each PR against the §2 boundary table and the §6 risk list
  (dual-engine and CORS-silent-failure flags are standing review items).