# SOLUTION — Kafka 消息丢失（acks=0 / acks=1）

---

## 根因（Root Cause）

`acks=0` 不等待 Broker 确认，`acks=1` 只等待 Leader 写入结果，二者都不保证消息已完成多副本同步。
当 Leader 在副本同步或稳定落盘前崩溃时，Producer 侧“已成功”的消息可能在恢复后不存在，形成永久丢失。

**参数干预说明**：本实验把 `log.flush.interval.ms` 调高到 `600000` 以扩大“已写入但未稳定落盘”的时间窗口。
生产中通常不会这样设置，但在高吞吐场景下，异步刷盘与副本同步时延仍会带来同类风险窗口。

---

## 关键证据（Key Evidence）

**日志证据**

| 证据 | 预期关键字 / 内容 | 获取方式 |
|------|--------------------|---------|
| Producer 发送无报错 | inject 执行过程中发送阶段成功返回 | `./cli/faultlab.sh inject` |
| Broker 异常恢复路径 | Broker 出现异常终止和重启日志 | `docker logs kafka001-broker --tail 200` |

**指标证据**

| 证据 | 预期观测值 | 获取方式 |
|------|-----------|---------|
| 发送数量 | `produced_count` 为设定值（默认 200） | Inject Summary |
| 恢复数量 | `recovered_count` 显著小于 `produced_count` | Inject Summary |

**配置证据**

| 证据 | 预期值 | 获取方式 |
|------|-------|---------|
| Producer `acks` | `0` 或 `1` | `ACKS_MODE` 注入参数 |
| Broker flush 参数 | `log.flush.interval.ms=600000` | `docker-compose.yml` |

---

## 解决方案（Solution）

### 方案 A：生产场景使用 `acks=all` + 合理 `min.insync.replicas`（推荐）

```properties
acks=all
retries=2147483647
enable.idempotence=true
```

并确保 Topic 配置与 Broker 配置一致，例如 `min.insync.replicas=2` 且副本数 >= 3。

### 方案 B：避免单副本容灾假象（推荐）

将关键 Topic 的 `replication.factor` 提升到至少 3，避免单点 Leader 故障导致确认消息不可恢复。

### 方案 C：建立发送成功与落盘/复制的监控闭环（推荐）

监控 ISR 变化、Under Replicated Partitions、Broker 崩溃恢复事件，避免只依赖业务侧发送成功率。

---

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 acks=0/1 不能保证多副本持久化
  - 能描述 Leader 崩溃发生在副本同步完成前的丢失路径
  - 至少给出一个正确修复方向（acks=all、提高副本和 ISR 约束、幂等发送）
  - reality_check: 能解释“业务看到成功”与“消息可恢复”是两层语义

partial_credit:
  - 只提到 acks 配置不安全，但未说明崩溃窗口
  - 只说副本数不够，未关联确认语义
  - 方案方向正确但缺少关键配置（如 min.insync.replicas）

no_credit:
  - 将根因归为消费者问题或网络抖动
  - 认为 acks=1 等价于强一致持久化
  - 未提及 Leader/Follower 同步链路
```

---

## 实现说明（Implementation Notes）

- 本实验使用单 Broker 并通过 `SIGKILL` + 日志段移除模拟“崩溃前同步/落盘未完成”后的可见丢失结果，用于稳定复现教学现象。
- 真实生产通常是多 Broker、多副本，丢失由 Leader 切换时副本状态、ISR 收缩、刷盘策略共同决定，触发机制更复杂。
- 场景省略鉴权、TLS、跨机房网络等生产因素，但“确认语义 != 最终可恢复语义”这个核心结论可直接迁移。

---

## 延伸思考（Further Reading）

- `acks=all` 与 `min.insync.replicas` 组合下的可用性-一致性权衡是什么？
- 幂等 Producer 与事务消息能解决哪些“重复/丢失”边界问题？
- 当集群发生频繁 ISR 抖动时，应如何设置告警和降级策略？
