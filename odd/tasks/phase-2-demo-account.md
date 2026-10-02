# Phase 2 — Demo Account (ODD)

Branch: `feat/phase-2-demo-account`
Base: `main` at `0c66884`
Authorization: User approved implementation and specified reset ownership in `sentinel-worker`.
Demo monitor source of truth: one shared JSON manifest at repository root, consumed by the API seed and worker reset; keep list of monitors in no second location.
TDD: strict, explicitly selected by user for this feature. Evidence required per task: RED → GREEN → REFACTOR.
Checks requested by user: `cd sentinel-api && bun run test`; `cd sentinel-api && bun run test:e2e` against real Compose database; `cd frontend && bun run lint`; `cd sentinel-worker && go test -count=1 ./...`.
Delivery strategy: ask-on-risk. Use small Conventional Commits separated by migration, API, worker, frontend, and tests; no push or merge.

## Tasks

### T1 — Record Phase 2 requirements and shared seed contract
- Add all user-approved Phase 2 acceptance requirements to the Phase 2 checklist in `PLAN.md` (including public-account limits, demo-only auth, protected user operations, race behavior, public-safe seed targets, env docs, no public monitors, shared manifest, 60-minute reset default, and UI reset notice).
- Do not read or write any `.env.example` path. Mark environment-variable documentation as pending user paste and leave it unchecked until user confirms.
- Establish the root-level shared JSON demo-monitor manifest and make its single-source ownership explicit.
- Resolve how the manifest is available to both API and worker runtime/Docker Compose without duplicating its monitor list. The selected runtime plan is a read-only bind mount of the root manifest into both Compose services; keep Docker build contexts unchanged.
- Checks: declarative-only task; no behavioral RED/GREEN test evidence claimed. `docker compose --env-file /dev/null -f docker-compose.yml config --quiet` passed; `python3 -m json.tool demo-monitors.json >/dev/null` passed; `git diff --check` passed.
- Route: delegated direct as preparation for a cross-language shared contract and multiple files.
- Status: done.
- Commit evidence: `7fe4e9c feat: add shared demo monitor manifest`.
- RDD assessment: unavailable (untracked ODD task artifact prevented native assessment); independent Compose/manifest verification passed.

### T2 — Add demo persistence and idempotent API seeding
- Add `users.is_demo` with a Prisma migration.
- Build idempotent API seeding around `DEMO_USER_EMAIL`, public credentials, and the shared manifest; do not create the account during login. Update matching manifest monitors by stable `seed_key` (or equivalent per-user unique key), add missing ones, and preserve all extra demo-owned monitors; the seed never deletes rows. Reset alone replaces the exact demo set, filtered by the demo user ID.
- Ensure manifest targets pass the existing SSRF validation rules and do not mark monitors public. Two seeded monitors at default `DEMO_MAX_MONITORS=3` leave one slot free; reject configuration where the manifest count would consume the full quota.
- Strict-TDD seed test: run twice without duplicates, restore an edited manifest monitor, and retain an extra user-created monitor.
- Do not access or modify any `.env.example`; the final handoff must include a copy-ready example-only block with every new environment variable. Keep the PLAN checkbox open until the user confirms manual paste.
- Checks: strict TDD; focused seed tests and Prisma/migration validation, including repeat/restore/extra-preservation behavior.
- Route: delegated direct; multi-file implementation.
- Status: done. Added baseline migration `0_init` before the demo delta; preserved the existing data and did not drop/reset the Compose DB.
- Verification: focused seed test passed (1 test); `bunx prisma validate` and `bunx prisma generate` passed; `git diff --check` passed. Independent verifiers confirmed behavior and migration shape.
- Commit evidence: `145b117 test: cover demo seed restoration semantics`; `1dc9088 feat(db): add demo flags and monitor seed keys`; `4e0543b feat(api): seed demo account from shared manifest`; `38d2e1a feat(db): baseline existing prisma schema`.
- RDD assessment: unavailable for these candidates (untracked files/schema-incompatible failure); independent verifier passed the focused test/schema/migration checks.
- Baseline diagnosis/resolution: existing Compose DB had legacy tables and no Prisma history; the first `migrate deploy` stopped with P3005 before mutation. Added `0_init` for the pre-demo schema (including legacy `alembic_version`), marked it applied on the existing DB with `prisma migrate resolve --applied 0_init`, then applied the demo delta with `prisma migrate deploy`. Both migrations now show applied and `prisma migrate diff` reports empty schema diff. Fresh DB uses `migrate deploy` for both migrations.
- Environment-variable docs: intentionally deferred to user paste; no `.env.example` access.
- Seed acceptance: run twice without duplicates, restore an edited manifest monitor by stable `seed_key`, preserve an extra user-created monitor, enforce at least one free slot (2 manifest entries / default max 3), and never delete in the seeder; only reset job may delete by demo user ID.

