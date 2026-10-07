# Reproducible worker load test

## Objective and authorization
Measure 5,000 private HTTP monitors at 60-second frequency against a local synthetic target without changing API/worker code or weakening SSRF. User authorized this feature, small `test:`/`docs:` commits, and a two-minute validation only. Full 15-minute steady-state runs at 10 ms and 300 ms belong to the user and remain pending.

## Scope and constraints
- Worktree `/home/eliott/Projects/sentinel-project-loadtest`, branch `chore/load-test`, based on updated `origin/main` at `9bc49de` (clean, 0/0 divergence).
- Never read or edit `.env*`; Compose uses `--env-file /dev/null` and explicit test environment values.
- Edit only new loadtest override, `scripts/loadtest/`, `docs/load-test.md`, and this tracking document. No API/worker/dev Compose edits, no push/PR.
- Compose project `sentinel-load`, project-specific volumes, only db/api/worker/target. Target `198.51.100.10:8080`, subnet `198.51.100.0/24` allowed by existing SSRF; worker remains on default network for DB.
- Dedicated user registered through API after health; 5,000 SQL-generated monitors with NULL last_checked_at, private, frequency 60, HTTP, empty config. Exclude demo/status monitors from worker workload without modifying their code.
- Sample docker stats every 10 seconds for worker/db/target; startup sampled peak separate from steady median and peak. Label sampled peaks, not exact maxima.
- UTC bounded result count/minute, overdue >30 seconds including never-checked monitors, inter-check median/p95, successful/failed checks, host and Docker resources/version, Git commit/dirty status, effective fixed concurrency 10.
- Do not assert 75,000 results or ~25 MB without measurement. Full runs pending; theoretical upper bounds: 10/0.010=1000 checks/s; 10/0.300=33.333... checks/s before overhead; demand 5000/60=83.333... checks/s.

## Tasks
- [ ] T1 (in progress): Implement isolated target/Compose, safe seeding and reproducible measurement scripts with focused tests and procedural README. Commit `test:` work unit after checks.
- [ ] T2 (pending): Independently execute two-minute validation; write observed numbers and limitations in docs/load-test.md; full run rows pending; commit `docs:` evidence work unit.

## Acceptance checks
- Applicable script/target deterministic tests with observed RED/GREEN; syntax and Compose structural validation.
- API healthy before registration/seed; exact dedicated-user count 5,000, no unrelated active monitors; default SSRF intact; target healthy HTTP checks.
- Two-minute run produces raw worker/db/target CSV, minute results/overdue, interval stats, metadata and summary. Preserve local evidence, do not publish invented full-run numbers.
- Failures and skipped checks recorded; no secrets in artifacts; verify no API/worker/.env* changed and no resources in main stack touched.

## Evidence and progress
- Read PLAN.md completely. Read-only explorer mapped schema, SSRF, worker loop and startup. Hardcoded concurrency 10; all due monitors fetched without LIMIT; cycles do not overlap; timestamps are unzoned UTC.
- Docker daemon available: Engine 29.7.2, 12 CPUs, 16,582,406,144 bytes RAM assigned. Host metadata will be captured by harness.
- Full runs and remote CI are pending, not acceptance evidence for the short validation.

## Next step
Delegate T1 within derived allowed edit surfaces, then assess and route independent validation. No source changes yet.
