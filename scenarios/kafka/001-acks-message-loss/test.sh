#!/bin/sh
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_FILE="$SCRIPT_DIR/.test-inject-output.txt"

sh "$SCRIPT_DIR/inject.sh" >"$OUTPUT_FILE"

produced=$(awk -F ':' '/produced_count/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")
recovered=$(awk -F ':' '/recovered_count/ {gsub(/ /, "", $2); print $2}' "$OUTPUT_FILE")

if [ -z "${produced:-}" ] || [ -z "${recovered:-}" ]; then
  echo "FAIL: inject summary missing produced_count/recovered_count"
  exit 1
fi

if [ "$recovered" -ge "$produced" ]; then
  echo "FAIL: expected data loss signal, but recovered_count >= produced_count ($recovered >= $produced)"
  exit 1
fi

echo "PASS: data loss observed (produced=$produced, recovered=$recovered)"
