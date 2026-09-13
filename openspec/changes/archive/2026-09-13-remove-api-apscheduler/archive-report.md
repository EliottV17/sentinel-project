# Archive Report — `remove-api-apscheduler`

**Status: PASS — archived.** Change moved to
`openspec/changes/archive/2026-09-13-remove-api-apscheduler/` on 2026-09-13.

## Preconditions

- Verify report: verdict `pass_with_warnings`, blockers 0, critical findings 0 —
  7/7 requirements (REQ-APIRUN-001..007), 16/16 scenarios. All gates green:
  pytest 27 passed, ruff check/format clean, pyright 0 errors, `go vet` +
  `go build` exit 0, `uv sync --frozen` exit 0. The single warning (open
  single-commit task) was resolved post-verify by the orchestrator's commit
  `e68e55a`; an archive-closure addendum was appended to the report header.
- Sync report: `synced` — canonical `openspec/specs/api-runtime/spec.md`
  **created** (new domain; copy semantics: byte-identical to the verified delta,
  `diff -q`-confirmed) with 7 requirements / 16 scenarios. ADDED: all 7
  (REQ-APIRUN-001 No in-process checking engine, -002 Default no-op application
  lifespan, -003 apscheduler dependency removed, -004 Checker extension point
  preserved, -005 REST-only invariant test, -006 Documentation states
  worker-only checking, -007 Schema and worker behaviour untouched).
  MODIFIED/REMOVED/RENAMED: none. No destructive merges; no approvals needed.
- Commit `e68e55a` ("feat(api): remove in-process APScheduler — API is
  REST-only; Go worker is the sole polling engine") contains the entire
  implementation (code + test + docs + all change artifacts up to
  verify-report.md). The sync added `openspec/specs/api-runtime/spec.md`
  (canonical) and this change's `sync-report.md`; both were uncommitted at
  archive time and are committed by the orchestrator with the archive move.
- `openspec/config.yaml` rule `archive`: "Update openspec specs only for
  behaviour that is now implemented and green" — satisfied by the sync.

## Final Task Completion Gate

Re-read `tasks.md` immediately before any move: `grep '^\s*- \[ \]'` → 0
matches; **29/29 `- [x]`**, including the orchestrator-delegated single-commit
task (closed user-authorized after `e68e55a` landed). No checkbox repair
performed; no stale-checkbox reconciliation needed.

## Artifacts read

`openspec/config.yaml` (archive rule), `proposal.md`, `design.md`, `tasks.md`,
`specs/api-runtime/spec.md` (via sync report), `apply-progress.md`,
`verify-report.md`, `sync-report.md`; archive layout mirrored from
`openspec/changes/archive/2026-09-12-web-frontend/`.

## Domains synced

| Domain | Canonical file | Requirements |
|---|---|---|
| `api-runtime` | `openspec/specs/api-runtime/spec.md` | 7 (created by sync) |

## Requirement deltas

- ADDED (as new canonical, via sync): `api-runtime` 7 (REQ-APIRUN-001..007).
- MODIFIED: none. REMOVED: none.

## Collisions / warnings

- Same-domain active changes: none (`sameDomainActiveChanges: []`; the only
  other active change, if any, does not touch `specs/api-runtime/`).
- Canonical domains `api-cors` and `web-frontend` untouched; canonical
  `api-runtime` spec untouched by this phase (already canonical).
- Legacy flat `spec.md` layout: none (file-backed `specs/{domain}/spec.md`).

## Final-state consistency edits (scope item 2)

Stale phase-status lines inside the change's own artifacts were reconciled with
the final state; no historical content was rewritten:

- `verify-report.md` — archive-closure addendum after the YAML block: the sole
  warning (open single-commit task) is RESOLVED by commit `e68e55a`; verdict
  stands.
- `apply-progress.md` — closure note in the status header: commit `e68e55a`
  landed, commit task closed user-authorized, 29/29 tasks complete, archived.

## Scope exclusions honored

No source code touched; `openspec/specs/api-runtime/spec.md` untouched; no
other archived change touched; no Engram merge layer used (artifact store:
`openspec`).

## Archived path

`openspec/changes/archive/2026-09-13-remove-api-apscheduler/` (moved from
`openspec/changes/remove-api-apscheduler/`; archive dir existed; audit trail
preserved — folder name kept, flat layout mirrored from the web-frontend
archive).