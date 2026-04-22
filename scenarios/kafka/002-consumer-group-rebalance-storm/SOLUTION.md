# SOLUTION — Kafka 消费者组 Rebalance 风暴

---

## 根因（Root Cause）

消费者组内存在频繁加入/离开的成员抖动，导致 Group Coordinator 持续触发 Rebalance。
每次 Rebalance 都会带来分区撤销与重新分配窗口，消费线程在窗口期无法稳定拉取消息，最终表现为吞吐下降和 Lag 持续累积。

---

## 关键证据（Key Evidence）

**日志证据**

| 证据 | 预期关键字 / 内容 | 获取方式 |
|------|--------------------|---------|
| Group 成员频繁变更 | 同一 group 出现 repeated join/leave、generation 变化 | `docker logs kafka002-broker --tail 300` |
| 消费进度不稳定 | 消费记录间隔拉长，处理连续性被打断 | `tail -n 200 /tmp/faultlab-stable-consumer.log` |

**指标证据**

| 证据 | 预期观测值 | 获取方式 |
|------|-----------|---------|
| 注入前后 Lag 对比 | `lag_after` 明显高于 `lag_before` | Inject Summary |
| 消费组描述状态 | 反复出现成员变化导致分区重分配 | `kafka-consumer-groups.sh --describe --group faultlab-rebalance-group` |

**配置证据**

| 证据 | 预期值 | 获取方式 |
|------|-------|---------|
| 故障触发方式 | `consumer join/leave churn` | Inject Summary 的 `inject_param` |
| 分区规模 | 多分区更易放大重分配影响 | `kafka-topics.sh --describe --topic faultlab-rebalance` |

---

## 解决方案（Solution）

### 方案 A：降低消费者实例抖动频率（推荐）

优先排查导致实例频繁重启或短生命周期的根因（探活阈值、容器资源限制、发布策略）。
避免在短时间内重复扩缩容同一消费者组。

### 方案 B：使用 Cooperative Rebalance（推荐）

将再平衡策略切到增量模式，减少全量分区撤销带来的停顿时间。

```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

### 方案 C：优化消费处理路径，缩短重平衡恢复时间（推荐）

降低单批处理耗时，确保分区重新分配后消费者可以快速恢复稳定消费。
必要时通过限流和背压保护下游，避免“重平衡期间积压进一步放大”。

---

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出根因是消费者组成员频繁加入/离开触发持续 Rebalance
  - 能说明 Rebalance 会导致分区消费短暂停顿，从而拉低吞吐并抬升 Lag
  - 使用至少一个证据闭环（例如 lag_before/lag_after 或 group describe + 日志）
  - 至少给出一个有效修复方向（减少实例抖动、cooperative rebalance、优化消费路径）

partial_credit:
  - 只描述了 Lag 增大，但没有解释成员抖动与 Rebalance 的因果关系
  - 只说“Kafka 性能差”或“消费者慢”，缺少组重平衡证据
  - 给出修复方向但无法对应到当前现象

no_credit:
  - 将根因归为 Producer 故障或 Topic 配置错误
  - 未提及 Consumer Group / Rebalance 机制
  - 无法给出任何可执行的缓解措施
```

---

## 实现说明（Implementation Notes）

- 本实验通过脚本化地启动一个稳定消费者，并反复创建短生命周期消费者来模拟“成员频繁加入/离开”。
- 环境为单 Broker、无鉴权、无跨机房网络，弱化了生产中的多节点与网络因素；但“成员抖动触发持续 Rebalance 并拖慢消费”的机制与生产一致。
- 注入期间额外持续写入消息以放大现象，便于在短时间窗口内稳定观察 `lag_before -> lag_after` 的变化。

---

## 延伸思考（Further Reading）

- 消费者探活与发布策略应如何协同，避免滚动发布触发 Rebalance 风暴？
- 在高吞吐场景下，如何权衡 Sticky/Cooperative 分配策略与恢复速度？
- [Kafka Consumer 配置文档](https://kafka.apache.org/documentation/#consumerconfigs)
