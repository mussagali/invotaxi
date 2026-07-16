#!/usr/bin/env bash
set -Eeuo pipefail

# Git Bash on Windows must not rewrite container paths such as /scripts/day_peak.js.
export MSYS_NO_PATHCONV=1
export PYTHONUTF8=1
export COMPOSE_PROGRESS="${COMPOSE_PROGRESS:-plain}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RESULTS_DIR="$ROOT_DIR/loadtest/results"
mkdir -p "$RESULTS_DIR"

LOCK_DIR="$ROOT_DIR/.p9-matrix.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "another P9 matrix is already running ($LOCK_DIR exists)" >&2
  exit 2
fi

ACTIVE_PROJECT=""
ACTIVE_LIMITS=""

cleanup_on_exit() {
  if [[ -n "$ACTIVE_PROJECT" && -n "$ACTIVE_LIMITS" ]]; then
    local -a active_compose=(
      docker compose --project-name "$ACTIVE_PROJECT"
      -f docker-compose.yml
      -f docker-compose.prod.yml
      -f docker-compose.monitoring.yml
      -f loadtest/internal-only.yml
      -f "$ACTIVE_LIMITS"
    )
    "${active_compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
    local ids
    ids="$(docker ps -aq --filter "label=com.docker.compose.project=$ACTIVE_PROJECT")"
    if [[ -n "$ids" ]]; then
      # All IDs are restricted to the unique P9 compose project label.
      # shellcheck disable=SC2086
      docker rm -f $ids >/dev/null 2>&1 || true
    fi
  fi
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}

trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

TEST_DURATION="${TEST_DURATION:-30m}"
RAMP_DURATION="${RAMP_DURATION:-3m}"
STEADY_DURATION="${STEADY_DURATION:-27m}"
DISPATCH_DELAY="${DISPATCH_DELAY:-10m}"
DISPATCH_MAX_DURATION="${DISPATCH_MAX_DURATION:-20m}"
PROFILES="${PROFILES:-2cpu-4g 4cpu-8g}"
PYTHON_BIN="${PYTHON_BIN:-python}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 2
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "$PYTHON_BIN is required" >&2
  exit 2
fi
if [[ ! -f .env ]]; then
  echo ".env is required; copy .env.example and set secrets first" >&2
  exit 2
fi

