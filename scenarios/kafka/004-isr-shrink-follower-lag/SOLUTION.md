# SOLUTION — Kafka ISR 副本持续缩减（副本落后）

---

## 根因（Root Cause）

Follower 副本持续无法从 Leader 拉取并追上日志（实验中通过暂停 Follower Broker 模拟负载过高/网络抖动），超过 `replica.lag.time.max.ms` 判定窗口后被逐步移出 ISR，最终 ISR 只剩 Leader。
当 Producer 使用 `acks=all` 且 Topic 配置 `min.insync.replicas=2` 时，ISR=1 不满足最小同步副本要求，Broker 拒绝写入并返回 `NotEnoughReplicasException`。

**参数干预说明**：本场景将实验 Topic 的 `min.insync.replicas` 设置为 `2`（而非单副本可写入的默认行为），用于稳定暴露“ISR 缩减后写入被拒绝”的生产保护机制。真实生产中对关键 Topic 配置 `min.insync.replicas>=2` 是常见做法。

---

## 关键证据（Key Evidence）

**日志证据**

| 证据 | 预期关键字 / 内容 | 获取方式 |
|------|--------------------|---------|
| Leader 侧副本状态变化 | ISR 列表从 `1,2,3` 缩减到仅 `1` | `kafka-topics.sh --describe --topic faultlab-isr-shrink` |
| 写入被拒绝异常 | `NotEnoughReplicasException` | `kafka-console-producer.sh` 写入输出 |

**指标证据**

| 证据 | 预期观测值 | 获取方式 |
|------|-----------|---------|
| ISR 收缩 | `isr_size_before=3`，`isr_size_after=1` | Inject Summary |
| 副本不足分区 | `under_replicated_partitions=1`（持续不为 0） | Inject Summary |
| 写入错误 | `producer_error=NotEnoughReplicasException` | Inject Summary |

**配置证据**

| 证据 | 预期值 | 获取方式 |
|------|-------|---------|
| Topic 最小 ISR | `min.insync.replicas=2` | Topic 创建参数 / Inject Summary |
| Producer 一致性要求 | `acks=all` | `kafka-console-producer.sh --producer-property acks=all` |

---

## 解决方案（Solution）

### 方案 A：先恢复副本同步链路（推荐）

优先处理 Follower 落后的直接原因（Broker 负载、磁盘 I/O、网络抖动、跨可用区链路质量），确保 Follower 能持续追上 Leader 并重新加入 ISR。
恢复后验证 `under-replicated-partitions` 回落到 0，再评估后续参数优化。

### 方案 B：保障写入 SLA 的副本策略（推荐）

对关键 Topic 保持 `replication.factor>=3` 与 `min.insync.replicas>=2`，并配套 `acks=all`。
该策略会在副本不足时主动拒绝写入，避免“写成功但没有足够副本”的数据风险。

### 方案 C：建立副本落后告警与容量基线（推荐）

将 `under-replicated-partitions`、Follower fetch lag、Broker 磁盘与网络利用率纳入告警体系；
针对峰值流量做容量压测，避免在高负载下长期处于 ISR 收缩状态。

---

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 Follower 落后触发 ISR 收缩，最终只剩 Leader
  - 明确说明 acks=all + min.insync.replicas 校验失败导致 NotEnoughReplicasException
  - 使用至少一条 ISR 证据和一条写入失败证据形成闭环
  - 给出可执行修复方向（恢复副本同步、容量治理、副本策略与告警）

partial_credit:
  - 只描述了 ISR 变小或 URP 升高，但未解释写入失败机制
  - 只提到 NotEnoughReplicasException，但未关联 min.insync.replicas 与 acks=all
  - 修复建议笼统，缺少可落地动作

no_credit:
  - 将根因归结为 Producer SDK Bug 或 Topic 不存在
  - 未提及 ISR、副本同步、min.insync.replicas 任一关键机制
  - 未给出有效修复建议
```

---

## 实现说明（Implementation Notes）

- 本实验通过 `docker pause` 暂停两个 Follower Broker，模拟“副本长期落后/链路不可用”导致的 ISR 收缩；真实生产里更常见诱因是网络抖动、磁盘慢、CPU 饱和或副本流量竞争。
- 为了让故障信号稳定且可重复，实验 Topic 显式设置 `min.insync.replicas=2` 并使用 `acks=all` 触发写入保护。
- 环境为 3 节点 KRaft 简化集群，无鉴权、无 TLS、无跨机房部署；但 ISR 收缩与写入拒绝的核心机制与生产一致。

---

## 延伸思考（Further Reading）

- 当 ISR 频繁抖动时，应优先调优网络与存储，还是调整副本相关参数？
- 如何在“可用性优先”和“一致性优先”之间制定不同业务等级的 Topic 策略？
- [Kafka Replication 设计](https://kafka.apache.org/documentation/#design_replicatedlog)
