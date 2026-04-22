#!/bin/sh
set -eu

SCENARIO_ID="kafka-003"
BROKER_CONTAINER="kafka003-broker"
TOPIC_NAME="${TOPIC_NAME:-faultlab-partition-ceiling}"
GROUP_ID="${GROUP_ID:-faultlab-partition-group}"
TOPIC_PARTITIONS="${TOPIC_PARTITIONS:-2}"
CONSUMER_COUNT="${CONSUMER_COUNT:-5}"
BURST_MESSAGES="${BURST_MESSAGES:-3000}"
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

produce_messages() {
  count="$1"
  i=1
  while [ "$i" -le "$count" ]; do
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

get_active_consumers() {
  MSYS_NO_PATHCONV=1 docker exec "$BROKER_CONTAINER" /opt/kafka/bin/kafka-consumer-groups.sh \
    --bootstrap-server localhost:9092 \
    --describe \
    --group "$GROUP_ID" 2>/dev/null \
  | awk '
      /^TOPIC/ {next}
      NF == 0 {next}
      {
        cid=$6
        if (cid != "-" && cid != "") {
          seen[cid]=1
        }
      }
      END {
        c=0
        for (k in seen) c++
        print c + 0
      }
    '
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
  --partitions "$TOPIC_PARTITIONS" \
  --replication-factor 1 >/dev/null

i=1
while [ "$i" -le "$CONSUMER_COUNT" ]; do
  MSYS_NO_PATHCONV=1 docker exec -d "$BROKER_CONTAINER" /bin/sh -c \
    "/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic $TOPIC_NAME --group $GROUP_ID --consumer-property auto.offset.reset=latest --consumer-property enable.auto.commit=true --timeout-ms 15000 >/tmp/faultlab-partition-consumer-$i.log 2>&1 || true"
  i=$((i + 1))
done

if ! wait_group_created; then
  echo "ERROR: consumer group was not created in timeout."
  exit 1
fi

sleep 2
lag_before=$(get_total_lag)
produce_messages "$BURST_MESSAGES"
sleep 2
lag_after=$(get_total_lag)
active_consumers=$(get_active_consumers)
idle_consumers=$((CONSUMER_COUNT - active_consumers))
if [ "$idle_consumers" -lt 0 ]; then
  idle_consumers=0
fi

echo "=== FaultLab Inject Summary ==="
echo "scenario             : $SCENARIO_ID"
echo "lag_before           : $lag_before"
echo "lag_after            : $lag_after"
echo "topic_partitions     : $TOPIC_PARTITIONS"
echo "consumer_count       : $CONSUMER_COUNT"
echo "active_consumers     : $active_consumers"
echo "idle_consumers       : $idle_consumers"
echo "affected_component   : consumer-group/$GROUP_ID"
echo "inject_param         : partitions=$TOPIC_PARTITIONS consumers=$CONSUMER_COUNT"
echo "================================"
