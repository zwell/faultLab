# Kafka 消息丢失

> **难度**：⭐⭐☆☆☆  |  **技术栈**：Kafka 3.x / Docker  |  **预计时长**：25–40 分钟  
> **前置知识**：Kafka Producer `acks` 语义、Leader/Follower 副本同步机制  
> **故障显现时间窗口**：inject 后约 **10-20 秒** 可观察到现象  
> **参数干预**：是，实验中将 `log.flush.interval.ms` 提高以放大未落盘窗口

---

## 环境要求

- **Docker**：>= 24.0（`docker compose` 命令）
- **可用内存**：至少 **2 GB**（本场景资源等级：🔴 重量）
- **端口说明**：默认不暴露宿主机端口，避免多场景并行时冲突

---

## 你会遇到什么

Producer 端显示消息发送成功（`acks=0` 或 `acks=1`），但 Broker 异常重启后，
重新消费同一 Topic 时会发现部分甚至全部消息消失。现象上看是“已确认写入”，
实际却没有可恢复的数据。

---

## 快速开始

### 1. 启动环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss ./cli/faultlab.sh start
```

### 2. 注入故障

```bash
FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss ./cli/faultlab.sh inject
```

可选参数：

- `ACKS_MODE`：默认 `1`，可设为 `0` 或 `1`
- `MESSAGE_COUNT`：默认 `200`

注入完成后会输出摘要，例如：

```text
=== FaultLab Inject Summary ===
scenario             : kafka-001
produced_count       : 200
recovered_count      : 17
acks_mode            : 1
affected_component   : producer durability path
inject_param         : acks=1 + broker SIGKILL before replica sync
================================
```

---

## 观察与排查

### 查看 Topic 当前消息数（恢复后）

```bash
MSYS_NO_PATHCONV=1 docker exec kafka001-broker /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic faultlab-loss \
  --from-beginning \
  --timeout-ms 4000 | wc -l
```

### 检查 Broker 最近日志

```bash
docker logs kafka001-broker --tail 200
```

### 对比不同 acks 模式

```bash
ACKS_MODE=0 FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss ./cli/faultlab.sh inject
ACKS_MODE=1 FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss ./cli/faultlab.sh inject
```

---

## 分析你的发现

1. `acks=0` 与 `acks=1` 的“成功语义”差异是什么？
2. 为什么“收到 ACK”不必然等于“多副本持久化完成”？
3. 在 Broker 崩溃恢复窗口里，哪些消息最容易丢失？

---

## 提交排查结论

```bash
FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss ./cli/faultlab.sh verify
```

---

## 清理环境

```bash
FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss ./cli/faultlab.sh clean
```

---

## 参考资料

- [Kafka Producer 配置](https://kafka.apache.org/documentation/#producerconfigs)
- [Kafka Replication 设计](https://kafka.apache.org/documentation/#replication)

