#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/backup-unit.XXXXXXXX")
# Keep this private temporary fixture for manual inspection; never clean paths
# outside the repository test's direct ownership scope.
mkdir -p "$TEMP/bin" "$TEMP/output"

cat >"$TEMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "${MOCK_DOCKER_FAILURE:-}:$1:${2:-}" in
  list-failure:ps:*) exit 1 ;;
  list-timeout:ps:*) sleep 9; exit 0 ;;
  inspect-failure:inspect:*) exit 1 ;;
esac
if [[ $1 == ps ]]; then
  [[ " $* " == *'label=com.docker.compose.service=db'* ]] || exit 98
  case ${MOCK_DB_COUNT:-1} in
    0) exit 0 ;;
    2) printf '0123456789abcdef01234567\n0123456789abcdef01234568\n' ;;
    *) printf '0123456789abcdef01234567\n' ;;
  esac
elif [[ $1 == inspect ]]; then
  case ${MOCK_DOCKER_FAILURE:-} in foreign) printf 'other-project\n'; exit 0;; esac
  printf '%s|%s|running\n' "${MOCK_PROJECT:-sentinel-prod}" "${MOCK_SERVICE:-db}"
elif [[ $1 == exec ]]; then
  case ${MOCK_DOCKER_FAILURE:-} in
    dump-failure) printf 'private-partial'; exit 1 ;;
    dump-timeout) sleep 2; exit 0 ;;
  esac
  shift
  container=$1
  shift
  [[ $1 == sh && $2 == -ec ]] || exit 97
  shift
  shell_mode=$1
  shell_code=$2
  shift 2
  POSTGRES_USER=${MOCK_POSTGRES_USER:-sentinel_role}
  export POSTGRES_USER
  if [[ ${MOCK_DB_IS_UNSET:-0} == 1 ]]; then
    unset POSTGRES_DB
  else
    POSTGRES_DB=${MOCK_POSTGRES_DB:-sentinel_tests_db}
    export POSTGRES_DB
  fi
  sh "$shell_mode" "$shell_code" "$@"
else
  exit 99
fi
MOCK
cat >"$TEMP/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$MOCK_PGDUMP_ARGS_FILE"
printf 'synthetic SQL dump\n'
MOCK
cat >"$TEMP/bin/date" <<'MOCK'
#!/usr/bin/env bash
if [[ -n ${MOCK_TIMESTAMP:-} ]]; then printf '%s\n' "$MOCK_TIMESTAMP"; else exec /usr/bin/date "$@"; fi
MOCK
cat >"$TEMP/bin/od" <<'MOCK'
#!/usr/bin/env bash
if [[ -n ${MOCK_NONCE:-} ]]; then printf '%s\n' "$MOCK_NONCE"; else exec /usr/bin/od "$@"; fi
MOCK
cat >"$TEMP/bin/stat" <<'MOCK'
#!/usr/bin/env bash
if [[ ${MOCK_STAT_FAILURE:-0} == 1 ]]; then exit 1; fi
exec /usr/bin/stat "$@"
MOCK
chmod +x "$TEMP/bin/docker" "$TEMP/bin/pg_dump" "$TEMP/bin/date" "$TEMP/bin/od" "$TEMP/bin/stat"
export PATH="$TEMP/bin:$PATH" MOCK_PROJECT=sentinel-prod BACKUP_PROJECT=sentinel-prod BACKUP_DIR="$TEMP/output" BACKUP_TIMEOUT_SECONDS=1 MOCK_PGDUMP_ARGS_FILE="$TEMP/pgdump-args" MOCK_POSTGRES_DB=sentinel_tests_db

