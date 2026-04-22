# SOLUTION — Kafka 分区数不足导致吞吐上限

---

## 根因（Root Cause）

同一 Consumer Group 内，一个分区在同一时刻只能被一个消费者实例消费。
当 `topic_partitions` 远小于 `consumer_count` 时，超出的消费者无法分配到分区，只能空闲等待，导致横向扩容失效，系统吞吐受限于分区并行度上限。

---

## 关键证据（Key Evidence）

**日志证据**

| 证据 | 预期关键字 / 内容 | 获取方式 |
|------|--------------------|---------|
| 消费组分配结果 | 仅少量 consumer-id 持有分区，其余实例无分区 | `kafka-consumer-groups.sh --describe --group faultlab-partition-group` |
| 消费者空闲现象 | 多个消费者日志几乎无消费记录 | `/tmp/faultlab-partition-consumer-*.log` |

**指标证据**

| 证据 | 预期观测值 | 获取方式 |
|------|-----------|---------|
| 注入摘要并发关系 | `active_consumers <= topic_partitions` | Inject Summary |
| 空闲消费者数量 | `idle_consumers > 0` | Inject Summary |
| 负载下积压 | `lag_after` 高于 `lag_before` | Inject Summary |

**配置证据**

| 证据 | 预期值 | 获取方式 |
|------|-------|---------|
| Topic 分区配置 | 低于消费者实例数（默认 2 vs 5） | `kafka-topics.sh --describe` |
| 注入参数 | `partitions=<N> consumers=<M>`，且 `N < M` | Inject Summary 的 `inject_param` |

---

## 解决方案（Solution）

### 方案 A：按目标并发提升分区数（推荐）

保证关键消费组对应 Topic 的分区数不低于稳定在线消费者数。
建议先做容量评估，再通过扩分区逐步放量验证。

### 方案 B：按分区数控制消费者副本（推荐）

在无法立即扩分区时，将消费者实例数限制在分区数以内，避免资源空转和无效扩容。

### 方案 C：结合吞吐规划做分区策略设计（推荐）

把预估峰值吞吐、单分区处理能力、消费者部署规模纳入统一容量模型，避免业务增长后才被动扩分区。

---

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出一个分区同一时刻只能被同组一个消费者消费
  - 指出分区数低于消费者数会导致部分消费者空闲
  - 能用证据说明 active_consumers 与 topic_partitions 的上限关系
  - 给出至少一个可执行修复方向（扩分区、控制实例数、容量规划）

partial_credit:
  - 只说吞吐低但未解释分区并行度限制
  - 只说消费者有空闲但没有关联到分区数
  - 提出优化方案但与当前证据链不匹配

no_credit:
  - 将根因归为网络问题或 producer acks 设置
  - 未提及分区与消费并行度关系
  - 没有给出可落地方案
```

---

## 实现说明（Implementation Notes）

- 本实验在单 Broker 环境中使用 `TOPIC_PARTITIONS=2`、`CONSUMER_COUNT=5` 稳定复现“消费者空闲”现象。
- 真实生产中通常是多 Broker、多分区、多个消费组并存，但“同组并行度受分区数上限约束”的核心机制不变。
- 注入阶段会发送一批突发消息以放大差异，便于在短时间窗口内观察 `idle_consumers` 与 `lag_after`。

---

## 延伸思考（Further Reading）

- 扩分区后如何处理 key 分布倾斜与热点分区问题？
- 何时应优先扩分区，何时应优先优化单条消息处理时延？
- [Kafka 官方文档：Consumers](https://kafka.apache.org/documentation/#consumerconfigs)
