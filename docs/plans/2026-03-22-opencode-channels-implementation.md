# OpenCode Channels 实施计划

> **致 Claude：** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development 逐项执行。

**目标：** 开发一个支持飞书远程控制、动态插件和白名单安全的 OpenCode 网关。

**架构：** 基于 Node.js，采用 Feishu SDK WebSocket 模式，通过文件系统管理状态，支持动态加载 JS 脚本作为扩展指令。

**技术栈：** Node.js, `@larksuiteoapi/node-sdk`, `axios`, `eventsource`, `https-proxy-agent`, `chokidar`.

---

### Task 1: 项目初始化与依赖安装

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `config.json`

**Step 1: 初始化 package.json**
```bash
npm init -y
npm install @larksuiteoapi/node-sdk axios eventsource https-proxy-agent chokidar dotenv
```

**Step 2: 创建基础配置 config.json**
```json
{
  "feishu": {
    "appId": "",
    "appSecret": "",
    "domain": "https://open.feishu.cn"
  },
  "proxy": "",
  "whitelist": [],
  "admin": "",
  "opencode": {
    "port": 4096,
    "host": "127.0.0.1"
  }
}
```

**Step 3: 提交**
```bash
git add package.json config.json
git commit -m "init: project structure and dependencies"
```

---

### Task 2: 飞书 WebSocket 连接与代理适配

**Files:**
- Create: `src/lib/feishu.js`
- Create: `src/index.js`

**Step 1: 实现核心飞书客户端逻辑**
- 支持从 `config.json` 读取 `proxy` 并传给 `WSClient` 的 `agent` 参数。
- 支持 `lark.Client` 自定义 `httpInstance` (Axios) 以使用代理。

**Step 2: 验证连接**
- 编写简单的 `src/index.js` 启动 WS 并打印连接成功日志。

---

### Task 3: 指令系统与动态脚本加载

**Files:**
- Create: `src/lib/commands.js`
- Create: `scripts/hello.js`
- Create: `scripts/date.js`

**Step 1: 实现命令注册器**
- 扫描 `scripts/` 目录。
- 支持 `/start`, `/stop`, `/status` 等内置指令。
- 使用 `fs.watch` 或 `chokidar` 实现脚本的热重载。

---

### Task 4: 白名单与安全层

**Files:**
- Create: `src/lib/security.js`
- Create: `storage/unauthorized.log`

**Step 1: 实现中间件逻辑**
- 在消息处理前检查 `sender.id`。
- 如果不在白名单，记录 ID 到 `unauthorized.log` 并反馈给用户。
- 如果是 ADMIN，允许执行特权指令。

---

### Task 5: OpenCode Bridge (REST/SSE)

**Files:**
- Create: `src/lib/opencode.js`

**Step 1: 封装 OpenCode 交互**
- `POST /session` 创建会话。
- `POST /session/:id/prompt_async` 发送内容。
- `GET /event` 监听流，并实现 **节流 (Throttle)** 逻辑。

---

### Task 6: 消息卡片与状态反馈

**Files:**
- Create: `src/lib/cards.js`

**Step 1: 实现飞书卡片更新逻辑**
- 模拟进度条。
- 更新任务状态（思考中、工具执行、已完成）。
- 整合心跳检测，超时自动更新卡片。

---

### Task 7: 存储层 (JSONL) 与历史记录

**Files:**
- Create: `src/lib/storage.js`
- Create: `storage/history/.gitkeep`

**Step 1: 实现 JSONL 追加写入**
- 每条消息流转都异步存入 `chat_{id}.jsonl`。

---

### Task 8: 整体集成与冒烟测试

**Step 1: 整合所有模块**
- 完善 `src/index.js`。
- 本地启动测试。
