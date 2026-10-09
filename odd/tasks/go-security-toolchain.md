# Go security toolchain

## Goal and authorization
User reported CI govulncheck exit 3 on Go 1.25.14 standard library advisories GO-2026-6617/6613/6612/6611/6610/6608/6607/6605/6603 and explicitly requested correction and a new commit. This supersedes the previous worker exclusion only for this narrowly scoped toolchain security fix. No push or PR authorized.

## Constraints
No .env* reads, edits or automatic loading. Preserve frontend work, ZIP, dependency versions and worker behavior. No finding suppression or weaker scanning. Only worker go.mod, Dockerfile and CI workflow changed, alongside this tracking document.

## Tasks
- [x] T1: Confirm patched release and align module, Docker and CI. Commit: 4fb8b59 — fix(ci): pin worker toolchain to patched Go 1.26.9.
- [x] T2: Independently verify tests, race tests, vet, build, exact pinned scanner and Docker build evidence; audit scope and commit coherent fix. Commit: 4fb8b59.

## Implementation
Module minimum Go 1.26.9; Docker builder golang:1.26.9-alpine; setup-go reads sentinel-worker/go.mod. GitHub Actions defaults.run.working-directory affects run steps, not setup-go action inputs; the version-file path resolves from the repository workspace root. govulncheck remains v1.7.0 with no suppression. go.sum and dependency versions unchanged.

## Evidence
Writer mv0olxpl-m-ci96 and independent verifier mv0otqid-n-yysf passed using isolated Go 1.26.9 containers with GOTOOLCHAIN=local and read-only worker mounts, not host Go 1.27.1. Commands: go version; go test ./...; go test -race ./...; go vet ./...; go build -o /tmp/worker ./cmd/worker; temporary GOBIN installation of govulncheck@v1.7.0 followed by version and ./... scan. Scanner: No vulnerabilities found; database updated 2026-10-08 22:31:09 UTC. Independent report: 27 top-level tests and 41 subtests passed; one PostgreSQL integration test skipped because TEST_DATABASE_URL was unconfigured.

All nine authoritative https://vuln.go.dev/ID/<id>.json records list Go 1.26.9 as fixed; separate Go 1.27 branch requires 1.27.2. Release feed, toolchain proxy and Docker manifest confirmed version availability. Initial lookup failure was an invalid endpoint, corrected before edits.

Writer built worker Docker image successfully after checking .dockerignore excludes .env*. Verifier inspected the resulting image without rebuilding. Local image sentinel-worker-go1269-security-check remains as build cache; temporary containers used --rm. Parent diff checks passed; source change totals three additions and three deletions.

## Limitations and next step
No old-compiler baseline scan rerun: user-provided failing CI log is baseline evidence. This is a compiler configuration upgrade, not an application behavior change, so no artificial RED behavior test was added. Native risk assessment failed due to undeclared untracked scope; conservative high-risk independent verification was completed with RDD off.

GitHub CI has not been executed remotely. Next step: user-authorized push and CI rerun. No push or PR performed. ZIP preserved untracked; frontend, API, Caddy and CSP unchanged by this fix.
