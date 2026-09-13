# Proposal — `web-frontend`

Greenfield browser UI for sentinel: a React + Vite (TypeScript) SPA that logs in with
existing credentials, shows the user's monitors with live healthy/unhealthy state, and
supports creating and deleting monitors — built against the existing REST API with the
single backend change of adding CORS support.

---

## 1. Problem and goal

**Problem.** Sentinel has no user interface. Monitors can only be created, observed, and
removed by calling the REST API by hand (`curl`, Swagger UI, ad-hoc scripts), which
requires knowing the endpoint table, the OAuth2 form-login flow, and JWT mechanics. There
is no way to see "is anything down right now" at a glance, no first-class way to add a
monitor, and no persistence of the login across a work session. The operational cost is
that monitoring feels like API plumbing instead of a tool.

**Goal (MVP).** A small, fast, self-hostable web app that delivers a closed loop in one
screen: log in → see every monitor with live health state → create a monitor → delete
one. Live state is achieved by polling the existing REST API on a ~10–15 s cadence that
matches the engine tick; no realtime transport is added (and none is permitted).

The product decisions below were confirmed with the user during pre-proposal and are
carried here unchanged; they are not re-negotiated in this document.

1. **Stack**: React + Vite (TypeScript SPA). No SSR, no Next.js, no Vue.
2. **Communication**: polling REST every ~10–15 s. No SSE, no WebSocket (the API has
   none today and adding any was declined).
3. **API scope**: CORS middleware only (`sentinel-api/app/main.py`, origins from an env
   setting in `app/core/config.py`). Everything else stays untouched.
4. **MVP scope**: login page, monitors list with live healthy/unhealthy state, create +
   delete monitor. Edit/PATCH UI, per-monitor history/alerts views, refresh token, and
   realtime are explicitly **excluded** (second wave).

---

## 2. Affected areas

| Area | Change |
|------|--------|
| `frontend/` (new) | Entire greenfield SPA. Today it is `.gitkeep` only; no toolchain exists. |
| `sentinel-api/app/main.py` | Add `CORSMiddleware` (only backend code edit). |
| `sentinel-api/app/core/config.py` | Add `CORS_ORIGINS` setting (only backend config edit). |
| `sentinel-api/.env.example` | Document `CORS_ORIGINS`. |
| `sentinel-api/app/tests/` | New API test asserting the CORS header (strict TDD). |
| `openspec/config.yaml` | Fill `testing.runners.frontend` (package manager + test command) once the toolchain lands — required by the config's own testing policy. |
| `.github/workflows/ci.yml` | Optional: add a frontend job (lint + typecheck + tests). |
| `README.md` | Frontend run instructions. |

No schema changes, no migrations, no worker changes, no dual-engine interaction changes.

---

## 3. Stack proposal and justification

| Concern | Choice | Why | Trade-off |
|---------|--------|-----|-----------|
| Framework | React 19 + Vite (current stable, TS) SPA | Components + hooks fit an interactive dashboard; Vite gives instant HMR dev server and the dev-proxy we need (see §4.6). No SSR: this is a self-hosted internal tool served as static files. | ~45 KB gz React runtime; nothing else (no server runtime, no SSR complexity). |
| Routing | react-router v7 (`createBrowserRouter`) | Three routes (`/login`, `/` protected, fallback) plus declarative guards and post-login redirect for ~30 lines. | ~20 KB gz. A hand-rolled location-state switch would work but is worse to extend. |
| Server state + polling | TanStack Query v5 | Polling (`refetchInterval`), staleness/cache, `invalidateQueries` after mutations, retry/backoff, tab-focus refetch, error-state retention — this is exactly the async-monitor problem. | ~13 KB gz. Re-implementing poll/backoff/invalidate correctly by hand is the real cost; the library is the cheap option. |
| Forms | react-hook-form + zod resolver | Uncontrolled inputs (no re-render churn), tiny, and zod mirrors the server's Pydantic constraints (`name` 1–100, `frequency` ge=10, URL shape). | ~23 KB gz for both. |
| UI primitives | Tailwind CSS v4 (`@tailwindcss/vite`) + ~5 local components (`Button`, `Input`, `StatusPill`, `Spinner`, `Card`) | Recommendation: **plain Tailwind, no component library.** Three views do not justify MUI/AntD's 100 KB+ runtime and styling lock-in; Tailwind compiles to a small purged CSS and makes status pills, badges, and form states trivial. | Tailwind is a build-time step only; zero component-lib API surface to learn or fight. |
| API client types | `openapi-typescript` codegen + ~40-line typed `fetch` wrapper | `/openapi.json` is available (§6 of explore); generated types stay in sync with the Pydantic schemas. Orval (full client + query-hook codegen) was rejected: it would generate more code and churn than the 10 endpoints we have are worth. Fully hand-written types were rejected: drift risk as the API evolves. | Generated `schema.ts` is committed (deterministic, reviewable, no build-time network dependency) and regenerated when the contract changes. |
| Testing | Vitest + React Testing Library + MSW | Component/query tests with mocked fetch; no backend needed for frontend tests. | Extra dev deps; mandatory per repo testing policy (strict TDD). |

