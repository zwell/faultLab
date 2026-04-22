#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_FILE="$SCRIPT_DIR/.test-inject-output.txt"

sh "$SCRIPT_DIR/inject.sh" >"$OUTPUT_FILE"

lag_before=$(awk -F ':' '/lag_before/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")
lag_after=$(awk -F ':' '/lag_after/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")

if [ -z "${lag_before:-}" ] || [ -z "${lag_after:-}" ]; then
  echo "FAIL: inject summary missing lag_before/lag_after"
  exit 1
fi

if [ "$lag_after" -le "$lag_before" ]; then
  echo "FAIL: expected lag increase, but lag_after <= lag_before ($lag_after <= $lag_before)"
  exit 1
fi

echo "PASS: rebalance storm signal observed (lag_before=$lag_before, lag_after=$lag_after)"
