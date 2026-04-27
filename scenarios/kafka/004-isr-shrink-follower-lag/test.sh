#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_FILE="$SCRIPT_DIR/.test-inject-output.txt"

sh "$SCRIPT_DIR/inject.sh" >"$OUTPUT_FILE"

urp=$(awk -F ':' '/under_replicated_partitions/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")
producer_error=$(awk -F ':' '/producer_error/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")

if [ -z "${urp:-}" ] || [ -z "${producer_error:-}" ]; then
  echo "FAIL: inject summary missing under_replicated_partitions/producer_error"
  exit 1
fi

if [ "$urp" -le 0 ]; then
  echo "FAIL: expected under_replicated_partitions > 0, got $urp"
  exit 1
fi

if [ "$producer_error" != "NotEnoughReplicasException" ]; then
  echo "FAIL: expected producer_error=NotEnoughReplicasException, got $producer_error"
  exit 1
fi

echo "PASS: ISR shrink observed with producer rejection (urp=$urp, error=$producer_error)"
