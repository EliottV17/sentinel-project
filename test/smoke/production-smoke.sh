#!/usr/bin/env bash
# Isolated production/development Docker smoke. Sourcing this file defines helpers only.
set -euo pipefail

smoke_valid_project() {
  [[ ${1:-} =~ ^sentinel-smoke-unique-[a-f0-9]{12}$ ]]
}

smoke_owned_project() {
  smoke_valid_project "${1:-}" && [[ ${1:-} == "${2:-}" && -n ${3:-} ]]
}

smoke_docker() {
  timeout 5s docker "$@"
}

smoke_compose_down() {
  compose down --volumes --remove-orphans
}

smoke_cleanup_owned_resources() {
  local project=$1 original=$2 ids id label actual vols networks failure=''
  if ! ids=$(smoke_docker ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null); then
    failure='container listing'
  fi
  if [[ -z $failure ]]; then
    for id in $ids; do
      if ! label=$(smoke_docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null); then
        failure='container ownership inspection'
        break
      fi
      if ! actual=$(smoke_docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$id" 2>/dev/null); then
        failure='container service inspection'
        break
      fi
      if ! smoke_owned_project "$project" "$label" "$actual"; then
        failure='container ownership check'
        break
      fi
    done
  fi
  if [[ -z $failure ]]; then
    if ! vols=$(smoke_docker volume ls -q --filter "label=com.docker.compose.project=$project" 2>/dev/null); then
      failure='volume listing'
    else
      for id in $vols; do
        if ! label=$(smoke_docker volume inspect -f '{{ index .Labels "com.docker.compose.project" }}' "$id" 2>/dev/null); then
          failure='volume ownership inspection'
          break
        fi
        if [[ $label != "$project" ]]; then failure='volume ownership check'; break; fi
      done
    fi
  fi
  if [[ -z $failure ]]; then
    if ! networks=$(smoke_docker network ls -q --filter "label=com.docker.compose.project=$project" 2>/dev/null); then
      failure='network listing'
    else
      for id in $networks; do
        if ! label=$(smoke_docker network inspect -f '{{ index .Labels "com.docker.compose.project" }}' "$id" 2>/dev/null); then
          failure='network ownership inspection'
          break
        fi
        if [[ $label != "$project" ]]; then failure='network ownership check'; break; fi
      done
    fi
  fi
  if [[ -z $failure ]]; then
    if smoke_compose_down >/dev/null 2>&1; then
      printf '[cleanup] removed only owned project %s containers/volumes\n' "$project"
    else
      failure='Compose down'
    fi
  fi
  if [[ -n $failure ]]; then
    printf '[cleanup] %s failed; preserved project resources %s\n' "$failure" "$project" >&2
    if ((original != 0)); then return "$original"; fi
    return 1
  fi
  return "$original"
}

smoke_fixture_manifest_safe() {
  local file=${1:-} expected="$PWD/test/smoke/demo-monitors.json"
  case "$file" in
    test/smoke/demo-monitors.json) expected="$PWD/test/smoke/demo-monitors.json" ;;
    test/smoke/status-monitors.json) expected="$PWD/test/smoke/status-monitors.json" ;;
    *) return 1 ;;
  esac
  [[ -f "$expected" ]] || return 1
  jq -e 'type == "array" and length > 0 and all(.[];
    type == "object" and (.name | type == "string" and length > 0) and
    .target == "http://probe.example.test/health" and
    (.seed_key | type == "string" and length > 0) and
    (if has("check_type") then .check_type == "http" and .check_config == {} else true end))' "$expected" >/dev/null
}

