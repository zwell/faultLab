# FaultLab

FaultLab 是面向 SRE、后端与中间件使用者的**本地故障演练**项目：在 Docker 里启动可复现场景，注入故障，对照现象排查，并用 **Verify** 获得 AI 的引导式反馈。

本仓库的推荐用法是通过 **Web UI** 浏览场景、在浏览器内嵌终端操作，并在同一界面完成 Verify。纯命令行流程见下文入口。

---

## 你需要准备什么

- **Docker** >= 24（需支持 `docker compose` 子命令），daemon 已运行
- **Node.js** >= 18
- 建议可用内存 **>= 2 GB**
- **Verify**：在仓库根目录配置 `.env`（从 `.env.example` 复制）。Web UI 的 Verify 会优先读取 **`ANTHROPIC_API_KEY`**；未设置时也可按 `.env.example` 使用 Qwen（`DASHSCOPE_API_KEY`）或 OpenAI 兼容配置

---

## 快速开始（Web UI）

在**仓库根目录**执行：

```bash
cp .env.example .env
# 编辑 .env，至少配置一种 Verify 所需的 Key（见 .env.example 内注释）

cd web
npm install
npm run dev
```

浏览器打开 **http://localhost:5173**（Vite 开发服务器；API 与 WebSocket 会通过代理连到本机 Node 服务）。

在界面中你可以：

- 按技术栈与难度筛选场景，进入详情页阅读说明
- 使用内嵌终端执行排查命令；通过按钮完成 **启动环境 / 注入故障 / 清理**
- 在 Verify 区域多轮对话，获取基于当前场景标准答案的反馈

> 若 `npm install` 时编译原生依赖失败，在 macOS 上通常需要先安装 **Xcode Command Line Tools**（`xcode-select --install`）；在 Windows 上需要可用的 **Visual Studio Build Tools** 或对应 C++ 生成工具，以便构建 `node-pty`。

### 终端里先显示 “Connected” 马上又 “Terminal disconnected”

常见原因是 **`node-pty` 自带的 `spawn-helper` 没有执行权限**（上游 npm 包在 macOS 上以 `644` 安装），服务端创建伪终端失败并关闭 WebSocket。`npm install` 后会自动跑 `postinstall` 修复；若你仍遇到该现象，在 `web/` 目录执行：

```bash
npm run fix-node-pty
```

然后重启 `npm run dev`。

---

## 纯命令行（不使用 Web）

若你只想在系统终端里用脚本操作场景，请看：

- **[命令行使用说明（CLI）](doc/CLI_USAGE.md)**

---

## 贡献新场景

场景规范、注入摘要格式与自检清单见：

- **[doc/CONTRIBUTING.md](doc/CONTRIBUTING.md)**

---

## 仓库结构（概要）

```text
<仓库根>/
  web/                 # Web UI（Vite 前端 + Express / WebSocket 服务）
  cli/
    faultlab.sh        # 命令行入口（Web 底层也会调用等价流程）
  scenarios/           # 各故障场景
  doc/
    CLI_USAGE.md       # 纯 CLI 文档
    CONTRIBUTING.md
  .env.example
```
