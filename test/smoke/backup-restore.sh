#!/usr/bin/env bash
# Real dump/restore round trip using two new, isolated PostgreSQL 17 containers.
# No host ports, application clients, public targets, or existing DB are used.
set -Eeuo pipefail
umask 077

# Enforce the harness-wide limit even when invoked without an outer test timeout.
if [[ ${BACKUP_RESTORE_WITHIN_TIMEOUT:-0} != 1 ]]; then
  exec timeout --foreground -k 10s 300s env BACKUP_RESTORE_WITHIN_TIMEOUT=1 bash "$0" "$@"
fi

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/sentinel-backup-restore.XXXXXXXX")
suffix=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
[[ $suffix =~ ^[a-f0-9]{12}$ ]] || { printf 'backup-restore: could not create a safe namespace\n' >&2; exit 1; }
source_project="sentinel-backup-test-$suffix"
destination_project="sentinel-backup-restore-$suffix"
source_name="$source_project-db"
destination_name="$destination_project-db"
source_volume="$source_project-data"
destination_volume="$destination_project-data"
source_password='phase4-backup-source-example-password'
destination_password='phase4-backup-dest-example-password'
database='sentinel_tests_db'
db_user='sentinel'
cleanup_failed=0

owned_container() {
  local name=$1 project=$2 labels
  labels=$(timeout --foreground -k 2s 8s docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}' "$name" 2>/dev/null) || return 1
  [[ $labels == "$project|db" ]]
}

