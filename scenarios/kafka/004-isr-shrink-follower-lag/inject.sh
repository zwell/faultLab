#!/bin/sh
set -eu

SCENARIO_ID="kafka-004"
TOPIC_NAME="${TOPIC_NAME:-faultlab-isr-shrink}"
BROKER_BOOTSTRAP="${BROKER_BOOTSTRAP:-kafka004-broker1:9092}"
MIN_INSYNC_REPLICAS="${MIN_INSYNC_REPLICAS:-2}"
REPLICATION_FACTOR="${REPLICATION_FACTOR:-3}"
PARTITIONS="${PARTITIONS:-1}"
PAUSE_FOLLOWERS="${PAUSE_FOLLOWERS:-kafka004-broker2 kafka004-broker3}"
WAIT_ISR_TIMEOUT_SEC="${WAIT_ISR_TIMEOUT_SEC:-70}"

ensure_running() {
  container="$1"
  running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo "false")
  if [ "$running" != "true" ]; then
    docker start "$container" >/dev/null
  fi
}

wait_broker_ready() {
  container="$1"
  timeout_sec="${WAIT_BROKER_TIMEOUT_SEC:-90}"
  start_ts=$(date +%s)
  while :; do
    if MSYS_NO_PATHCONV=1 docker exec "$container" /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list >/dev/null 2>&1; then
      return 0
    fi
    now_ts=$(date +%s)
    if [ $((now_ts - start_ts)) -ge "$timeout_sec" ]; then
      return 1
    fi
    sleep 2
  done
}

topic_state() {
  MSYS_NO_PATHCONV=1 docker exec kafka004-broker1 /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server "$BROKER_BOOTSTRAP" \
    --describe \
    --topic "$TOPIC_NAME" 2>/dev/null | awk '/Partition: 0/ {print $0; exit}'
}

extract_isr_size() {
  line="$1"
  isr=$(printf "%s\n" "$line" | sed -n 's/.*Isr:[[:space:]]*\([^[:space:]]*\).*/\1/p')
  if [ -z "$isr" ]; then
    echo "0"
    return
  fi
  printf "%s\n" "$isr" | awk -F ',' '{print NF}'
}

extract_replica_size() {
  line="$1"
  replicas=$(printf "%s\n" "$line" | sed -n 's/.*Replicas:[[:space:]]*\([^[:space:]]*\)[[:space:]]*Isr:.*/\1/p')
  if [ -z "$replicas" ]; then
    echo "0"
    return
  fi
  printf "%s\n" "$replicas" | awk -F ',' '{print NF}'
}

wait_isr_shrink_to_leader() {
  start_ts=$(date +%s)
  while :; do
    state_line=$(topic_state || true)
    if [ -z "$state_line" ]; then
      now_ts=$(date +%s)
      if [ $((now_ts - start_ts)) -ge "$WAIT_ISR_TIMEOUT_SEC" ]; then
        return 1
      fi
      sleep 2
      continue
    fi
    isr_size=$(extract_isr_size "$state_line")
    if [ "$isr_size" -le 1 ]; then
      printf "%s\n" "$state_line"
      return 0
    fi
    now_ts=$(date +%s)
    if [ $((now_ts - start_ts)) -ge "$WAIT_ISR_TIMEOUT_SEC" ]; then
      return 1
    fi
    sleep 2
  done
}

produce_with_acks_all() {
  payload="$1"
  printf "%s\n" "$payload" | MSYS_NO_PATHCONV=1 docker exec -i kafka004-broker1 /opt/kafka/bin/kafka-console-producer.sh \
    --bootstrap-server "$BROKER_BOOTSTRAP" \
    --topic "$TOPIC_NAME" \
    --producer-property acks=all \
    --producer-property retries=0 \
    --producer-property request.timeout.ms=3000 2>&1 || true
}

for follower in $PAUSE_FOLLOWERS; do
  docker unpause "$follower" >/dev/null 2>&1 || true
done

for broker in kafka004-broker1 kafka004-broker2 kafka004-broker3; do
  ensure_running "$broker"
done

if ! wait_broker_ready "kafka004-broker1"; then
  echo "ERROR: kafka004-broker1 is not ready in timeout."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec kafka004-broker1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server "$BROKER_BOOTSTRAP" \
  --delete \
  --topic "$TOPIC_NAME" >/dev/null 2>&1 || true

sleep 2

MSYS_NO_PATHCONV=1 docker exec kafka004-broker1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server "$BROKER_BOOTSTRAP" \
  --create \
  --if-not-exists \
  --topic "$TOPIC_NAME" \
  --partitions "$PARTITIONS" \
  --replication-factor "$REPLICATION_FACTOR" \
  --config min.insync.replicas="$MIN_INSYNC_REPLICAS" >/dev/null

state_before=$(topic_state || true)
isr_before=$(extract_isr_size "$state_before")

baseline_output=$(produce_with_acks_all "baseline-ok")
if printf "%s" "$baseline_output" | awk '/NotEnoughReplicasException/ {found=1} END {exit found ? 1 : 0}'; then
  producer_before="ok"
else
  producer_before="unexpected_error"
fi

for follower in $PAUSE_FOLLOWERS; do
  docker pause "$follower" >/dev/null
done

if ! state_after=$(wait_isr_shrink_to_leader); then
  echo "ERROR: ISR did not shrink to leader-only within timeout."
  exit 1
fi

isr_after=$(extract_isr_size "$state_after")
replica_count=$(extract_replica_size "$state_after")
under_replicated_partitions=0
if [ "$replica_count" -gt "$isr_after" ]; then
  under_replicated_partitions=1
fi

producer_error_output=$(produce_with_acks_all "should-fail")
if printf "%s" "$producer_error_output" | awk '/NotEnoughReplicasException/ {found=1} END {exit found ? 0 : 1}'; then
  producer_error="NotEnoughReplicasException"
else
  producer_error="no_exception_observed"
fi

echo "=== FaultLab Inject Summary ==="
echo "scenario                     : $SCENARIO_ID"
echo "isr_size_before              : $isr_before"
echo "isr_size_after               : $isr_after"
echo "under_replicated_partitions  : $under_replicated_partitions"
echo "min_insync_replicas          : $MIN_INSYNC_REPLICAS"
echo "producer_before              : $producer_before"
echo "producer_error               : $producer_error"
echo "affected_component           : topic/$TOPIC_NAME"
echo "inject_param                 : pause followers=[$PAUSE_FOLLOWERS]"
echo "================================"