owned_archive_count() {
  local directory=$1 path basename count=0
  shopt -s nullglob
  for path in "$directory/backup-sentinel-prod-"*.sql.gz; do
    [[ -f $path && ! -L $path ]] || continue
    basename=${path##*/}
    [[ $basename =~ ^backup-sentinel-prod-[0-9]{8}T[0-9]{6}(\.[0-9]{9})?Z-[a-f0-9]{12}\.sql\.gz$ ]] || continue
    count=$((count + 1))
  done
  shopt -u nullglob
  printf '%s' "$count"
}

failures=0
expected_failures=0
expect_failure() {
  local reason=$1
  shift
  expected_failures=$((expected_failures + 1))
  if env "$@" bash scripts/backup-postgres.sh >"$TEMP/stdout" 2>"$TEMP/stderr"; then
    printf 'FAIL: expected failure for %s\n' "$reason" >&2
    failures=$((failures + 1))
  fi
}

expect_failure invalid-keep BACKUP_KEEP_COUNT=0
expect_failure unsafe-project BACKUP_PROJECT='sentinel-prod;bad'
ln -s "$TEMP/output" "$TEMP/output-symlink"
expect_failure symlink-output BACKUP_DIR="$TEMP/output-symlink"
expect_failure list-failure MOCK_DOCKER_FAILURE=list-failure
expect_failure list-timeout MOCK_DOCKER_FAILURE=list-timeout
expect_failure no-database MOCK_DOCKER_FAILURE=none MOCK_DB_COUNT=0
expect_failure ambiguous-databases MOCK_DB_COUNT=2
expect_failure inspect-failure MOCK_DOCKER_FAILURE=inspect-failure
expect_failure foreign-label MOCK_DOCKER_FAILURE=foreign
expect_failure wrong-service MOCK_DOCKER_FAILURE=none MOCK_SERVICE=api

# Deterministic regression probes for archive ownership/order, numeric parsing,
# in-container PostgreSQL defaults, and ordering-metadata failure handling.
regression_failures=0
regression_fail() { printf 'RED regression: %s\n' "$1" >&2; regression_failures=$((regression_failures + 1)); }
test_stamp=20250101T000000.000000000Z

mkdir -p "$TEMP/prefix-overlap"
: >"$TEMP/prefix-overlap/backup-sentinel-prod-staging-20990101T000000Z-ffffffffffff.sql.gz"
: >"$TEMP/prefix-overlap/backup-sentinel-prod-not-an-archive.sql.gz"
if BACKUP_DIR="$TEMP/prefix-overlap" BACKUP_KEEP_COUNT=1 MOCK_TIMESTAMP="$test_stamp" MOCK_NONCE=000000000001 bash scripts/backup-postgres.sh >"$TEMP/prefix-out" 2>"$TEMP/prefix-err"; then
  regression_archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/prefix-out")
  [[ -f $regression_archive && -f "$TEMP/prefix-overlap/backup-sentinel-prod-staging-20990101T000000Z-ffffffffffff.sql.gz" && -f "$TEMP/prefix-overlap/backup-sentinel-prod-not-an-archive.sql.gz" && $(awk -F': ' '$1 == "Kept project archives" {print $2}' "$TEMP/prefix-out") == 1 ]] || regression_fail 'overlapping/malformed names must not count, prune, or hide the published archive'
else
  regression_fail 'strict-prefix fixture backup should succeed'
fi

mkdir -p "$TEMP/same-second"
: >"$TEMP/same-second/backup-sentinel-prod-$test_stamp-ffffffffffff.sql.gz"
if BACKUP_DIR="$TEMP/same-second" BACKUP_KEEP_COUNT=1 MOCK_TIMESTAMP="$test_stamp" MOCK_NONCE=000000000001 bash scripts/backup-postgres.sh >"$TEMP/same-second-out" 2>"$TEMP/same-second-err"; then
  regression_archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/same-second-out")
  [[ -f $regression_archive && $(find "$TEMP/same-second" -maxdepth 1 -type f -name 'backup-sentinel-prod-*.sql.gz' | wc -l) == 1 ]] || regression_fail 'same-second newer archive must survive higher old nonce'
else
  regression_fail 'same-second chronology fixture backup should succeed'
fi

for padded_keep in 08 09; do
  mkdir -p "$TEMP/keep-$padded_keep"
  if BACKUP_DIR="$TEMP/keep-$padded_keep" BACKUP_KEEP_COUNT="$padded_keep" MOCK_TIMESTAMP="$test_stamp" MOCK_NONCE=000000000002 bash scripts/backup-postgres.sh >"$TEMP/keep-$padded_keep-out" 2>"$TEMP/keep-$padded_keep-err"; then
    regression_archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/keep-$padded_keep-out")
    [[ -f $regression_archive && $(awk -F': ' '$1 == "Kept project archives" {print $2}' "$TEMP/keep-$padded_keep-out") == 1 ]] || regression_fail "zero-padded keep $padded_keep should normalize and succeed"
  else
    regression_fail "zero-padded keep $padded_keep should normalize and succeed"
  fi
done

mkdir -p "$TEMP/db-default"
if BACKUP_DIR="$TEMP/db-default" MOCK_DB_IS_UNSET=1 MOCK_POSTGRES_USER=custom_backup_role MOCK_TIMESTAMP="$test_stamp" MOCK_NONCE=000000000003 bash scripts/backup-postgres.sh >"$TEMP/db-default-out" 2>"$TEMP/db-default-err"; then
  grep -q -- '-U custom_backup_role -d custom_backup_role' "$TEMP/pgdump-args" || regression_fail 'unset POSTGRES_DB must default to POSTGRES_USER in executed pg_dump argv'
else
  regression_fail 'custom-user default-database fixture backup should succeed'
fi

# UTC filename chronology must survive the London fall-back offset change.
mkdir -p "$TEMP/dst-order"
dst_old="$TEMP/dst-order/backup-sentinel-prod-20261025T005900Z-ffffffffffff.sql.gz"
dst_new="$TEMP/dst-order/backup-sentinel-prod-20261025T010100Z-000000000001.sql.gz"
: >"$dst_old"; touch -d '2026-10-25 00:59:00 UTC' "$dst_old"
: >"$dst_new"; touch -d '2026-10-25 01:01:00 UTC' "$dst_new"
if TZ=Europe/London BACKUP_DIR="$TEMP/dst-order" BACKUP_KEEP_COUNT=2 MOCK_TIMESTAMP=20261025T010200.000000000Z MOCK_NONCE=000000000005 bash scripts/backup-postgres.sh >"$TEMP/dst-order-out" 2>"$TEMP/dst-order-err"; then
  regression_archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/dst-order-out")
  [[ -f $regression_archive && -f $dst_new && ! -e $dst_old ]] || regression_fail 'DST rollback must prune only the chronologically older UTC-named archive'
else
  regression_fail 'DST rollback chronology fixture backup should succeed'
fi

# Equal legacy UTC names use a UTC-normalized mtime tie-break across DST.
mkdir -p "$TEMP/dst-tie"
tie_old="$TEMP/dst-tie/backup-sentinel-prod-20261025T010000Z-ffffffffffff.sql.gz"
tie_new="$TEMP/dst-tie/backup-sentinel-prod-20261025T010000Z-000000000001.sql.gz"
: >"$tie_old"; touch -d '2026-10-25 00:59:00 UTC' "$tie_old"
: >"$tie_new"; touch -d '2026-10-25 01:01:00 UTC' "$tie_new"
if TZ=Europe/London BACKUP_DIR="$TEMP/dst-tie" BACKUP_KEEP_COUNT=2 MOCK_TIMESTAMP=20261025T010200.000000000Z MOCK_NONCE=000000000006 bash scripts/backup-postgres.sh >"$TEMP/dst-tie-out" 2>"$TEMP/dst-tie-err"; then
  regression_archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/dst-tie-out")
  [[ -f $regression_archive && -f $tie_new && ! -e $tie_old ]] || regression_fail 'equal legacy UTC names must use timezone-independent mtime to break nonce ties'
else
  regression_fail 'equal-name DST tie fixture backup should succeed'
fi

# The encoded UTC filename remains primary even when copied mtimes disagree.
mkdir -p "$TEMP/filename-primary"
primary_old="$TEMP/filename-primary/backup-sentinel-prod-20261025T005900Z-ffffffffffff.sql.gz"
primary_new="$TEMP/filename-primary/backup-sentinel-prod-20261025T010100Z-000000000001.sql.gz"
: >"$primary_old"; touch -d '2026-10-25 02:00:00 UTC' "$primary_old"
: >"$primary_new"; touch -d '2026-10-25 00:00:00 UTC' "$primary_new"
if TZ=Europe/London BACKUP_DIR="$TEMP/filename-primary" BACKUP_KEEP_COUNT=2 MOCK_TIMESTAMP=20261025T010200.000000000Z MOCK_NONCE=000000000007 bash scripts/backup-postgres.sh >"$TEMP/filename-primary-out" 2>"$TEMP/filename-primary-err"; then
  regression_archive=$(awk -F': ' '$1 == "Backup archive" {print $2}' "$TEMP/filename-primary-out")
  [[ -f $regression_archive && -f $primary_new && ! -e $primary_old ]] || regression_fail 'UTC filename chronology must outrank divergent copied-file mtimes'
else
  regression_fail 'filename-primary fixture backup should succeed'
fi

mkdir -p "$TEMP/order-failure"
: >"$TEMP/order-failure/backup-sentinel-prod-20200101T000000Z-ffffffffffff.sql.gz"
if BACKUP_DIR="$TEMP/order-failure" BACKUP_KEEP_COUNT=1 MOCK_TIMESTAMP="$test_stamp" MOCK_NONCE=000000000004 MOCK_STAT_FAILURE=1 bash scripts/backup-postgres.sh >"$TEMP/order-failure-out" 2>"$TEMP/order-failure-err"; then
  regression_fail 'archive ordering metadata failure must not report success'
else
  regression_archive=$(grep -oE '/[^[:space:]]+\.sql\.gz' "$TEMP/order-failure-err" | head -n1)
  [[ -f $regression_archive && -f "$TEMP/order-failure/backup-sentinel-prod-20200101T000000Z-ffffffffffff.sql.gz" ]] || regression_fail 'ordering failure must preserve current and old archives'
  ! grep -q 'Kept project archives' "$TEMP/order-failure-out" || regression_fail 'ordering failure must not print success/kept count'
fi

printf 'Focused regression assertions failing: %s\n' "$regression_failures"
if ((regression_failures != 0)); then exit 1; fi

make_old_archives() {
  : >"$BACKUP_DIR/backup-sentinel-prod-20200101T000000Z-111111111111.sql.gz"
  : >"$BACKUP_DIR/backup-sentinel-prod-20200102T000000Z-222222222222.sql.gz"
  : >"$BACKUP_DIR/backup-other-20200103T000000Z-333333333333.sql.gz"
  : >"$BACKUP_DIR/backup-sentinel-prod-malformed.sql.gz"
  ln -s /dev/null "$BACKUP_DIR/backup-sentinel-prod-20200104T000000Z-444444444444.sql.gz"
}
make_old_archives
before=$(find "$BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' | sort)
expect_failure dump-failure MOCK_DOCKER_FAILURE=dump-failure
expect_failure dump-timeout MOCK_DOCKER_FAILURE=dump-timeout
export MOCK_GZIP_FAILURE=1
cat >"$TEMP/bin/gzip" <<'MOCK'
#!/usr/bin/env bash
if [[ ${MOCK_GZIP_FAILURE:-0} == 1 ]]; then printf broken; exit 1; fi
for argument in "$@"; do [[ $argument != -t ]] || exec /usr/bin/gzip "$@"; done
if [[ ${MOCK_GZIP_CORRUPT:-0} == 1 ]]; then printf 'not a gzip stream'; exit 0; fi
exec /usr/bin/gzip "$@"
MOCK
chmod +x "$TEMP/bin/gzip"
expect_failure gzip-failure
unset MOCK_GZIP_FAILURE
export MOCK_GZIP_CORRUPT=1
expect_failure gzip-integrity
unset MOCK_GZIP_CORRUPT
[[ $before == "$(find "$BACKUP_DIR" -maxdepth 1 -type f -printf '%f\n' | sort)" ]]
[[ -z $(find "$BACKUP_DIR" -maxdepth 1 -name '.*.partial' -print -quit) ]]
cat >"$TEMP/bin/rm" <<'MOCK'
#!/usr/bin/env bash
if [[ ${MOCK_ROTATION_FAILURE:-0} == 1 && ${1:-} == -- && ${2:-} == *backup-sentinel-prod-*.sql.gz ]]; then exit 1; fi
exec /usr/bin/rm "$@"
MOCK
chmod +x "$TEMP/bin/rm"
if env BACKUP_KEEP_COUNT=1 MOCK_ROTATION_FAILURE=1 bash scripts/backup-postgres.sh >"$TEMP/rotation-out" 2>"$TEMP/rotation-error"; then
  printf 'FAIL: rotation failure was reported as success\n' >&2
  exit 1
fi
grep -q 'rotation failed after publishing' "$TEMP/rotation-error"
rotation_archive=$(grep -oE '/[^[:space:]]+\.sql\.gz' "$TEMP/rotation-error" | head -n1)
[[ -f $rotation_archive ]]

BACKUP_KEEP_COUNT=2 bash scripts/backup-postgres.sh >"$TEMP/success"
archive=$(grep -oE '/[^[:space:]]+\.sql\.gz' "$TEMP/success" | head -n1)
[[ -n $archive && -f $archive && ! -L $archive ]]
gzip -t "$archive"
BACKUP_KEEP_COUNT=2 bash scripts/backup-postgres.sh >"$TEMP/success-second"
second_archive=$(grep -oE '/[^[:space:]]+\.sql\.gz' "$TEMP/success-second" | head -n1)
[[ -n $second_archive && $second_archive != "$archive" && -f $second_archive ]]
[[ $(stat -c '%a' "$BACKUP_DIR") == 700 && $(stat -c '%a' "$archive") == 600 ]]
[[ $(owned_archive_count "$BACKUP_DIR") == 2 ]]
[[ -f "$BACKUP_DIR/backup-other-20200103T000000Z-333333333333.sql.gz" ]]
[[ -f "$BACKUP_DIR/backup-sentinel-prod-malformed.sql.gz" ]]
[[ -L "$BACKUP_DIR/backup-sentinel-prod-20200104T000000Z-444444444444.sql.gz" ]]
[[ $(find "$BACKUP_DIR" -maxdepth 1 -type f -name '.*.partial' | wc -l) == 0 ]]
printf 'backup-postgres mock control-flow assertions passed (%s expected-failure cases; unexpected successes=%s) plus rotation/private-output cases\n' "$expected_failures" "$failures"
[[ $failures == 0 && $expected_failures == 14 && $regression_failures == 0 ]]