**Bundle budget (approx, gz)**: React 45 + Router 20 + Query 13 + RHF/zod 23 + app code
≈ **~100–130 KB** — a comfortable, appliance-like page for a monitoring tool. The two
non-trivial build steps are Tailwind and the one-time `openapi-typescript` codegen, both
self-contained in the frontend package.

---

## 4. Communication plan with the async API

### 4.1 Auth flow

- **Login**: `POST /api/v1/auth/login` with body `application/x-www-form-urlencoded`
  (`username` + `password` via `URLSearchParams`, **not JSON** — the endpoint uses
  OAuth2PasswordRequestForm). `username` accepts email **or** username (§1.1 of explore).
  → `{access_token, token_type}`. A 401 here means bad credentials → inline form error,
  **not** a redirect.
- **Storage recommendation (in-memory + sessionStorage)**: the token's single source of
  truth is an in-memory module singleton used by the fetch wrapper; a write-through to
  `sessionStorage` means a browser refresh restores the session without forcing re-login.
  **Never `localStorage`** — it survives browser restarts and widens the XSS blast
  radius for a 30-min bearer credential. Trade-offs accepted: `sessionStorage` is
  per-tab (a new tab needs a fresh login; multi-tab sync is a later refinement), and the
  token dies with the tab — which is the point (session-scoped credential).
- **Proactive expiry**: the API only guarantees `exp` (default 30 min, env-configurable,
  so never hardcoded). At login, pad-safe base64url-decode the JWT payload once, keep
  `exp`/`sub` in memory; a light check before each route navigation and a slow interval
  (30–60 s) redirects to `/login` when `exp - now < 60 s`, so users re-login before
  hitting a wall of 401s.
- **401 interceptor**: every protected call goes through one wrapper. On 401 →
  clear token (memory + sessionStorage) → redirect to `/login?next=<path>`; after login,
  navigate back to `next` (screen state, not the token, survives).
- **Logout**: client-side only — the API has no logout/revocation endpoint (a stolen
  token stays valid until `exp`; discarding it locally is the only remedy). MVP includes
  a Logout button: clear token → `/login`.

### 4.2 Polling strategy

- **Which queries poll**: exactly one — the monitors list (`GET /api/v1/monitors/`).
  Create/delete are fetch-on-demand mutations that **invalidate** the list
  (`['monitors']`), which triggers an immediate refetch; polling then continues. No
  history/alerts queries exist in the MVP.
- **Cadence**: `REFETCH_INTERVAL = 10 s` default (env-tunable constant). Rationale: the
  in-process APScheduler engine ticks every 10 s and checks **all** active monitors
  regardless of `frequency`, so with the API engine running, state changes surface on a
  10 s lattice; the Go engine (2 s tick, due-ness by `frequency` ≥ 10) is covered by the
  same window. 10–15 s was the confirmed band; 10 s aligns with the engine tick and
  costs nothing (one cheap per-user `SELECT` per poll).
