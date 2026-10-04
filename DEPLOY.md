# Production deployment and recovery runbook

This runbook describes an operator-managed deployment of the repository's production Compose stack. It does not provision a VM, change a cloud firewall, publish images, or verify a public internet deployment. Read the complete runbook and review both monitor manifests before following it: once the worker starts, it makes real HTTP/HTTPS requests to configured targets.

## 1. Prepare the host and DNS

Use a Linux VM with a supported Docker Engine and Docker Compose plugin that implements `compose up --wait`. Have Bash, coreutils (`install` and `timeout`), gzip, and OpenSSL available for the commands below; `jq` is needed only for the optional filtered-log example. The project has local AMD64 production-smoke evidence. The repository also defines an optional ARM64 build-only CI job, but an actual ARM64 VM build/runtime has not been verified here; treat it as a target to validate, not a proven platform. If a native Alpine ARM64 build fails in Argon2 or Prisma, preserve and report the exact build error before considering any image-base change. Install Docker using the official [Docker Engine installation guide](https://docs.docker.com/engine/install/) and [Compose plugin guide](https://docs.docker.com/compose/install/linux/).

Before starting containers:

1. Create DNS `A` (and, only if correctly routed, `AAAA`) records for the intended hostname. Remove stale records that point elsewhere.
2. Permit inbound TCP `80` and `443` in both the provider firewall and the VM firewall. Permit SSH only from trusted administrative addresses. The database, API, worker, and frontend need no inbound host ports.
3. Ensure the hostname resolves to this VM before Caddy starts; Caddy uses automatic public TLS for a public hostname. `SITE_ADDRESS=localhost` is for isolated local testing and uses Caddy's private local CA, not a publicly trusted certificate.
4. Select an approved release commit or tag that is already available to the operator. Do not assume the current branch is merged or released.

A public TLS certificate and live hostname have not been provisioned by this work. No public cloud, DNS, firewall, or ACME action is performed by the author of this document.

## 2. Check out the approved release

Run from the VM user's chosen checkout directory. Replace the release reference with one the project owner has approved and made available:

```bash
git clone https://github.com/EliottV17/sentinel-project.git
cd sentinel-project
git switch --detach "APPROVED_TAG_OR_COMMIT"
git rev-parse --short HEAD
```

Keep the selected commit identity with the deployment notes. A clean checkout is preferable to building a developer worktree with unrelated local modifications.

### Review the monitor manifests before first start

The root `demo-monitors.json` and `status-monitors.json` are mounted read-only into production containers. Review their targets and frequency before starting the worker. The demo manifest controls what the public demo account can see; the status manifest controls which non-demo monitors may be published anonymously. The API seed validates manifests and reconciles status publication. Do not add a private endpoint, local network target, credential, or secret to either manifest. The worker has its own SSRF defenses, but manifest review is still an operator responsibility.

## 3. Create private production configuration

Compose must receive one explicit configuration file on every production command. Keep it outside the checkout, outside web-served directories, and readable only by the deployment user. Do not use the repository's development defaults for production.

```bash
CONFIG_DIR="$HOME/.config/sentinel"
CONFIG_FILE="$CONFIG_DIR/production.env"
install -d -m 700 "$CONFIG_DIR"
umask 077
"${EDITOR:-vi}" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
```

Paste and complete the root production block below in that user-owned file. Generate fresh, distinct random values locally. For example, `openssl rand -hex 32` produces URL-safe hexadecimal text; generate separate values for the database password and API signing key. Do not paste real secrets into tickets, chat, shell history, or source control. This runbook's values are placeholders, not deployable credentials.

The PostgreSQL environment and `DATABASE_URL` must identify the same database role, password, database name, and host. Compose DNS host is `db`; do not use `127.0.0.1` in the container URL. If a password contains URI-reserved characters, percent-encode the username/password in `DATABASE_URL`; a fresh hexadecimal password avoids this complication. Changing `POSTGRES_PASSWORD` in the configuration does **not** rotate the password stored in an existing PostgreSQL volume. Plan and verify database credential rotation separately.

```dotenv
# Compose PostgreSQL role; keep it identical to DATABASE_URL's username.
POSTGRES_USER=postgres
# Generate a fresh URL-safe password; it must not equal the default "postgres".
POSTGRES_PASSWORD=REPLACE_WITH_FRESH_DATABASE_PASSWORD
# Compose PostgreSQL database; keep it identical to DATABASE_URL's path.
POSTGRES_DB=sentinel_db
# Container-to-container URL; credentials and database must match the three PostgreSQL settings above.
DATABASE_URL=postgresql://postgres:REPLACE_WITH_FRESH_DATABASE_PASSWORD@db:5432/sentinel_db
# Generate a separate random signing secret; use at least 32 characters and never a placeholder/default.
SECRET_KEY=REPLACE_WITH_A_DISTINCT_RANDOM_SIGNING_SECRET
# JWT signing algorithm passed through to the API; this project uses HS256 by default.
ALGORITHM=HS256
# Ordinary access-token lifetime in minutes; Compose default is 30.
ACCESS_TOKEN_EXPIRE_MINUTES=30
# Exact browser origin allowed by the API; match SITE_ADDRESS and include scheme, with no path.
CORS_ORIGINS=https://sentinel.example.com
# Required demo login identity; it is distinct from the status owner.
DEMO_USER_EMAIL=demo@example.invalid
# Choose a strong demo password, but treat it as PUBLIC: Vite embeds it in the shipped frontend.
DEMO_USER_PASSWORD=REPLACE_WITH_A_PUBLIC_DEMO_PASSWORD
# Separate valid owner identity for the anonymously visible status monitors.
STATUS_OWNER_EMAIL=status-owner@example.invalid
# Demo JWT lifetime in minutes; Compose default is 15.
DEMO_ACCESS_TOKEN_EXPIRE_MINUTES=15
# Demo-account monitor quota; default is 3.
DEMO_MAX_MONITORS=3
# Minimum demo monitor interval in seconds; default is 60.
DEMO_MIN_FREQUENCY_SECONDS=60
# Periodic demo reconciliation interval in minutes; default is 60.
DEMO_RESET_INTERVAL_MINUTES=60
# General authenticated-user monitor quota; default is 10.
MAX_MONITORS_PER_USER=10
# Minimum general monitor interval in seconds; default is 60.
MIN_MONITOR_FREQUENCY_SECONDS=60
# Public uptime SQL aggregation window in hours; default is 24 (maximum 876000).
STATUS_UPTIME_WINDOW_HOURS=24
# In-process public-status cache lifetime in seconds; default is 30.
STATUS_CACHE_TTL_SECONDS=30
# Frontend marks a last check older than this many minutes as stale; default is 5.
STATUS_STALE_AFTER_MINUTES=5
# Frontend healthy-state degradation threshold in percent; default is 99.
STATUS_DEGRADED_THRESHOLD_PERCENT=99
# Worker HTTP checker port allowlist; default is 80,443,8080,8443.
ALLOWED_PORTS=80,443,8080,8443
# Worker database operation deadline in seconds; default is 10.
WORKER_DB_TIMEOUT_SECONDS=10
# Worker health-command database ping deadline in seconds; default is 5.
WORKER_HEALTH_DB_TIMEOUT_SECONDS=5
# Worker heartbeat file inside its container; default is /tmp/sentinel-worker.heartbeat.
WORKER_HEARTBEAT_PATH=/tmp/sentinel-worker.heartbeat
# Worker heartbeat freshness limit in seconds; default 67 at a 10-second DB timeout and lower values are clamped.
WORKER_HEARTBEAT_MAX_AGE_SECONDS=67
# Check-result retention in days; default is 30 and it must cover the uptime window.
CHECK_RESULT_RETENTION_DAYS=30
# Alert-event retention in days; default is 90.
ALERT_RETENTION_DAYS=90
# Worker retention cadence in minutes; default is 60 (range 1..1440).
RETENTION_INTERVAL_MINUTES=60
# Rows per bounded cleanup batch; default is 500 (range 1..5000).
RETENTION_BATCH_SIZE=500
# Per-retention-query database timeout in seconds; default is 5 (range 1..3600).
RETENTION_DB_TIMEOUT_SECONDS=5
# Default per-IP API throttle window in milliseconds; default is 60000.
THROTTLE_DEFAULT_TTL=60000
# Default per-IP API request limit in that window; default is 100.
THROTTLE_DEFAULT_LIMIT=100
# Authentication throttle window in milliseconds; default is 60000.
THROTTLE_AUTH_TTL=60000
# Authentication requests allowed per IP in that window; default is 5.
THROTTLE_AUTH_LIMIT=5
# Monitor-mutation throttle window in milliseconds; default is 60000.
THROTTLE_MONITORS_TTL=60000
# Monitor mutations allowed per IP in that window; default is 20.
THROTTLE_MONITORS_LIMIT=20
# Caddy public site hostname; use localhost only for local/private-CA testing.
SITE_ADDRESS=sentinel.example.com
```

The production Compose file fixes `NODE_ENV=production`, API `PORT=8000`, manifest container paths and frontend `VITE_API_BASE_URL=""`; these values are not override knobs in the root file. Other frontend build arguments derive from the root demo credentials and status-display settings above and require a rebuild when changed. The empty frontend API base keeps browser requests same-origin through Caddy. Retention accepts positive bounded settings; `CHECK_RESULT_RETENTION_DAYS` must be at least `ceil(STATUS_UPTIME_WINDOW_HOURS / 24)`. In particular, increasing the uptime window without increasing check retention causes the worker configuration to fail.

The API preflight rejects a missing or known-placeholder `SECRET_KEY`; the 32-character guidance above is an operator strength recommendation, not a length check performed by this code.

**The demo password is public.** `DEMO_USER_PASSWORD` becomes the frontend `VITE_DEMO_USER_PASSWORD` build argument and is shipped in public static assets. Use only a deliberately public demo credential. Never reuse it as a private user, database, SSH, API, or administrator password. The status owner is a separate inactive, non-demo seed identity and cannot log in normally.

### Standalone API process configuration reference

Use this separate block only when a host-managed Node API process is intentionally deployed outside Compose. Its database URL points to a database reachable from that host (the example uses a host-local database); the Compose database is not published on the host. Use independently managed credentials for this deployment, not copied production secrets. Percent-encode URI-reserved password characters in `DATABASE_URL`. The API process also needs both manifests at the absolute paths configured below. `NODE_ENV=production` makes Nest ignore `.env` files; `IGNORE_ENV_FILE=true` is available as an explicit additional guard. The file's key/value pairs must be supplied by the operator's process manager—do not shell-source it.

This block configures the process; it does not perform the production preflight/migrate/compiled-seed/server sequence. The production container entrypoint is the supported automated path for that lifecycle. A standalone deployment needs its own reviewed, ordered migration-and-seed process before starting the compiled Node server.

```dotenv
# Standalone API runtime; production mode ignores dotenv files.
NODE_ENV=production
# API listen port; default is 8000.
PORT=8000
# Host-reachable PostgreSQL URL; use the actual host endpoint and matching role/database.
DATABASE_URL=postgresql://postgres:REPLACE_WITH_FRESH_DATABASE_PASSWORD@127.0.0.1:5432/sentinel_db
# Distinct random non-placeholder JWT signing key; use at least 32 characters.
SECRET_KEY=REPLACE_WITH_A_DISTINCT_RANDOM_SIGNING_SECRET
# JWT signing algorithm; this application uses HS256.
ALGORITHM=HS256
# Ordinary access-token lifetime in minutes; default is 30.
ACCESS_TOKEN_EXPIRE_MINUTES=30
# Exact browser origin permitted by CORS; match the serving origin.
CORS_ORIGINS=https://sentinel.example.com
# Required demo account identity, distinct from the status owner.
DEMO_USER_EMAIL=demo@example.invalid
# Public demo credential; if the matching frontend is served, this value is public.
DEMO_USER_PASSWORD=REPLACE_WITH_A_PUBLIC_DEMO_PASSWORD
# Demo JWT lifetime in minutes; default is 15.
DEMO_ACCESS_TOKEN_EXPIRE_MINUTES=15
# Demo monitor quota; default is 3.
DEMO_MAX_MONITORS=3
# Minimum demo check frequency in seconds; default is 60.
DEMO_MIN_FREQUENCY_SECONDS=60
# Absolute path to the demo monitor JSON manifest on the API host.
DEMO_MONITORS_MANIFEST_PATH=/srv/sentinel-project/demo-monitors.json
# Required valid status-owner identity, different from the demo identity.
STATUS_OWNER_EMAIL=status-owner@example.invalid
# Absolute path to the public status monitor JSON manifest on the API host.
STATUS_MONITORS_MANIFEST_PATH=/srv/sentinel-project/status-monitors.json
# Public uptime aggregation window in hours; default is 24.
STATUS_UPTIME_WINDOW_HOURS=24
# In-process status cache lifetime in seconds; default is 30.
STATUS_CACHE_TTL_SECONDS=30
# Authenticated-user monitor quota; default is 10.
MAX_MONITORS_PER_USER=10
# Minimum general monitor frequency in seconds; default is 60.
MIN_MONITOR_FREQUENCY_SECONDS=60
# Default throttle time-to-live in milliseconds; default is 60000.
THROTTLE_DEFAULT_TTL=60000
# Default requests per IP in the throttle window; default is 100.
THROTTLE_DEFAULT_LIMIT=100
# Authentication throttle time-to-live in milliseconds; default is 60000.
THROTTLE_AUTH_TTL=60000
# Authentication requests per IP; default is 5.
THROTTLE_AUTH_LIMIT=5
# Monitor mutation throttle time-to-live in milliseconds; default is 60000.
THROTTLE_MONITORS_TTL=60000
# Monitor mutations per IP; default is 20.
THROTTLE_MONITORS_LIMIT=20
# Explicitly disable Nest dotenv-file loading; production mode already does this.
IGNORE_ENV_FILE=true
```

The root Compose config requires its own `DATABASE_URL` pointing to `db`; do not replace it with this standalone block's host-loopback URL. Root `PORT` and these standalone manifest paths do not override the production file's fixed container values. Keep the standalone deployment model and its configuration management separate.

## 4. Build and start the isolated production stack

Run all commands below from the repository root. Use this same Bash array for every production Compose operation so the project name, explicit configuration file, and production Compose file do not drift. Do not run bare `docker compose` commands for this stack.

```bash
CONFIG_DIR="$HOME/.config/sentinel"
CONFIG_FILE="$CONFIG_DIR/production.env"
prod=(docker compose --project-name sentinel-prod --env-file "$CONFIG_FILE" -f docker-compose.prod.yml)

# Build locally on the VM; no registry push or Buildx emulation is needed here.
timeout --foreground -k 10s 180s "${prod[@]}" build
# Start and wait for Compose healthchecks with a finite readiness limit.
timeout --foreground -k 10s 180s "${prod[@]}" up -d --wait --wait-timeout 120
# Show service names and health/state only; do not print resolved Compose config.
timeout --foreground -k 5s 20s "${prod[@]}" ps
```

The API container runs a production preflight before touching the database, then `prisma migrate deploy`, the compiled idempotent demo/status seed, and finally the Node.js API at `dist/main.js`. A failed preflight, migration, or seed stops startup. The API, worker, and Nginx containers run as non-root users; PostgreSQL uses its `postgres` container account. The worker waits for the database and healthy API. Only Caddy has published ports.

Do not use `docker compose config` in a terminal recording or support log: it renders interpolated environment values. The production command's explicit `--env-file` also prevents an unrelated working-directory `.env` from silently supplying Compose values. The Nest application ignores dotenv files in production; configuration is passed by the container environment.

### First-start checks

For a public hostname, use the normal OS trust store and strict TLS verification. Replace the shell variable with the same hostname used for `SITE_ADDRESS` and `CORS_ORIGINS`:

```bash
SITE_HOST=sentinel.example.com
curl --fail --silent --show-error --max-time 10 "https://${SITE_HOST}/api/v1/health" -o /dev/null -w '%{http_code}\n'
curl --fail --silent --show-error --max-time 10 "https://${SITE_HOST}/api/v1/public/status" -o /dev/null -w '%{http_code}\n'
```

For `SITE_ADDRESS=localhost`, Caddy uses its own local CA. Do not use `curl -k` or modify the host trust store. Export only the public CA certificate to a private local test directory, then pass it explicitly:

```bash
CA_DIR="$HOME/.local/share/sentinel-local-ca"
install -d -m 700 "$CA_DIR"
"${prod[@]}" exec -T caddy sh -ec 'cat /data/caddy/pki/authorities/local/root.crt' >"$CA_DIR/caddy-root.crt"
chmod 600 "$CA_DIR/caddy-root.crt"
curl --fail --silent --show-error --max-time 10 --cacert "$CA_DIR/caddy-root.crt" \
  https://localhost/api/v1/health -o /dev/null -w '%{http_code}\n'
curl --fail --silent --show-error --max-time 10 --cacert "$CA_DIR/caddy-root.crt" \
  https://localhost/api/v1/public/status -o /dev/null -w '%{http_code}\n'
```

The health endpoint checks API-to-database connectivity. The anonymous status endpoint may return an empty array if the reviewed status manifest is empty or has no current public checks. A healthy API alone does not prove the worker is progressing; check the worker health command too:

```bash
timeout --foreground -k 5s 15s "${prod[@]}" exec -T worker /worker health
timeout --foreground -k 5s 20s "${prod[@]}" ps
```

The worker health command verifies a fresh poll-progress heartbeat and a bounded database ping. An unhealthy worker means checks may not be advancing even when the API responds. A target blocked by SSRF controls can produce an unhealthy check result while the worker itself remains healthy.

## 5. Observe, update, and roll back

### Bounded logs and operations

Use finite tails. Avoid `docker inspect` environment dumps and never paste resolved config, secrets, tokens, full SQL dumps, or unbounded logs into tickets.

```bash
timeout --foreground -k 5s 30s "${prod[@]}" logs --no-log-prefix --tail=100 api worker caddy
timeout --foreground -k 5s 30s "${prod[@]}" logs --no-log-prefix --tail=100 worker | jq -c 'select(.level == "ERROR" or .level == "WARN")'
timeout --foreground -k 5s 20s "${prod[@]}" restart worker
timeout --foreground -k 5s 20s "${prod[@]}" ps
```

Worker JSON logs include monitor IDs, states, status codes, and configured target URLs. Treat them as operational data and restrict access accordingly.

### Update from an approved release

Record the current release reference and take/verify a backup before updating. Fetch or check out only a release the owner has approved. Review release notes and migrations, then rebuild and wait for health:

```bash
# After checkout of the approved new reference, still at repository root:
timeout --foreground -k 10s 180s "${prod[@]}" build
timeout --foreground -k 10s 180s "${prod[@]}" up -d --wait --wait-timeout 120
timeout --foreground -k 5s 20s "${prod[@]}" ps
```

This is a short-downtime, single-stack update, not a zero-downtime deployment. API startup may apply forward migrations before the new process becomes healthy. A previous application image/ref may not work with a newer database schema. Preserve a verified backup and the previous approved code reference until the new release and restored-data procedure are accepted. Do not run automatic migration-down, database reset, or `down -v` as rollback.

### Stop and restart

```bash
timeout --foreground -k 10s 60s "${prod[@]}" stop
timeout --foreground -k 5s 30s "${prod[@]}" start
timeout --foreground -k 5s 20s "${prod[@]}" ps
```

`stop` preserves the PostgreSQL volume. Never use `down -v`, volume prune, or broad Docker cleanup as a routine restart or rollback step.

## 6. Compressed PostgreSQL backups

The committed executable `scripts/backup-postgres.sh` finds exactly one running Compose `db` service labelled with `sentinel-prod`, runs `pg_dump` inside that container using its configured PostgreSQL user/database, compresses a plain SQL dump, validates the gzip stream, publishes atomically, and rotates only canonical archives for that exact project. It does not load the Compose env file or need a host PostgreSQL client.

Create a private backup directory outside the checkout and every web-served directory. Run one backup process at a time; do not overlap invocations or independent schedulers. Set every script option explicitly—the script does not inherit values from the Compose config file:

```bash
BACKUP_DIR="$HOME/backups/sentinel"
install -d -m 700 "$BACKUP_DIR"
BACKUP_PROJECT=sentinel-prod \
BACKUP_DIR="$BACKUP_DIR" \
BACKUP_KEEP_COUNT=7 \
BACKUP_TIMEOUT_SECONDS=120 \
./scripts/backup-postgres.sh
```

Options are `BACKUP_PROJECT` (default `sentinel-prod`, safe Docker project identifier), `BACKUP_DIR` (default `backups` relative to the current directory), `BACKUP_KEEP_COUNT` (default 7, range 1..1000), and `BACKUP_TIMEOUT_SECONDS` (default 120, range 1..3600). Use an absolute private directory in production. New archive names use a UTC timestamp with nanosecond precision and a random suffix; valid legacy second-precision names remain recognized. The currently published archive is protected during rotation.

The output is a **plain SQL dump compressed with gzip, not encrypted**. Files are created with restrictive permissions and the output directory is set to mode `700`, but that is not encryption or off-site backup. Protect the VM and filesystem, encrypt any operator-managed off-site copy with separately managed keys, and test restores. No off-site transfer, encryption key management, scheduler, or remote backup service is implemented here. If scheduling externally, configure exactly one non-overlapping job and monitor its exit status and available disk space.

## 7. Restore into a fresh isolated PostgreSQL instance

**Never restore a backup over the live Compose database as a test.** A restore test below creates a new labelled container and a new named volume, publishes no host port, and uses only resources with a unique restore label. Match the source database role and database name because a plain `pg_dump` archive does not create PostgreSQL cluster roles. Use a separate throwaway password for the isolated restore instance.

Set `ARCHIVE` to one selected archive and choose a unique restore label/name. The sample role/database match the Compose block above; change them if the source deployment used different values.

```bash
ARCHIVE="$HOME/backups/sentinel/REPLACE_WITH_SELECTED_ARCHIVE.sql.gz"
RESTORE_PROJECT="sentinel-restore-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
RESTORE_CONTAINER="${RESTORE_PROJECT}-db"
RESTORE_VOLUME="${RESTORE_PROJECT}-data"
RESTORE_DB_USER=postgres
RESTORE_DB_NAME=sentinel_db
RESTORE_DB_PASSWORD="$(openssl rand -hex 32)"
```

First validate the archive's gzip integrity and fail closed if either randomly named restore resource already exists. Create a new labelled volume and start a fresh PostgreSQL 17 instance with no published port. Do not substitute a production volume name:

```bash
timeout --foreground -k 5s 60s gzip -t -- "$ARCHIVE"
existing_container=$(timeout --foreground -k 2s 8s docker ps -aq --filter "name=^/${RESTORE_CONTAINER}$")
existing_volume=$(timeout --foreground -k 2s 8s docker volume ls -q --filter "name=^${RESTORE_VOLUME}$")
if [[ -n $existing_container || -n $existing_volume ]]; then
  printf 'restore resource name already exists; choose a new RESTORE_PROJECT\n' >&2
  exit 1
fi
timeout --foreground -k 5s 20s docker volume create \
  --label "com.sentinel.restore=$RESTORE_PROJECT" "$RESTORE_VOLUME" >/dev/null
volume_label=$(timeout --foreground -k 2s 8s docker volume inspect \
  -f '{{ index .Labels "com.sentinel.restore" }}' "$RESTORE_VOLUME")
[[ $volume_label == "$RESTORE_PROJECT" ]] || { printf 'restore volume label mismatch\n' >&2; exit 1; }
POSTGRES_PASSWORD="$RESTORE_DB_PASSWORD" timeout --foreground -k 5s 30s docker run -d --name "$RESTORE_CONTAINER" \
  --label "com.sentinel.restore=$RESTORE_PROJECT" \
  --user postgres --cap-drop ALL --security-opt no-new-privileges \
  --volume "$RESTORE_VOLUME:/var/lib/postgresql/data" \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --env "POSTGRES_USER=$RESTORE_DB_USER" \
  --env POSTGRES_PASSWORD \
  --env "POSTGRES_DB=$RESTORE_DB_NAME" \
  postgres:17-alpine >/dev/null
container_label=$(timeout --foreground -k 2s 8s docker inspect \
  -f '{{ index .Config.Labels "com.sentinel.restore" }}' "$RESTORE_CONTAINER")
[[ $container_label == "$RESTORE_PROJECT" ]] || { printf 'restore container label mismatch\n' >&2; exit 1; }
```

Wait for authenticated SQL over loopback TCP on the **final** server. `pg_isready` or a Unix-socket query can observe PostgreSQL's temporary initialization server and is not a sufficient readiness check. This bounded loop checks `SELECT 1` with the restore-only credentials:

```bash
restore_deadline=$((SECONDS + 60))
while :; do
  if restore_result=$(PGPASSWORD="$RESTORE_DB_PASSWORD" timeout --foreground -k 2s 8s \
      docker exec --env PGPASSWORD "$RESTORE_CONTAINER" \
      psql -h 127.0.0.1 -X -qAt -v ON_ERROR_STOP=1 \
      -U "$RESTORE_DB_USER" -d "$RESTORE_DB_NAME" -c 'SELECT 1' 2>/dev/null) \
      && [[ $restore_result == 1 ]]; then
    break
  fi
  ((SECONDS < restore_deadline)) || { printf 'final PostgreSQL readiness timed out\n' >&2; exit 1; }
  sleep 1
done
```

Restore the real compressed SQL stream into that empty database. `pipefail` is essential: it propagates both decompression and `psql -v ON_ERROR_STOP=1` failures. The archive is plain SQL, so use `psql`, not `pg_restore`.

```bash
set -euo pipefail
timeout --foreground -k 10s 1800s gzip -dc -- "$ARCHIVE" | timeout --foreground -k 10s 1800s \
  docker exec -i "$RESTORE_CONTAINER" \
  psql -X -v ON_ERROR_STOP=1 -U "$RESTORE_DB_USER" -d "$RESTORE_DB_NAME" >/dev/null
```

### Verify the restored snapshot

Record archive-specific expectations when making the backup, then inspect only the isolated restore database. If production writers were active during `pg_dump`, live counts read later may have advanced; compare against the archive snapshot, not blindly against current production counts. Confirm table counts and key IDs, monitor state/check timestamps, no orphaned foreign keys, and sequence positions before any recovery decision.

```bash
timeout --foreground -k 5s 30s docker exec -i "$RESTORE_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
  -U "$RESTORE_DB_USER" -d "$RESTORE_DB_NAME" <<'SQL'
SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM monitor) AS monitors,
       (SELECT count(*) FROM check_result) AS checks,
       (SELECT count(*) FROM alert) AS alerts;
SELECT id, last_state, last_checked_at FROM monitor ORDER BY id;
SELECT count(*) AS orphan_monitors FROM monitor m LEFT JOIN users u ON u.id=m.user_id WHERE u.id IS NULL;
SELECT count(*) AS orphan_checks FROM check_result c LEFT JOIN monitor m ON m.id=c.monitor_id WHERE m.id IS NULL;
SELECT count(*) AS orphan_alerts FROM alert a LEFT JOIN monitor m ON m.id=a.monitor_id WHERE m.id IS NULL;
SELECT last_value, is_called FROM users_id_seq;
SELECT last_value, is_called FROM monitor_id_seq;
SELECT last_value, is_called FROM check_result_id_seq;
SELECT last_value, is_called FROM alert_id_seq;
SELECT monitor_id,
       round(100.0 * count(*) FILTER (WHERE state='healthy') / NULLIF(count(*), 0), 2) AS uptime_percent
FROM check_result
WHERE created_at >= now() - interval '24 hours' AND created_at <= now()
GROUP BY monitor_id ORDER BY monitor_id;
SQL
```

For a production-sized restore, compare counts and selected primary keys against the backup-time inventory you recorded. Check sequence `last_value` is not behind the corresponding maximum ID, and check representative `monitor.last_state` / `last_checked_at` values and the SQL uptime window configured for that deployment (the query above uses 24 hours as an example). Gzip integrity alone is not proof that schema, rows, relationships, sequences, and application state restored correctly.

The D08 isolated fixture was separately verified with one synthetic user, two monitors, three checks, two alerts, preserved IDs/FKs and monitor state/timestamps, and a 66.67% SQL uptime projection. Those fixture counts are evidence for that synthetic test only; they are not expected counts for an operator's database.

### Clean up only the isolated restore resources

After saving the verification report, positively verify the unique restore labels before removing the new container and volume. Do not use `docker system prune`, `docker volume prune`, Compose `down -v`, wildcard cleanup, or any command against the live `sentinel-prod` database volume.

```bash
container_label=$(timeout --foreground -k 2s 8s docker inspect -f '{{ index .Config.Labels "com.sentinel.restore" }}' "$RESTORE_CONTAINER")
volume_label=$(timeout --foreground -k 2s 8s docker volume inspect -f '{{ index .Labels "com.sentinel.restore" }}' "$RESTORE_VOLUME")
if [[ $container_label == "$RESTORE_PROJECT" && $volume_label == "$RESTORE_PROJECT" ]]; then
  timeout --foreground -k 3s 10s docker rm -f "$RESTORE_CONTAINER"
  timeout --foreground -k 3s 10s docker volume rm "$RESTORE_VOLUME"
else
  printf 'refusing cleanup: restore ownership labels do not match\n' >&2
  exit 1
fi
```

If label inspection or cleanup fails, stop and investigate only the named restore resources. Never broaden cleanup to make the command succeed.

## 8. Recovery and rollback decisions

A successful restore into an isolated instance proves that the selected archive can be read by the tested PostgreSQL major version and that its snapshot passes your checks; it does not replace a production recovery plan. Before promoting recovered data, decide explicitly which writes made after the archive time may be lost, how the restored instance will become the intended database, and how API/worker versions will match the restored schema. Keep the existing production volume and another verified backup until the recovered service is accepted.

Do not automatically point the production Compose database at the isolated test volume. Do not drop or truncate the live database as a restore shortcut. API migrations may be forward-only for rollback purposes, so reverting application code does not imply reverting the database. A rollback should be an operator-approved, rehearsed recovery decision, not an unconditional shell script.

## 9. Scope and verification status

The latest independent local functional verification recorded API 107 unit tests/16 suites, 51 e2e tests/7 suites and build; Go 7 packages/full tests/race/static build plus fresh PostgreSQL retention integration; and frontend 121 tests/16 files with lint, typecheck and build on Node.js 22.23.2. Isolated Compose smoke passed 30 helper assertions, 15 production scenarios (142s) and 5 development scenarios (26s), including strict local-CA checks, XFF throttling, worker stall/restart, database-pause recovery and real retention preserving 66.67% public-status uptime. D08 passed 9 backup regressions plus 14 expected-failure cases and a fresh PostgreSQL 17 restore in 4 seconds with the complete synthetic snapshot and SQL uptime verified; no owned Docker resources remained and the baseline test container stayed exited (255).

These are recorded results, not checks run while writing this runbook. A prior D06 record contains Chromium DOM verification; the latest verifier report does not establish a new browser DOM run. ShellCheck was unavailable. The deployment workflow's AMD64 job is defined; remote CI execution, actual ARM64 VM builds, public DNS/ACME, and a public VM deployment remain unverified. The README's live-site and video links remain owner-maintained placeholders.
