# Public status API

`GET /api/v1/public/status` is anonymous and explicitly public. It returns active, published monitors owned by non-demo users, ordered by name. The response contains exactly these fields:

| Field | Meaning |
|---|---|
| `name` | Published monitor name |
| `last_state` | Current monitor state (`healthy`, `unhealthy`, or `null`) |
| `uptime_percentage` | Healthy checks divided by checks in the configured window, from 0 to 100; `null` when there are no samples |
| `last_checked_at` | Current monitor check timestamp, independent of the uptime window; `null` if the monitor has never been checked |

Uptime is aggregated in one SQL query over `STATUS_UPTIME_WINDOW_HOURS` (default `24`). Checks older than the window and future-dated checks are excluded. `last_state` and `last_checked_at` come directly from the monitor row, so the response retains the actual latest worker state and check time even when that check is outside the uptime window or no history rows are present. The API uses an in-process cache controlled by `STATUS_CACHE_TTL_SECONDS` (default `30`); each value must be positive and finite. Each process has its own cache. The existing default per-IP throttler remains in force at 100 requests per minute; the endpoint does not relax or override it.

Publication is controlled only by the status seed. User monitor POST/PATCH DTOs do not accept `is_public`, and demo-owned monitors are excluded even if publication is misconfigured. The response deliberately omits targets, IDs, owners, check configuration, and frequency.

## Frontend classification

The single classifier lives in `frontend/src/features/status/status.ts`; the API returns facts and does not duplicate this presentation logic. Both service badges and the overall summary use that classifier. The overall summary uses the worst service severity in this order: **Caído > Degradado > Sin datos > Operacional**. An empty list is presented separately as no configured public services, never as an all-operational result.

| Condition (in precedence order) | Public label |
|---|---|
| Missing/invalid/future check time, missing/unknown state, or check older than configured staleness | Sin datos |
| Fresh `unhealthy` state | Caído (uptime is irrelevant) |
| Fresh `healthy` state with no valid uptime samples | Sin datos |
| Fresh `healthy` state with uptime below degradation threshold | Degradado |
| Fresh `healthy` state with uptime at or above degradation threshold | Operacional |

Staleness uses `VITE_STATUS_STALE_AFTER_MINUTES` (default `5`); degradation uses `VITE_STATUS_DEGRADED_THRESHOLD_PERCENT` (default `99`). Both are frontend build-time settings, parsed and validated by the classifier with safe defaults when values are invalid. For a local Vite run, set those `VITE_` variables in the frontend process environment. For the Compose build, set the root-level `STATUS_STALE_AFTER_MINUTES` and `STATUS_DEGRADED_THRESHOLD_PERCENT`; Compose maps them to Docker build arguments and the final SPA. Example values (not secrets):

```dotenv
STATUS_STALE_AFTER_MINUTES=5
STATUS_DEGRADED_THRESHOLD_PERCENT=99
```

Changing these values for a Compose deployment requires rebuilding the frontend image; they are not API runtime settings. The uptime measurement window remains independently configured by API runtime setting `STATUS_UPTIME_WINDOW_HOURS` (default `24`).
