# FaultLab V2

FaultLab 是一个面向 SRE / 后端工程师 / 中间件使用者的故障演练项目。  
你可以一键启动场景、注入故障、观察信号、提交根因分析，并通过 `verify` 获得 AI 引导式反馈。

---

## 项目目标

- 提供可复现的中间件故障场景（本地 Docker 即可运行）
- 统一实验操作入口（`start / inject / verify / clean`）
- 强化“现象 -> 证据 -> 根因 -> 方案”的排障思维

---

## 当前能力

- 统一 CLI：`./cli/faultlab.sh`
- 场景目录标准化：`meta.yaml`、`docker-compose.yml`、`inject.sh`、`README.md`、`SOLUTION.md`、`test.sh`
- `verify` 通过 `.env` 中的 API Key 接入 LLM 进行反馈

已提供示例场景：

- `scenarios/kafka/001-acks-message-loss`
- `scenarios/kafka/002-consumer-group-rebalance-storm`
- `scenarios/kafka/003-topic-partitions-throughput-ceiling`

---

## 环境要求

- Docker >= 24（需支持 `docker compose` 子命令）
- 建议可用内存 >= 2 GB
- Shell 环境：Git Bash / Linux / macOS（Windows PowerShell 也可运行）

---

## 快速开始

### 1) 选择场景

```bash
export FAULTLAB_SCENARIO=scenarios/kafka/001-acks-message-loss
```

PowerShell 写法：

```powershell
$env:FAULTLAB_SCENARIO='scenarios/kafka/001-acks-message-loss'
```

### 2) 启动环境

```bash
./cli/faultlab.sh start
```

### 3) 注入故障

```bash
./cli/faultlab.sh inject
```

### 4) 提交你的分析结论

```bash
./cli/faultlab.sh verify
```

### 5) 清理环境

```bash
./cli/faultlab.sh clean
```

---

## 使用说明

- `start`：启动当前场景容器并等待就绪
- `inject`：将系统推进到可观察的故障态，并输出摘要
- `verify`：进入 AI 交互验证（根因与解决方案）
- `clean`：停止并清理场景容器、网络与卷

> `FAULTLAB_SCENARIO` 是必填变量，格式：`scenarios/<tech>/<id>`

`verify` 默认使用 Qwen（`VERIFY_PROVIDER=qwen`），后续可通过 `.env` 切换为其他 OpenAI 兼容模型（例如 OpenAI）。

---

## 镜像自动探测（未显式设置镜像时）

当场景 `docker-compose.yml` 使用 `${VAR:-repo:tag}` 格式定义镜像时，CLI 会自动处理：

1. 优先使用本地已有的默认镜像
2. 若默认 tag 不在本地，尝试同仓库本地 tag 回退（例如 `apache/kafka:*`）
3. 本地没有则尝试拉取默认镜像

若仍不可用，会提示你手动设置对应环境变量（如 `KAFKA_IMAGE`）。

---

## 目录结构

```text
faultLabV2/
  cli/
    faultlab.sh
  scenarios/
    kafka/
      001-acks-message-loss/
        meta.yaml
        docker-compose.yml
        inject.sh
        README.md
        SOLUTION.md
        test.sh
      002-consumer-group-rebalance-storm/
        meta.yaml
        docker-compose.yml
        inject.sh
        README.md
        SOLUTION.md
        test.sh
      003-topic-partitions-throughput-ceiling/
        meta.yaml
        docker-compose.yml
        inject.sh
        README.md
        SOLUTION.md
        test.sh
  doc/
    CONTRIBUTING.md
  .env.example
```

---

## 贡献场景

新增或修改场景前，请先阅读：

- `doc/CONTRIBUTING.md`

该文档定义了场景目录规范、注入摘要格式、README/SOLUTION 模板约束与发布自检清单。
