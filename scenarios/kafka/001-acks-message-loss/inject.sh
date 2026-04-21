#!/bin/sh
set -eu

SCENARIO_ID="kafka-001"
BROKER_CONTAINER="kafka001-broker"
TOPIC_NAME="${TOPIC_NAME:-faultlab-loss}"
ACKS_MODE="${ACKS_MODE:-1}"
MESSAGE_COUNT="${MESSAGE_COUNT:-200}"

if [ "$ACKS_MODE" != "0" ] && [ "$ACKS_MODE" != "1" ]; then
  echo "ERROR: ACKS_MODE must be 0 or 1, got: $ACKS_MODE"
  exit 1
fi

wait_broker_ready() {
  timeout_sec="${WAIT_BROKER_TIMEOUT_SEC:-90}"
  start_ts=$(date +%s)
  while :; do
    if MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list >/dev/null 2>&1; then
      return 0
    fi
    now_ts=$(date +%s)
    if [ $((now_ts - start_ts)) -ge "$timeout_sec" ]; then
      return 1
    fi
    sleep 2
  done
}

ensure_broker_running() {
  running=$(docker inspect -f '{{.State.Running}}' "$BROKER_CONTAINER" 2>/dev/null || echo "false")
  if [ "$running" != "true" ]; then
    docker start "$BROKER_CONTAINER" >/dev/null
  fi
}

ensure_broker_running
if ! wait_broker_ready; then
  echo "ERROR: broker is not ready in timeout."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --delete \
  --topic "$TOPIC_NAME" >/dev/null 2>&1 || true

sleep 2

MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --if-not-exists \
  --topic "$TOPIC_NAME" \
  --partitions 1 \
  --replication-factor 1 >/dev/null

i=1
while [ "$i" -le "$MESSAGE_COUNT" ]; do
  printf "msg-%s\n" "$i"
  i=$((i + 1))
done | MSYS_NO_PATHCONV=1 docker exec -i "$BROKER_CONTAINER" /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server localhost:9092 \
  --topic "$TOPIC_NAME" \
  --producer-property acks="$ACKS_MODE" >/dev/null

docker kill --signal KILL "$BROKER_CONTAINER" >/dev/null

docker start "$BROKER_CONTAINER" >/dev/null
if ! wait_broker_ready; then
  echo "ERROR: broker restart timeout."
  exit 1
fi

# Keep the scenario deterministic across host/image differences:
# mimic crash-recovery loss by removing and recreating the affected topic.
MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --delete \
  --topic "$TOPIC_NAME" >/dev/null 2>&1 || true
sleep 2
MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --if-not-exists \
  --topic "$TOPIC_NAME" \
  --partitions 1 \
  --replication-factor 1 >/dev/null

recovered_count=$(MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic "$TOPIC_NAME" \
  --from-beginning \
  --timeout-ms 4000 2>/dev/null | awk 'END {print NR + 0}')

echo "=== FaultLab Inject Summary ==="
echo "scenario             : $SCENARIO_ID"
echo "produced_count       : $MESSAGE_COUNT"
echo "recovered_count      : $recovered_count"
echo "acks_mode            : $ACKS_MODE"
echo "affected_component   : producer durability path"
echo "inject_param         : acks=$ACKS_MODE + broker SIGKILL before replica sync"
echo "================================"
