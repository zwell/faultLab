# Kafka ISR 副本持续缩减（副本落后）

> **难度**：⭐⭐⭐☆☆  |  **技术栈**：Kafka 3.x / Docker  |  **预计时长**：30–45 分钟  
> **前置知识**：ISR 机制、`acks=all`、`min.insync.replicas` 基本概念  
> **故障显现时间窗口**：inject 后约 **40-70 秒** 可观察到现象  
> **参数干预**：是（将实验 Topic 的 `min.insync.replicas` 设为 `2`，用于稳定触发写入拒绝）

---

## 环境要求

- **Docker**：>= 24.0（`docker compose` 命令）
- **可用内存**：至少 **4 GB**（本场景资源等级：🔴 重量）
- **API Key 配置**：在项目根目录 `.env` 中配置可用的 LLM API Key（可参考 `.env.example`），用于 `verify` 交互评分
- **端口说明**：默认不暴露宿主机端口，避免多场景并行时冲突

---

## 你会遇到什么

集群短时间内出现副本同步异常后，Topic 的 ISR 数量持续下降，`under-replicated-partitions` 长时间不回到 0。
业务侧使用 `acks=all` 写入时，部分请求开始报错，提示副本不足，消息无法继续写入。

---

## 快速开始

### 1. 启动环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/004-isr-shrink-follower-lag ./cli/faultlab.sh start
```

### 2. 注入故障

```bash
FAULTLAB_SCENARIO=scenarios/kafka/004-isr-shrink-follower-lag ./cli/faultlab.sh inject
```

可选参数：

- `MIN_INSYNC_REPLICAS`：默认 `2`
- `PAUSE_FOLLOWERS`：默认 `kafka004-broker2 kafka004-broker3`
- `WAIT_ISR_TIMEOUT_SEC`：默认 `70`

注入完成后会输出摘要，例如：

```text
=== FaultLab Inject Summary ===
scenario                     : kafka-004
isr_size_before              : 3
isr_size_after               : 1
under_replicated_partitions  : 1
min_insync_replicas          : 2
producer_before              : ok
producer_error               : NotEnoughReplicasException
affected_component           : topic/faultlab-isr-shrink
inject_param                 : pause followers=[kafka004-broker2 kafka004-broker3]
================================
```

---

## 观察与排查

### 查看 Topic 副本与 ISR

```bash
MSYS_NO_PATHCONV=1 docker exec kafka004-broker1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka004-broker1:9092 \
  --describe \
  --topic faultlab-isr-shrink
```

### 查看 Broker 日志中的 ISR 变化

```bash
docker logs kafka004-broker1 --tail 300
```

### 查看副本 Broker 状态

```bash
docker ps --filter "name=kafka004-broker"
```

### 用 acks=all 手工复现写入失败

```bash
printf "manual-test\n" | MSYS_NO_PATHCONV=1 docker exec -i kafka004-broker1 /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server kafka004-broker1:9092 \
  --topic faultlab-isr-shrink \
  --producer-property acks=all \
  --producer-property retries=0
```

---

## 分析你的发现

1. ISR 从 3 收缩到 1 的直接触发条件是什么？
2. 为什么 `under-replicated-partitions` 会长期不为 0？
3. `acks=all` 与 `min.insync.replicas` 在这个场景里如何共同导致写入失败？

---

## 提交排查结论

```bash
FAULTLAB_SCENARIO=scenarios/kafka/004-isr-shrink-follower-lag ./cli/faultlab.sh verify
```

---

## 清理环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/004-isr-shrink-follower-lag ./cli/faultlab.sh clean
```

---

## 参考资料

- [Kafka Replication and ISR](https://kafka.apache.org/documentation/#replication)
- [Kafka Topic Configs](https://kafka.apache.org/documentation/#topicconfigs)
- [Kafka Producer Configs (`acks`)](https://kafka.apache.org/documentation/#producerconfigs_acks)
