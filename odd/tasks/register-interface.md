# Register interface

## Objective and rationale
Implement the registration screen from `sentinel-interface-design.zip` using the existing frontend conventions and NestJS user creation contract. Successful registration returns to login with a confirmation message; it must not sign in automatically.

## Scope and constraints
- Frontend registration API adapter, form, routing, login link and success feedback, and focused tests.
- Preserve ZIP desktop/mobile layout, copy, demo action, and status navigation while using existing design tokens and brand components.
- Send `name`, `last_name`, `username`, `email`, and `password`; never send `confirmPassword`. Phone is optional and omitted.
- Match backend username (3–20 ASCII alphanumeric characters) and password (8+ characters, a letter and a digit) rules.
- Backend changes, new dependencies, ZIP extraction, deployment, push, PR, and merge are out of scope.
- Branch: `feat/register-interface`, created from updated `main` / `origin/main` at `e812b30`.
- User initially approved branch creation and implementation only. User subsequently authorized exact root-cache cleanup and committing the verified registration work. Push, PR, merge, and deployment remain unauthorized.
- Keep writes single-threaded and leave the user-provided ZIP untouched and untracked.

## Tasks
- [x] T1 — Implement registration and regression tests. **Implemented, verified, and committed in `09a8dc8`.** Registration, DTO-aligned payload, public route, login redirect/banner, and tests are present. Both verifier findings corrected: name errors use correct distinct field matching; password inputs contain aria-hidden lock icons. Correction RED: 3 failed / 15 passed; GREEN: 18 passed. Full suite now 175 tests. Initial feature RED remains mixed with incorrect-root runner failures; correction RED is clean.
- [x] T2 — Independently verify implementation and review scope. **Verified; tests included in `09a8dc8`.** Post-correction independent verification PASS: 18 focused / 175 full tests, typecheck, lint, build, diff --check. Chromium desktop/mobile checks confirm icons, label focus, distinct backend name-error attribution, success redirect/banner, no tokens, and no horizontal overflow. No remaining defects detected within checked scope.
- [x] T3 — Resolve accidental root runner cache. **Completed with user authorization.** Exact results cache deleted after verifying no symlinks/unexpected files; now-empty root directories removed. `frontend/node_modules` inode unchanged; root `node_modules` absent. Closure evidence is recorded with this feature document.

## Acceptance criteria
- `/register` is reachable without authentication and linked from login.
- Registration reproduces ZIP intent on desktop/mobile without importing ZIP scaffolding or adding dependencies.
- Client validation mirrors DTO, including password confirmation, with accessible labels and feedback.
- Request uses `last_name` and excludes confirmation; account creation uses existing public endpoint.
- Success navigates to `/login` with an accessible account-created message, without storing credentials or calling login.
- Duplicate email/username, validation errors, HTTP 429, server errors, and network errors are handled; no false success.
- Repeated submission and simultaneous registration/demo requests are prevented.
- Demo and status links work through existing flows; existing login behavior remains intact.

## Verification and evidence
- Initial state: only untracked `sentinel-interface-design.zip`; `git fetch origin` and fast-forward-only update reported main already current.
- Writer focused Vitest: 6 files / 34 tests passed; full frontend Vitest: 25 files / 168 tests passed.
- Writer typecheck, lint, build passed; build has dependency annotation and chunk-size warnings. Parent `git diff --check -- frontend/src` passed.
- Initial RED was not a clean frontend-runner execution; retain this limitation rather than claiming complete TDD evidence.
- Read-only ASSESS failed because untracked paths require declaration; returned risk unassessable and independent verifier required (RDD off). No native review transaction started.
- Planned commands from `frontend/`: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`; focused Vitest tests precede full checks.
- Independent verifier used preinstalled Chromium 152 and Playwright against temporary loopback Vite server (terminated afterward). Desktop 1280×800 and mobile 375×667 had no horizontal overflow. Labels/focus, validation, intercepted success→login/banner/no tokens, duplicate email, 429/500 safe errors, demo and navigation passed. No live backend/database writes.
- Correction writer mv1me6wb-4-ght5: focused `bun run test -- src/lib/api/errors.test.ts src/features/register/RegisterPage.test.tsx` observed RED (3 failed / 15 passed) then GREEN (18 passed), with normalizer regressions and icon presence/aria-hidden assertions.
- Correction full suite: 26 files / 175 tests passed; typecheck, lint, build, and diff --check passed. Parent spot-read confirms separate name/last_name/username attribution and both lock SVGs. Repeated ASSESS remains unassessable -> independent verification required.
- Native review switch: injected clone-local RDD is off; use read-only ASSESS after writer return and follow verifier plan. Do not enable RDD.
- Final verifier mv1mi784-5-pbhw independently passed focused (2 files / 18 tests), full (26 files / 175 tests), typecheck, lint, production build, and diff --check.
- Final real Chromium checks at 1280×800 and 375×667 passed: lock icons visible/aria-hidden, label focus, isolated Name error from mocked backend validation array, success redirect to login/banner, zero stored tokens, no horizontal overflow. Temporary server terminated.
- Live backend/database end-to-end test: not executed; browser endpoints were intercepted to avoid creating real accounts. Backend unchanged.
- Remaining non-blocking build warnings: upstream Zod annotations and JS bundle >500 kB (~533 kB). Native ASSESS unavailable due untracked declaration; conservative independent verification completed instead, no native authority transaction.
- Final parent spot-check: `git diff --check -- frontend/src` passed; feature branch and HEAD e812b30 unchanged, so no commits created.
- Feature work-unit commit: `09a8dc8522d8cb1ac84f3893cbdf9145dee37b27` — `feat(auth): add registration with sign-in confirmation`; 13 frontend files, 498 insertions / 21 deletions, tests included. User explicitly authorized this commit after cleanup.
- Runtime evidence: independent Chromium tests with intercepted API responses, described above; real database writes were not performed.
- Rollback boundary: revert feature commit to remove registration UI/API helper/routing/login feedback and related tests; backend and existing account data unaffected.
- Authorized cleanup: exact root Vitest cache removed, now-empty directories removed, frontend dependencies preserved, final Git whitespace checks passed. ZIP is not staged.

## Progress and next step
All three tasks are complete. User-authorized feature commit `09a8dc8` contains the verified frontend implementation and tests; this document records its evidence. No backend changes, added dependencies, push, PR, or deployment. ZIP remains untouched and untracked. Review workload is 519 added/deleted frontend lines because this is a coherent screen/API/routing/tests unit; no unrelated scope or line-budget compression. Next: human visual/live API check at `/register` and local startup guidance. Compose startup recommendation remains read-only; no services were started or stopped by this task.