### T3 — Implement demo authentication, account boundaries, and quotas
- Add parameter-free `POST /api/v1/auth/demo-login`; return clear 503 if configured account is missing; apply 30/minute per-IP demo throttling without relaxing 5/minute login/register limits.
- Issue demo JWTs with configurable short expiry; preserve identity status through JWT validation and return `is_demo` from `/users/me`.
- Enforce demo monitor count and frequency quotas on create and PATCH; prevent public monitor flag activation.
- Protect all current and future user mutation routes from demo users; test the route inventory invariant for password/email/delete operations.
- Checks: strict TDD plus API unit/e2e tests.
- Route: delegated direct; multi-file API change.
- Status: done.
- Strict TDD: RED/GREEN for demo-login claim, create quota, exact frequency variable, and password-login demo expiry; e2e proxy harness corrected to match application trust-proxy setting.
- Verification: focused API unit tests passed (4 suites, 38 tests); API build passed; `bun run test:e2e` against real Compose PostgreSQL passed (2 suites, 31 tests). Initial E2E failures (demo password expiry 30m; forwarded-IP harness ECONNRESET/429; monitor rate-limit interference) were fixed without weakening assertions.
- Commit evidence: `0e341d0 test: cover demo auth quotas and boundaries`; `6273470 feat(api): enforce demo auth and quotas`.
- RDD: native review start/assessment unavailable because the package-local binary is missing; independent verifier passed unit tests/build and Compose e2e 31/31. No installation was attempted.
- Environment-variable docs remain pending user paste; no `.env.example` access.

### T4 — Implement worker reset and deletion-race resilience
- Reset only monitors selected by `user.id` found via `DEMO_USER_EMAIL`; absent demo user is a no-op.
- Schedule at `DEMO_RESET_INTERVAL_MINUTES` (default 60), restore monitors from the shared manifest, and purge that user's monitor history/alerts idempotently.
- Treat FK violations caused by a monitor concurrently deleted during a check as expected, log them, and keep the worker running.
- Add deterministic worker tests for reset and concurrent deletion behavior.
- Checks: strict TDD plus `go test -count=1 ./...`.
- Route: delegated direct; worker-specific multi-file change.
- Status: done.
- Strict TDD recovery: initial tests-first run failed at compile time (not acceptable behavior RED); then a schema-driven test failed at runtime because the reset INSERT omitted required `created_at` and `consecutive_failures`. Added both and saw focused tests pass. FK insert seam tests also demonstrated behavior RED against a stub before GREEN.
- Verification: `go test -count=1 ./...` passed; `go vet ./...` passed; independent verifier repeated both. `docker compose --env-file /dev/null config ...` validated API/worker demo defaults and read-only shared manifest mounts.
- Database evidence: reset logic and rollback/scope/race tested with fakes; schema readback verifies required DDL. No live PostgreSQL worker reset was executed.
- Commit evidence: `2ddb2cf test: cover worker demo reset and races`; `3a55478 feat(worker): reset demo monitors periodically`; `a68bf2d feat(compose): configure demo runtime defaults`.
- RDD: native assessment/inspect unavailable because the package-local binary is missing; independent Go and Compose verification passed. No installation attempted.
- Environment-variable docs remain pending user paste; no `.env.example` access.

### T5 — Add demo login and reset notice to frontend
- Add “Probar demo” using the dedicated parameter-free endpoint and visible example credentials that match configured Compose defaults.
- Use the signed `is_demo` JWT claim for a zero-extra-request identity flag and show a clear 60-minute reset notice in the authenticated shell.
- Decision: keep the button on `/auth/demo-login`; do not prefill regular login (wrong 5/min throttle). Read fallback text from Vite build args with matching defaults.
- Checks: strict TDD with frontend tests and `bun run lint`.
- Route: delegated direct; multi-file frontend change.
- Status: done.
- Strict TDD: login and provider tests first failed behavioral assertions for missing demo CTA/credentials and missing reset notice; GREEN followed after implementation.
- Verification: focused tests 3 files/15 passed; full frontend suite 13 files/87 passed; typecheck, lint, and production build passed. Compose build args matched configured backend demo credentials; Compose defaults/mounts remained valid. Build emitted two non-fatal upstream Zod Rollup annotation warnings.
- Commit evidence: `656fabc test(frontend): cover demo access and reset notice`; `c8d4589 feat(frontend): add demo access and reset notice`; `4f69c4f feat(frontend): show demo reset notice`; `384e28d build(compose): pass demo credentials to frontend`.
- `is_demo` comes from signed JWT claim; the banner makes no extra `/users/me` request. Demo CTA uses the dedicated 30/min endpoint and leaves standard login unchanged.
- Environment-variable docs remain pending user paste; no `.env.example` access.

### T6 — Complete acceptance tests, Phase 2 checklist, and requested suites
- Add/update e2e and unit tests for every approved requirement; include rate-limit distinctions, missing demo account, PATCH quota, account mutation protections, idempotent reset, and reset-vs-worker FK race.
- Mark Phase 2 checklist items complete only when evidence passes.
- Run the exact requested API unit/e2e, frontend lint, and worker suites; report every failure or skipped check truthfully.
- Checks: all user-requested suites; e2e against the real Compose database.
- Route: delegated verification for command execution; parent performs scoped result/readback.
- Status: pending.
- Commit evidence: pending.
