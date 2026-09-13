# Sync Report — `remove-api-apscheduler`

Phase: sdd-sync (executor). Artifact store: `openspec`. Change remains **active**
(not archived); archive is owned by `sdd-archive`.

## Status

**synced** — the verified delta spec is now the canonical `api-runtime` spec.

## Inputs consumed

- `openspec/changes/remove-api-apscheduler/verify-report.md` — verdict
  `pass_with_warnings`, blockers 0, critical findings 0, requirements 7/7,
  scenarios 16/16; all gates green (pytest 27 passed, ruff, pyright, go vet,
  go build). Sync proceeds on the strength of this clean verification.
- `openspec/changes/remove-api-apscheduler/specs/api-runtime/spec.md` — delta
  spec synced (full spec form; no `ADDED`/`MODIFIED`/`REMOVED`/`RENAMED`
  operation headers).
- `openspec/config.yaml` — `rules.archive`: "Update openspec specs only for
  behaviour that is now implemented and green." Respected: only verified,
  green behaviour was synced.
- Native SDD status: `sync: blocked` in the preflight JSON was stale — the
  parent prompt confirms the working-tree candidate was committed as `e68e55a`
  (29/29 tasks closed, native review APPROVED, authority burned), clearing the
  verify gate. Parent explicitly authorized this sync run.

## Domains synced

- `api-runtime` (new canonical domain; `openspec/specs/api-runtime/` did not
  exist before this sync).

## Canonical files updated

- `openspec/specs/api-runtime/spec.md` — **created** (copy semantics per
  helper contract: canonical spec absent ⇒ change spec becomes the canonical
  spec). Byte-identical to the verified delta; verified with `diff -q`.

## Requirement accounting

- ADDED: REQ-APIRUN-001 (No in-process checking engine),
  REQ-APIRUN-002 (Default no-op application lifespan),
  REQ-APIRUN-003 (apscheduler dependency removed),
  REQ-APIRUN-004 (Checker extension point preserved),
  REQ-APIRUN-005 (REST-only invariant test),
  REQ-APIRUN-006 (Documentation states worker-only checking),
  REQ-APIRUN-007 (Schema and worker behaviour untouched) — all 7 added as
  canonical requirements with all 16 scenarios.
- MODIFIED: none.
- REMOVED: none.
- RENAMED: none (no RENAMED block present; unsupported-op guard not triggered).

## Guardrail findings

- Active same-domain collisions: none (`sameDomainActiveChanges: []`; no other
  active change touches `specs/api-runtime/spec.md`).
- Legacy flat specs: none (`openspec/changes/remove-api-apscheduler/` uses the
  file-backed `specs/{domain}/spec.md` layout).
- Destructive sync (REMOVED / large MODIFIED): none — no approval needed.
- Preservation check: worker-mandatory posture wording carried over verbatim
  in REQ-APIRUN-001/006/007 (API is REST-only; the Go worker is the official
  and mandatory polling engine; checker extension point preserved). Archived
  change specs under `openspec/changes/archive/**` were not touched.
- Unrelated canonical domains (`api-cors`, `web-frontend`) untouched.

## Validation performed

- `diff -q` between change delta and new canonical spec → identical.
- `grep -c '^### Requirement:'` → 7; `grep -c '^#### Scenario:'` → 16 —
  matches verify-report counts exactly.
- Confirmed no `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` headers in the
  delta (full-spec copy path, no delta merge required).

## Structured status / actionContext

- `actionContext.mode: repo-local`; `allowedEditRoots` covers the repo — no
  blockers. No same-domain collisions. Artifact store `openspec` → filesystem
  sync only (no Engram merge layer used for canonical specs).

## Next recommended phase

**`sdd-archive`** — verification is clean, sync is complete, 29/29 tasks are
closed, and the change is committed (`e68e55a`). Per the executor contract this
sync did NOT move the change folder to archive; the archive executor owns that
move (target: `openspec/changes/archive/YYYY-MM-DD-remove-api-apscheduler`).

## Out-of-scope informational notes (do NOT action in sync)

- R3-lifespan-assertion-brittle (SUGGESTION) and R3-missing-worker-presence
  (WARNING) remain non-blocking follow-ups per the parent's native review;
  deliberately not actioned here.