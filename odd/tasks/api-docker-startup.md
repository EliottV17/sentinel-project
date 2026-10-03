# API Docker startup and artifact verification

## Goal
Fix the API image startup failure at its source, execute Prisma migrations and the idempotent demo seed on API startup, expose a real Compose health check, and add CI coverage proving the production image contains the expected entrypoint artifact.

## Constraints
- Keep `CMD`/runtime entrypoint expecting `dist/main.js`; do not hide a compiler root/output regression by changing it to `dist/src/main.js`.
- Build TypeScript application sources only from `src/` with an explicit root/output mapping. Any separately compiled seed must have an explicit output path; preferably preserve Bun's current TS seed runtime and package its imported source intentionally.
- Preserve existing Compose database volume and data. Never drop/reset databases.
- Do not access or modify any `.env.example` by any path or method.
- Keep migrations and seed idempotent; run `prisma migrate deploy` before the seed on each API container startup.
- Small Conventional Commits; do not push or merge.

## Evidence / Acceptance
- Current production API image builds but contains `/app/dist/src/main.js`, not `/app/dist/main.js` (reproduced using `docker compose build api` and a transient shell container).
- `tsconfig.build.json` explicitly sets `rootDir: "src"`, includes only `src/**/*`, excludes tests/scripts/prisma/outDir, and Nest build uses that config.
- Docker image build preserves the `bun dist/main.js` application target and supplies files required by the seed runtime.
- API container startup runs migrations, then the idempotent seed, then starts the API; Compose reports API healthy.
- Demo login HTTP smoke returns a token and the demo identity works; seeded monitors match the shared manifest.
- CI builds the API image and asserts `/app/dist/main.js` exists in the final image (and optionally asserts the misplaced `dist/src/main.js` does not exist).
- Run `docker compose build api`, `docker compose up -d --build`, verify health, migrations/seed startup and demo HTTP flow; report complete Compose status.

## Work units
### T1 — Fix TypeScript build scope and guard the image artifact
- Add build tsconfig / Nest configuration and Docker copy.
- Add CI production image build + artifact assertion before implementation fix to capture behavioral RED, then fix and show GREEN.
- Status: done. RED: image build succeeded but `test -f /app/dist/main.js` returned 1; `find` showed `/app/dist/src/main.js`. GREEN: local build has `dist/main.js` only; built image contains `/app/dist/main.js` and not `/app/dist/src/main.js`.
- Commit evidence: `528053d ci(api): verify production entrypoint artifact`; `627e3d5 fix(api): keep Nest build rooted in src`.

### T2 — Make container startup initialize schema and demo seed
- Add an executable entrypoint that runs `bunx prisma migrate deploy`, then `bun run prisma:seed`, then `exec` the unchanged `bun dist/main.js` CMD.
- Ensure runtime image contains the TypeScript source imported by `prisma/seed.ts`; the seed is executed directly by Bun and is not compiled into `dist`.
- Add a deterministic shell test using fake `bunx`/`bun` commands to verify startup ordering; run it in CI.
- Add/verify Compose API healthcheck at the existing root endpoint and wait for API health before starting worker/frontend.
- Status: done. RED: shell test showed only `bun dist/main.js`, with migration/seed calls absent; GREEN: verified `bunx prisma migrate deploy` → `bun run prisma:seed` → `exec` CMD.
- Commits: `97feda7 test(api): verify startup initialization order`; `566d435 feat(api): initialize migrations and demo seed`.

### T3 — Verify full Compose startup and record evidence
- Build API image and locate `main.js` inside it.
- Start the full Compose stack without dropping volumes; check API health, migration and seed logs, API demo-login and `/users/me` claim, frontend reachability, and complete Compose status.
- Run relevant API tests/build and CI artifact check; capture skipped/failed checks honestly.
- Status: done. `docker compose build api`, `docker compose build worker frontend`, and `docker compose up -d` all passed without dropping volumes. API became healthy immediately; DB healthy; worker/frontend running. Logs show Prisma migration status up-to-date, `bun prisma/seed.ts` ran, and Nest started.
- Database check found exactly 2 manifest-seeded demo monitors. Live `POST /api/v1/auth/demo-login` plus authenticated `/api/v1/users/me` returned `is_demo=true`. Frontend returned HTTP 200 and its served JS contains `Probar demo`, `/api/v1/auth/demo-login`, and the 60-minute reset notice. Final `docker compose ps` showed API healthy, DB healthy, worker/frontend running.
- CI artifact check's equivalent Docker build/assertion passed and the image contains `/app/dist/main.js` only; CI workflow includes that check and the deterministic startup-order shell test.
- Native review assessment/inspect unavailable because the package-local binary is missing; independent verification and live Compose checks passed. No installation attempted.

## Status
- T1/T2/T3 done; Compose stack remains running.
- T1 commits: `528053d`, `627e3d5`. T2 commits: `97feda7`, `566d435`.
- No `.env.example` access.
