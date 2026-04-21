# FaultLab Web UI 开发计划

## 项目背景

FaultLab 是一个本地运行的故障排查练习工具。用户 clone 仓库后，在自己机器上通过 Docker 启动故障场景，在终端中排查问题，最后通过 LLM 评分。

本计划目标是为 FaultLab 构建一个本地 Web UI，替代纯命令行操作，提升体验。用户仍在本地运行 Docker，Web UI 通过一个本地 server 代理所有操作。

---

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 前端 | React 18 + Vite | 组件化，开发体验好 |
| 样式 | Tailwind CSS | 快速布局，无需自定义 CSS 体系 |
| 本地 Server | Node.js + Express | 与前端同语言，维护成本低 |
| 终端渲染 | xterm.js | 浏览器内渲染真实终端，支持颜色/光标 |
| 终端进程 | node-pty | Server 侧创建真实 pty 进程 |
| 实时通信 | WebSocket (ws) | 终端输入输出必须流式，HTTP 不够用 |
| Markdown 渲染 | react-markdown + remark-gfm | 渲染场景 README.md |
| YAML 解析 | js-yaml | 读取 meta.yaml |
| LLM 调用 | Anthropic SDK (@anthropic-ai/sdk) | 流式调用 Claude API |

---

## 项目目录结构

在现有 FaultLab 仓库根目录下新增 `web/` 目录，不影响现有 CLI 流程：

```
faultlab/
  web/
    server/
      index.js          # Express + WebSocket 入口
      routes/
        scenarios.js    # 场景列表、详情接口
        terminal.js     # pty 进程管理、WebSocket 处理
        actions.js      # start / inject / clean 执行
        verify.js       # LLM 调用、流式返回
      lib/
        scenarioScanner.js  # 扫描 meta.yaml，构建场景索引
        ptyManager.js       # pty 会话生命周期管理
        shellRunner.js      # 执行 sh 命令，处理跨平台差异
    client/
      src/
        pages/
          Home.jsx        # 首页：技术栈筛选 + 场景列表
          Scenario.jsx    # 详情页：说明 + 终端 + verify
        components/
          ScenarioCard.jsx
          Terminal.jsx
          ContainerTabs.jsx
          VerifyChat.jsx
          ActionBar.jsx   # start / inject / clean 按钮组
        hooks/
          useTerminal.js
          useVerify.js
        App.jsx
        main.jsx
      index.html
    package.json
    vite.config.js
  .env.example
  scenarios/
    ...（现有场景，不变）
  cli/
    faultlab.sh（现有 CLI，不变）
```

---

## 阶段划分

### 阶段一：项目骨架 + 场景列表

**目标**：能在浏览器里看到场景列表，点击进入详情页（详情页内容暂时为空）。

#### Server 侧

1. 初始化 `web/` 目录，`package.json` 包含所有依赖。

2. 实现 `scenarioScanner.js`：
   - 递归扫描 `scenarios/<tech>/<id>/meta.yaml`
   - 用 `js-yaml` 解析，返回场景对象数组
   - 结果按 `tech` 分组，按 `difficulty` 升序排列
   - 扫描根路径通过环境变量 `FAULTLAB_ROOT` 配置，默认为 `../`（相对 web/ 目录）

3. 实现 `GET /api/scenarios` 接口：
   - 返回所有场景的 meta 信息数组
   - 支持 query 参数过滤：`?tech=kafka`、`?difficulty=2`、`?resource_level=light`

4. 实现 `GET /api/scenarios/:id/readme` 接口：
   - 读取对应场景的 `README.md`，以纯文本返回
   - 路径解析：根据 `id` 匹配场景目录，返回该目录下的 `README.md`

#### 前端侧

5. 实现首页 `Home.jsx`：
   - 顶部：技术栈 tab 筛选（动态读取 API 返回的 tech 列表，不硬编码）
   - 筛选栏：难度（1-5）、资源等级（light/medium/heavy）多选筛选
   - 场景卡片网格：显示标题、技术栈、难度星级、预计时长、资源等级标签
   - 资源等级用色块标注：🟢 light / 🟡 medium / 🔴 heavy
   - 点击卡片跳转详情页

6. 路由配置：`/` 首页，`/scenario/:id` 详情页（详情页此阶段只显示占位内容）。

#### 兼容性要求

- Server 启动时检测 Docker 是否可用（`docker info`），不可用时在终端打印警告，但不阻止启动
- FAULTLAB_ROOT 路径在 Windows 下需处理反斜杠，统一用 `path.resolve()` 处理

---

### 阶段二：详情页 + 终端

**目标**：详情页左侧显示 README，右侧有可交互的真实终端，支持切换容器快捷方式。

这是整个项目技术难度最高的部分，需要仔细处理跨平台兼容性。

#### Server 侧 — pty 管理

