# Phase 3: Public status

## Current state
Implementation and local verification are complete on `feat/phase-3-public-status` (base `0e1ccd1`).
Final documentation commit: `4d6d7041aa572255702604d9327b406528085816`.
At that initial boundary the source worktree was clean; cumulative work-unit diff lines were 1,985.
Publication-maintenance follow-up: `c5c924011fe9db0a454ec9c04bc41eb6aad5915d`, see `odd/tasks/status-publication-reconciliation.md`. It revokes obsolete public flags without deletion; current API checks are 76 unit/46 real-PG e2e/build PASS. User edits to .env.example/status-monitors.json remain preserved outside the fix. Configuration follow-up: `c434fa381a46650bcb3267984358f917a9f4af13` commits the user-approved .env.example and one portfolio monitor manifest; source Git worktree now clean. Total cumulative work-unit diff lines: 2,371.
Remote CI is **not observed**. The PLAN phase-completion condition requiring green CI remains pending.
No push, PR creation, merge, or Phase 4 implementation is authorized.

## Constraints and decisions
- PLAN.md remains authoritative; Phase 2 preceded this branch.
- JWT is global; public handlers use explicit metadata and an exact route-inventory test.
- Seed-only `monitor.is_public`, default false; POST/PATCH input attempts return 400.
- Dedicated inactive, non-demo owner via STATUS_OWNER_EMAIL, recognized by an unusable non-Argon2 password marker. Ordinary/demo email collisions fail without adoption.
- Separate `status-monitors.json`, stable seed_key, SSRF-safe examples, idempotent update-never-delete seed.
- Anonymous endpoint returns exactly name, last_state, uptime_percentage, last_checked_at for active/public/non-demo monitors.
- SQL windowed aggregation and composite history index; memory cache, coalescing, and unchanged default per-IP throttler.
- Latest check timestamp comes from monitor, independently of the uptime window.
- Shared frontend classifier: invalid/missing/future/stale check → Sin datos; fresh unhealthy → Caído; fresh healthy/no uptime → Sin datos; healthy below threshold → Degradado; otherwise Operacional.
- Overall severity: Caído > Degradado > Sin datos > Operacional.
- Five-minute staleness and 99% degradation defaults; anonymous 30-second polling retains data on refresh failures.
- React Router matchPath(end:true) governs public expiry exemptions, including trailing slash and case aliases, excluding nested paths.
- Worker/frontend healthchecks and configurable 30-day history retention stay deferred to Phase 4.
- No .env.example was read or edited. Final delivery contains example-only variables, with Compose/container vs local paths distinguished.
- Human selected future feature-branch-chain review organization. Small cohesive Conventional Commits, no code-golf.

## Work units and commit evidence
- [x] T1 Update PLAN scope and Phase 4 deferrals: `e960cdc`. Passive documentation; structural check, no meaningful RED.
- [x] T2 Global JWT and public route inventory: `82add66`. New-suite missing-module RED; guard/inventory unit and real e2e GREEN. Earlier native auth review approved and consumed for this exact work unit only.
- [x] T3 Publication schema, isolated seed and demo-reset proof: `dff1518`, safe e2e cleanup `54e8d4b`, Go regression `ec771c6`, manifest mount `5dff84b`, verified plan `804e2d7`. Seed unit11/e2e7, repeated seed, migrations, build and Go checks passed; safe cleanup correction observed RED before deletion.
- [x] B1 Read-only diagnosis of terminal native artifact-verification stop. Cause unknown; no implementation commit applies to read-only diagnosis. Human explicitly chose clone-local RDD off and continuation; blocked authority preserved.
- [x] T4 Public SQL endpoint/cache/security tests: `cd1f90b`, CI fixtures `825dead`, Compose config `e4901fd`, verified PLAN `a819bc5`. Missing-module RED and realDB timestamp regression RED; focused8/full74 unit and real focused20 e2e GREEN. Fresh independent unit8/e2e20 passed after DB readiness restoration.
- [x] T5 Public frontend: anonymous client/Auth tests `d26ca9f`; classifier/DTO/tests/env/docs `7f387b1`; UI/App/Login/tests `cadd2c5`; build args `6df726c`; verified PLAN `273cf20`. Independent full120/lint/typecheck/build passed. All four source work units are below 400 diff lines.
- [x] T6 Full local suites, Compose health, exact-field curl and real Chromium verification. Final evidence recorded in `4d6d7041aa572255702604d9327b406528085816`; no behavioral source changes during verification.

