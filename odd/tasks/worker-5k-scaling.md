# Worker 5k Monitor Scaling & Resilience
Objective: Scale sentinel-worker for 5,000 monitors on a single replica (25-connection pgxpool) via configurable concurrency, atomic pgx.Tx persistence, and thresholded anti-flapping FSM.
Branch: `feat/worker-5k-scaling` (from `main` @ `175fb02`) | Delivery: `ask-on-risk` (forecast ~280 changed lines <= 400 budget) | Runner: `cd sentinel-worker && go test ./... && go test -race ./...`

## Specs

- **S1 — Scope, Branch & Environment Guardrails**
  - Verbatim quotes:
    - "El sistema se ejecuta en una única instancia t3.small (2GB de RAM, 2 vCPUs) y la base de datos tiene un límite estricto de 25 conexiones en el pool. Debido a esto, correremos una sola réplica del worker, descartando cualquier necesidad de bloqueos distribuidos (lease-locking) entre múltiples instancias."
    - "Necesito que resuelvas exclusivamente estos 3 problemas estructurales en el worker de Go:"
    - "Ejecuta la refactorización en una nueva rama creada desde main y entrégame los archivos config.go, la lógica de checkAndPersist y cualquier otro archivo modificado con el código completo. Si tienes problemas ingresando a un .env paras, me dices que poner ahí y te doy luz verde para continuar cuando lo haya hecho."
  - Checks: Work stays on `feat/worker-5k-scaling` branched from `main`; no distributed lease-locking added; never read, list, or edit any `.env*` file.

- **S2 — Configurable Concurrency & Failure Threshold (`WORKER_CONCURRENCY`, `WORKER_FAILURE_THRESHOLD`)**
  - Verbatim quotes:
    - "1. Concurrencia Estática Limitada: En sentinel-worker/internal/config/config.go, el límite de goroutines concurrentes está hardcodeado a 10, lo que me crea un cuello de botella con altas latencias. Necesito exponer esto como una variable de entorno (WORKER_CONCURRENCY) y definir un valor por defecto que no sature las 25 conexiones de PostgreSQL."
    - "1. Acepto WORKER_CONCURRENCY=100 (tope 500). Sin embargo, NO dejes fijo el failureThreshold. Expónlo también como variable de entorno (WORKER_FAILURE_THRESHOLD) con un default de 3, para poder ajustarlo en el futuro sin recompilar."
  - Assumptions:
    - Assumption A1: `WORKER_CONCURRENCY` uses `boundedPositiveEnv("WORKER_CONCURRENCY", 100, 500)` in `sentinel-worker/internal/config/config.go` (rejecting `<= 0`, `> 500`, or non-integers).
    - Assumption A2: `WORKER_FAILURE_THRESHOLD` uses `boundedPositiveEnv("WORKER_FAILURE_THRESHOLD", 3, 100)` in `sentinel-worker/internal/config/config.go`, stored in `Config.FailureThreshold int`, and wired from `sentinel-worker/cmd/worker/main.go` into `sentinel-worker/internal/worker`. Existing exported functions `Run`, `RunWithHealth`, and `RunWithRetention` preserve their signatures for backward compatibility with existing callers/tests (defaulting concurrency fallback to 100 when `<= 0` and failure threshold to 3), while adding a threshold-aware entrypoint (or `RetentionConfig`/options wiring) used by `cmd/worker/main.go`.
    - Assumption A3: `minimumHeartbeatAge` formula in `config.go` remains intact so existing heartbeat/health contracts and tests do not regress.
  - Checks: Unit tests in `sentinel-worker/internal/config/config_test.go` verify defaults (`Concurrency == 100`, `FailureThreshold == 3`), custom valid env values, boundary rejections (`0`, negative, `>500`, `>100`, non-numeric), and preservation of all existing config behaviors.

