#!/usr/bin/env bash
# Create a private, compressed PostgreSQL archive from exactly one running
# Compose db container. Dumps are plaintext SQL inside gzip, not encrypted:
# protect BACKUP_DIR and arrange any offsite encryption/transfer yourself.
#
# Usage: BACKUP_PROJECT=sentinel-prod [BACKUP_DIR=backups]
#        [BACKUP_KEEP_COUNT=7] [BACKUP_TIMEOUT_SECONDS=120] ./scripts/backup-postgres.sh
set -Eeuo pipefail
backup_partial=''
umask 077

backup_error() {
  printf 'backup-postgres: %s\n' "$1" >&2
}

backup_positive_bounded() {
  local name=$1 value=$2 minimum=$3 maximum=$4
  [[ $value =~ ^[0-9]{1,5}$ ]] && ((10#$value >= minimum && 10#$value <= maximum)) || {
    backup_error "$name must be an integer from $minimum through $maximum"
    return 1
  }
  printf '%d' "$((10#$value))"
}

backup_main() {
  local project=${BACKUP_PROJECT:-sentinel-prod}
  local directory=${BACKUP_DIR:-backups}
  local keep=${BACKUP_KEEP_COUNT:-7}
  local duration=${BACKUP_TIMEOUT_SECONDS:-120}
  local -a ids=() archives=() archive_keys=()
  local id labels service state archive partial stamp nonce status index listing
  local base filename_time file_nonce file_mtime key insert_at archive_count
  local LC_ALL=C

  [[ $project =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]] || { backup_error 'BACKUP_PROJECT must be a safe Docker project identifier'; return 2; }
  keep=$(backup_positive_bounded BACKUP_KEEP_COUNT "$keep" 1 1000) || return 2
  duration=$(backup_positive_bounded BACKUP_TIMEOUT_SECONDS "$duration" 1 3600) || return 2
  [[ -n $directory && ! -L $directory ]] || { backup_error 'BACKUP_DIR must be a non-symlink directory path'; return 2; }
  if [[ ! -e $directory ]]; then
    mkdir -p -- "$directory" || { backup_error 'could not create BACKUP_DIR'; return 1; }
  fi
  [[ -d $directory && ! -L $directory ]] || { backup_error 'BACKUP_DIR must be a real directory, not a symlink'; return 2; }
  chmod 700 -- "$directory" || { backup_error 'could not make BACKUP_DIR private'; return 1; }

  if ! listing=$(timeout --foreground -k 2s 8s docker ps --quiet --filter "status=running" --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=db' 2>/dev/null); then
    backup_error 'Docker container discovery failed or timed out'
    return 1
  fi
  if [[ -n $listing ]]; then
    mapfile -t ids <<<"$listing"
  fi
  ((${#ids[@]} == 1)) || { backup_error "expected exactly one running db container for project $project"; return 1; }
  id=${ids[0]}
  [[ $id =~ ^[[:alnum:]]{12,64}$ ]] || { backup_error 'Docker returned an invalid container identifier'; return 1; }

  if ! labels=$(timeout --foreground -k 2s 8s docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ .State.Status }}' "$id" 2>/dev/null); then
    backup_error 'Docker ownership inspection failed or timed out'
    return 1
  fi
  IFS='|' read -r project_label service state <<<"$labels"
  [[ $project_label == "$project" && $service == db && $state == running ]] || {
    backup_error 'selected container is not the running db service owned by BACKUP_PROJECT'
    return 1
  }

  stamp=$(date -u +%Y%m%dT%H%M%S.%NZ) || { backup_error 'could not create archive timestamp'; return 1; }
  nonce=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n') || { backup_error 'could not create archive nonce'; return 1; }
  [[ $stamp =~ ^[0-9]{8}T[0-9]{6}\.[0-9]{9}Z$ && $nonce =~ ^[a-f0-9]{12}$ ]] || { backup_error 'could not create a safe unique archive name'; return 1; }
  archive="$directory/backup-$project-$stamp-$nonce.sql.gz"
  [[ ! -e $archive && ! -L $archive ]] || { backup_error 'archive name already exists; refusing to overwrite'; return 1; }
  partial=$(mktemp "$directory/.backup-$project-$stamp-$nonce.XXXXXXXX.partial") || { backup_error 'could not create a private partial archive'; return 1; }
  backup_partial=$partial
  trap 'if [[ -n $backup_partial && -f $backup_partial && ! -L $backup_partial ]]; then rm -- "$backup_partial" || backup_error "could not remove owned partial archive $backup_partial"; fi' EXIT
  chmod 600 -- "$partial" || { backup_error 'could not secure partial archive'; return 1; }

  # Resolve the official image's POSTGRES_USER/POSTGRES_DB inside the selected
  # container; never inspect or print its environment. The internal timeout
  # ends pg_dump itself, while the outer timeout bounds Docker/gzip as well.
  if timeout --foreground -k 10s "${duration}s" docker exec "$id" sh -ec '
    user=${POSTGRES_USER:-postgres}
    database=${POSTGRES_DB:-$user}
    exec timeout -s TERM "$1" pg_dump --lock-wait-timeout=10s -U "$user" -d "$database"
  ' backup-dump "${duration}s" 2>/dev/null | timeout --foreground -k 10s "${duration}s" gzip -c >"$partial"; then
    :
  else
    status=$?
    backup_error "pg_dump/compression failed or timed out (status $status); existing archives were retained"
    return 1
  fi
  [[ -s $partial ]] || { backup_error 'dump produced an empty archive; existing archives were retained'; return 1; }
  if ! timeout --foreground -k 2s 8s gzip -t -- "$partial" >/dev/null 2>&1; then
    backup_error 'compressed archive integrity validation failed; existing archives were retained'
    return 1
  fi
  if ! mv -n -- "$partial" "$archive" || [[ -e $partial || ! -f $archive || -L $archive ]]; then
    backup_error 'atomic archive publication failed; existing archives were retained'
    return 1
  fi
  partial=''
  backup_partial=''

  # Only canonical current/legacy filenames count as owned archives. The UTC
  # filename stamp is primary; UTC-normalized mtime then nonce break equal-name
  # ties. Protect the current archive even if the system clock moved backwards.
  shopt -s nullglob
  for id in "$directory/backup-$project-"*.sql.gz; do
    [[ -f $id && ! -L $id ]] || continue
    base=${id##*/}
    [[ $base =~ ^backup-${project}-([0-9]{8}T[0-9]{6})(\.([0-9]{9}))?Z-([a-f0-9]{12})\.sql\.gz$ ]] || continue
    [[ $id == "$archive" ]] && continue
    filename_time="${BASH_REMATCH[1]}.${BASH_REMATCH[3]:-000000000}Z"
    file_nonce=${BASH_REMATCH[4]}
    if ! file_mtime=$(TZ=UTC0 timeout --foreground -k 2s 8s stat -c '%y' -- "$id" 2>/dev/null) || [[ -z $file_mtime ]]; then
      shopt -u nullglob
      backup_error "could not establish archive ordering; published archive $archive was preserved and rotation was skipped"
      return 1
    fi
    key="$filename_time|$file_mtime|$file_nonce"
    insert_at=${#archive_keys[@]}
    while ((insert_at > 0)); do
      [[ $key > ${archive_keys[insert_at-1]} ]] || break
      archives[insert_at]=${archives[insert_at-1]}
      archive_keys[insert_at]=${archive_keys[insert_at-1]}
      insert_at=$((insert_at - 1))
    done
    archives[insert_at]=$id
    archive_keys[insert_at]=$key
  done
  shopt -u nullglob
  archives=("$archive" "${archives[@]}")
  archive_count=${#archives[@]}
  # archives[0] is the new file; retain keep-1 most recent prior archives.
  for ((index=keep; index<${#archives[@]}; index++)); do
    if ! rm -- "${archives[index]}"; then
      backup_error "rotation failed after publishing $archive; archive cleanup was incomplete"
      return 1
    fi
  done
  local kept=$(( archive_count < keep ? archive_count : keep ))
  [[ -f $archive && ! -L $archive ]] || { backup_error 'published archive disappeared during rotation'; return 1; }
  printf 'Backup archive: %s\nKept project archives: %s\n' "$archive" "$kept"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  backup_main "$@"
fi
