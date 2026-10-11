# Deterministic E2E CI

## Objective
Make the complete API E2E command pass reliably on the CI database without weakening assertions or changing production publication policy.

## Authorization and boundaries
- User approved corrections, disposable PostgreSQL verification and local commits.
- Continue on feat/operational-ui-clarity from clean ac02e15; preserve the completed UI feature.
- No production database/configuration, existing DB reuse, dependency/schema/Go changes, publishing, PR, merge or deployment.
- One writer; commands and verification runs are sequential.
- Local runtime writes are limited to a newly created, identity-tracked PostgreSQL 17 container on 127.0.0.1:5433 with database sentinel_e2e_ci_test_db.
- Use minimal explicit env-i and assert the exact database URL before schema/seed/test writes. Never run the scout's suggested 5432/createdb command.

## Problem and design
- StatusSeed reconciles publication globally. Parallel suites on one database can unpublish public-status fixtures.
- Configure Jest E2E maxWorkers: 1; production reconciliation remains unchanged.
- Cache fixtures must select the healthy monitor by name, not the first ID of an unordered query.
- Concurrent inserts do not guarantee ID allocation order. Compare the same ID set in a consistent numeric order while retaining full row snapshots.
- Inspect the cache clock before changing its test. Prefer a tests-only controlled expiry over a 150 ms wall-clock race if database time semantics remain real.
- Document why shared-database suites are serialized; do not introduce a per-worker schema framework.

## Tasks and acceptance
- [ ] T1 Correct E2E isolation and deterministic fixture assertions.
  - Observe the existing complete-command failure on a freshly bootstrapped disposable DB before fixes.
  - Edit only Jest E2E configuration, the two failing specs and a brief API testing note.
  - Preserve all tests, privacy/publication checks, cache behavior, throttling and row/history retention assertions.
  - Run focused checks, build and applicable non-mutating type/lint checks. Record actual RED/GREEN, limitations and local commit.
- [ ] T2 Verify the full CI E2E command and relevant API checks independently.
  - Match CI's schema push, account/monitor seed and build using isolated explicit environment.
  - Use a fresh code view with an actual empty private node_modules/.cache, build once as CI does, and assert dist/main.js plus dist/common/config/production-env.js exist before testing.
  - Run bun run test:e2e with no command-line serialization or suite filters, three consecutive times on the same newly bootstrapped DB without hidden reseeding.
  - Run the API unit suite and relevant entrypoint test with no downloads or production changes.
  - Confirm owned container removal, free port, expected Git scope and unchanged production source/schema/dependencies.
  - Record failures/skips honestly; remote GitHub Actions and Docker image/security jobs are not claimed from local tests.

