# Pre-Proposal — `web-frontend`

Status: product decisions CONFIRMED (user, 2025). Ready for `sdd-proposal`.

## Confirmed decisions

1. **Stack**: React + Vite (TypeScript SPA). No SSR, no Next.js.
2. **Communication**: Polling REST (~10-15 s cadence). No SSE, no WebSocket.
3. **API scope**: CORS middleware only (`sentinel-api/app/main.py`, origins configurable via env). All other gaps (refresh token, pagination, missing endpoints) are client-side workarounds or follow-up changes.
4. **MVP scope**: Minimal — login, monitor list with healthy/unhealthy state, create + delete. No edit, no per-monitor history/alerts (second wave).

## Constraints carried into proposal

- CORS is missing and is the only backend change authorized in this change.
- JWT: HS256, `sub`=email, `exp` ~30 min, no refresh/logout/revocation; 401 → clear token → re-login.
- `check_config` free-form JSON; only `http` checker registered today (expected_status/timeout/method).
- Timestamps naive UTC; `last_state: null` = never checked; alerts only on transitions.
- No pagination; history/alerts are `limit`-capped DESC lists. MVP does not use them anyway.
- `/openapi.json` + `/docs` enabled → client codegen viable (openapi-typescript).