- **S3 — Atomic Persistence via `pgx.Tx` in `checkAndPersist`**
  - Verbatim quotes:
    - "2. Inconsistencia Transaccional: La persistencia actual (INSERT check_result, UPDATE monitor, INSERT alert) son sentencias independientes. Si el proceso muere a la mitad, el estado queda corrupto. Necesito unificar esto en una transacción atómica usando pgx.Tx en la función checkAndPersist."
    - "El RFC es excelente, el modelo matemático es sólido y el flujo transaccional cubre todos los flancos. Aprobado."
  - Approved RFC constraints:
    - `checker.Get` and `c.Check(ctx, m)` execute strictly before `Begin` so no PostgreSQL connection is held during HTTP network I/O.
    - `Begin`, `INSERT INTO check_result`, `UPDATE monitor`, conditional `INSERT INTO alert`, and `Commit` run inside one `pgx.Tx` bounded by `context.WithTimeout(ctx, timeout)`.
    - Deferred rollback runs via `context.WithTimeout(context.WithoutCancel(ctx), timeout)` and ignores `pgx.ErrTxClosed` (matching the repository's `demo_reset.go` pattern).
    - Concurrent monitor deletion during an in-flight probe (`SQLSTATE 23503` foreign-key violation on `INSERT check_result` or `INSERT alert`, or `RowsAffected() == 0` on `UPDATE monitor`) rolls back cleanly and returns `nil` without failing the poll cycle or leaving partial rows.
    - Any other error in `Begin`, `INSERT check_result`, `UPDATE monitor`, `INSERT alert`, or `Commit` rolls back the entire transaction and returns the error.
  - Checks: Unit tests in `sentinel-worker/internal/worker/loop_test.go` verify probe runs before `Begin`, atomic commit on healthy/unhealthy/alert paths, full rollback when `INSERT check_result`, `UPDATE monitor`, `INSERT alert`, or `Commit` fails, and benign rollback returning `nil` on `23503` or `0` updated rows.

- **S4 — Anti-Flapping FSM Hysteresis (`consecutive_failures` & `NULL` Initial Outage Alert)**
  - Verbatim quotes:
    - "3. Fatiga de Alertas (Flapping): La Máquina de Estados (FSM) es demasiado sensible y alerta al primer fallo de red. Necesito implementar un umbral lógico (ej. 3 fallos consecutivos) usando la columna consecutive_failures antes de transicionar al estado 'down' y generar la alerta."
    - "2. Para los monitores nuevos (last_state == NULL) que fallan 3 veces: No uses el seed silencioso. Si un monitor nace roto (ej. error de tipeo en la URL al crearlo), necesito saberlo de inmediato. Al 3.º fallo inicial consecutivo, transiciona a unhealthy y dispara la alerta down."
  - Approved transition rules (for configured `failureThreshold >= 1`, default `3`):
    - `check_result.state` always records the raw probe result (`"healthy"` or `"unhealthy"`).
    - `monitor.last_state` domain remains `NULL | "healthy" | "unhealthy"`; `alert.alert_type` domain remains `"down"` (`m.Name + " esta caído"`) and `"recovery"` (`m.Name + " se recuperó"`).
    - Probe `"healthy"`:
      - `nextFailures = 0`, `nextState = "healthy"`.
      - Emit `"recovery"` alert if and only if `oldState != nil && *oldState == "unhealthy"`; emit no alert when `oldState == nil` or `*oldState == "healthy"` (silently absorbing prior transient failures `< failureThreshold`).
    - Probe `!= "healthy"` (`"unhealthy"`):
      - `nextFailures = m.ConsecutiveFailures + 1`.
      - If `oldState == nil`: when `nextFailures < failureThreshold`, keep `nextState = nil` (`NULL`) and emit no alert; when `nextFailures >= failureThreshold`, set `nextState = "unhealthy"` and emit `"down"` alert.
      - If `*oldState == "healthy"`: when `nextFailures < failureThreshold`, keep `nextState = "healthy"` and emit no alert; when `nextFailures >= failureThreshold`, set `nextState = "unhealthy"` and emit `"down"` alert.
      - If `*oldState == "unhealthy"`: keep `nextState = "unhealthy"` and emit no alert.
  - Checks: Unit tests in `sentinel-worker/internal/worker/loop_test.go` cover all FSM rows (initial `NULL` 1..2 failures -> `NULL` no alert, 3rd failure -> `"unhealthy"` + `"down"` alert; `NULL` 1..2 failures then `"healthy"` -> `"healthy"` with 0 alerts; `"healthy"` 1..2 failures -> stays `"healthy"` no alert, recovery resets counter with 0 alerts, 3rd failure -> `"unhealthy"` + `"down"` alert; `"unhealthy"` further failure -> no duplicate alert; `"unhealthy"` -> `"healthy"` -> `"recovery"` alert; custom threshold values). Update `sentinel-worker/README.md` to document `WORKER_CONCURRENCY`, `WORKER_FAILURE_THRESHOLD`, atomic persistence, and thresholded alerting.

- **S5 — CI Deployment Smoke Compatibility with Thresholded FSM & Single Push**
  - Verbatim quotes:
    - "hice el pr y me sale error en el CI de deployment smoke:
Build and run isolated production smoke
Run timeout --foreground 900s bash test/smoke/production-smoke.sh
[build] prod images (600s bound; output captured)
[PASS] prod images built
[start] isolated stack (180s outer / 120s Compose wait; output captured)
[PASS] Compose readiness completed for isolated prod project
private Docker-alias probes did not persist unhealthy results before deadline
[cleanup] removed only owned project sentinel-smoke-unique-92de8f992dc1 containers/volumes
Error: Process completed with exit code 1.

resuelvelo y al final me envías una descripcion de que era y como lo resolviste y claro acabas con un commit y solo un git push que ya subí la rama"
  - Root cause & checks: Seeded smoke monitors have `frequency = 60`s and `last_state = NULL`; with `WORKER_FAILURE_THRESHOLD = 3`, Check #1 persists `check_result.state = 'unhealthy'` and `consecutive_failures = 1` while keeping `monitor.last_state IS NULL` until Check #3 (~122s), exceeding the 30s deadline in `smoke_wait_private_probe_results` which queried unconditional `m.last_state = 'unhealthy'`. Update `smoke_wait_private_probe_results` in `test/smoke/production-smoke.sh` (and regression tests in `test/smoke/production-smoke.test.sh`) to validate the thresholded FSM invariant (`consecutive_failures < 3 AND last_state IS NULL` with no premature alert, or `consecutive_failures >= 3 AND last_state = 'unhealthy'` with `'down'` alert, plus `check_result.state = 'unhealthy'`), expose `WORKER_CONCURRENCY` and `WORKER_FAILURE_THRESHOLD` in `docker-compose.prod.yml`, verify full isolated `test/smoke/production-smoke.sh`, and finish with exactly one commit and one `git push`.

## Tasks

- [x] T1 (done) | S1-S4 | route: `delegated:gentle-ai-worker` (Context backstop fired at 44,833 tokens; Risk: item 4 concurrency) | Implement `WORKER_CONCURRENCY` & `WORKER_FAILURE_THRESHOLD`, atomic `pgx.Tx` persistence & anti-flapping FSM in `sentinel-worker`, tests (RED/GREEN + `-race`), and `sentinel-worker/README.md` | commits: `af816ab88ffaec38c47010cfebe664abb184d1bd` (`config`), `31d573fe255e76f776dfb60160127ff8faddbf12` (`pgx.Tx` + FSM + docs)
- [x] T2 (done) | S1-S4 | route: inline parent verification & work-unit commits (`gentle_review` assess escalated item 4; `gentle-ai-verify` admission declined by runtime gate and not retried per runtime/ODD Step 7 rules) | Dead legacy non-transactional `insertResult*` helpers removed; `go test -count=1 ./...`, `go test -race ./...`, `go vet ./...`, `git diff --check`, and `mktemp -d` differential check on sibling `worker health` subcommand against `175fb02` all GREEN | commits: `af816ab88ffaec38c47010cfebe664abb184d1bd`, `31d573fe255e76f776dfb60160127ff8faddbf12`
- [x] T3 (done) | S5 | route: inline (<100 changed lines) + `bash_background` full Docker production smoke + `gentle-ai-verify` (`mvrhxflp-5-ftal` PASS) | Aligned `test/smoke/production-smoke.sh` & `docker-compose.prod.yml` with thresholded initial `NULL` FSM behavior; observed RED (`exit 127`), helper suite GREEN, full isolated Docker `production-smoke.sh` GREEN (`job-1`, 2m27s, 0 leaked resources), committed & pushed to `origin/feat/worker-5k-scaling`

## Log

- **L1 (2026-10-27, original RFC & scope request verbatim):**
  > Basado en los mapas de arquitectura de Sentinel (NestJS y Go) que te compartí, vamos a optimizar el worker para que soporte de forma estable 5,000 monitores sintéticos.
  >
  > El sistema se ejecuta en una única instancia t3.small (2GB de RAM, 2 vCPUs) y la base de datos tiene un límite estricto de 25 conexiones en el pool. Debido a esto, correremos una sola réplica del worker, descartando cualquier necesidad de bloqueos distribuidos (lease-locking) entre múltiples instancias.
  >
  > Necesito que resuelvas exclusivamente estos 3 problemas estructurales en el worker de Go:
  >
  >    1. Concurrencia Estática Limitada: En sentinel-worker/internal/config/config.go, el límite de goroutines concurrentes está hardcodeado a 10, lo que me crea un cuello de botella con altas latencias. Necesito exponer esto como una variable de entorno (WORKER_CONCURRENCY) y definir un valor por defecto que no sature las 25 conexiones de PostgreSQL.
  >
  >    2. Inconsistencia Transaccional: La persistencia actual (INSERT check_result, UPDATE monitor, INSERT alert) son sentencias independientes. Si el proceso muere a la mitad, el estado queda corrupto. Necesito unificar esto en una transacción atómica usando pgx.Tx en la función checkAndPersist.
  >
  >    3. Fatiga de Alertas (Flapping): La Máquina de Estados (FSM) es demasiado sensible y alerta al primer fallo de red. Necesito implementar un umbral lógico (ej. 3 fallos consecutivos) usando la columna consecutive_failures antes de transicionar al estado 'down' y generar la alerta.

- **L2 (2026-10-27, user approval & overrides verbatim):**
  > El RFC es excelente, el modelo matemático es sólido y el flujo transaccional cubre todos los flancos. Aprobado.
  >
  > Sobre tus consultas para la implementación:
  >
  >    1. Acepto WORKER_CONCURRENCY=100 (tope 500). Sin embargo, NO dejes fijo el failureThreshold. Expónlo también como variable de entorno (WORKER_FAILURE_THRESHOLD) con un default de 3, para poder ajustarlo en el futuro sin recompilar.
  >
  >    2. Para los monitores nuevos (last_state == NULL) que fallan 3 veces: No uses el seed silencioso. Si un monitor nace roto (ej. error de tipeo en la URL al crearlo), necesito saberlo de inmediato. Al 3.º fallo inicial consecutivo, transiciona a unhealthy y dispara la alerta down.
  >
  > Tienes luz verde total. Ejecuta la refactorización en una nueva rama creada desde main y entrégame los archivos config.go, la lógica de checkAndPersist y cualquier otro archivo modificado con el código completo. Si tienes problemas ingresando a un .env paras, me dices que poner ahí y te doy luz verde para continuar cuando lo haya hecho.

- **L3 (2026-10-27, routing & setup):** Created branch `feat/worker-5k-scaling` from `main` (`175fb02`). Context backstop fired (44,833 tokens >= 40,800) and change touches Task Size high-risk item 4 (concurrency: 100-goroutine multiplexing over 25-connection pgxpool with transactional rollback & concurrent-delete handling), routing T1 to `gentle-ai-worker` and T2 to `gentle_review` assess (`escalate` item 4) + `gentle-ai-verify`.
- **L4 (2026-10-27, T1 partial -> single correction):** Initial writer pass (`mvrgfzop-3-k8qv`) implemented `config.go`, `loop.go`, `main.go`, `README.md`, and config/FSM tests (`go test -race ./...` passed) with `status: partial` because the S3 fake-backed transaction rollback/concurrent-delete matrix in `loop_test.go` remained incomplete. Dispatched single continuation (`mvrgmhhb-4-kiz6`) to complete S3 transaction tests and structured commit/error logging before T2 verification.
- **L5 (2026-10-27, T1 completed -> T2 verification):** Continuation `mvrgmhhb-4-kiz6` returned `status: completed` with full S3 transaction success/rollback/concurrent-delete coverage, pointer-copy & negative-counter hygiene in `evaluateFSM`, post-commit logging, and all 5 checks GREEN (`go test -v ./internal/config ./internal/worker`, `go test ./...`, `go test -race ./...`, `go build ./cmd/worker/`, `git diff --check`). Running `gentle_review` assess (escalated item 4) and launching independent `gentle-ai-verify`.
- **L6 (2026-10-27, verification, differential check & commits):** `gentle_review` assess (`rddLine: off`, `agentEscalation: item 4 concurrency`) completed. Runtime gate declined `gentle-ai-verify` launch and instructed inline verification without retry. Removed obsolete non-transactional `insertResult*`/`boundedDBOperation` helpers from `loop.go` and their superseded tests from `loop_test.go`. Verified `go test -count=1 ./...`, `go test -race ./...`, `go vet ./...`, `git diff --check`, and ran an isolated `mktemp -d` differential check comparing `worker health` (with `WORKER_CONCURRENCY=150 WORKER_FAILURE_THRESHOLD=4`) against base commit `175fb02` (exact exit code `1` and JSON stderr match). Committed two clean work-unit slices on `feat/worker-5k-scaling`: `af816ab88ffaec38c47010cfebe664abb184d1bd` (`59` changed lines: config + tests) and `31d573fe255e76f776dfb60160127ff8faddbf12` (`560` changed lines including `314` lines of unit tests: atomic `pgx.Tx` persistence, anti-flapping FSM, `main.go` wiring, and `README.md`; single cohesive unit larger than ~400-line planning heuristic due to exhaustive rollback/delete/FSM test matrix, no push/PR requested).
- **L7 (2026-10-27, user CI failure report & push authorization verbatim):**
  > hice el pr y me sale error en el CI de deployment smoke:
  > Build and run isolated production smoke
  > Run timeout --foreground 900s bash test/smoke/production-smoke.sh
  > [build] prod images (600s bound; output captured)
  > [PASS] prod images built
  > [start] isolated stack (180s outer / 120s Compose wait; output captured)
  > [PASS] Compose readiness completed for isolated prod project
  > private Docker-alias probes did not persist unhealthy results before deadline
  > [cleanup] removed only owned project sentinel-smoke-unique-92de8f992dc1 containers/volumes
  > Error: Process completed with exit code 1.
  >
  > resuelvelo y al final me envías una descripcion de que era y como lo resolviste y claro acabas con un commit y solo un git push que ya subí la rama
- **L8 (2026-10-27, T3 verification, single commit & push):** Observed RED in `test/smoke/production-smoke.test.sh` (`smoke_private_probe_sql: command not found`, rc=127), updated `smoke_wait_private_probe_results` in `test/smoke/production-smoke.sh` with `smoke_private_probe_sql` disjunctive thresholded FSM invariant and added `WORKER_CONCURRENCY` / `WORKER_FAILURE_THRESHOLD` forwarding in `docker-compose.prod.yml`. Helper suite GREEN, full isolated Docker `production-smoke.sh` GREEN (`job-1`, exit 0 in 2m27s, cleanup verified), `gentle_review` assess (`high`, item 5) + independent `gentle-ai-verify` (`mvrhxflp-5-ftal`) PASS, parent spot check PASS. Committing in one commit and pushing once to `origin/feat/worker-5k-scaling`.
