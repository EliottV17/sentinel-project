# Sentinel operational UI clarity

## Objective
Implement the approved six-block plan as small verified work units while preserving Kanso Zen identity and existing behavior.

## Authorization and boundaries
- User approved implementation, new branch from main, functional/accessibility/responsive verification, and explicitly authorized local commits per verified unit.
- Branch: feat/operational-ui-clarity. Base: main at 5f53362.
- No push, PR, merge, automatic deployment or production data mutation.
- Preserve palette, serif/monospace identity, functionality, deletion safeguards and demo reset notices. English UI; monitor is the primary term.
- No large dependencies, Go/schema/retention changes, cursor pagination, history beyond200, temporal uptime engine or speculative historical latency rewriting.
- Writes single-threaded. Verification commands sequential.

## Design decisions
- Chart X coordinates use actual timestamps. Break the line for null/nonfinite latency and for timestamp separation strictly greater than 3 times the monitor's current configured frequency (seconds). Equality at threshold is not a gap. Describe this as a missing-samples heuristic based on current frequency, never as evidence of downtime; past frequency configuration is not available. Preserve valid zero and measured failed-check durations.
- Public metric remains healthy check count / total count in the backend-configured rolling window. Keep response array and existing fields/meaning; add sampling metadata. Frontend tolerates old payloads and never invents a24-hour window.
- History metrics use loaded samples; share count/real interval/timezone context. Keep standard median and nearest-rank P95 over finite recorded durations; cards use1decimal.
- Exhaustion depends on successfully loaded rows AND their requested limit, never pending placeholders. Full batches mean unknown exhaustion; cap200 is not end-of-history. Retry same failed limit and guard concurrent activation.
- Dashboard uses inline Add monitor disclosure, not modal. Separate pending from failing monitors and represent administrative paused state where relevant.

## Work units and acceptance
- [x] T1 Timestamp-aware, scaled, accessible latency chart (approved block1).
  - Numeric ms scale, width-adaptive real-time ticks, mouse/keyboard/touch selection, missing measurements and frequency-relative gaps, accessible description/table retained.
  - Tests: irregular/equal timestamps, day boundary, single/empty/all-null samples, zero/error durations, gap threshold, keyboard/touch selection. Route: delegated worker; multi-file behavior/tests and graph geometry.
- [x] T2 Truthful public and history metric context (block2).
  - Add backwards-compatible public sample metadata; inventory all consumers; old-response fallback. Count/window/interval/timezone,1decimal latency cards, unchanged formulas.
  - Tests: configured nondefault window, null/partial/mixed samples, compatibility, sampling scope updates. Route: delegated worker; API/frontend contract change.
- [x] T3 History exhaustion, retry and inflight correctness (block3).
  - Distinct exhaustion/cap/loading/error, retain data, retry same limit, preserve429 cooldown and monitor switching.
  - Tests: counts0/14/15/49/50/51/200, loading placeholders, failed expansion, duplicate activation, refresh and monitor switch. Route: delegated worker; hook/page/tests.
- [x] T4 Upfront form requirements and semantic validation (block4a).
  - Real password/username hints, required semantics, associated hints/errors, preserve autocomplete and keyboard submit; early HTTP/HTTPS feedback without cloning security policy.
  - Tests: requirements, accessible description, errors, invalid targets, submission and busy states. Route: delegated worker; auth/create forms/tests.
- [ ] T5 Accessible secondary deletion confirmation (block4b).
  - Keep two-step protection, named confirmation, focus transition/restoration, Escape, announcements and touch sizing.
  - Tests: keyboard confirmation/cancel, target name, pending/errors. Route: delegated worker; DeleteButton/tests.
- [ ] T6 Monitor-first dashboard and inline creation (block5).
  - Direct Monitors heading, remove redundant overview, compact accurate counters, pending vs failures, admin state, disclosure with focus and retained error input; preserve operational fields.
  - Tests: statuses/counters, empty/populated lists, disclosure open/close, create success/error and focus. Route: delegated worker; dashboard/rows/form/tests.