1. 实现 `ptyManager.js`：
   - 每个场景维护一个 pty 会话（`Map<scenarioId, ptyProcess>`）
   - pty 进程启动时 shell 选择逻辑：
     ```
     Windows: 优先 Git Bash (C:\Program Files\Git\bin\bash.exe)，
              找不到则用 PowerShell，并在启动时提示用户安装 Git Bash
     macOS/Linux: /bin/bash
     ```
   - pty 启动的工作目录设为对应场景目录（`scenarios/<tech>/<id>/`），
     这样用户在终端里可以直接执行 `./inject.sh`
   - pty 进程退出时自动从 Map 中移除

2. 实现 WebSocket 端点 `WS /ws/terminal/:id`：
   - 连接时，若该场景已有 pty 会话则复用，否则新建
   - 前端发来的数据（键盘输入）直接 write 到 pty
   - pty 的输出（stdout + stderr 合并）直接发回前端
   - 连接断开时不销毁 pty（用户刷新页面后可以恢复会话）
   - 同一场景支持多个 WebSocket 连接共享同一个 pty（多标签页场景）

3. 实现容器列表接口 `GET /api/scenarios/:id/containers`：
   - 执行 `docker ps --filter name=<scenario-prefix> --format json`
   - 解析返回容器名列表
   - 用于前端渲染「切换容器」快捷按钮

#### 前端侧

4. 实现 `Terminal.jsx`：
   - 使用 xterm.js 渲染终端
   - 通过 WebSocket 连接 `/ws/terminal/:id`
   - 处理 xterm.js 的 `onData` 事件，将用户输入发送到 WebSocket
   - 处理 WebSocket 的 `message` 事件，将数据写入 xterm
   - 终端自适应容器宽高（使用 xterm 的 `FitAddon`）
   - 窗口 resize 时重新 fit

5. 实现 `ContainerTabs.jsx`：
   - 调用 `/api/scenarios/:id/containers` 获取容器列表
   - 每个容器显示为一个快捷按钮
   - 点击后向终端发送 `docker exec -it <container-name> /bin/sh\n`（或 `/bin/bash`，自动探测）
   - 按钮上显示容器角色名（去掉场景 ID 前缀后的部分，如 `kafka001-broker` 显示为 `broker`）

6. 实现详情页 `Scenario.jsx` 布局：
   - 左侧面板（40%宽）：渲染 README.md，使用 `react-markdown`
   - 右侧面板（60%宽）：
     - 顶部：`ActionBar`（start/inject/clean 按钮）+ `ContainerTabs`
     - 中部（60%高）：`Terminal`
     - 底部（40%高）：`VerifyChat`（此阶段为占位，阶段三实现）
   - 左右面板支持拖拽调整宽度比例

#### 兼容性要求

- Windows 下 node-pty 需要编译原生模块，`package.json` 中标注安装时需要 `windows-build-tools` 或 Visual Studio Build Tools，在 README 中给出安装指引
- `docker exec` 进入容器时，先尝试 `/bin/bash`，失败则退回 `/bin/sh`（部分镜像无 bash）
- xterm.js 字体：优先使用系统等宽字体，fallback 顺序：`'Cascadia Code', 'Fira Code', 'Menlo', 'Consolas', monospace`

---

### 阶段三：ActionBar — start / inject / clean

**目标**：三个按钮能触发对应操作，执行输出实时显示在终端里，inject 完成后解析并展示摘要。

#### Server 侧

1. 实现 `shellRunner.js`：
   - 封装跨平台的命令执行逻辑
   - Windows 下执行 sh 脚本时，通过 Git Bash 运行：`"C:\Program Files\Git\bin\bash.exe" -c "<command>"`
   - 设置环境变量 `MSYS_NO_PATHCONV=1` 防止路径转义
   - 返回 Promise，resolve 时携带 exit code 和完整输出

2. 实现三个 action 接口，执行方式统一：**将命令发送到该场景的 pty 会话**，而不是独立子进程。这样输出自然出现在终端里，用户体验一致。
   - `POST /api/scenarios/:id/start`：向 pty 发送 `./cli/faultlab.sh start\n`
   - `POST /api/scenarios/:id/inject`：向 pty 发送 `./cli/faultlab.sh inject\n`，同时监听输出，识别摘要区块并解析返回
   - `POST /api/scenarios/:id/clean`：向 pty 发送 `./cli/faultlab.sh clean\n`

3. inject 摘要解析逻辑（在 `actions.js` 中）：
   - 监听 pty 输出，识别 `=== FaultLab Inject Summary ===` 到 `================================` 之间的内容
   - 解析键值对（`key : value` 格式），构建 JSON 对象
   - 通过接口响应返回，供前端展示

#### 前端侧

4. 实现 `ActionBar.jsx`：
   - 三个按钮：`启动环境`、`注入故障`、`清理环境`
   - 按钮状态机：
     ```
     初始态：只有「启动环境」可点击
     启动中：三个按钮禁用，显示 loading
     已启动：「注入故障」可点击，「启动环境」变为「重启」
     已注入：「清理环境」可点击
     已清理：回到初始态
     ```
   - 「注入故障」成功后，在按钮下方展示摘要卡片（键值对列表）
   - 操作失败时按钮变红，显示错误提示

#### 兼容性要求

