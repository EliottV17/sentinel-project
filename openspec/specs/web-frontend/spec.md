# Web Frontend Specification

## Purpose

A greenfield browser SPA for sentinel that closes the monitoring loop in one place:
log in → see every monitor with live healthy/unhealthy state → create a monitor →
delete one. React + Vite (TypeScript) SPA served as static files; server state comes
from polling the existing REST API on a ~10–15 s cadence. No realtime transport, no
SSR, no edit/history/pagination features in the MVP.

## Requirements

### Requirement: Login with existing credentials

The SPA MUST provide a login view at `/login` that authenticates against
`POST /api/v1/auth/login` using the OAuth2 form-encoded body (`username` +
`password`), where `username` accepts either username or email. On success the SPA
MUST store the access token and navigate to the monitors view. On 401 the SPA MUST
show an inline "invalid credentials" error on the form and MUST NOT redirect.

#### Scenario: Successful login

- GIVEN a registered user with valid credentials
- WHEN the user submits the login form with their username or email and password
- THEN the SPA receives `{access_token, token_type}` and navigates to the
  protected monitors view

#### Scenario: Invalid credentials stay on the form

- GIVEN a user with wrong credentials
- WHEN the login form is submitted
- THEN the API returns 401 and the SPA shows an inline error on the login form
  without navigating away

### Requirement: Session-scoped token handling

The access token MUST live in an in-memory store written through to
`sessionStorage`; the SPA MUST NOT persist the token in `localStorage`. The SPA MUST
decode the token's `exp` at login and proactively redirect to `/login` when the
token is within ~60 s of expiry or has expired, without relying on a hardcoded
expiry duration. On any 401 from a protected API call, the SPA MUST clear the token
and redirect to `/login?next=<path>`, returning the user to `next` after a
successful login. A client-side Logout control MUST clear the token and return to
`/login` (no server revocation exists).

#### Scenario: Browser refresh restores the session

- GIVEN a logged-in session
- WHEN the user reloads the page within the token lifetime
- THEN the SPA restores the token from sessionStorage and the user remains logged in

#### Scenario: 401 interceptor redirects with return path

- GIVEN the user is on the monitors view with an expired token
- WHEN a protected API call returns 401
- THEN the SPA clears the token and redirects to `/login?next=/`
- AND after re-login the user lands back on the monitors view

#### Scenario: Logout clears the session

- GIVEN a logged-in user
- WHEN the user clicks Logout
- THEN the token is removed from memory and sessionStorage and the SPA navigates to
  `/login`

### Requirement: Route protection

The SPA MUST protect the monitors view behind authentication: an unauthenticated
visitor to a protected route MUST be redirected to `/login`, preserving the
attempted path for post-login return.

#### Scenario: Unauthenticated visitor is redirected

- GIVEN no stored token
- WHEN a visitor navigates to a protected route
- THEN the SPA redirects to `/login` and remembers the attempted path

### Requirement: Monitors list with live state

The SPA MUST display the authenticated user's monitors with the fields `name`,
`target`, `frequency`, `last_state`, `last_checked_at`, and
`consecutive_failures`. The state pill MUST derive from `last_state` only:
`null` → a muted "Never checked" indicator, `"healthy"` → a green Healthy pill,
`"unhealthy"` → a red Unhealthy pill. The list MUST refresh by polling
`GET /api/v1/monitors/` at a 10–15 s cadence (default 10 s, matching the API engine
tick). Mutations MUST invalidate the list query so changes appear immediately.
Polling MUST pause for hidden tabs and MUST slow down (with retry/backoff) while the
API is unreachable, keeping the last known data visible rather than blanking the
list. `check_config` MUST NOT be rendered.

#### Scenario: State pill reflects live state

- GIVEN a monitor whose target has just gone down
- WHEN the poll cycle fetches the list after the engine flips `last_state` to
  `"unhealthy"`
- THEN the monitor row shows the red Unhealthy pill

#### Scenario: Never-checked monitor is distinguishable

- GIVEN a newly created monitor that no engine has checked yet
- WHEN the list renders
- THEN the row shows the muted "Never checked" state instead of healthy or
  unhealthy

#### Scenario: Mutations surface immediately

- GIVEN the monitors list is displayed
- WHEN a create or delete mutation succeeds
- THEN the list is invalidated and refetched immediately, in addition to the
  regular poll cadence

#### Scenario: Hidden tabs do not poll

- GIVEN the SPA tab is hidden in the background
- WHEN the poll interval elapses
- THEN the SPA does not issue a fetch while the tab is hidden and resumes on
  visibility

#### Scenario: API unreachable keeps last data

- GIVEN the API has been unreachable across several polls
- WHEN the user views the monitors list
- THEN the SPA retains and shows the last known data with a stale/offline banner
  and continues polling at a slowed interval

### Requirement: Freshness hint for stalled engines