run_profile() {
  local profile="$1"
  local resources="$2"
  local limits_file="$3"
  local project="invotaxi-p9-${profile}"
  local summary="$RESULTS_DIR/${profile}-summary.json"
  local stats="$RESULTS_DIR/${profile}-docker-stats.jsonl"
  local dispatch="$RESULTS_DIR/${profile}-dispatch.tsv"
  local log="$RESULTS_DIR/${profile}-k6.log"
  local report="$RESULTS_DIR/${profile}.md"
  local sampler_pid=""
  local k6_exit=1
  local started_at

  local -a compose=(
    docker compose --project-name "$project"
    -f docker-compose.yml
    -f docker-compose.prod.yml
    -f docker-compose.monitoring.yml
    -f loadtest/internal-only.yml
    -f "$limits_file"
  )
  ACTIVE_PROJECT="$project"
  ACTIVE_LIMITS="$limits_file"

  cleanup_profile() {
    if [[ -n "$sampler_pid" ]]; then
      kill "$sampler_pid" >/dev/null 2>&1 || true
      wait "$sampler_pid" >/dev/null 2>&1 || true
    fi
    if [[ "${KEEP_P9_STACK:-0}" != "1" ]]; then
      "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
    fi
    ACTIVE_PROJECT=""
    ACTIVE_LIMITS=""
  }
  trap cleanup_profile RETURN

  rm -f "$summary" "$stats" "$dispatch" "$log" "$report"
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  "${compose[@]}" build api worker
  "${compose[@]}" up -d postgres redis

  # Docker Desktop can briefly report a healthy container before its bridge
  # network accepts connections. Retry the migration so this infrastructure
  # race cannot invalidate a 60-minute matrix run.
  local migrated=0
  for _ in {1..10}; do
    if "${compose[@]}" run --rm api alembic upgrade head; then
      migrated=1
      break
    fi
    sleep 3
  done
  if [[ "$migrated" != "1" ]]; then
    "${compose[@]}" logs --tail=200 postgres
    echo "PostgreSQL did not become ready for $profile" >&2
    return 1
  fi
  "${compose[@]}" run --rm api python scripts/seed_load.py
  "${compose[@]}" up -d api worker cadvisor node-exporter postgres-exporter redis-exporter prometheus grafana

  local ready=0
  for _ in {1..60}; do
    if "${compose[@]}" exec -T api python -c \
      "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=2)" \
      >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != "1" ]]; then
    "${compose[@]}" ps
    "${compose[@]}" logs --tail=200 api worker
    echo "API did not become ready for $profile" >&2
    return 1
  fi

  # Validate that the provisioned dashboard is discoverable before applying load.
  local grafana_ready=0
  for _ in {1..60}; do
    if "${compose[@]}" exec -T api python -c \
      "import urllib.request; urllib.request.urlopen('http://grafana:3000/api/health', timeout=2)" \
      >/dev/null 2>&1; then
      grafana_ready=1
      break
    fi
    sleep 2
  done
  if [[ "$grafana_ready" != "1" ]]; then
    "${compose[@]}" logs --tail=200 grafana prometheus
    echo "Grafana did not become ready for $profile" >&2
    return 1
  fi
  local grafana_user grafana_password
  grafana_user="$("${compose[@]}" exec -T grafana printenv GF_SECURITY_ADMIN_USER | tr -d '\r')"
  grafana_password="$("${compose[@]}" exec -T grafana printenv GF_SECURITY_ADMIN_PASSWORD | tr -d '\r')"
  "${compose[@]}" exec -T \
    -e P9_GF_USER="$grafana_user" -e P9_GF_PASSWORD="$grafana_password" api python -c \
    "import base64,json,os,urllib.request; raw=f'{os.environ[\"P9_GF_USER\"]}:{os.environ[\"P9_GF_PASSWORD\"]}'.encode(); r=urllib.request.Request('http://grafana:3000/api/search?query=InvoTaxi',headers={'Authorization':'Basic '+base64.b64encode(raw).decode()}); assert any(x.get('uid') == 'invotaxi-p9' for x in json.load(urllib.request.urlopen(r,timeout=10)))" \
    >/dev/null

  # Prometheus must accept the rules and scrape every required target.
  local prometheus_ready=0
  for _ in {1..30}; do
    if "${compose[@]}" exec -T api python -c \
      "import json,urllib.request; rules=json.load(urllib.request.urlopen('http://prometheus:9090/api/v1/rules',timeout=3)); names={r['name'] for g in rules['data']['groups'] for r in g['rules']}; assert {'ApiP95LatencyHigh','ApiErrorRateHigh','HostDiskUsageHigh','DispatchJobTooSlow'} <= names; targets=json.load(urllib.request.urlopen('http://prometheus:9090/api/v1/targets',timeout=3)); required={'invotaxi-api','invotaxi-worker','cadvisor','node','postgres','redis'}; health={x['labels']['job']:x['health'] for x in targets['data']['activeTargets']}; assert all(health.get(x) == 'up' for x in required)" \
      >/dev/null 2>&1; then
      prometheus_ready=1
      break
    fi
    sleep 2
  done
  if [[ "$prometheus_ready" != "1" ]]; then
    "${compose[@]}" logs --tail=200 prometheus
    echo "Prometheus rules or targets are not ready for $profile" >&2
    return 1
  fi

  (
    while true; do
      local now ids
      now="$(date +%s)"
      ids="$("${compose[@]}" ps -q api worker postgres redis | tr '\n' ' ')"
      if [[ -n "$ids" ]]; then
        # shellcheck disable=SC2086
        docker stats --no-stream --format '{{json .}}' $ids | while IFS= read -r row; do
          printf '%s\t%s\n' "$now" "$row"
        done >>"$stats"
      fi
      sleep 5
    done
  ) &
  sampler_pid=$!

  started_at="$(date +%s)"
  set +e
  "${compose[@]}" run --rm --no-deps \
    -e TEST_DURATION="$TEST_DURATION" \
    -e RAMP_DURATION="$RAMP_DURATION" \
    -e STEADY_DURATION="$STEADY_DURATION" \
    -e DISPATCH_DELAY="$DISPATCH_DELAY" \
    -e DISPATCH_MAX_DURATION="$DISPATCH_MAX_DURATION" \
    -e VUS="${VUS:-}" \
    -e DRIVERS_VU="${DRIVERS_VU:-}" \
    -e CLIENTS_VU="${CLIENTS_VU:-}" \
    -e DISPATCHER_RPM="${DISPATCHER_RPM:-}" \
    -e LOGIN_ACCOUNT_POOL="${LOGIN_ACCOUNT_POOL:-}" \
    -e DATASET="${DATASET:-load}" \
    -e BASE_URL="${BASE_URL:-http://api:8000}" \
    -e WS_URL="${WS_URL:-ws://api:8000}" \
    k6 run --quiet --summary-export "/results/${profile}-summary.json" /scripts/day_peak.js \
    >"$log" 2>&1
  k6_exit=$?
  set -e

  kill "$sampler_pid" >/dev/null 2>&1 || true
  wait "$sampler_pid" >/dev/null 2>&1 || true
  sampler_pid=""

  "${compose[@]}" exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -c "$1"' sh \
    "select status, coalesce(extract(epoch from (finished_at-started_at)),0), coalesce((result_stats->>'total_orders')::int,0) from routing_jobs order by created_at desc limit 1" \
    >"$dispatch"

  set +e
  "$PYTHON_BIN" loadtest/render_results.py \
    --profile "$profile" \
    --resources "$resources" \
    --summary "loadtest/results/${profile}-summary.json" \
    --stats "loadtest/results/${profile}-docker-stats.jsonl" \
    --dispatch "loadtest/results/${profile}-dispatch.tsv" \
    --started-at "$started_at" \
    --ramp-duration "$RAMP_DURATION" \
    --test-duration "$TEST_DURATION" \
    --steady-duration "$STEADY_DURATION" \
    --k6-exit "$k6_exit" \
    >"$report"
  local render_exit=$?
  set -e
  if [[ "$render_exit" != "0" ]]; then
    overall=1
  fi
  return 0
}

overall=0
if [[ " $PROFILES " == *" 2cpu-4g "* ]]; then
  run_profile "2cpu-4g" "2 vCPU / 4 GiB" "loadtest/limits-2cpu-4g.yml"
fi
if [[ " $PROFILES " == *" 4cpu-8g "* ]]; then
  run_profile "4cpu-8g" "4 vCPU / 8 GiB" "loadtest/limits-4cpu-8g.yml"
fi

"$PYTHON_BIN" loadtest/render_conclusion.py \
  "loadtest/results/2cpu-4g.md" "loadtest/results/4cpu-8g.md" \
  >loadtest/CONCLUSION.md

exit "$overall"