cleanup() {
  local original=$? volume labels
  trap - EXIT INT TERM
  set +e
  for name_project in "$source_name:$source_project" "$destination_name:$destination_project"; do
    local name=${name_project%%:*} project=${name_project#*:}
    if timeout --foreground -k 2s 8s docker inspect "$name" >/dev/null 2>&1; then
      if owned_container "$name" "$project"; then
        timeout --foreground -k 3s 10s docker rm -f "$name" >/dev/null 2>&1 || cleanup_failed=1
      else
        printf 'backup-restore: refusing cleanup of unverified container %s\n' "$name" >&2
        cleanup_failed=1
      fi
    fi
  done
  for volume_project in "$source_volume:$source_project" "$destination_volume:$destination_project"; do
    volume=${volume_project%%:*}
    project=${volume_project#*:}
    if timeout --foreground -k 2s 8s docker volume inspect "$volume" >/dev/null 2>&1; then
      labels=$(timeout --foreground -k 2s 8s docker volume inspect -f '{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.service" }}' "$volume" 2>/dev/null) || labels=''
      if [[ $labels == "$project|db" ]]; then
        timeout --foreground -k 3s 10s docker volume rm "$volume" >/dev/null 2>&1 || cleanup_failed=1
      else
        printf 'backup-restore: refusing cleanup of unverified volume %s\n' "$volume" >&2
        cleanup_failed=1
      fi
    fi
  done
  if ((cleanup_failed)); then
    printf 'backup-restore: owned Docker cleanup failed; inspect only namespace %s / %s\n' "$source_project" "$destination_project" >&2
    ((original != 0)) || original=1
  else
    printf '[cleanup] verified owned container/volume cleanup completed for %s and %s\n' "$source_project" "$destination_project"
  fi
  # Temporary SQL/archives contain only synthetic test data; retain on disk for
  # bounded manual diagnosis rather than deleting a path in automated cleanup.
  exit "$original"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() { printf 'backup-restore: %s\n' "$1" >&2; return 1; }
docker_bounded() { timeout --foreground -k 5s 30s docker "$@"; }

create_volume() {
  local volume=$1 project=$2
  docker_bounded volume create --label "com.docker.compose.project=$project" --label com.docker.compose.service=db "$volume" >/dev/null
}

start_database() {
  local name=$1 project=$2 volume=$3 password=$4
  docker_bounded run -d --name "$name" \
    --label "com.docker.compose.project=$project" --label com.docker.compose.service=db \
    --user postgres --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m --volume "$volume:/var/lib/postgresql/data" \
    --env "POSTGRES_USER=$db_user" --env "POSTGRES_PASSWORD=$password" --env "POSTGRES_DB=$database" \
    postgres:17-alpine >/dev/null
}

wait_ready() {
  local name=$1 password=$2 deadline=$((SECONDS + 60)) response
  # pg_isready may observe the official image's temporary Unix-socket init
  # server. Require authenticated SQL over loopback TCP on the final daemon.
  while ((SECONDS < deadline)); do
    if response=$(timeout --foreground -k 2s 8s docker exec --env "PGPASSWORD=$password" "$name" \
      psql -h 127.0.0.1 -X -qAt -v ON_ERROR_STOP=1 -U "$db_user" -d "$database" -c 'SELECT 1' 2>/dev/null) && [[ $response == 1 ]]; then
      return 0
    fi
    sleep 1
  done
  fail "Final PostgreSQL TCP/SQL readiness exceeded 60 seconds for owned container $name"
}

psql_stdin() {
  local name=$1
  shift
  timeout --foreground -k 5s 30s docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U "$db_user" -d "$database" "$@"
}

snapshot() {
  local name=$1
  timeout --foreground -k 5s 30s docker exec -i "$name" psql -X -At -F '|' -v ON_ERROR_STOP=1 -U "$db_user" -d "$database" <<'SQL'
SELECT
  (SELECT count(*) FROM users),
  (SELECT string_agg(id::text, ',' ORDER BY id) FROM users),
  (SELECT count(*) FROM monitor),
  (SELECT string_agg(id::text || ':' || last_state || ':' || last_checked_at::text, ',' ORDER BY id) FROM monitor),
  (SELECT count(*) FROM check_result),
  (SELECT string_agg(id::text || ':' || monitor_id::text || ':' || state, ',' ORDER BY id) FROM check_result),
  (SELECT count(*) FROM alert),
  (SELECT string_agg(id::text || ':' || monitor_id::text || ':' || alert_type, ',' ORDER BY id) FROM alert),
  (SELECT count(*) FROM check_result c LEFT JOIN monitor m ON m.id=c.monitor_id WHERE m.id IS NULL),
  (SELECT round(100.0 * count(*) FILTER (WHERE state='healthy') / NULLIF(count(*),0), 2)
     FROM check_result WHERE created_at >= now() - interval '24 hours');
SQL
}

mkdir -m 700 "$TEMP/backups"
create_volume "$source_volume" "$source_project"
create_volume "$destination_volume" "$destination_project"
start_database "$source_name" "$source_project" "$source_volume" "$source_password"
start_database "$destination_name" "$destination_project" "$destination_volume" "$destination_password"
wait_ready "$source_name" "$source_password"
wait_ready "$destination_name" "$destination_password"

for migration in \
  "$ROOT/sentinel-api/prisma/migrations/0_init/migration.sql" \
  "$ROOT/sentinel-api/prisma/migrations/20261001000000_demo_user/migration.sql" \
  "$ROOT/sentinel-api/prisma/migrations/20261002000000_public_status/migration.sql" \
  "$ROOT/sentinel-api/prisma/migrations/20261003000000_retention_indexes/migration.sql"; do
  psql_stdin "$source_name" <"$migration" >/dev/null
 done
psql_stdin "$source_name" >/dev/null <<'SQL'
INSERT INTO users (name,last_name,username,email,password,created_at,updated_at,is_active,is_demo)
VALUES ('Synthetic','Backup','backup-test','backup-test@example.test','not-a-real-password',now(),now(),true,false);
INSERT INTO monitor (name,target,frequency,state,created_at,check_type,check_config,last_state,last_checked_at,consecutive_failures,user_id,seed_key,is_public)
VALUES
 ('Synthetic healthy','https://probe.example.test/one',60,'Active',now(),'http','{}','healthy',now(),0,1,'backup-one',false),
 ('Synthetic unhealthy','https://probe.example.test/two',60,'Active',now(),'http','{}','unhealthy',now(),2,1,'backup-two',false);
INSERT INTO check_result (monitor_id,state,status_code,latency_ms,created_at)
VALUES (1,'healthy',200,12.5,now()-interval '1 hour'),(1,'unhealthy',NULL,40,now()-interval '2 hours'),(2,'healthy',200,8.5,now()-interval '3 hours');
INSERT INTO alert (monitor_id,alert_type,message,created_at)
VALUES (1,'down','synthetic down transition',now()-interval '2 hours'),(1,'recovery','synthetic recovery transition',now()-interval '1 hour');
SQL

BACKUP_PROJECT="$source_project" BACKUP_DIR="$TEMP/backups" BACKUP_KEEP_COUNT=2 BACKUP_TIMEOUT_SECONDS=120 \
  timeout --foreground -k 10s 140s bash "$ROOT/scripts/backup-postgres.sh" >"$TEMP/backup-result"
archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/backup-result")
[[ -n $archive && -f $archive && ! -L $archive ]] || fail 'backup script did not publish one regular archive'
gzip -t -- "$archive" || fail 'published dump failed gzip integrity verification'

# Restore the real archive into the separately created, empty destination DB.
if ! timeout --foreground -k 10s 140s gzip -dc -- "$archive" | \
    timeout --foreground -k 10s 140s docker exec -i "$destination_name" psql -X -v ON_ERROR_STOP=1 -U "$db_user" -d "$database" >/dev/null 2>"$TEMP/restore-error"; then
  fail 'actual gzip/psql restore failed; see the bounded synthetic-test error file'
fi
source_snapshot=$(snapshot "$source_name") || fail 'source snapshot query failed'
destination_snapshot=$(snapshot "$destination_name") || fail 'restored snapshot query failed'
[[ $source_snapshot == "$destination_snapshot" ]] || fail 'source and restored schema/data snapshots differ'

IFS='|' read -r users user_ids monitors monitor_state checks check_rows alerts alert_rows orphan_checks uptime <<<"$source_snapshot"
[[ $users == 1 && $user_ids == 1 && $monitors == 2 && $checks == 3 && $alerts == 2 && $orphan_checks == 0 && $uptime == 66.67 ]] || \
  fail 'restored row counts, IDs/FKs, monitor state, or SQL uptime projection did not match the expected fixture'
printf 'Real isolated restore passed: users=%s monitors=%s checks=%s alerts=%s; IDs/FKs, monitor last_state/last_checked_at, alert/check IDs and SQL uptime=%s%% match.\n' \
  "$users" "$monitors" "$checks" "$alerts" "$uptime"
printf 'Owned PostgreSQL 17 source/destination containers and volumes are being cleaned up.\n'
