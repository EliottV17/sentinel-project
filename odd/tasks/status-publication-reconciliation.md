# Status publication reconciliation

## Goal and scope
Fix stale publication flags on feat/phase-3-public-status (base HEAD 4d6d704), as explicitly authorized by the user. A monitor is public iff it belongs to the current STATUS_OWNER_EMAIL owner and its non-null seed_key is in the current manifest. All other public monitors become private without deletion; log the number hidden.

## Constraints
- Preserve user modifications to .env.example and status-monitors.json. Never read/edit .env.example, and never stage either user-modified file.
- Validate manifest and owner safety before mutation; atomic upsert/reconciliation; reject ordinary/demo owner collisions without takeover.
- Empty manifest is valid: remove-last-entry hides all. No configured owner means no eligible public monitors; keep demo-only startup valid without needing a status manifest, but revoke stale flags when the seed executes.
- Explicitly cover null seed_key (SQL NULL semantics) and old owners. Filter previously public rows so already-private demo/ordinary monitors remain untouched.
- Preserve every monitor, owner, check_result and alert row; only publication is revoked.
- Current API memory cache may retain prior response until TTL; no endpoint/frontend changes requested.
- One source writer; no installs, database resets/baselining, push/PR/merge. Every shell call prefixes absolute package cwd.
- Existing clone-local RDD off/global on choice remains; ASSESS chooses ordinary verification after writer handoff.

## Tasks
- [x] R1 Implement reconciliation, deterministic regression tests, concise docs and the authorized small work-unit commit. Authorized surfaces: StatusSeed+unit/e2e, CLIseed if required, endpointREADME, PLAN. Tests first, observe meaningful RED then GREEN.
- [x] R2 Assess the committed-only fix range and verify full API unit/e2e with real Compose PostgreSQL and build; independent verifier when ASSESS requires it. Use dedicated sentinel_phase3_tests_db with synthetic test configuration, never application/legacy databases or real environment values.
- [x] R3 Record verification evidence and report the scoped commit/counts/limitations; preserve the two user-modified files.

## Checks
Removing manifest entry hides it; owner switch hides prior owner; repeat invocation changes no flags/count0; demo and ordinary private monitors untouched. Empty manifest, null seed_key and owner/collision/invalid-input failure behavior covered proportionately. Monitor/history retention asserted. Hidden count logged after committed changes, including zero.

## Progress
Exploration confirms upsert-only implementation and rejection of empty manifest. Current CLI skips status seeding without STATUS_OWNER_EMAIL (map required before fixes). User requested precise invariant, not deletions. All three tasks complete; final commit and verification evidence are recorded below.

## Next step
Re-run the updated seed with the intended current owner/manifest to apply the fix to application data; rebuild the API image first if running an old Docker image. No automatic application reseed was performed.

Assessment isolation: current workspace includes user .env.example/status-monitors.json changes; never assess the ambient dirty diff. After writer self-checks, parent commits only explicit bugfix paths and ASSESS uses committedOnly with the previous full HEAD as base, excluding user files. New global reconciliation deliberately changes publication on previous owners; existing seed e2e snapshot expectations must retain monitor/history protection while allowing this intentional is_public revocation, not restore obsolete visibility to force green.

## R1 handoff and coverage completion
Writer implemented six scoped paths (190 additions/74 deletions), genuine unit/e2e RED for omitted/null keys and empty manifest, then full unit76/e2e45/build PASS. Parent spotcheck confirms transaction + postcommit logging + explicit null-key branch, no-owner CLI reconciliation. Remaining acceptance gap: existing repeat mock changes input and doesn't simulate real hiding; private demo/normal preservation not explicitly exercised during reconciliation, omitted-history test only used retained row. Sole test/doc continuation murzekhz-a-tam2 addresses exact same-input idempotence/count0, private-row/history snapshots and omitted-row history; scoped unit/e2e/PLAN only, full checks rerun. No commit yet; user files preserved. New passing triangulation tests must not be represented as historical RED.

## Verified fix boundary
- Commit c5c924011fe9db0a454ec9c04bc41eb6aad5915d: fix(seed): reconcile current public status monitors. Six authorized files, 289 additions/77 deletions (366 lines); user-modified .env.example/status-monitors.json excluded and still modified. No push/PR/merge.
- Final writer checks: seed unit12/e2e9, full API unit76 (13 suites), real PostgreSQL e2e46 (5 suites), build PASS. Same-input repeat count1→0 and row snapshot unchanged; private normal/demo monitors+histories retained; omitted-monitor history survives. Original old-code RED documented above; coverage extension was triangulation, not new behavior RED. Test-authoring unsupported createManyAndReturn corrected without dependency changes.
- Committed-only ASSESS base4d6d7041aa572255702604d9327b406528085816 excludes user files: risk medium, writer large/runtime, RDDoff, self-verification stands, independentVerifier=false. No separate verifier required/run. No native authority operations/approval claim.
- Application database/live Docker image not changed or reseeded; only dedicated test DB used. Running old image needs rebuild before seed can apply the fix. Public API cache/polling may delay visibility of revoked rows until TTL/refetch.
- R3 complete: evidence and readbacks recorded; no pending functional failures or source edits. Remaining working-tree changes are the user's two original files.