## Final independent functional verification
Verified source boundary: `273cf20b941c018f4205e9f9e50c5cb08716cbab`; subsequent commit changes PLAN only.
- API: `bun run test -- --runInBand` — 13 suites, 74 tests PASS.
- API: `bun run test:e2e -- --runInBand` — 5 suites, 44 tests PASS against real Compose PostgreSQL `sentinel_phase3_tests_db`.
- API: `bun run build` PASS.
- Frontend: 15 files, 120 tests, lint, typecheck and build independently PASS on this exact source. Not rerun by the final API/Go/runtime executor.
- Go: `go test -count=1 ./...` PASS, 3 tested packages and 3 packages without tests.
- Compose: `docker compose up -d --build` PASS; API, worker and frontend images built. DB and API healthy; worker/frontend running, no healthchecks claimed.
- Anonymous root/public curl HTTP200. Nonempty public response contains Example Website and GitHub API, each with exactly the four allowed keys.
- Chromium/ChromeDriver: page populated; expired synthetic token retained; four observed public-status requests had no Authorization; /status/ and /STATUS stayed public; protected / redirected to login; simulated refresh failure retained both services and showed friendly warning.
- Parent spotcheck observed HTTP200 and exact public JSON; Example Website unhealthy/0%, GitHub API healthy/100% at 2026-10-03T04:27:30Z. These are real checker observations, not forced fixtures.
- No remaining failed functional checks. Nonfatal React act, Zod/Rollup annotation and Prisma configuration-deprecation warnings remain.

## Process limits and resolved incidents
- Original classifier/page missing-module RED was observed; initial client/Auth-specific RED was not captured.
- Auth alias correction observed four genuine RED failures before the fix; private expiry remained passing.
- Duplicate-key test passed before fix because its warning matcher was too narrow; strengthened afterward. No historical pre-fix RED claim is made.
- Initial independent e2e failed because DB was unreachable. Compose DB readiness restoration followed by real20 e2e PASS resolved the environment issue.
- Preferred verifier runtime failed twice without usable evidence; explorer fallback lacked bash. Fresh shell-equipped workers were strictly verification-only; never static-inspection-as-test claims.
- Wrong-cwd API file creation was diagnosed separately and removed only after exact human file authorization.
- Wrong-cwd frontend Vitest created only root node_modules/.vite (~4 KiB). Human approved exact root-directory cleanup; parent verified root identity, non-symlink, .vite-only contents and no tracked paths, removed only that directory, preserved frontend/node_modules.
- Every future shell invocation must prefix its absolute package cwd; shell cwd does not persist between calls. No unapproved bunx install fallback.
- Initial browser automation endpoint/diagnostic errors were resolved; the final actual browser run passed all stated checks.
- Existing legacy sentinel_tests_db was never reset/baselined. Isolated Prisma test DB was created non-destructively. Runtime deploy/seed preserved ordinary accounts and public history.
- Compose runtime test used an ephemeral non-default SECRET_KEY, never printed or written to repository files; a future re-up needs a configured non-default key.

## Native authority and verification policy
- RDD OFF clone-local by explicit human selection `disable_clone_continue`; global remains ON.
- Seed lineage `review-04b23f37a39e155c` remains correction_required/terminal captured_artifacts_unverifiable, never approved/acknowledged.
- Original seed target: `sha256:45b020d115b6e73ce49171f8670417119a975fcf00af7a061307bb75a4a3fdb3`.
- Corrected target: `sha256:231e8e1d95f00a57cc1ba4cbecfcf0f402e8eb94a1b433a8f81fc4b2a026b5ef`.
- No reset, recover, delete, or new START was used after the user disabled clone-local review.
- Native read-only ASSESS reported high risk for CI/auth changes and required independent verification; that ordinary risk-gated plan was fulfilled.
- No native approval is claimed for the seed, endpoint or frontend; only earlier auth work-unit approval remains historical.
- Relevant skills used: work-unit-commits, cognitive-doc-design, go-testing.

## Next step
Remote CI and future feature-branch-chain review require explicit human authorization for push/PR actions.
Do not start Phase 4 until Phase 3 is integrated according to PLAN.

## Approved example/manifest commit
User explicitly authorized the two-file commit after supplying .env.example contents. Public demo credentials and SECRET_KEY placeholder are examples (placeholder rejected in production); staged active assignments matched supplied values without disclosing unexpected values. Actual .env was not read/edited. Manifest has one unique stable key and HTTPS portfolio target, validated with the actual API target validator; no DB writes or source behavior edits. Commit c434fa3 includes only these files, no push/PR/merge. This approval is a bounded exception to the earlier example-file restriction, not unrestricted future environment access. Local implementation/runtime verification remains complete, remote CI unobserved.