smoke_require_tools() {
  local missing=()
  for tool in docker timeout curl jq openssl; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  ((${#missing[@]} == 0)) || { printf 'missing required host tools: %s\n' "${missing[*]}" >&2; return 1; }
  timeout 10s docker compose version >/dev/null
}

smoke_main() {
  mode=prod
  if (($#)); then
    [[ $# == 1 && $1 == --dev ]] || { printf 'usage: %s [--dev]\n' "$0" >&2; return 2; }
    mode=dev
  fi
  smoke_require_tools
  root=$(git -C "$(dirname -- "${BASH_SOURCE[0]}")/../.." rev-parse --show-toplevel)
  cd "$root"
  smoke_fixture_manifest_safe test/smoke/demo-monitors.json || { printf 'unsafe demo fixture\n' >&2; return 1; }
  smoke_fixture_manifest_safe test/smoke/status-monitors.json || { printf 'unsafe status fixture\n' >&2; return 1; }
  suffix=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
  project="sentinel-smoke-unique-$suffix"
  smoke_valid_project "$project" || return 1
  temp=$(mktemp -d "${TMPDIR:-/tmp}/sentinel-smoke.XXXXXXXX")
  worker_paused=0 db_paused=0
  compose_args=(-p "$project" --env-file /dev/null)
  compose_files=()
  compose_env=(
    "PATH=$PATH" "HOME=${HOME:-/}"
    POSTGRES_USER=sentinel POSTGRES_PASSWORD=phase4-compose-example-password POSTGRES_DB=sentinel_db
    DATABASE_URL=postgresql://sentinel:phase4-compose-example-password@db:5432/sentinel_db
    SECRET_KEY=phase4-compose-test-secret-at-least-32-characters
    ALGORITHM=HS256 ACCESS_TOKEN_EXPIRE_MINUTES=30 CORS_ORIGINS=https://localhost:28443
    DEMO_USER_EMAIL=phase4-demo@example.test 'DEMO_USER_PASSWORD=DemoTestPassword123!'
    STATUS_OWNER_EMAIL=phase4-status-owner@example.test SITE_ADDRESS=localhost
    STATUS_CACHE_TTL_SECONDS=1 STATUS_UPTIME_WINDOW_HOURS=24
  )
  ca_file="$temp/public-caddy-root.crt"

  cleanup() {
    local original=$?
    trap - EXIT INT TERM
    set +e
    if [[ -n ${project:-} ]] && smoke_valid_project "$project"; then
      if [[ $mode == prod ]]; then
        if ((worker_paused)); then timeout 10s docker kill --signal=CONT "$worker_id" >/dev/null 2>&1; fi
        if ((db_paused)); then compose unpause db >/dev/null 2>&1; fi
      fi
      smoke_cleanup_owned_resources "$project" "$original"
      original=$?
    fi
    # temp contains only this run's override, public CA and bounded response bodies.
    exit "$original"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  write_override() {
    local target="$1"
    if [[ $mode == prod ]]; then
      cat >"$target" <<EOF
services:
  db:
    environment:
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: phase4-compose-example-password
      POSTGRES_DB: sentinel_db
    networks:
      default:
        aliases: [probe.example.test]
    healthcheck: {interval: 2s, timeout: 2s, retries: 15, start_period: 5s}
  api:
    environment:
      DATABASE_URL: postgresql://sentinel:phase4-compose-example-password@db:5432/sentinel_db
      SECRET_KEY: phase4-compose-test-secret-at-least-32-characters
      ALGORITHM: HS256
      ACCESS_TOKEN_EXPIRE_MINUTES: "30"
      CORS_ORIGINS: https://localhost:28443
      DEMO_USER_EMAIL: phase4-demo@example.test
      DEMO_USER_PASSWORD: DemoTestPassword123!
      STATUS_OWNER_EMAIL: phase4-status-owner@example.test
      STATUS_CACHE_TTL_SECONDS: "1"
    volumes:
      - $root/test/smoke/demo-monitors.json:/app/demo-monitors.json:ro
      - $root/test/smoke/status-monitors.json:/app/status-monitors.json:ro
    healthcheck: {interval: 2s, timeout: 5s, retries: 30, start_period: 120s}
  worker:
    environment:
      DATABASE_URL: postgresql://sentinel:phase4-compose-example-password@db:5432/sentinel_db
      DEMO_USER_EMAIL: phase4-demo@example.test
      WORKER_DB_TIMEOUT_SECONDS: "1"
      WORKER_HEALTH_DB_TIMEOUT_SECONDS: "1"
      WORKER_HEARTBEAT_MAX_AGE_SECONDS: "31"
      CHECK_RESULT_RETENTION_DAYS: "30"
      ALERT_RETENTION_DAYS: "90"
      STATUS_UPTIME_WINDOW_HOURS: "24"
      RETENTION_INTERVAL_MINUTES: "1"
      RETENTION_BATCH_SIZE: "25"
      RETENTION_DB_TIMEOUT_SECONDS: "3"
    volumes:
      - $root/test/smoke/demo-monitors.json:/app/demo-monitors.json:ro
    healthcheck: {interval: 2s, timeout: 2s, retries: 2, start_period: 5s}
  frontend:
    build:
      args:
        VITE_API_BASE_URL: ""
        VITE_DEMO_USER_EMAIL: phase4-demo@example.test
        VITE_DEMO_USER_PASSWORD: DemoTestPassword123!
  caddy:
    environment: {SITE_ADDRESS: localhost}
    ports: !override
      - 127.0.0.1:28080:80
      - 127.0.0.1:28443:443
networks:
  default:
    name: $project
EOF
    else
      cat >"$target" <<EOF
services:
  db:
    container_name: !reset null
    environment: {POSTGRES_USER: sentinel, POSTGRES_PASSWORD: phase4-compose-example-password, POSTGRES_DB: sentinel_db}
    healthcheck: {test: [CMD-SHELL, 'pg_isready -U sentinel -d sentinel_db'], interval: 2s, timeout: 2s, retries: 15}
    ports: !override [127.0.0.1:28081:5432]
    networks:
      default: {aliases: [probe.example.test]}
  api:
    container_name: !reset null
    environment:
      DATABASE_URL: postgresql://sentinel:phase4-compose-example-password@db:5432/sentinel_db
      SECRET_KEY: phase4-compose-test-secret-at-least-32-characters
      ALGORITHM: HS256
      ACCESS_TOKEN_EXPIRE_MINUTES: "30"
      CORS_ORIGINS: http://localhost:28083
      DEMO_USER_EMAIL: phase4-demo@example.test
      DEMO_USER_PASSWORD: DemoTestPassword123!
      STATUS_OWNER_EMAIL: phase4-status-owner@example.test
      DEMO_MONITORS_MANIFEST_PATH: /app/demo-monitors.json
      STATUS_MONITORS_MANIFEST_PATH: /app/status-monitors.json
      STATUS_CACHE_TTL_SECONDS: "1"
    ports: !override [127.0.0.1:28082:8000]
    volumes: !override
      - $root/test/smoke/demo-monitors.json:/app/demo-monitors.json:ro
      - $root/test/smoke/status-monitors.json:/app/status-monitors.json:ro
  worker:
    container_name: !reset null
    environment:
      DATABASE_URL: postgres://sentinel:phase4-compose-example-password@db:5432/sentinel_db
      DEMO_USER_EMAIL: phase4-demo@example.test
      DEMO_MONITORS_MANIFEST_PATH: /app/demo-monitors.json
    volumes: !override [$root/test/smoke/demo-monitors.json:/app/demo-monitors.json:ro]
  frontend:
    container_name: !reset null
    ports: !override [127.0.0.1:28083:80]
    volumes: !reset []
    build:
      args:
        VITE_API_BASE_URL: ""
        VITE_DEMO_USER_EMAIL: phase4-demo@example.test
        VITE_DEMO_USER_PASSWORD: DemoTestPassword123!
        VITE_STATUS_STALE_AFTER_MINUTES: "5"
        VITE_STATUS_DEGRADED_THRESHOLD_PERCENT: "99"
networks:
  default:
    name: $project
EOF
    fi
  }

  if [[ $mode == prod ]]; then
    compose_files=(-f "$root/docker-compose.prod.yml" -f "$temp/override.yml")
    compose_args=(-p "$project" --env-file /dev/null)
  else
    compose_files=(-f "$root/docker-compose.yml" -f "$temp/override.yml")
  fi
  write_override "$temp/override.yml"
  compose config --format json >"$temp/merged.json"
  jq -e 'all(.services[]; (has("env_file") | not))' "$temp/merged.json" >/dev/null
  if [[ $mode == prod ]]; then
    jq -e '[.services[].ports[]? | select(.published != "28080" and .published != "28443")] | length == 0' "$temp/merged.json" >/dev/null
  else
    jq -e '[.services[].ports[]? | select(.host_ip != "127.0.0.1")] | length == 0' "$temp/merged.json" >/dev/null
  fi
  printf '[build] %s images (600s bound; output captured)\n' "$mode"
  if timeout --foreground 600s env -i "${compose_env[@]}" docker compose "${compose_args[@]}" "${compose_files[@]}" build >"$temp/build.log" 2>&1; then
    printf '[PASS] %s images built\n' "$mode"
  else
    local result=$?
    printf '[FAIL] %s image build (last 40 log lines)\n' "$mode" >&2
    tail -n 40 "$temp/build.log" >&2
    return "$result"
  fi
  printf '[start] isolated stack (180s outer / 120s Compose wait; output captured)\n'
  if timeout --foreground 180s env -i "${compose_env[@]}" docker compose "${compose_args[@]}" "${compose_files[@]}" up --no-build -d --wait --wait-timeout 120 >"$temp/start.log" 2>&1; then
    printf '[PASS] Compose readiness completed for isolated %s project\n' "$mode"
  else
    local result=$?
    printf '[FAIL] %s Compose startup (last 40 log lines)\n' "$mode" >&2
    tail -n 40 "$temp/start.log" >&2
    return "$result"
  fi
  stage=ready
  if [[ $mode == prod ]]; then smoke_production_cases; else smoke_development_cases; fi
  printf '[PASS] %s smoke complete for %s\n' "$mode" "$project"
}

smoke_production_cases() {
  local base=https://localhost:28443 code worker_state
  compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$ca_file"
  local deadline=$((SECONDS + 30))
  until curl --silent --show-error --fail --max-time 10 --cacert "$ca_file" "$base/api/v1/health" -o "$temp/health.json" 2>/dev/null; do
    ((SECONDS < deadline)) || { printf 'API readiness deadline expired\n' >&2; return 1; }
    sleep 1
  done
  curl --silent --show-error --fail --max-time 10 --cacert "$ca_file" "$base/api/v1/health" -o "$temp/health.json"
  jq -e '.status == "ok"' "$temp/health.json" >/dev/null
  curl --silent --show-error --fail --max-time 10 --cacert "$ca_file" "$base/api/v1/public/status" -o "$temp/status.json"
  jq -e 'type == "array" and length == 1 and .[0].name == "Smoke Public Probe"' "$temp/status.json" >/dev/null
  curl --silent --show-error --fail --max-time 10 --cacert "$ca_file" "$base/status" -o "$temp/spa.html"
  grep -qi '<div id="root"' "$temp/spa.html"
  local asset
  asset=$(grep -oE '/assets/[^" ]+\.js' "$temp/spa.html" | head -n 1)
  [[ -n $asset ]]
  local headers
  headers=$(curl --silent --show-error --max-time 10 --cacert "$ca_file" -D - -o /dev/null "$base$asset")
  grep -qi 'cache-control:.*immutable' <<<"$headers"
  curl --silent --show-error --max-time 10 --cacert "$ca_file" -D "$temp/security.headers" -o /dev/null "$base/does-not-exist.css"
  grep -qi '^HTTP/.* 404' "$temp/security.headers"
  for header in strict-transport-security x-content-type-options referrer-policy x-frame-options content-security-policy; do
    grep -qi "^$header:" "$temp/security.headers"
  done
  ! grep -Eqi 'example\.com|github\.com|eliottvelarde\.com' "$temp/status.json"

  # Keep legitimate application behavior separate from this route-limit probe.
  for attempt in 1 2 3 4 5; do
    code=$(curl --silent --max-time 10 --cacert "$ca_file" -H "X-Forwarded-For: 198.51.100.$attempt" -H 'content-type: application/json' -d '{"username":"missing-smoke-user@example.test","password":"not-a-real-password"}' -o /dev/null -w '%{http_code}' "$base/api/v1/auth/login")
    [[ $code != 429 ]] || { printf 'auth limit fired before configured request 6\n' >&2; return 1; }
  done
  code=$(curl --silent --max-time 10 --cacert "$ca_file" -H 'X-Forwarded-For: 203.0.113.99' -H 'content-type: application/json' -d '{"username":"missing-smoke-user@example.test","password":"not-a-real-password"}' -o "$temp/rate.body" -w '%{http_code}' "$base/api/v1/auth/login")
  [[ $code == 429 ]] || { printf 'forged XFF bypassed auth throttle (status %s)\n' "$code" >&2; return 1; }
  ! grep -Eq 'token|secret|password' "$temp/rate.body"
  smoke_wait_private_probe_results
  printf '[PASS] TLS, API/public status, SPA/assets/404/security headers, forged-XFF throttle and private-target SSRF behavior\n'

  # Worker health is an operational poll-progress signal, not target reachability.
  worker_id=$(compose ps -q worker)
  worker_paused=1
  timeout 10s docker kill --signal=STOP "$worker_id" >/dev/null
  local deadline=$((SECONDS + 38))
  while :; do
    worker_state=$(timeout 5s docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_id")
    [[ $worker_state == unhealthy ]] && break
    ((SECONDS < deadline)) || { printf 'stalled worker did not become unhealthy\n' >&2; return 1; }
    sleep 1
  done
  timeout 10s docker kill --signal=CONT "$worker_id" >/dev/null
  worker_paused=0
  deadline=$((SECONDS + 40))
  smoke_wait_worker healthy "$deadline"
  compose stop worker >/dev/null
  [[ $(timeout 5s docker inspect -f '{{.State.Status}}' "$worker_id") == exited ]]
  compose start worker >/dev/null
  smoke_wait_worker healthy "$((SECONDS + 40))"
  printf '[PASS] worker stale heartbeat, SIGCONT recovery, explicit stop/exited and restart\n'

  db_paused=1
  compose pause db >/dev/null
  deadline=$((SECONDS + 25))
  while :; do
    worker_state=$(timeout 5s docker inspect -f '{{.State.Health.Status}}' "$worker_id")
    [[ $worker_state == unhealthy ]] && break
    ((SECONDS < deadline)) || { printf 'worker remained healthy with paused DB\n' >&2; return 1; }
    sleep 1
  done
  compose unpause db >/dev/null
  db_paused=0
  smoke_wait_worker healthy "$((SECONDS + 40))"
  printf '[PASS] paused-database worker health failure and recovery\n'

  smoke_retention_http_case "$base"
}

smoke_wait_private_probe_results() {
  local deadline=$((SECONDS + 30)) count
  while :; do
    count=$(compose exec -T db psql -U sentinel -d sentinel_db -Atqc "SELECT COUNT(*) FROM monitor m JOIN users u ON u.id=m.user_id WHERE m.last_state='unhealthy' AND ((u.email='phase4-demo@example.test' AND m.seed_key='smoke-demo-primary') OR (u.email='phase4-status-owner@example.test' AND m.seed_key='smoke-status-primary')) AND EXISTS (SELECT 1 FROM check_result cr WHERE cr.monitor_id=m.id AND cr.state='unhealthy')")
    [[ $count == 2 ]] && break
    ((SECONDS < deadline)) || { printf 'private Docker-alias probes did not persist unhealthy results before deadline\n' >&2; return 1; }
    sleep 1
  done
  smoke_wait_worker healthy "$((SECONDS + 5))"
  printf '[PASS] private alias probes persisted unhealthy check results while worker heartbeat remained healthy; no public targets\n'
}

smoke_wait_worker() {
  local expected=$1 deadline=$2 id state
  id=$(compose ps -q worker)
  while :; do
    state=$(timeout 5s docker inspect -f '{{.State.Health.Status}}' "$id")
    [[ $state == "$expected" ]] && return 0
    ((SECONDS < deadline)) || { printf 'worker health deadline expired (expected %s, got %s)\n' "$expected" "$state" >&2; return 1; }
    sleep 1
  done
}

smoke_retention_http_case() {
  local base=$1 id before after counts monitor_id
  id=$(compose ps -q worker)
  worker_paused=1
  worker_id=$id
  timeout 10s docker kill --signal=STOP "$id" >/dev/null
  monitor_id=$(compose exec -T db psql -U sentinel -d sentinel_db -Atqc "SELECT m.id FROM monitor m JOIN users u ON u.id=m.user_id WHERE m.seed_key='smoke-status-primary' AND u.email='phase4-status-owner@example.test'")
  [[ $monitor_id =~ ^[0-9]+$ ]]
  compose exec -T db psql -v ON_ERROR_STOP=1 -U sentinel -d sentinel_db -Atqc "DELETE FROM alert WHERE monitor_id=$monitor_id; DELETE FROM check_result WHERE monitor_id=$monitor_id; UPDATE monitor SET frequency=86400,last_state='healthy',last_checked_at=NOW(),consecutive_failures=0 WHERE id=$monitor_id; INSERT INTO check_result(monitor_id,state,created_at) VALUES ($monitor_id,'healthy',NOW()-INTERVAL '1 hour'),($monitor_id,'healthy',NOW()-INTERVAL '2 hours'),($monitor_id,'unhealthy',NOW()-INTERVAL '3 hours'),($monitor_id,'healthy',NOW()-INTERVAL '31 days'),($monitor_id,'unhealthy',NOW()-INTERVAL '32 days'); INSERT INTO alert(monitor_id,alert_type,message,created_at) VALUES ($monitor_id,'down','smoke old',NOW()-INTERVAL '91 days'),($monitor_id,'recovery','smoke recent',NOW()-INTERVAL '1 hour');" >/dev/null
  sleep 2
  curl --silent --show-error --max-time 10 --cacert "$ca_file" "$base/api/v1/public/status" -o "$temp/status-before.json"
  before=$(jq -c --argjson id "$monitor_id" '[.[] | select(.name == "Smoke Public Probe") | {name,last_state,uptime_percentage,last_checked_at}]' "$temp/status-before.json")
  [[ $(jq -r '.[0].uptime_percentage' <<<"$before") == 66.66666666666667* ]] || [[ $(jq -r '.[0].uptime_percentage' <<<"$before") == 66.67 ]]
  printf '[retention] fixture monitor %s; inserted 2 old/3 recent checks and 1 old/1 recent alerts\n' "$monitor_id"
  timeout 10s docker kill --signal=CONT "$id" >/dev/null
  worker_paused=0
  local deadline=$((SECONDS + 75))
  while :; do
    counts=$(compose exec -T db psql -U sentinel -d sentinel_db -Atqc "SELECT (SELECT COUNT(*) FROM check_result WHERE monitor_id=$monitor_id AND created_at < NOW()-INTERVAL '30 days') || ':' || (SELECT COUNT(*) FROM alert WHERE monitor_id=$monitor_id AND created_at < NOW()-INTERVAL '90 days')")
    [[ $counts == 0:0 ]] && break
    ((SECONDS < deadline)) || { printf 'retention did not delete old fixture rows (remaining %s)\n' "$counts" >&2; return 1; }
    sleep 2
  done
  [[ $(compose exec -T db psql -U sentinel -d sentinel_db -Atqc "SELECT COUNT(*) FROM check_result WHERE monitor_id=$monitor_id AND created_at >= NOW()-INTERVAL '24 hours'") == 3 ]]
  [[ $(compose exec -T db psql -U sentinel -d sentinel_db -Atqc "SELECT COUNT(*) FROM alert WHERE monitor_id=$monitor_id AND created_at >= NOW()-INTERVAL '90 days'") == 1 ]]
  [[ $(compose exec -T db psql -U sentinel -d sentinel_db -Atqc "SELECT last_state || ':' || (last_checked_at IS NOT NULL)::text FROM monitor WHERE id=$monitor_id") == healthy:true ]]
  sleep 2
  curl --silent --show-error --max-time 10 --cacert "$ca_file" "$base/api/v1/public/status" -o "$temp/status-after.json"
  after=$(jq -c '[.[] | select(.name == "Smoke Public Probe") | {name,last_state,uptime_percentage,last_checked_at}]' "$temp/status-after.json")
  [[ $before == "$after" ]]
  printf '[PASS] retention deleted 2 old checks + 1 old alert; preserved 3 recent checks + 1 recent alert, monitor state and HTTP uptime\n'
}

smoke_development_cases() {
  local deadline=$((SECONDS + 150)) code
  until code=$(curl --silent --max-time 10 -o "$temp/dev-health.json" -w '%{http_code}' http://127.0.0.1:28082/api/v1/health) && [[ $code == 200 ]]; do
    ((SECONDS < deadline)) || { printf 'development API readiness deadline expired\n' >&2; return 1; }
    sleep 2
  done
  jq -e '.status == "ok"' "$temp/dev-health.json" >/dev/null
  local worker_id
  worker_id=$(compose ps -q worker)
  [[ $(timeout 5s docker inspect -f '{{.State.Status}}' "$worker_id") == running ]]
  curl --silent --show-error --fail --max-time 10 http://127.0.0.1:28082/api/v1/public/status -o "$temp/dev-status.json"
  jq -e 'type == "array" and length == 1 and .[0].name == "Smoke Public Probe"' "$temp/dev-status.json" >/dev/null
  curl --silent --show-error --fail --max-time 10 http://127.0.0.1:28083/status -o "$temp/dev-spa.html"
  grep -qi '<div id="root"' "$temp/dev-spa.html"
  printf '[PASS] controlled original development Compose API, public status and frontend; fixtures mounted read-only\n'
}

compose() {
  timeout --foreground 15s env -i "${compose_env[@]}" docker compose "${compose_args[@]}" "${compose_files[@]}" "$@"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  smoke_main "$@"
fi
