# CI demo E2E environment and planning-artifact ignore

## Goal
Fix API CI E2E failures by configuring and seeding the demo account in the workflow; ignore `odd/` and `openspec/` and remove their already-tracked contents from the branch as the user explicitly selected.

## Constraints
- Do not access or modify `.env.example`.
- Preserve the current database volume; CI environment setup must not affect other users/data.
- User authorized committing the fix and selected removing both `odd/` and `openspec/` from Git tracking. Use `git rm --cached` so local files remain on disk; add root ignore patterns.
- Do not push or merge.

## Evidence / Acceptance
- Reported CI E2E failures show `DEMO_USER_EMAIL` and `DEMO_USER_PASSWORD` undefined; demo login consequently returns no token and downstream throttling/identity tests fail.
- CI sets explicit demo E2E variables, runs Prisma schema push, then the idempotent demo seed before API tests.
- `bun run test:e2e` succeeds under the same environment.
- Root `.gitignore` ignores `/odd/` and `/openspec/`; all existing tracked paths under both directories are removed from the branch, but local files are preserved as ignored.
- Small Conventional Commits; no `.env.example` access.

## Work Units
### T1 — Configure and verify CI demo prerequisites
- Add demo account/quota/expiry/manifest environment defaults to the API workflow job.
- Run `bun run prisma:seed` after `prisma db push`.
- Run the full API CI E2E command with the same values and capture results.
- Status: done. With the CI-equivalent values, `bun run prisma:seed` passed and E2E passed 2 suites/31 tests.
- Commit: `d14534a fix(ci): seed demo account before e2e`.

### T2 — Remove planning artifacts from Git
- Add `/odd/` and `/openspec/` to root `.gitignore`.
- Remove already-tracked content from Git index while preserving local files; verify only intended path deletions are staged.
- Status: done. All 27 previously tracked paths under those directories are untracked from the repo; local files remain present and ignored.
- Commit: `e98d572 chore(repo): ignore planning artifacts`.

### T3 — Commit and close
- Commit CI and ignore/removal changes in small Conventional Commits.
- Record test outcomes and commit identities.
- Status: done. Working tree clean; branch is two commits ahead. No `.env.example` accessed.
