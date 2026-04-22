#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_FILE="$SCRIPT_DIR/.test-inject-output.txt"

sh "$SCRIPT_DIR/inject.sh" >"$OUTPUT_FILE"

idle_consumers=$(awk -F ':' '/idle_consumers/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")

if [ -z "${idle_consumers:-}" ]; then
  echo "FAIL: inject summary missing idle_consumers"
  exit 1
fi

if [ "$idle_consumers" -le 0 ]; then
  echo "FAIL: expected idle consumers when partitions are insufficient, got idle_consumers=$idle_consumers"
  exit 1
fi

echo "PASS: partition ceiling observed (idle_consumers=$idle_consumers)"
