# Kafka 消费者组 Rebalance 风暴

> **难度**：⭐⭐⭐☆☆  |  **技术栈**：Kafka 3.x / Docker  |  **预计时长**：30–45 分钟  
> **前置知识**：Consumer Group 基本概念、`kafka-consumer-groups.sh` 基本用法  
> **故障显现时间窗口**：inject 后约 **15-30 秒** 可观察到现象  
> **参数干预**：否

---

## 环境要求

- **Docker**：>= 24.0（`docker compose` 命令）
- **可用内存**：至少 **2 GB**（本场景资源等级：🔴 重量）
- **端口说明**：默认不暴露宿主机端口，避免多场景并行时冲突

---

## 你会遇到什么

系统持续写入消息，但消费者组吞吐明显下降，消费延迟（Lag）持续累积。
查看消费组状态时，会反复看到组成员变更和分区重新分配，整体表现为“看起来在运行，但业务进度很慢”。

---

## 快速开始

### 1. 启动环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/002-consumer-group-rebalance-storm ./cli/faultlab.sh start
```

### 2. 注入故障

```bash
FAULTLAB_SCENARIO=scenarios/kafka/002-consumer-group-rebalance-storm ./cli/faultlab.sh inject
```

可选参数：

- `STORM_ROUNDS`：默认 `12`，消费者加入/离开轮次
- `MESSAGES_PER_ROUND`：默认 `80`，每轮新增消息数
- `BASELINE_MESSAGES`：默认 `300`，注入前基线消息数

注入完成后会输出摘要，例如：

```text
=== FaultLab Inject Summary ===
scenario             : kafka-002
lag_before           : 0
lag_after            : 423
affected_component   : consumer-group/faultlab-rebalance-group
inject_param         : consumer join/leave churn rounds=12
================================
```

---

## 观察与排查

### 查看 Consumer Group 延迟

```bash
MSYS_NO_PATHCONV=1 docker exec kafka002-broker /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --group faultlab-rebalance-group
```

### 查看消费者日志

```bash
MSYS_NO_PATHCONV=1 docker exec kafka002-broker /bin/sh -c "tail -n 200 /tmp/faultlab-stable-consumer.log"
```

### 查看 Broker 日志中的 Group 变化

```bash
docker logs kafka002-broker --tail 300
```

### 查看 Topic 与分区信息

```bash
MSYS_NO_PATHCONV=1 docker exec kafka002-broker /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic faultlab-rebalance
```

---

## 分析你的发现

1. 消费者组成员变化频率和 Lag 变化是否相关？
2. Rebalance 期间消费进度为什么会受到影响？
3. 如果消费者实例频繁上下线，系统层面需要做哪些保护？

---

## 提交排查结论

```bash
FAULTLAB_SCENARIO=scenarios/kafka/002-consumer-group-rebalance-storm ./cli/faultlab.sh verify
```

---

## 清理环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/002-consumer-group-rebalance-storm ./cli/faultlab.sh clean
```

---

## 参考资料

- [Kafka Consumer 配置](https://kafka.apache.org/documentation/#consumerconfigs)
- [Kafka Consumer Group 命令](https://kafka.apache.org/documentation/#basic_ops_consumer_lag)
- [Incremental Cooperative Rebalancing](https://www.confluent.io/blog/cooperative-rebalancing-in-kafka-streams-consumer-ksqldb/)