- [ ] T7 Direct copy and decluttering (block6a).
  - Remove inert help, fake operational claims, redundant brand/footer/labels and internal external-link arrows; no visible demo credentials when direct entry works. Preserve useful notices.
  - Tests: auth/demo/navigation/messages unchanged; passive copy uses structural verification, not fabricated RED. Route: delegated worker; related feature pages/tests.
- [ ] T8 Responsive/accessibility integration and final verification (block6b).
  - Fix observed overflow/focus/touch/layout defects only; no aesthetic redesign. Verify360/390/768/1280px, long URLs/email, demo/header, localized table scroll, chart touch/keyboard, zoom200%, reduced motion, contrast and text/icon states.
  - Existing focused/full frontend tests and build; focused API tests/build; local isolated API integration where safely available. Browser checks must be real, not jsdom screenshots. Report every skipped/unavailable check explicitly.
  - Route: verifier first; bounded worker for proven scoped defects; independent recheck. No production calls/data writes.

## Verification policy
Use applicable deterministic test-first RED/GREEN for behavior. Commands and exact observed results recorded per task. No baseline failures assumed. Read-only native ASSESS after each writer; follow returned verifier plan. User-owned RDD is off; do not enable it. Any unavailable risk assessment is treated high. Full suites/browser commands go to verifier. Generated artifacts must not alter production connections/data.
Each completed unit includes behavior/tests/docs in a Conventional Commit; record hash below. Feature progress updates are bookkeeping, not claims of functional validation. No task checked off before outcome and applicable focused checks observed. Integrated browser acceptance remains T8 until actually run.

## Progress and evidence
- Setup: clean main5f53362, branch created, local commits explicitly authorized. No source changes yet.
- T1: completed in8c1ecbc (feat(history): add accessible timestamp-based latency chart). RED initial module failures then6regression failures; GREEN3files/25tests, typecheck and focused eslint PASS; independent recheck same results and all5findings resolved. Parent spotcheck geometry6tests PASS. Browser/physicaltouch/screenreader limits remain T8. Rollback: only history chart component/geometry/page integration/tests/README; no API/data changes.
- T2: completed91a94b2 (feat(status): expose truthful check sampling context). RED API2fail/frontend5fail; GREEN API8tests/frontend45tests, APIbuild/frontendtypecheck/focusedlint PASS. Parent API8tests PASS. Native ASSESS medium/large, no independent verifier required. Flatarray/legacy4fields preserved, optional safe nested check_summary with consistent SQL snapshot; strict allowlists/legacyfixtures tested. E2E updated NOTRUN pending isolatedDB T8. Rollback: remove addedmetadata andUIcontext, preserve existingmetricformulas/classification.
- T3: completedabc6347 (fix(history): stop exhausted loads and retry failed expansions). RED5fail14pass; GREEN23integrationtests/typecheck/focusedlint PASS; parent23tests PASS. Successfulrows+monitor+limit guard, short/full/cap states distinct, samefailedlimit retry, rapidactivation/429/terminal401403404/refresh/navigation covered. Native ASSESS medium/large selfverificationstands. Rollback: historyhook exhaustion/retry state+page messages/tests/docs only.
- T4: completed924fbea (fix(forms): expose requirements and guard pending submissions). InitialRED7fail26pass; correctionRED4fail32pass (3POST instead1), finalGREEN36tests/typecheck/focusedlint PASS; parentcreate13tests PASS. All3monitorfieldsrequired/errorassociated, visibleguidance in3forms, username/password upfront, HTTP/localhostfeedback, pendingmutation/refguardreleasedonsettlement. ASSESSmedium/large selfverificationstands. Rollback: guidance/semantics/clientfeedback/pendingguard in3forms/tests; no serverpolicychange.
- T5: in progress — accessible inline delete confirmation writer. T6-T8: pending.
- Native review: RDD off; no review authority created.
- Browser, builds and functional checks: not yet executed.

## Next step
Implement T5 accessible two-step deletion, focus/Escape/name/announcements/touch targets; preserve safeguards, assess andverify beforecommit.
