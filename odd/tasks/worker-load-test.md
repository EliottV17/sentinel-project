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
- [x] T1 (done): Implement isolated target/Compose, safe seeding and reproducible measurement scripts with focused tests and procedural README. Commit `c64b4d7eae9043b4f54e1837b3afd4efbd0981bf` (`test: add isolated reproducible worker load test`).
- [x] T3 (done): Fix no-healthcheck inspection, sampler failure propagation and teardown, preserve failed data with opt-in fresh volume for repeat runs, and calendar-minute metric grouping. Commit `7030004f9726463c153be41bb2f74cdad07c69a5` (`test: make load test sampling and repeat runs reliable`); 19 regression tests independently passed, Bash/AST/Compose/whitespace checks passed.
- [x] T2 (done): Independent two-minute fresh-volume validation completed at clean `5ef5fdbcd5e47c05fead4933cb5658e13a396222`; observed data documented and independently cross-checked in `docs/load-test.md`. Commit `6c77dbe4921d50d4764c52888563b0bfcf418a7b` (`docs: report measured worker load test validation`). Full 900-second runs remain operator-owned and pending.

## Acceptance checks
- Applicable script/target deterministic tests with observed RED/GREEN; syntax and Compose structural validation.
- API healthy before registration/seed; exact dedicated-user count 5,000, no unrelated active monitors; default SSRF intact; target healthy HTTP checks.
- Two-minute run produces raw worker/db/target CSV, minute results/overdue, interval stats, metadata and summary. Preserve local evidence, do not publish invented full-run numbers.
- Failures and skipped checks recorded; no secrets in artifacts; verify no API/worker/.env* changed and no resources in main stack touched.

## Evidence and progress
- Read PLAN.md completely. Read-only explorer mapped schema, SSRF, worker loop and startup. Hardcoded concurrency 10; all due monitors fetched without LIMIT; cycles do not overlap; timestamps are unzoned UTC.
- Docker daemon available: Engine 29.7.2, 12 CPUs, 16,582,406,144 bytes RAM assigned. Host metadata will be captured by harness.
- T1 test-first RED missing metrics module and unknown-state behavior; GREEN eight tests. Independent verifier repeated eight passing tests, Bash syntax, four Python AST parses, Compose config and whitespace checks.
- Independent verifier found plain container_name:null retained dev names; parent fixed all four with !reset null; merged config rechecked names absent and project volume correct before any containers started.
- Native assessment unassessable because new files were untracked: conservatively routed to independent verifier. RDD clone-local off, no native review started.
- Harness is one coherent work unit (1,256 added lines including tests/docs); larger than the planning heuristic, with no code compression or omitted checks. No delivery authorized beyond commits.
- Full runs and remote CI are pending, not acceptance evidence for the short validation.

- First runtime attempt at `6eb47a2` failed: no-healthcheck worker inspection crashed sampler and final metadata; `finally` raised before worker stop. Worker samples absent, so no memory evidence. Raw failed artifacts remain at `scripts/loadtest/results/20261007T024129Z/`.
- Parent verified exact Docker ownership and stopped only sentinel-load-worker-1. No volumes/data removed; failed DB retained. SQL window produced 7,023 healthy results in 120 seconds, but this is not a completed measurement and must not be used to claim memory or sustained full-run throughput.
- Authorized scoped correction adds opt-in new project-specific volume to repeat runs without deleting failed evidence; previous volumes retained. Calendar-minute counts must match requested date_trunc grouping rather than relative buckets.

- Successful evidence directory: `scripts/loadtest/results/20261007T032218Z/`; 120.000-second window after 9.519-second startup and 60.000-second warmup. Exactly 5,000 monitors; 6,920 healthy results, zero failures/unknown, zero overdue in three samples. Interval median 61.9688225 seconds; p95 62.285953049999996 seconds.
- Worker window memory median 24,080,547 and sampled peak 25,249,710 display-derived bytes. Startup had one 7.285 MiB sample and cannot resolve true transient peak. Post-window sample 26.36 MiB / 27,640,463 bytes disclosed; no 25 MB maximum claim.
- Independent final readback cross-checked tables and raw artifacts, repeated all 19 passing tests and whitespace checks, verified no API/worker/dev Compose changes and final worker exited(0). DB/API/target healthy; new and failed-run volumes retained. No secrets serialized in summaries, no `.env*` read/edited, no push/PR.
- Native assessment of new docs was unassessable due untracked scope; conservative independent verification performed. No native review approval claimed, RDD remains clone-local off. API/worker suites not rerun because source unchanged; real harness SQL/Compose/HTTP validated. Full runs/CI/external behavior remain unverified.

## Next step
User runs sequentially `./scripts/loadtest/loadtest.sh --duration 900 --delay 10 --fresh-volume` and `./scripts/loadtest/loadtest.sh --duration 900 --delay 300 --fresh-volume`, then supplies summary.json and raw CSVs to replace pending evidence rows. Keep sample coverage, exact counts and memory units explicit. No full run, destructive cleanup or delivery operation is authorized for the agent.