The SPA SHOULD show a subdued per-row hint when `last_checked_at` is older than
roughly `max(frequency, 30 s) × 2`, signaling that live data has gone stale (the
checking engine may be down). The hint SHOULD be derived from the data, not from
alerts.

#### Scenario: Stale timestamp shows the hint

- GIVEN a monitor with `frequency` 60 whose `last_checked_at` is more than
  ~2 minutes old
- WHEN the list renders
- THEN the row shows the "engine may be down" freshness hint

### Requirement: Naive-UTC timestamp normalization

The API returns timestamps without timezone designators. The SPA MUST normalize
every datetime by appending `Z` when no timezone designator is present before
parsing, so displayed times and "x ago" freshness reflect UTC rather than being
shifted by the viewer's local offset. Display formatting MUST use the user's locale
and timezone. This behavior MUST be pinned by tests with a fixed timezone.

#### Scenario: Naive timestamps are treated as UTC

- GIVEN an API timestamp string without a timezone designator
- WHEN the SPA parses and formats it
- THEN the value is interpreted as UTC (no local-offset shift) and rendered in the
  user's locale

### Requirement: Create monitor

The SPA MUST provide a create-monitor form with fields: `name` (required,
1–100 chars), `target` (required, must be a valid URL), and `frequency` (integer ≥
10, default 60). `check_type` MUST be locked to `"http"` and the request MUST send
the default `check_config` (`expected_status: 200`, `timeout: 10`, `method: "GET"`).
Client-side validation MUST mirror the server's Pydantic constraints. On 201 the
SPA MUST invalidate the monitors list so the new monitor appears immediately. On
400 the SPA MUST map FastAPI `detail` errors (string or `[{loc, msg, type}]` list)
back to the offending form fields or show them as a form-level message.

#### Scenario: Valid creation appears on the list

- GIVEN the user fills name, target, and a frequency ≥ 10
- WHEN the form is submitted
- THEN the API returns 201, the list is invalidated, and the new monitor row
  appears without waiting for the next poll

#### Scenario: Validation error maps to the field

- GIVEN the user submits `frequency` below 10
- WHEN the API returns 400 with a validation detail list
- THEN the SPA shows the error message on the frequency field, not as a generic
  error

### Requirement: Delete monitor

The SPA MUST provide a per-monitor delete action requiring explicit user
confirmation. On success the SPA MUST invalidate the monitors list. On 404 (monitor
already removed) the SPA MUST show a "monitor not found — refreshing" message and
invalidate the list.

#### Scenario: Confirmed delete removes the row

- GIVEN the monitors list is displayed
- WHEN the user confirms deletion of a monitor
- THEN the API delete call succeeds, the list is invalidated, and the row
  disappears

#### Scenario: Deleting an already-removed monitor

- GIVEN the monitor was deleted in another tab or session
- WHEN the user confirms deletion and the API returns 404
- THEN the SPA shows the "not found" message and refreshes the list

### Requirement: API contract types and base URL configuration

The SPA MUST use types generated from the API's `/openapi.json` (committed
generated schema) rather than fully hand-written types. All API calls MUST go
through a configurable base URL (`VITE_API_BASE_URL`, default empty): in development
the empty default relies on the Vite dev-server proxy to the API origin, and in
production the variable points at the cross-origin API host, which requires the
CORS configuration on the API.

#### Scenario: Cross-origin production call works via CORS

- GIVEN `VITE_API_BASE_URL=https://<api-host>` and the API's `CORS_ORIGINS` includes
  the SPA origin
- WHEN the SPA makes an authenticated API call from its own origin
- THEN the browser accepts the response because the CORS headers permit the SPA
  origin with credentials

### Requirement: Quality gates for the new toolchain

The frontend MUST build, pass lint, pass typecheck, and pass its component/query
test suite (Vitest + React Testing Library with mocked API calls; no live backend
required). The adopted package manager and test commands MUST be documented in
`openspec/config.yaml` (`testing.runners.frontend`), and frontend run instructions
MUST be added to the README.

#### Scenario: Clean checkout verifies the suite

- GIVEN a clean checkout with the documented toolchain steps
- WHEN the frontend build, lint, typecheck, and test commands run
- THEN all succeed with no live API instance running

### Requirement: Scope boundary (non-goals)

The MVP MUST NOT include: edit/PATCH UI, per-monitor history or alerts views, token
refresh, realtime transport (SSE/WebSocket), pagination/filtering/sorting,
pause/resume, uptime/latency aggregates, user registration or profile UI, dark-mode
theming, i18n, multi-tab token sync, richer `check_config` editing, or component
library adoption. These are second-wave concerns and MUST NOT be partially built
here.

#### Scenario: MVP contains only the confirmed loop

- GIVEN the completed MVP
- WHEN a user explores the SPA
- THEN only login, the monitors list with live state, create, delete, and their
  supporting affordances (banners, interceptors) exist — no history, edit, or
  realtime surfaces are present