#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/production-smoke.sh"

assert() {
  if ! "$@"; then
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
  fi
}

assert smoke_valid_project sentinel-smoke-unique-123456789abc
assert smoke_owned_project sentinel-smoke-unique-123456789abc sentinel-smoke-unique-123456789abc api
if smoke_owned_project sentinel-smoke-unique-123456789abc sentinel-prod api; then
  printf 'FAIL: a foreign project resource was accepted for cleanup\n' >&2
  exit 1
fi
if smoke_owned_project sentinel-smoke-unique-123456789abc sentinel-smoke-unique-123456789abc ''; then
  printf 'FAIL: an unlabeled resource was accepted for cleanup\n' >&2
  exit 1
fi
if smoke_valid_project sentinel-prod; then
  printf 'FAIL: production namespace was accepted for destructive cleanup\n' >&2
  exit 1
fi
if smoke_valid_project sentinel-smoke-unique; then
  printf 'FAIL: unsuffixed namespace was accepted\n' >&2
  exit 1
fi
assert smoke_fixture_manifest_safe test/smoke/demo-monitors.json
assert smoke_fixture_manifest_safe test/smoke/status-monitors.json
if smoke_fixture_manifest_safe demo-monitors.json; then
  printf 'FAIL: non-test manifest was accepted\n' >&2
  exit 1
fi

# These command doubles exercise cleanup control flow and never contact Docker.
MOCK_COMPOSE_CALLS=0
MOCK_DOCKER_FAILURE=none
MOCK_COMPOSE_STATUS=0
smoke_docker() {
  local operation=${1:-} subcommand=${2:-} kind format resource
  if [[ $operation == volume || $operation == network ]]; then
    format=${4:-}
    resource=${5:-}
  else
    format=${3:-}
    resource=${4:-}
  fi
  case "$operation:$subcommand" in
    ps:*) kind=ps ;;
    volume:ls) kind=volume ;;
    network:ls) kind=network ;;
    inspect:*) kind=inspect-container ;;
    volume:inspect) kind=inspect-volume ;;
    network:inspect) kind=inspect-network ;;
    *) printf 'unexpected fake Docker call: %s\n' "$*" >&2; return 99 ;;
  esac
  if [[ $MOCK_DOCKER_FAILURE == "$kind" ]]; then return 1; fi
  if [[ $MOCK_DOCKER_FAILURE == "$kind-timeout" ]]; then return 124; fi
  if [[ $MOCK_DOCKER_FAILURE == empty ]]; then return 0; fi
  case "$operation:$subcommand" in
    ps:*) printf 'container-1\n' ;;
    volume:ls) printf 'volume-1\n' ;;
    network:ls) printf 'network-1\n' ;;
    *)
      case "$MOCK_DOCKER_FAILURE" in
        foreign-label) printf 'sentinel-prod\n' ;;
        invalid-label) printf '\n' ;;
        *)
          if [[ $format == *com.docker.compose.service* ]]; then printf 'api\n'; else printf 'sentinel-smoke-unique-123456789abc\n'; fi
          ;;
      esac
      ;;
  esac
}
smoke_compose_down() {
  MOCK_COMPOSE_CALLS=$((MOCK_COMPOSE_CALLS + 1))
  return "$MOCK_COMPOSE_STATUS"
}

MOCK_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/smoke-cleanup-test.XXXXXXXX")
PROJECT=sentinel-smoke-unique-123456789abc

expect_fail_closed() {
  local failure=$1 result=0
  MOCK_DOCKER_FAILURE=$failure
  MOCK_COMPOSE_STATUS=0
  MOCK_COMPOSE_CALLS=0
  if smoke_cleanup_owned_resources "$PROJECT" 0 >"$MOCK_OUTPUT" 2>&1; then result=0; else result=$?; fi
  [[ $result != 0 && $MOCK_COMPOSE_CALLS == 0 ]] || {
    printf 'FAIL: %s did not fail closed (status=%s down_calls=%s)\n' "$failure" "$result" "$MOCK_COMPOSE_CALLS" >&2
    exit 1
  }
  if grep -q 'removed only owned project' "$MOCK_OUTPUT"; then
    printf 'FAIL: %s reported successful cleanup\n' "$failure" >&2
    exit 1
  fi
  grep -q "preserved project resources $PROJECT" "$MOCK_OUTPUT" || {
    printf 'FAIL: %s cleanup diagnostic omitted the project name\n' "$failure" >&2
    exit 1
  }
}

for failure in ps ps-timeout volume volume-timeout network network-timeout; do
  expect_fail_closed "$failure"
done
MOCK_DOCKER_FAILURE=ps MOCK_COMPOSE_CALLS=0
if smoke_cleanup_owned_resources "$PROJECT" 37 >"$MOCK_OUTPUT" 2>&1; then result=0; else result=$?; fi
[[ $result == 37 && $MOCK_COMPOSE_CALLS == 0 ]]
for failure in inspect-container inspect-container-timeout inspect-volume inspect-volume-timeout inspect-network inspect-network-timeout foreign-label invalid-label; do
  expect_fail_closed "$failure"
done

# A failed down is an error; cleanup cannot print a success claim. Preserve a
# pre-existing main failure code instead of replacing it with cleanup's status.
for down_status in 1 124; do
  MOCK_DOCKER_FAILURE=none MOCK_COMPOSE_STATUS=$down_status MOCK_COMPOSE_CALLS=0
  if smoke_cleanup_owned_resources "$PROJECT" 0 >"$MOCK_OUTPUT" 2>&1; then result=0; else result=$?; fi
  [[ $result != 0 && $MOCK_COMPOSE_CALLS == 1 ]]
  ! grep -q 'removed only owned project' "$MOCK_OUTPUT"
  if smoke_cleanup_owned_resources "$PROJECT" 37 >"$MOCK_OUTPUT" 2>&1; then result=0; else result=$?; fi
  [[ $result == 37 ]]
done

# Empty lists are valid only when each list command itself succeeded.
MOCK_DOCKER_FAILURE=empty MOCK_COMPOSE_STATUS=0 MOCK_COMPOSE_CALLS=0
if smoke_cleanup_owned_resources "$PROJECT" 0 >"$MOCK_OUTPUT" 2>&1; then result=0; else result=$?; fi
[[ $result == 0 && $MOCK_COMPOSE_CALLS == 1 ]]
grep -q 'removed only owned project sentinel-smoke-unique-123456789abc' "$MOCK_OUTPUT"

MOCK_DOCKER_FAILURE=none MOCK_COMPOSE_STATUS=0 MOCK_COMPOSE_CALLS=0
if smoke_cleanup_owned_resources "$PROJECT" 0 >"$MOCK_OUTPUT" 2>&1; then result=0; else result=$?; fi
[[ $result == 0 && $MOCK_COMPOSE_CALLS == 1 ]]
grep -q 'removed only owned project sentinel-smoke-unique-123456789abc' "$MOCK_OUTPUT"
printf 'production-smoke helper and cleanup regression tests passed\n'
