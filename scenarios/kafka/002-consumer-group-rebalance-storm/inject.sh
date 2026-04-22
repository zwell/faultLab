#!/bin/sh
set -eu

SCENARIO_ID="kafka-002"
BROKER_CONTAINER="kafka002-broker"
TOPIC_NAME="${TOPIC_NAME:-faultlab-rebalance}"
GROUP_ID="${GROUP_ID:-faultlab-rebalance-group}"
PARTITIONS="${PARTITIONS:-3}"
BASELINE_MESSAGES="${BASELINE_MESSAGES:-300}"
STORM_ROUNDS="${STORM_ROUNDS:-12}"
MESSAGES_PER_ROUND="${MESSAGES_PER_ROUND:-80}"
WAIT_GROUP_TIMEOUT_SEC="${WAIT_GROUP_TIMEOUT_SEC:-60}"

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

produce_messages() {
  count="$1"
  start_idx="$2"
  end_idx=$((start_idx + count - 1))
  i="$start_idx"
  while [ "$i" -le "$end_idx" ]; do
    printf "msg-%s\n" "$i"
    i=$((i + 1))
  done | MSYS_NO_PATHCONV=1 docker exec -i "$BROKER_CONTAINER" /opt/kafka/bin/kafka-console-producer.sh \
    --bootstrap-server localhost:9092 \
    --topic "$TOPIC_NAME" >/dev/null
}

get_total_lag() {
  MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-consumer-groups.sh \
    --bootstrap-server localhost:9092 \
    --describe \
    --group "$GROUP_ID" 2>/dev/null \
  | awk '
      BEGIN {sum=0}
      /^TOPIC/ {next}
      NF == 0 {next}
      {
        lag=$5
        if (lag ~ /^[0-9]+$/) {
          sum += lag
        }
      }
      END {print sum + 0}
    '
}

wait_group_created() {
  start_ts=$(date +%s)
  while :; do
    if MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-consumer-groups.sh \
      --bootstrap-server localhost:9092 \
      --describe \
      --group "$GROUP_ID" >/dev/null 2>&1; then
      return 0
    fi

    now_ts=$(date +%s)
    if [ $((now_ts - start_ts)) -ge "$WAIT_GROUP_TIMEOUT_SEC" ]; then
      return 1
    fi
    sleep 1
  done
}

ensure_broker_running
if ! wait_broker_ready; then
  echo "ERROR: broker is not ready in timeout."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --delete \
  --group "$GROUP_ID" >/dev/null 2>&1 || true

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
  --partitions "$PARTITIONS" \
  --replication-factor 1 >/dev/null

produce_messages "$BASELINE_MESSAGES" 1

MSYS_NO_PATHCONV=1 docker exec -d "$BROKER_CONTAINER" /bin/sh -c \
  "/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic $TOPIC_NAME --group $GROUP_ID --from-beginning --consumer-property auto.offset.reset=earliest --consumer-property enable.auto.commit=true > /tmp/faultlab-stable-consumer.log 2>&1"

if ! wait_group_created; then
  echo "ERROR: consumer group was not created in timeout."
  exit 1
fi

sleep 2
lag_before=$(get_total_lag)

msg_index=$((BASELINE_MESSAGES + 1))
round=1
while [ "$round" -le "$STORM_ROUNDS" ]; do
  MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /bin/sh -c \
    "/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic $TOPIC_NAME --group $GROUP_ID --consumer-property auto.offset.reset=latest --consumer-property enable.auto.commit=false --timeout-ms 900 >/dev/null 2>&1 || true"

  produce_messages "$MESSAGES_PER_ROUND" "$msg_index"
  msg_index=$((msg_index + MESSAGES_PER_ROUND))
  round=$((round + 1))
done

sleep 2
lag_after=$(get_total_lag)

echo "=== FaultLab Inject Summary ==="
echo "scenario             : $SCENARIO_ID"
echo "lag_before           : $lag_before"
echo "lag_after            : $lag_after"
echo "affected_component   : consumer-group/$GROUP_ID"
echo "inject_param         : consumer join/leave churn rounds=$STORM_ROUNDS"
echo "================================"
