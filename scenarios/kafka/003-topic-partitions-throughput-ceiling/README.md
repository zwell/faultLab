# Kafka 分区数不足导致吞吐上限

> **难度**：⭐⭐☆☆☆  |  **技术栈**：Kafka 3.x / Docker  |  **预计时长**：25–40 分钟  
> **前置知识**：Topic 分区与 Consumer Group 分配机制  
> **故障显现时间窗口**：inject 后约 **10-20 秒** 可观察到现象  
> **参数干预**：否

---

## 环境要求

- **Docker**：>= 24.0（`docker compose` 命令）
- **可用内存**：至少 **2 GB**（本场景资源等级：🔴 重量）

---

## 你会遇到什么

你启动了多个消费者实例，希望提升吞吐，但消费速度并未按实例数线性增长。
消费组里会出现“部分消费者长期空闲”的现象，Lag 在高负载阶段难以下降。

---

## 快速开始

### 1. 启动环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/003-topic-partitions-throughput-ceiling ./cli/faultlab.sh start
```

### 2. 注入故障

```bash
FAULTLAB_SCENARIO=scenarios/kafka/003-topic-partitions-throughput-ceiling ./cli/faultlab.sh inject
```

可选参数：

- `TOPIC_PARTITIONS`：默认 `2`
- `CONSUMER_COUNT`：默认 `5`
- `BURST_MESSAGES`：默认 `3000`

注入完成后会输出摘要，例如：

```text
=== FaultLab Inject Summary ===
scenario             : kafka-003
lag_before           : 0
lag_after            : 927
topic_partitions     : 2
consumer_count       : 5
active_consumers     : 2
idle_consumers       : 3
affected_component   : consumer-group/faultlab-partition-group
inject_param         : partitions=2 consumers=5
================================
```

---

## 观察与排查

### 查看消费组分区分配

```bash
MSYS_NO_PATHCONV=1 docker exec kafka003-broker /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group faultlab-partition-group
```

### 查看 Topic 分区数

```bash
MSYS_NO_PATHCONV=1 docker exec kafka003-broker /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic faultlab-partition-ceiling
```

### 查看消费者日志

```bash
MSYS_NO_PATHCONV=1 docker exec kafka003-broker /bin/sh -c "ls -1 /tmp/faultlab-partition-consumer-*.log"
```

### 查看 Broker 日志

```bash
docker logs kafka003-broker --tail 200
```

---

## 分析你的发现

1. 为什么消费者实例数增加后，活跃消费并发没有同步增长？
2. `topic_partitions`、`active_consumers`、`idle_consumers` 三者是什么关系？
3. 当业务流量上涨时，如何提前避免该类吞吐天花板？

---

## 提交排查结论

```bash
FAULTLAB_SCENARIO=scenarios/kafka/003-topic-partitions-throughput-ceiling ./cli/faultlab.sh verify
```

---

## 清理环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/003-topic-partitions-throughput-ceiling ./cli/faultlab.sh clean
```

---

## 参考资料

- [Kafka Consumer Group 文档](https://kafka.apache.org/documentation/#basic_ops_consumer_lag)
- [Kafka Topic 配置文档](https://kafka.apache.org/documentation/#topicconfigs)
