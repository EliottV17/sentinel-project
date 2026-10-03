# Live status publication verification

## State
Complete: user-authorized live manual checks passed on source c5c9240, feat/phase-3-public-status. No new source changes, commits, push, PR or merge.

## Scope and safeguards
- Used existing root .env through Compose without printing secrets or full effective configuration. .env and .env.example not edited; .env.example not read.
- User's pre-existing status-monitors.json modification preserved. Only temporary case edits were made, then exact original bytes and permissions restored.
- Existing application records/history were not deleted, reset or baselined; normal/demo private publication remained private.
- Fresh disabled test-owner and its one monitor remain in the database, private. This was announced before execution and respects the no-deletion constraint.
- API rebuilt/recreated with the committed fix. Frontend built/started separately with --no-deps and left running for the user; worker was not started, matching initial Compose state.
- Backup retained: /tmp/sentinel-status-verify-gg0g6f20/status-monitors.original.json. Current bytes and mode match backup (0644).

## Tasks
- [x] L1 Execute guarded live matrix, capture baseline/history and restore current configuration. Runtime worker mus0l2pv-b-mxhc; no implementation commit applies to verification-only work.
- [x] L2 Parent readback of restoration/database/API evidence and real public frontend check. Parent read-only audit plus runtime continuation mus11bfg-c-2er4.
- [x] L3 Record evidence and report verified outcome/limits. No human blocker remains.

## Verified cases
- Original/current configuration: exactly one manifest entry public; obsolete owners/omitted entries private.
- Remove entry: one removed monitor became private and remained stored; hidden-count log1. Existing history retained.
- Identical repeat: two seed executions logged0 hidden, no duplicate seed keys or changed publication.
- Owner rotation: one new-owner monitor public and prior-owner monitors private. Old rows/history retained.
- Restore: configured original owner has1public among2retainedownerrows; generated test-owner has1monitor/0public. Exact original manifest bytes/mode restored, container current owner/config restored.
- Parent Prisma audit against live container owner and mounted manifest: owner exists, manifestEntries1, monitors8, published1, invariantMismatches0.
- Database final audit:8monitors/717check_results/0alerts; captured history IDs retained through cases. Worker-owned data may grow normally in future.

## HTTP and UI
- Direct anonymous GET http://localhost:8000/api/v1/public/status:200,1row,exact name/last_state/uptime_percentage/last_checked_at keys.
- Frontend GET http://localhost:5173/status:200.
- Same-origin GET http://localhost:5173/api/v1/public/status:200,1row,exact4keys.
- Isolated headless Chromium rendered Spanish Estado del sistema heading and1service; no application error or login redirect/form.
- API and DB healthy; frontend running without claiming a healthcheck; worker not started. Continuous polling was not tested here.
- Current user Git modifications remain only .env.example and status-monitors.json; no new stage/source changes.

## Resolved tooling incident and limits
The first runtime executor incorrectly queried /public/status and reported404 as a blocker. main.ts applies api/v1 globally and the controller contributes public/status. Parent verified the wrong URL returns404 as expected and the correct route returns200; no route/configuration defect or source fix was needed.
Potential Sin datos on the UI reflects missing/stale checks, not itself publication or rendering failure. Compose worker remains off as initially found; do not claim live check refresh was tested.
Previous unit76/e2e46/build pass evidence belongs to codefix c5c9240; these were not rerun during this live verification. No further implementation or CI/remote delivery was attempted.

## Next step
User can inspect http://localhost:5173/status. No manual intervention is needed for the tested publication behavior. Starting continuous polling or deleting the private test artifact is a separate action, not silently performed.