- faultlab.sh 的路径需要从场景目录往上找到项目根目录，用 `path.resolve` 处理，不能硬编码
- Windows 下路径分隔符统一处理，传给 sh 的路径使用正斜杠

---

### 阶段四：Verify 对话区

**目标**：用户在对话框里描述排查结论，LLM 流式返回评分和引导。

#### Server 侧

1. 实现 `verify.js`：
   - 读取当前场景的 `SOLUTION.md` 全文
   - 从 `.env` 文件读取 `ANTHROPIC_API_KEY`（使用 `dotenv`）
   - 构建系统提示词（见下方）
   - 调用 Anthropic SDK，开启流式返回
   - 通过 SSE（Server-Sent Events）将流式内容推送给前端

2. verify 系统提示词模板：
   ```
   你是一个故障排查教练。学习者正在练习排查以下场景的故障。

   ## 场景标准答案
   {SOLUTION.md 全文}

   ## 你的任务
   - 根据「评分要点（Scoring Rubric）」判断学习者的描述达到哪个级别
   - 指出学习者描述中正确的部分，给予肯定
   - 指出缺失或错误的关键点，给出提示但不直接给出答案
   - 如果学习者已达到 full_credit，给出鼓励并推荐延伸思考方向
   - 语气友好，像一个有经验的同事在做 code review
   - 回复使用中文
   ```

3. 实现 `POST /api/scenarios/:id/verify` 接口（SSE）：
   - 接收请求体：`{ message: string, history: [{role, content}] }`
   - 将历史消息传入 Claude API 实现多轮对话
   - 流式返回，Content-Type: `text/event-stream`
   - API Key 未配置时返回明确错误提示，引导用户配置 `.env`

#### 前端侧

4. 实现 `VerifyChat.jsx`：
   - 对话气泡列表，区分用户消息和 AI 回复
   - AI 回复支持 Markdown 渲染（代码块、加粗等）
   - 流式输出：AI 回复逐字出现，有光标闪烁效果
   - 底部输入框 + 发送按钮，支持 `Ctrl+Enter` 发送
   - 发送中禁用输入框，显示 loading 状态
   - API Key 未配置时，输入框上方显示提示横幅，说明如何配置

5. 实现 `useVerify.js` hook：
   - 维护对话历史状态
   - 封装 SSE 请求逻辑
   - 处理流式数据拼接

#### 兼容性要求

- SSE 连接断开时前端自动重试一次，超过一次报错提示
- API Key 存储在本地 `.env` 文件，不经过任何网络传输，在 UI 上明确告知用户

---

### 阶段五：体验打磨

**目标**：补全边界情况处理，让产品可以对外分享。

1. **启动检测页**：
   - server 启动时检测：Node.js 版本（需 >= 18）、Docker 是否运行、`.env` 是否存在
   - 检测结果在首页顶部以状态栏展示，问题项有修复引导链接

2. **Docker 状态轮询**：
   - 场景详情页每 5 秒轮询一次容器状态（`docker ps`）
   - ContainerTabs 中显示容器运行状态（绿点/红点）
   - 容器意外停止时给出提示

3. **错误处理**：
   - Docker 未运行：提示用户启动 Docker Desktop，给出各平台的启动方式
   - 镜像拉取失败：在终端输出中识别常见错误，在 UI 上补充提示
   - pty 进程崩溃：自动重建，提示用户终端已重置

4. **首次使用引导**：
   - 检测到 `.env` 不存在时，首页弹出配置向导
   - 引导用户填写 API Key，写入 `.env` 文件
   - 完成后消失，不再出现

5. **布局响应式**：
   - 最小支持宽度 1280px（开发工具使用场景，不考虑移动端）
   - 左右面板宽度比例持久化到 localStorage

6. **快捷键**：
   - `Ctrl+\`` 聚焦终端
   - `Ctrl+Shift+C` 清空终端
   - `Escape` 收起 verify 面板（可展开/收起）

---

## 启动方式

完成后用户的使用流程：

```bash
# 1. clone 仓库
git clone https://github.com/xxx/faultlab.git
cd faultlab

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 ANTHROPIC_API_KEY

# 3. 安装依赖并启动
cd web
npm install
npm run dev

# 4. 浏览器访问
# http://localhost:5173
```

server 和前端开发服务器通过 Vite 的 proxy 配置统一在同一端口，用户只需访问一个地址。生产构建时前端静态文件由 Express 托管。

---

## 关键约定

- **不修改现有 CLI 流程**：`cli/faultlab.sh` 和所有场景文件保持不变，Web UI 是叠加层
- **场景数据来源**：全部读自文件系统（`meta.yaml`、`README.md`、`SOLUTION.md`），不引入数据库
- **API Key 安全**：只存在本地 `.env`，server 侧读取后直接调用 Anthropic API，不经过任何中间层，不落盘，不打印到日志
- **pty 会话隔离**：每个场景 ID 对应一个 pty 会话，不同场景不共享终端状态
- **Windows 路径处理**：所有涉及文件路径的地方统一使用 `path.resolve()`，传给 shell 命令时转换为正斜杠，`docker exec` 前设置 `MSYS_NO_PATHCONV=1`
