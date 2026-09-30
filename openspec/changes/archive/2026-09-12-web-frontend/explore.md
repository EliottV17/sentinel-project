# Explore — `web-frontend` (greenfield UI for sentinel)

Read-only exploration of the sentinel API surface, auth mechanics, data model, and
async semantics. No implementation. Sources: `sentinel-api/app/**`, `sentinel-worker/internal/worker/loop.go`,
`openspec/config.yaml`.

---

## 1. HTTP surface

Base prefix: **`/api/v1`** (wired in `app/main.py` via `app.include_router(api_router, prefix="/api/v1")`).
Router composition in `app/api/v1/api.py`: `/users`, `/auth`, `/monitors`.

### 1.1 Endpoint table (complete — there are no other routes)

| # | Method | Full path | Auth | Request | Response | Status / errors |
|---|--------|-----------|------|---------|----------|-----------------|
| 1 | GET | `/` | Public | — | `{"message": "Sentinel API está en línea y vigilando"}` | 200 |
| 2 | POST | `/api/v1/users/` | Public | `UserCreate` (JSON) | `UserRead` | 201; 400 on duplicate email/username |
| 3 | GET | `/api/v1/users/me` | Bearer JWT | — | `UserRead` | 200; 401 invalid token; 400 inactive user |
| 4 | POST | `/api/v1/auth/login` | Public (form) | `application/x-www-form-urlencoded`: `username`, `password` (OAuth2PasswordRequestForm) | `Token` `{access_token, token_type:"bearer"}` | 200; 401 + `WWW-Authenticate: Bearer` on bad creds |
| 5 | POST | `/api/v1/monitors/` | Bearer JWT | `MonitorCreate` (JSON) | `MonitorRead` | 201; 400 unknown `check_type` or validation |
| 6 | GET | `/api/v1/monitors/` | Bearer JWT | — | `list[MonitorRead]` (current user's monitors only) | 200 |
| 7 | DELETE | `/api/v1/monitors/{monitor_id}` | Bearer JWT | — | `{"message": "Monitor deleted successfully"}` | 200; 404 if not owner/not found |
| 8 | PATCH | `/api/v1/monitors/{monitor_id}` | Bearer JWT | `MonitorUpdate` (JSON, partial) | `MonitorRead` (no explicit `response_model`, serializes the SQLModel — same shape) | 200; 404 if not owner/not found |
| 9 | GET | `/api/v1/monitors/{monitor_id}/history?limit=50` | Bearer JWT | query `limit:int=50` | `list[CheckResultRead]`, ordered `created_at DESC` | 200; 404 unknown monitor (checked **before** ownership); 403 not owner |
| 10 | GET | `/api/v1/monitors/{monitor_id}/alerts?limit=20` | Bearer JWT | query `limit:int=20` | `list[AlertRead]`, ordered `created_at DESC` | 200; 404 unknown monitor; 403 not owner |

Notes:

- **No `GET /api/v1/monitors/{id}` single-monitor endpoint exists.** The UI must use
  the list (§6).
- `PATCH /monitors/{id}` uses `exclude_unset=True`, so omitted fields are untouched;
  explicit `null` for `last_state`-style optionals is not meaningful here (all
  `MonitorUpdate` fields default to `None` = "not sent").
- **Ownership is enforced per user** on every monitor route (`user_id` filter); 403 vs
  404 semantics are inconsistent between history (403) and delete/update (404).
- Login accepts **email OR username** as `username` field (`AuthService.authenticate_user`
  tries email first, then username). Form-encoded, not JSON.
- Errors are plain FastAPI `{"detail": "..."}` bodies; no error-code taxonomy.
- History/alerts list endpoints do a raw `select` in the endpoint (not the service layer).

### 1.2 Implications for a web client

- Every protected call needs `Authorization: Bearer <token>`; 401 means re-login
  (there is no refresh endpoint — see §2).
- The UI can be built against the OpenAPI schema (§7) — all schemas are typed
  Pydantic models, so client codegen is viable.
- The login endpoint is OAuth2-password-flow compatible, so libraries like
  `swagger-ui`/`OAuth2PasswordBearer`-aware clients work out of the box.

---

## 2. JWT flow

Files: `app/core/security.py`, `app/api/deps.py`, `app/services/auth_service.py`, `app/schemas/auth.py`, `app/core/config.py`.

- **Algorithm / secret**: `HS256` (symmetric) with `settings.SECRET_KEY`; default
  expiry `ACCESS_TOKEN_EXPIRE_MINUTES = 30` (from `.env`, default 30). Changeable via
  env — the client must not hardcode expiry; decode the token's `exp` claim.
- **Claims**: only `sub` = **user email**, plus `exp` (integer unix timestamp,
  `int(expire.timestamp())`). No `iat`, no `jti`, no roles/scopes.
- **Request shape**: `Authorization: Bearer <jwt>` via `OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")`.
- **Validation path** (`get_current_user`): decode → read `sub` (email) → **DB lookup
  by email on every request** → 401 if invalid/expired/unknown user. `get_current_active_user`
  adds a 400 "Inactive user" if `is_active` is false.
- **No refresh tokens. No token revocation/blacklist. No logout endpoint.** A stolen
  token is valid until `exp`; the only client-side remedy is discarding it.
- **Password hashing**: argon2 via `pwdlib`-style `argon2.PasswordHasher`
  (`ph.hash` / `ph.verify`). Server-side only; client just sends plaintext over TLS.
- Login failure returns 401 with `WWW-Authenticate: Bearer`.

### Implications for a web client

- Store the token (memory or localStorage) with a 30-min-max lifetime; decode `exp`
  to trigger re-login proactively. On any 401, clear the token and route to login.
- Token is identity-scoped: the `sub` is email, so the UI can decode it for display
  but must call `/users/me` for the authoritative profile.
- No silent refresh is possible with the current API — either accept re-login every
  ≤30 min or plan an API-side refresh endpoint as part of this change.

---

## 3. Strategy / Registry data structures

Files: `app/core/checkers/{base.py,http_checker.py,registry.py}`, `app/schemas/monitor.py`, `app/models/monitor.py`.

### 3.1 Monitor on the wire (`MonitorRead`, all fields returned on create/list/patch)

| Field | Type | Constraints / default | Notes |
|-------|------|----------------------|-------|
| `id` | `int` | server-assigned | |
| `name` | `str` | 1–100 chars, required | indexed |
| `target` | `str` | required | URL for `http` checker |
| `check_type` | `str` | default `"http"` | must exist in checker registry; validated on **create only** (not on PATCH — see §3.4) |
| `check_config` | `dict` | default `{}` | free-form JSON blob, **not** discriminated/validated |
| `frequency` | `int` | required, `ge=10` (seconds) | validator also enforces ≥10 |
| `state` | `str` | `"Active"` default | lifecycle flag; only `"Active"` monitors are checked |
| `last_state` | `str \| null` | | `"healthy"` / `"unhealthy"`; `null` until first check |
| `last_checked_at` | `datetime \| null` | | naive UTC (tz stripped on write) |
| `consecutive_failures` | `int` | default 0 | reset to 0 on any healthy result |
| `created_at` | `datetime` | server | naive UTC |
| `user_id` | `int` | owner | |

`MonitorUpdate` allows partial `name`, `target`, `check_type`, `check_config`,
`frequency` (each optional, `frequency ge=10` when present).

### 3.2 check_config semantics — free-form, not discriminated

`check_config` is an untyped `dict`/JSON column. There is **no Pydantic discriminated
union per check_type**; validation happens inside each checker at runtime.
For the only registered checker (`http`), recognized keys are:

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `expected_status` | int | `200` | response must equal this to be healthy |
| `timeout` | number (seconds) | `10` | httpx timeout |
| `method` | str | `"GET"` | HTTP method |

Unknown keys are silently ignored; a wrong `expected_status` type would raise at check
time (checker crash → no row written for that monitor's tick).

### 3.3 Registry dispatch

- `_checker_registry: dict[str, type[BaseChecker]]` keyed by `check_type` string.
  `@register("http")` on class; `get_checker(check_type)` raises `ValueError("Unknown
  checker type: ...")` for unregistered types.
- Registration is import-driven: `app/main.py` imports `app.core.checkers.http_checker`.
- `MonitorService.create_monitor` validates `check_type in _checker_registry` → HTTP 400.
  **`update_monitor` does NOT re-validate `check_type`** — a PATCH with a bogus type
  succeeds and the monitor silently stops being checked (scheduler logs per-check failure).
- Checker result (`CheckResult` dataclass): `state` (`"healthy"`/`"unhealthy"` StrEnum),
  `latency_ms: float`, optional `status_code`, `response_sample` (≤500 chars),
  `error_message`, `extra_data: dict | None`.

### 3.4 CheckResult / Alert full field lists

**`CheckResultRead`** (wire) / `check_result` table:

| Field | Type | Notes |
|-------|------|-------|
| `id` | `int` | |
| `monitor_id` | `int` | FK `monitor.id`, indexed |
| `state` | `str` | `"healthy"` or `"unhealthy"` |
| `status_code` | `int \| null` | HTTP status; null on transport errors |
| `latency_ms` | `float \| null` | `0` on transport error in Python checker |
| `error_message` | `str \| null` | `repr(httpx.HTTPError)` on failure |
| `created_at` | `datetime` | naive UTC |

Wire schema omits model fields `response_sample` (≤500 chars body) and `extra_data`
(JSON) — **not exposed to any client today**.

**`AlertRead`** (wire) / `alert` table:

| Field | Type | Notes |
|-------|------|-------|
| `id` | `int` | |
| `monitor_id` | `int` | FK |
| `alert_type` | `str` | `"down"` (healthy→unhealthy) or `"recovery"` (unhealthy→healthy) |
| `message` | `str` | Spanish: `"<name> esta caído"` / `"<name> se recuperó"` |
| `created_at` | `datetime` | naive UTC |

Alerts are written **only on state transitions**, and never for the very first check
(`old_state` must be non-null).

### Implications for a web client

- A monitor-form UI must hand-build per-check-type config editors from client-side
  knowledge (e.g. `expected_status`/`timeout`/`method` for http) — the API offers no
  schema discovery for `check_config` and no list-available-checkers endpoint.
- Client codegen for `MonitorRead.check_config` will be `object`/`Record<string, unknown>`.
- `last_state: null` is a legitimate first-load state — render "pending/never checked".
- The Go worker (`internal/worker/loop.go`) writes the same tables with the same
  semantics, so all UI data is engine-agnostic.

---

## 4. Async semantics (dual engine, state machine)

- **Python engine** (`app/core/scheduler.py`): APScheduler `AsyncIOScheduler` started in
  the FastAPI lifespan; runs `check_all_monitors` **every 10 s**, checks ALL
  `state == "Active"` monitors regardless of `frequency` (bounded by `Semaphore(10)`),
  each with its own fresh DB session commit.
- **Go engine** (`sentinel-worker/internal/worker/loop.go`): ticks every **2 s**, selects
  Active monitors that are *due* (`last_checked_at IS NULL OR last_checked_at +
  frequency seconds <= NOW()`), checks them concurrently (default sem 10), writes
  identical rows.
- **Both engines run against the same tables with no locking/claiming** — running both
  simultaneously double-checks every monitor (duplicate `check_result` rows, racing
  `monitor` updates). Config currently assumes one or the other in a given deployment.
- **State machine**: `monitor.last_state` ∈ {null, "healthy", "unhealthy"}.
  - Every check: insert `check_result`; update `last_state`, `last_checked_at = NOW()`,
    `consecutive_failures` (0 on healthy, +1 otherwise).
  - `alert` inserted only when `old_state != null and old_state != new_state`
    → `alert_type = "down"` or `"recovery"`.
- `frequency` (seconds, ≥10) governs the Go worker's due-ness; the Python scheduler
  ignores it (fixed 10 s cadence), so observed result cadence depends on which engine
  runs.

### Implications for a web client

- **Polling is the only sync mechanism**: no WebSockets, no SSE, no webhooks anywhere
  in the API. A "live" dashboard must poll `GET /monitors/` + per-monitor
  `history`/`alerts` (suggested cadence ~5–15 s; the API's own scheduler runs at 10 s).
- Monitor freshness signal: compare `last_checked_at` to now; stale = engine down.
- Results are an append-only log; `created_at DESC` + `limit` is the natural timeline
  query. There is no cursor/keyset pagination — see §6.
- State transitions only appear in `alerts`; the UI should derive "up/down" from the
  newest `check_result.state` (or `monitor.last_state`) rather than from alerts.

---

## 5. Cross-cutting

### 5.1 `app/main.py` — CORS: **not configured**

`app = FastAPI(title="Sentinel API", lifespan=lifespan)` — there is **no
`CORSMiddleware`, no middleware at all**, no exception handlers, no versioning beyond
the `/api/v1` prefix. A browser SPA on a different origin **will be blocked by CORS**
until the API adds `CORSMiddleware` (allow-origins config needed). This is a blocking
API-side prerequisite for a web client and should be named in the plan.

### 5.2 `app/core/config.py` — settings relevant to a client

| Setting | Default | Client relevance |
|---------|---------|------------------|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | token lifetime |
| `ALGORITHM` | `HS256` | fixed symmetric; client treats token as opaque |
| `SECRET_KEY` | `""` (from `.env`) | server-only |
| `PROJECT_NAME` | "Sentinel API" | OpenAPI title |

No CORS origins, no rate-limit, no environment (dev/prod) settings exist.

### 5.3 `app/core/scheduler.py`

In-process APScheduler (lifespan-bound). One uvicorn worker = one engine. `--reload`
dev server restarts the scheduler each change. Nothing client-visible beyond §4.

### 5.4 Pagination / filtering / ordering conventions

- **No pagination anywhere.** `GET /monitors/` returns all of a user's monitors
  un-ordered (DB default order — effectively insertion order). History/alerts use
  `ORDER BY created_at DESC LIMIT n` with client-supplied `limit` (50/20 defaults),
  **no offset/cursor, no total count** — a UI can page backwards naively at best.
- **No filtering** (by state, date, alert_type) and **no sorting parameters** on any
  list endpoint.
- Timestamps are **naive UTC** (tzinfo stripped at write). Clients must treat all
  datetimes as UTC and localize themselves.

---

## 6. OpenAPI availability — confirmed available

`FastAPI(title="Sentinel API")` is instantiated with default arguments: no
`docs_url=None`, `redoc_url=None`, or `openapi_url=None`. Therefore:

- **`/docs`** (Swagger UI, includes OAuth2 password flow against `/api/v1/auth/login`)
- **`/redoc`**
- **`/openapi.json`** — full typed schema for all models/endpoints.

Client codegen (openapi-typescript, orval, etc.) is viable today. Caveats: the
`PATCH /monitors/{id}` route lacks `response_model`, so its OpenAPI response schema is
empty; and `check_config` is untyped `object`.

---

## 7. What is NOT available yet (gaps a UI would need)

1. **CORS support** — no middleware; a browser SPA cannot call the API cross-origin at all. (Blocking.)
2. **Token refresh / logout** — single 30-min access token only; no `/auth/refresh`, no revocation.
3. **Single-monitor GET** (`GET /monitors/{id}`) — detail views must filter the list client-side.
4. **Pagination** — no offset/cursor/total on monitors, history, or alerts; large monitors/history will degrade the UI.
5. **Global alert feed** — alerts are per-monitor only; no `GET /alerts` across a user's monitors for a dashboard/notification center.
6. **Available checkers discovery** — no `GET /checkers` (list of registered types + their config schema); the form must hardcode `"http"`.
7. **Monitor pause/resume semantics** — `Monitor.state` ("Active") is not in `MonitorUpdate`, so the UI cannot pause/resume a monitor via the API.
8. **Aggregates** — no uptime %, latency stats, or status-over-time endpoint; the UI must compute these from raw `check_result` history (max 50 rows per call).
9. **Filtering/sorting/query params** — no state/date/alert_type filters on any list endpoint.
10. **Realtime** — no WebSocket/SSE; polling only.
11. **`response_sample` / `extra_data`** — captured by checkers but not exposed in any read schema (useful for a result-detail drawer).
12. **User profile mutation** — no update-password / update-profile endpoint.

---

## Key files consulted

- `sentinel-api/app/main.py`, `app/api/v1/api.py`, `app/api/v1/endpoints/{auth,monitor,users}.py`
- `app/api/deps.py`, `app/core/{security,config,scheduler}.py`, `app/db/database.py`
- `app/core/checkers/{base,http_checker,registry}.py`
- `app/services/{auth,monitor,user}_service.py`
- `app/schemas/{auth,monitor,check_result,alert,user}.py`
- `app/models/{monitor,check_result,alert,user}.py`
- `sentinel-worker/internal/worker/loop.go`