## Evidence
- Initial user CI report: 7 suites, 2 failed / 5 passed; 51 tests, 2 failed / 49 passed.
- Read-only mapping confirms the seed's global updateMany, unordered healthy ID selection and Promise.all ID-order assumption.
- CI setup: .github/workflows/ci.yml uses PostgreSQL 17, prisma db push, prisma:seed, build, unit tests and the default test:e2e script.
- T1 corrections and mandatory independent verification passed; local commit is pending.
- Writer bootstrap verified the disposable database URL and synced the existing schema only to owned container 3db35cf..., but Prisma announced automatic .env loading. It stopped before baseline/tests/edits. Container was removed and port 5433 is free.
- An initial wrong-cwd bunx invocation resolved/downloaded packages outside the API local CLI; no repository changes resulted. This is a workflow deviation, not successful verification. Do not delete shared caches or retry package resolution.
- Incident verifier mv3dz9jd-s-owzz confirmed local Prisma/client 6.19.3, Bun 1.4.3 and Node 26.7.0. Bun supports --no-env-file. Prisma CLI auto-discovers environment files, and generated client also contains baked-in relative environment paths; the latter means Bun flags alone do not prove hermetic execution.
- Resume uses an external temporary tracked-code CI view with no environment files, symlinked existing non-Prisma dependencies, and physically copied @prisma/client plus generated .prisma/client so environment paths remain inside the clean view. Resolve and assert client paths before DB writes. Existing local CLI runs from that view with its schema and --skip-generate; do not use --accept-data-loss or --force-reset. Main environment files and generated client remain untouched. Copy only the four authorized edited files into the view before GREEN.
- Local Bun 1.4.3 differs from CI's pinned 1.4.0; record that limit, do not install or download another runtime.
- Writer observed fresh-DB RED: 2 failed / 5 passed suites, 2 failed / 49 passed tests. Failures reproduced unordered cache target and concurrent history ID assumptions. GREEN: focused public-status 3/3 and status-seed 9/9; complete default E2E script 7 suites / 51 tests PASS; build, tsc --noEmit and diff check PASS. Main edit scope: four files, 55 insertions / 20 deletions before the passive README translation to match existing Spanish documentation.
- Cache expiry now advances a restored Date.now spy beyond the original service TTL while PostgreSQL NOW() remains real; original cache/TTL, spy and inserted row are restored or cleaned in finally. Full snapshot/privacy assertions remain.
- A direct Bun invocation of Jest's JavaScript entrypoint failed on callSite.getFileName; the correct Node CLI and default Bun run script passed. Do not execute Jest's entrypoint under Bun directly.
- Non-mutating lint was unavailable: local ESLint CLI absent, and the --fix lint script was intentionally not run. No lint PASS is claimed.
- All owned PostgreSQL containers were removed and 5433 is free. Secret-free CI view /tmp/sentinel-e2e-ci-checks/t1-view.8bp5S7 remains because worker deletion is prohibited. Retention is explicit, not a running service or successful filesystem cleanup; do not bypass the restriction. Preserve logs.
- Native ASSESS was unassessable because the task document is untracked. Treat risk as high; mandatory independent verification will inspect the correction and execute the complete script three times before closure.
- User-owned RDD is off; native ASSESS follows writer output.

- First independent verification: all four source hashes matched before/after. Public-status 3/3 and status-seed 9/9 passed all three runs, but complete runs each had 47 PASS / 4 FAIL because production-entrypoint tests could not find compiled dist files. These complete runs are FAIL, not acceptance.
- Tooling/build incident: the reused view's second Nest build exited 0 after deleteOutDir removed dist; unchanged TypeScript source plus retained incremental cache caused no re-emission. Parent verified nest-cli.json, tsconfig.build.json and tsconfig.json. This pre-existing repeat-build interaction is not caused by the four test changes. Do not alter production build settings for this validation artifact.
- API unit 16 suites / 107 tests, typecheck and shell entrypoint PASS. Container 0151286e... was removed; port 5433 is free. Local lint unavailable. Previous views/logs retained under deletion restriction.

- Final fresh independent view t2-fresh-view.44Bhyl has an actual private empty compiler cache, never linked to the host cache. A single default build emitted 120 files; dist/main.js and dist/common/config/production-env.js were verified before E2E and remained present afterward.
- Final E2E stability: THREE consecutive full default-script runs each passed all 7 suites / 51 tests, zero failures/skips/filters and no reseeding between runs. Public-status 3/3 and status-seed 9/9 passed each run. API unit 16 suites / 107 tests, typecheck and shell entrypoint PASS.
- Four current source files and verified view files had matching SHA-256 before and after execution. Production source, schema, build policy and dependency declarations remain unchanged by this correction.
- Final evidence: /tmp/sentinel-e2e-ci-checks/t2-fresh-bootstrap.log, t2-fresh-build.log, t2-fresh-e2e-run1.log, t2-fresh-e2e-run2.log, t2-fresh-e2e-run3.log, t2-fresh-unit.log, t2-fresh-tsc.log, t2-fresh-entrypoint.log.
- Owned final container 7e52cdcb... was stopped/removed after label verification; port 5433 is free. Two secret-free views remain (t1-view.8bp5S7 and t2-fresh-view.44Bhyl), without active services. Retention follows deletion restrictions; no filesystem-cleanup claim is made.
- Limits: ESLint unavailable; local Bun 1.4.3 rather than CI 1.4.0. Remote GitHub Actions, Docker image builds, frontend/Go/security jobs not run for this correction. The pre-existing repeat-build/cache interaction is not fixed by these test changes; final proof used CI-like clean cache and initial build.

## Next step
Resume the bounded writer in the environment-free CI view, assert copied Prisma paths, observe baseline and apply only the four test/documentation edits in the real working tree. Preserve default Jest script semantics. Assess the resulting diff and independently repeat the full E2E command in a separate clean view.
