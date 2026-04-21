#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
FAULTLAB_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
SCENARIOS_DIR="$FAULTLAB_ROOT/scenarios"

usage() {
  cat <<'EOF'
Usage:
  ./cli/faultlab.sh <start|inject|verify|clean>

Required environment variable:
  FAULTLAB_SCENARIO=scenarios/<tech>/<id>

Examples:
  FAULTLAB_SCENARIO=scenarios/kafka/001-rebalance-slow-timeout ./cli/faultlab.sh start
  FAULTLAB_SCENARIO=scenarios/kafka/001-rebalance-slow-timeout ./cli/faultlab.sh inject
EOF
}

resolve_scenario_dir() {
  if [ "${FAULTLAB_SCENARIO:-}" = "" ]; then
    echo "ERROR: FAULTLAB_SCENARIO is not set."
    echo "Set it like: FAULTLAB_SCENARIO=scenarios/kafka/001-rebalance-slow-timeout"
    exit 1
  fi

  case "$FAULTLAB_SCENARIO" in
    scenarios/*) SCENARIO_DIR="$FAULTLAB_ROOT/$FAULTLAB_SCENARIO" ;;
    *) SCENARIO_DIR="$FAULTLAB_ROOT/scenarios/$FAULTLAB_SCENARIO" ;;
  esac

  if [ ! -d "$SCENARIO_DIR" ]; then
    echo "ERROR: Scenario directory not found: $SCENARIO_DIR"
    exit 1
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker is not installed or not in PATH."
    exit 1
  fi
  if ! docker version >/dev/null 2>&1; then
    echo "ERROR: docker daemon is not available."
    exit 1
  fi
}

compose_file() {
  COMPOSE_FILE="$SCENARIO_DIR/docker-compose.yml"
  if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: docker-compose.yml not found in $SCENARIO_DIR"
    exit 1
  fi
}

compose_project_name() {
  SCENARIO_BASENAME=$(basename "$SCENARIO_DIR")
  COMPOSE_PROJECT="faultlab-${SCENARIO_BASENAME}"
}

detect_compose_images_if_needed() {
  # Generic image detector:
  # Parse docker-compose image templates like ${VAR:-repo:tag}.
  # If VAR is unset, try local default image first, then pull it.
  unresolved=0
  found_any=0

  while IFS="$(printf '\t')" read -r var_name default_image; do
    [ -n "${var_name:-}" ] || continue
    [ -n "${default_image:-}" ] || continue
    found_any=1

    eval "current_value=\${$var_name:-}"
    if [ "$current_value" != "" ]; then
      continue
    fi

    if docker image inspect "$default_image" >/dev/null 2>&1; then
      eval "$var_name=\$default_image"
      eval "export $var_name"
      echo "[faultlab] selected local image for $var_name: $default_image"
      continue
    fi

    default_repo=$(printf "%s" "$default_image" | awk -F: '{print $1}')
    fallback_local_image=$(
      docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | awk -v repo="$default_repo" '$0 ~ ("^" repo ":") && $0 !~ /:<none>$/ {print; exit}'
    )
    if [ "${fallback_local_image:-}" != "" ]; then
      eval "$var_name=\$fallback_local_image"
      eval "export $var_name"
      echo "[faultlab] selected local fallback image for $var_name: $fallback_local_image"
      continue
    fi

    if docker pull "$default_image" >/dev/null 2>&1; then
      eval "$var_name=\$default_image"
      eval "export $var_name"
      echo "[faultlab] selected pulled image for $var_name: $default_image"
      continue
    fi

    echo "[faultlab] failed to prepare image for $var_name: $default_image"
    unresolved=1
  done <<EOF
$(awk '
  {
    line=$0
    while (match(line, /\$\{[A-Za-z_][A-Za-z0-9_]*:-[^}]+\}/)) {
      token=substr(line, RSTART + 2, RLENGTH - 3)
      split(token, pair, ":-")
      if (length(pair[1]) > 0 && length(pair[2]) > 0) {
        printf "%s\t%s\n", pair[1], pair[2]
      }
      line=substr(line, RSTART + RLENGTH)
    }
  }
' "$COMPOSE_FILE" | awk '!seen[$0]++')
EOF

  if [ "$found_any" -eq 1 ] && [ "$unresolved" -ne 0 ]; then
    echo "ERROR: one or more compose default images are unavailable."
    echo "Set corresponding image env vars manually and retry."
    exit 1
  fi
}

wait_for_health() {
  # Wait for health checks when present. Containers without healthchecks are treated as running.
  timeout_sec="${WAIT_TIMEOUT_SEC:-120}"
  start_ts=$(date +%s)

  while :; do
    all_ready=1
    container_ids=$(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" ps -q 2>/dev/null || true)

    if [ -z "$container_ids" ]; then
      all_ready=0
    else
      for cid in $container_ids; do
        running=$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo "false")
        if [ "$running" != "true" ]; then
          all_ready=0
          break
        fi

        health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "unknown")
        if [ "$health" = "starting" ] || [ "$health" = "unhealthy" ] || [ "$health" = "unknown" ]; then
          all_ready=0
          break
        fi
      done
    fi

    if [ "$all_ready" -eq 1 ]; then
      return 0
    fi

    now_ts=$(date +%s)
    elapsed=$((now_ts - start_ts))
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      return 1
    fi
    sleep 2
  done
}

cmd_start() {
  require_docker
  resolve_scenario_dir
  compose_file
  compose_project_name
  detect_compose_images_if_needed

  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] start: docker compose up -d"
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d

  echo "[faultlab] waiting containers to be ready..."
  if wait_for_health; then
    echo "✅ Environment ready"
  else
    echo "⚠️ Environment started but not fully healthy in timeout."
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" ps
    exit 1
  fi
}

cmd_inject() {
  resolve_scenario_dir
  INJECT_SCRIPT="$SCENARIO_DIR/inject.sh"
  if [ ! -f "$INJECT_SCRIPT" ]; then
    echo "ERROR: inject.sh not found in $SCENARIO_DIR"
    exit 1
  fi
  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] inject: $INJECT_SCRIPT"
  (cd "$SCENARIO_DIR" && sh "$INJECT_SCRIPT")
}

cmd_verify() {
  resolve_scenario_dir
  SOLUTION_FILE="$SCENARIO_DIR/SOLUTION.md"
  if [ ! -f "$SOLUTION_FILE" ]; then
    echo "ERROR: SOLUTION.md not found in $SCENARIO_DIR"
    exit 1
  fi

  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] verify is handled by outer module."
  echo "[faultlab] solution reference: $SOLUTION_FILE"
  echo
  echo "Please describe your root cause analysis and fix plan to the verify module."
}

cmd_clean() {
  require_docker
  resolve_scenario_dir
  compose_file
  compose_project_name

  echo "[faultlab] scenario: $FAULTLAB_SCENARIO"
  echo "[faultlab] clean: docker compose down -v --remove-orphans"
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" down -v --remove-orphans
}

if [ "$#" -ne 1 ]; then
  usage
  exit 1
fi

case "$1" in
  start) cmd_start ;;
  inject) cmd_inject ;;
  verify) cmd_verify ;;
  clean) cmd_clean ;;
  -h|--help|help) usage ;;
  *)
    echo "ERROR: unknown command: $1"
    usage
    exit 1
    ;;
esac
