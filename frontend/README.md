# Sentinel Frontend

React SPA dashboard for the Sentinel uptime monitoring engine. It talks exclusively to the [sentinel-api](../sentinel-api/README.md) REST backend: all monitoring work (checks, state transitions, alerts) is executed by the [sentinel-worker](../sentinel-worker/README.md) in Go — this package only renders state and issues CRUD calls.

## Tech Stack

| Layer | Choice |
|---|---|
| UI framework | **React 19** (function components + hooks) |
| Build tool | **Vite 7** (`@vitejs/plugin-react`) |
| Language | **TypeScript** ~5.9 (strict, `tsc -b`) |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite`) |
| Server state | `@tanstack/react-query` |
| Forms + validation | `react-hook-form` + `zod` (`@hookform/resolvers`) |
| Routing | `react-router-dom` 7 |
| Tests | **Vitest 3** + Testing Library (jsdom) + **MSW** |
| Package manager | **Bun** (pinned `bun@1.4.0`; text-format `bun.lock` committed) |

## Environment Variables

The SPA is fully static and reads its configuration at build time via Vite's `import.meta.env`:

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `""` (same origin, `/api`) | Base URL of the REST API. Empty means the SPA calls `/api` on its own origin: in dev, Vite proxies `/api` to `http://localhost:8000`; in Docker, nginx does the same. Set a full URL (e.g. `https://api.example.com`) to split the origins. **Baked at build time** — changing it requires a rebuild. |
| `VITE_POLL_INTERVAL_MS` | `10000` | UI refresh cadence (ms) for the monitors list (react-query refetch). Read once at module load; the Go worker still checks each monitor on its own `frequency`. |

See [`.env.example`](./.env.example) for the canonical template.

## Commands

All commands run from `frontend/`:

```bash
bun install                # install dependencies
bun run dev                # Vite dev server with HMR on http://localhost:5173
bun run build              # typecheck (tsc -b) + production build to dist/
bun run test               # run unit/component tests once (Vitest)
bun run test:watch         # Vitest watch mode
bun run lint               # ESLint (flat config, eslint.config.js)
bun run typecheck          # TypeScript check only (tsc -b)
bun run gen:api            # regenerate src/lib/api/schema.ts from the running API
```

### Regenerating the API client (`gen:api`)

`src/lib/api/schema.ts` is generated from the FastAPI OpenAPI contract with `openapi-typescript`:

```bash
bun run gen:api
```

Prerequisite: a running dev API on `http://localhost:8000` (e.g. `cd ../sentinel-api && uv run uvicorn app.main:app --reload`). Regenerate only when the API contract changes — the generated file is committed, so keep diffs intentional.

## Project Layout

```text
src/
├── app/
│   ├── api/          # fetch wrapper + bearer token store + typed endpoints
│   ├── auth/         # AuthProvider, route guards, JWT helpers
│   ├── styles/       # Tailwind / global styles entry
│   └── AppShell.tsx  # authenticated app shell
├── components/       # shared UI primitives (Button, Card, Input, Spinner)
├── features/
│   ├── login/        # login page
│   └── monitors/     # dashboard: monitor list, create form, poll logic
├── lib/
│   └── api/          # generated OpenAPI schema + FastAPI error normalization
└── test/             # Vitest setup, fixtures, MSW handlers
```

## Testing

Tests run on **jsdom** and mock every API call via **MSW** (`src/test/mocks/handlers.ts`), so they exercise real component logic without a backend:

- API client behavior: token attachment, 401 handling, FastAPI error-body normalization.
- Auth flows: login, JWT parsing, route guards.
- Monitor CRUD forms and the react-query polling hooks.

Run with `bun run test` (CI mode) or `bun run test:watch`.

## Docker / Production Serving

The SPA is served as static files by **nginx** (`nginx.conf`) — not by the Vite dev server:

- Multi-stage `Dockerfile`: builds with `oven/bun:1.4` (`bun install --frozen-lockfile` → `bun run build`), serves `dist/` from `nginx:alpine`.
- `VITE_API_BASE_URL` is a build `ARG` (default `""` → same-origin `/api`).
- `nginx.conf` proxies `/api/` to the `api` compose service (port 8000) and falls unknown routes back to `index.html` (SPA routing).

In the full stack (`docker compose up -d --build` from the repo root), the frontend is exposed on **http://localhost:5173**.