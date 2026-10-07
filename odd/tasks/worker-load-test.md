# Reproducible worker load test

## Objective and authorization
Measure 5,000 private HTTP monitors at 60-second frequency against a local synthetic target without changing API/worker code or weakening SSRF. User authorized this feature, small `test:`/`docs:` commits, and a two-minute validation only. Full 15-minute observation runs at 10 ms and 300 ms were executed by the user; their supplied artifacts are now independently verified. Update the evidence document without running new workloads or modifying harness/API/worker code.

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
- [x] T2 (done): Independent two-minute fresh-volume validation completed at clean `5ef5fdbcd5e47c05fead4933cb5658e13a396222`; observed data documented and independently cross-checked in `docs/load-test.md`. Commit `6c77dbe4921d50d4764c52888563b0bfcf418a7b` (`docs: report measured worker load test validation`). Full 900-second runs were subsequently supplied by the user; see T4.

- [x] T4 (done): Replaced pending full-run evidence with independently verified results and strict UTC resource recomputations, disclosed phase-only summary race and unmeasured startup transients. Commit `a1fda0f078bf724c0139d2821f5e663d222388df` (`docs: report verified full worker load test results`). No harness or application changes. Native assessment passive: parent structural readback and git diff --check passed; no new tests or workloads needed for documentation.

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

## Supplied full-run evidence
- 10 ms: `scripts/loadtest/results/20261007T035935Z/`; 300 ms: `scripts/loadtest/results/20261007T041737Z/`. Both completed at clean `6db4d0171da10c3edf7f08f2b2c87b738d9b9541`, identical images/host, 5,000 monitors, 900-second windows, zero worker restarts and final exited state.
- Raw result totals: 70,960 and 28,270, all healthy. Window overdue maxima 0 and 2,340 (15 samples each). Interval medians 61.994875 and 190.9495485 seconds; p95 62.055171099999995 and 210.26961054999998 seconds.
- Strict raw timestamp resource filter gives 90 samples/container/run; worker window memory medians 37,654,364 and 32,033,996 display-derived bytes; peaks 52,785,315 (50.34 MiB) and 36,458,987 (34.77 MiB).
- Independent verification discovered summarize_samples filters phase tags only while sampler remains running; original summary has snapshot-count asymmetry. Recompute documented window metrics from final raw timestamps; preserve original artifacts. Prior claim that summary enforces timestamps was incorrect and must be corrected in docs.
- No measured attribution of throughput gap to SQL/ticker/locks; no assertion transient startup peak was definitely missed. Only sampled limits and capacity formula are supported.

## Next step
Full-run evidence now committed. Use the measured 10 ms scenario (5,000 monitors; 70,960 healthy checks in 900 seconds; median worker memory 37,654,364 display-derived bytes; sampled peak 52,785,315 bytes) instead of the unsupported combined claim. Sampler timestamp-boundary fix, CI, external targets and profiling remain follow-ups; no new run, harness fix, destructive cleanup, push or PR is authorized.
