# Public status API

`GET /api/v1/public/status` is anonymous and explicitly public. It returns active, published monitors owned by non-demo users, ordered by name. The response contains only these fields:

| Field | Meaning |
|---|---|
| `name` | Published monitor name |
| `last_state` | Current monitor state (`healthy`, `unhealthy`, or `null`) |
| `uptime_percentage` | Healthy checks divided by checks in the configured window, from 0 to 100; `null` when there are no samples |
| `last_checked_at` | Current monitor check timestamp, independent of the uptime window; `null` if the monitor has never been checked |

Uptime is aggregated in one SQL query over `STATUS_UPTIME_WINDOW_HOURS` (default `24`). Checks older than the window and future-dated checks are excluded. `last_state` and `last_checked_at` come directly from the monitor row, so the response retains the actual latest worker state and check time even when that check is outside the uptime window or no history rows are present. The API uses an in-process cache controlled by `STATUS_CACHE_TTL_SECONDS` (default `30`); each value must be positive and finite. Each process has its own cache. The existing default per-IP throttler remains in force at 100 requests per minute; the endpoint does not relax or override it.

Publication is controlled only by the status seed. User monitor POST/PATCH DTOs do not accept `is_public`, and demo-owned monitors are excluded even if publication is misconfigured. The response deliberately omits targets, IDs, owners, and check configuration.

The frontend owns the single status classifier. Its contract is: missing or older-than-five-minute checks are “Sin datos”; a fresh unhealthy check is “Caído”; a fresh healthy check with no uptime is “Sin datos”; otherwise uptime below 99% is “Degradado” and uptime at least 99% is “Operacional”. The API does not duplicate that presentation logic. Frontend staleness remains a frontend configuration concern.