- **Staleness/cache**: `staleTime` 5 s (list payloads are small and user-scoped);
  `refetchOnWindowFocus: true` so a returning tab refreshes instantly;
  `refetchIntervalInBackground: false` plus a `visibilitychange` pause — hidden tabs do
  not poll, which bounds multi-tab thundering herd (this is a single-user tool today;
  the API's own 10 s engine is the real upstream load, not our polls).
- **Error/backoff**: `retry: 2` with exponential `retryDelay` (~1 s, 2 s); keep serving
  the last known data with a "stale/offline" banner rather than blanking the list; slow
  the poll on persistent failure —
  `refetchInterval: (q) => q.state.error ? 30_000 : 10_000` — and restore 10 s on the
  first success.

### 4.3 Data mapping (`MonitorRead` → UI)

- Row fields used: `name`, `target`, `frequency`, `last_state`,
  `last_checked_at`, `consecutive_failures`, `created_at`; `check_config` is typed
  `Record<string, unknown>` and is **not rendered** in the MVP.
- **State pill**: `last_state` is authoritative — `null` → muted "Never checked"
  (pending/spinner); `"healthy"` → green "Healthy"; `"unhealthy"` → red "Unhealthy".
  Derived from `last_state` only, never from alerts (alerts fire only on transitions and
  never for the first check; they are a wave-2 concern).
- **Naive-UTC normalization**: the API strips tzinfo, so every datetime arrives naive.
  JS `Date.parse("2025-…T10:00:00")` would interpret it as **local** and shift the
  display. Convention: normalize by appending `"Z"` when the string carries no
  timezone designator, then format with `Intl.DateTimeFormat` (user's locale/timezone)
  and compute "x s ago" freshness from the normalized value. Pinned in tests with a fixed
  timezone.
- **Freshness hint**: if `last_checked_at` is older than roughly
  `max(frequency, 30 s) × 2`, show a subdued "engine may be down" hint on the row —
  the user-facing signal that live data has gone stale.
- **Slow monitors are expected**: `frequency` ≥ 10 s governs when a monitor is due
  (Go engine) and the Python engine re-checks everything every 10 s, so a large
  `frequency` monitor may show the same state across many polls. Not a bug; surfaced as
  a tooltip with the frequency value.

### 4.4 Create form

- Fields: `name` (required, 1–100, zod-mirrored), `target` (required — client validates
  with `new URL()`; the server only requires non-empty), `frequency` (int ≥ 10, default
  **60**; server enforces `ge=10`), `check_type` **locked to `"http"`** (hidden input,
  server default), `check_config` posted as the default
  `{expected_status: 200, timeout: 10, method: "GET"}` — the three keys the http checker
  recognizes (§3.2 of explore); unknown keys are silently ignored server-side, so only
  these three are sent as **editable fields in a later wave**, defaulting here.
- http-only is a deliberate hardcode because **only one checker is registered** and there
  is no checker-discovery endpoint. The field list lives in one
  `CHECKER_CONFIG_SCHEMA` constant so a future checker is a client-only extension.
- On 201 → `invalidateQueries(['monitors'])` → the new monitor appears immediately (and
  continues to poll). On 400 → FastAPI `detail` is either a string (check_type/unknown
  errors) or a `[{loc, msg, type}]` list (validation, e.g. `frequency`) — mapped back to
  the offending form field.

### 4.5 Error handling matrix

| Case | Source | UX |
|------|--------|----|
| 400 | create validation / unknown check_type / dup | Field-level or toast; parse `detail` (string vs list). |
| 401 on login | bad credentials | Inline "Invalid credentials or email" on the form; no redirect. |
| 401 elsewhere | expired/revoked/unknown-user token | Interceptor: clear token → `/login?next=…`. Server DB-lookups the `sub` every request, so a deleted user 401s even with an unexpired token — same path. |
| 403 | ownership (history/alerts) | Not reachable in MVP (no history/alerts); interceptor covers future use. |
| 404 | delete of a monitor already removed | Toast "Monitor not found — refreshing list" + invalidate list. |
| Network / 5xx | API down, proxy down | Keep last data, "offline / stale" banner, backoff poll (30 s). No error page. |

FastAPI errors are plain `{"detail": …}` (no error-code taxonomy) — the fetch wrapper
normalizes them into `{status, detail, fields?}` once.

### 4.6 Env / API base URL

- `VITE_API_BASE_URL` — overrides the API origin for all calls. Default **empty**.
- **Dev**: empty base + Vite dev-server proxy `/api` → `http://localhost:8000`
  (`server.proxy` in `vite.config.ts`) — same-origin in dev, so CORS never fires locally.
- **Prod**: `VITE_API_BASE_URL=https://<api-host>`; the SPA is served from a different
  origin, which **requires** the CORS middleware (the single backend change, §6). CORS is
  therefore a prod-path requirement, not a dev friction point.

---

## 5. Frontend folder structure

Small, idiomatic Vite layout — feature-sliced, no mega-layers:

```
frontend/
├── index.html
├── package.json / tsconfig.json / vite.config.ts    # proxy + tailwind plugin here
├── .env.example                                     # VITE_API_BASE_URL (empty)
└── src/
    ├── main.tsx                                     # providers: QueryClient, Router
    ├── App.tsx                                      # route tree (createBrowserRouter)
    ├── app/
    │   ├── api/                                     # fetch wrapper + 401 interceptor,
    │   │   ├── client.ts                            #   error normalization
    │   │   ├── endpoints.ts                         # login/monitors calls
    │   │   └── token.ts                             # in-memory + sessionStorage store
    │   ├── auth/                                    # AuthProvider, useAuth, guards,
    │   │   └── jwt.ts                               #   exp decode, logout
    │   └── styles/                                  # globals.css (tailwind entry)
    ├── features/
    │   ├── login/                                   # LoginPage + form (RHF+zod)
    │   └── monitors/                                # MonitorsPage, MonitorList,
    │       └── …                                    #   MonitorRow, StatusPill,
    │                                                #   CreateMonitorForm, DeleteButton
    └── lib/
        ├── api/schema.ts                            # openapi-typescript output (committed)
        ├── datetime.ts                              # naive-UTC "Z" normalization + fmt
        └── checkers.ts                              # CHECKER_CONFIG_SCHEMA constant
```

`features/` keeps each view self-contained; `app/` holds cross-cutting plumbing;
`lib/` holds generated types and pure helpers. This is deliberately flat — the product
has three views, not a platform.

---

## 6. MVP scope boundary and non-goals

**In scope (MVP):** login (and client-side logout); monitors list with live
healthy/unhealthy state + never-checked state + freshness hint; create monitor; delete
monitor; offline/stale banner; 401 auto-redirect; openapi-typescript types; Vitest/RTL
tests; documented toolchain in `openspec/config.yaml`.

**Explicitly out of scope — second wave or later (not silently half-built here):**
- Edit / PATCH UI (API supports it; not in MVP)
- Per-monitor history / alerts views (endpoints exist; skipped per confirmed scope)
- Token refresh (no endpoint; would be an API-side change — declined)
- Realtime (SSE/WebSocket — none added)
- Pagination / filtering / sorting (API has none; would be an API feature, not a client one)
- Pause/resume (API cannot express it — `state` is not in `MonitorUpdate`)
- Uptime % / latency aggregates (no endpoint; client would need history)
- User registration / profile / password UI
- Dark-mode theming polish, i18n
- Multi-tab token sync
- Richer check_config editing (constant-driven currently), response_sample/extra_data display
- Component library adoption

---

## 7. API-side changes (the ONLY backend edits)

`CORS_ORIGINS` setting:

```python
# app/core/config.py (add)
CORS_ORIGINS: str = ""   # comma-separated origins, e.g. "https://ui.example.com,http://localhost:5173"

@property
def cors_origins_list(self) -> list[str]:
    return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
```

`app/main.py` (add, after `app = FastAPI(...)`):

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- `.env.example`: document `CORS_ORIGINS`.
- **Strict TDD**: a backend test (ASGITransport + AsyncClient, settings override or env
  stub) asserting `Access-Control-Allow-Origin` for a configured origin, written RED
  first (§8 of explore confirms there is no middleware today).
- Notes: `allow_credentials=True` forbids a wildcard origin — origins are explicit from
  env, never `*`; empty `CORS_ORIGINS` = no cross-origin access (safe default); preflight
  (`OPTIONS`) is handled by the middleware. No router, service, schema, or migration
  changes; the worker is untouched.

---

## 8. Risks

1. **CORS misconfiguration** — a missing origin in `CORS_ORIGINS` fails silently in the
   browser (no server-side error, just console noise), and the dev proxy hides the whole
   class of issues until prod. Mitigation: prod smoke test of an actual cross-origin
   fetch; the preflight response is asserted once in the API test.
2. **Stale data UX** — the list can lag a poll cycle, and if the engine is down the UI
   shows frozen states. Mitigation: `last_checked_at`-derived "engine may be down" hint
   and an offline banner; last-known data is retained, never blanked.
3. **Token expiry UX** — expiry mid-session or mid-form loses work. Mitigation:
   proactive `exp` check before navigation and pre-submit, `next` redirect so users land
   back, not at the start.
4. **Dual-engine duplicate rows** — both engines append `check_result` (and can race
   `monitor`) rows with no locking; the MVP only reads `monitor.last_state` (last writer
   wins) so duplicates are invisible, but wave-2 history/alerts views **will show double
   entries and jittered `last_checked_at`** — this is documented, not fixed here (fixing
   it is an engine concern, out of the confirmed API scope).
5. **Naive-UTC pitfalls** — forgetting the "Z" normalization shifts every displayed
   timestamp by the local offset; tests pin a fixed timezone so this can't regress.
6. **No pagination** — a user with many monitors gets one large list payload; acceptable
   for the MVP and consistent with everything else being unpaginated.
7. **XSS** — `check_config` is untrusted-ish JSON; it is never rendered via `innerHTML`
   (React escapes by default; the MVP doesn't render it at all). No `dangerouslySetInnerHTML` anywhere.
8. **Multi-tab thundering herd** — each tab polled independently; bounded by
   hidden-tab pause. The endpoint is a per-user `SELECT`; the API's own 10 s engine is
   the dominant load source regardless.

---

## 9. Rollback

- **Frontend**: purely additive (new directory, docs hunks, optional CI job). Revert =
  remove `frontend/` and revert config.yaml/CI/README hunks. No data is touched.
- **CORS**: revert `config.py` + `main.py` (two small hunks), or simply set
  `CORS_ORIGINS=""` to disable cross-origin access. No migration, no schema change, no
  worker interaction — nothing downstream can break at the data layer.

---

## 10. Success criteria

After this change:

- `frontend/` builds (`npm run build` or the adopted package manager's equivalent),
  passes lint + typecheck + Vitest/RTL tests locally, and the frontend CI job is green.
- From a clean browser: open the SPA → `/login` → valid credentials → monitor list →
  create a monitor (appears live within ~10 s) → state pill flips healthy/unhealthy
  when the target goes up/down (verify with a live and a dead URL) → delete removes it.
- An expired/revoked token redirects to `/login` via the 401 interceptor with no error
  storm; re-login lands back on the list.
- API test asserts `Access-Control-Allow-Origin` only for configured origins;
  `CORS_ORIGINS=""` blocks cross-origin requests.
- Backend (ruff/format/pyright/pytest) and worker (vet/build/govulncheck/`go test`)
  suites remain green — the CORS touch is additive.

---

## 11. Implementation plan outline (phases)

High-level phases only; `sdd-tasks` owns the red → green → refactor task breakdown. Each
phase lands as one work unit (code + tests + docs in the same commit).

1. **Foundation** — hand-written Vite React-TS scaffold (deliberately **not** `npm create
   vite` template output: smaller, reviewable), deps (router, query, RHF, zod,
   openapi-typescript, tailwind, vitest/RTL/MSW), dev proxy + `.env.example`,
   documented commands in `openspec/config.yaml` (runner status currently says "none").
2. **CORS** — RED test → middleware + setting + `.env.example` (smallest possible PR-able
   slice; unblocks real browser testing).
3. **API client + auth** — fetch wrapper, token store, exp decode, 401 interceptor,
   AuthProvider, `/login` page, route guards, client-side logout.
4. **Monitors feature** — polling list + status pills + freshness, create form + mutation,
   delete + confirm, FastAPI-error → field mapping.
5. **Polish** — offline/stale banners, README, frontend CI job, end-to-end browser smoke
   against the running stack (login → create → observe → delete).

---

## 12. Review workload forecast

Rough net changed-line estimates (excluding lockfiles and generated `schema.ts` bytes):

| Slice | Estimate |
|-------|----------|
| CORS change + test + `.env.example` | ~50–80 |
| Scaffold/configs/config.yaml/CI/README | ~250–400 |
| API client + auth + login page + tests | ~450–650 |
| Monitors feature (list/create/delete) + tests | ~500–750 |
| Polish/banners/docs | ~100–200 |
| **Total** | **~1 400–2 100** |

The change **far exceeds the 400-line review budget**, and chaining is advisable. A
self-reviewable chain of 3 PRs:

- **PR 1** — CORS backend change + test + config.yaml/CI scaffolding decisions (~150–300)
- **PR 2** — frontend scaffold + API client + auth/login (~600–750; the plumbing bulk)
- **PR 3** — monitors feature: list/create/delete (~550–750)

Boundary trade-off: keeping components deliberately small (no component library, flat
feature files) keeps each PR toward the low end; a strict 400-line-per-PR cap would force
4 chains for marginal review benefit. The chain strategy decision itself remains
`deferred` per `openspec/config.yaml` and is subject to the `ask-on-risk` gate at
delivery time — this forecast is the input the delivery step needs, not a commitment to
a specific split.