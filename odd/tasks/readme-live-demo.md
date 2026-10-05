# Live deployment README

Branch: `docs/readme-live-demo`

1. [x] Update the existing English README for the live demo, verified feature/security/architecture/operations details, real commands and stack versions. Keep video/screenshots as invisible TODO comments; edit no code/configuration/Dockerfiles.
2. [x] Mark only the README documentation item complete in PLAN.md; preserve the owner-dependent video item.
3. [x] Verify internal links, command names, claims, and docs-only scope with a delegated read-only audit; commit the documentation work with a `docs:` Conventional Commit. No push or PR.

Evidence/notes: `main` was fast-forward updated (`git pull --ff-only`, already up to date) before creating this branch. README, PLAN.md and DEPLOY.md were read in full. Read-only code audit confirms the public demo button uses parameterless demo-login; demo quota 3, interval minimum 60s; general quota 10, minimum 60s; demo reset default 60 min. Retain only claims verified in the repository. External live availability itself is not independently verified.
