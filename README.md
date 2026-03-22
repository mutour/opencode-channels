# OpenCode Channels (Feishu Gateway)

## 项目简介
`opencode-channels` 是一个用于桥接 **飞书 (Feishu / Lark)** 与 **OpenCode 引擎** 的服务端应用。
通过该项目，用户可以直接在飞书聊天窗口中向 OpenCode 下发指令，并实时获取 OpenCode 的任务执行状态与文本回复。

## 核心工作流程
1. **飞书消息接收**：用户向飞书机器人发送消息，通过 Lark WebSocket 事件订阅机制（`im.message.receive_v1`）被网关捕获。
2. **安全与权限控制 (Security / Whitelist Flow)**：
   - **管理员初始化**：系统初次运行不设默认管理员。首位发送消息的用户将收到包含其 `User ID` 的提示卡片，需在服务器执行 `oc-channels whitelist add <userId> admin` 进行手动绑定。
   - **管理员激活**：管理员绑定后，需向机器人发送任意消息以“激活”会话（使网关记录管理员的 `chat_id`），以便后续接收授权申请。
   - **访客授权申请**：非白名单用户发送消息时，若管理员已激活，网关会向管理员推送 **“🔐 授权申请”** 交互卡片。管理员可直接点击“批准”或“拒绝”。
   - **手动授权**：若管理员未激活或不便操作，仍可通过服务器指令 `oc-channels whitelist add <userId>` 手动将用户加入白名单。
3. **内置指令拦截**：消息内容若以 `#` 开头（如 `#help`），将被本地的指令中心 (`CommandRegistry`) 拦截处理，而不发送给模型。
4. **OpenCode 任务下发**：
   - 建立新会话 (`POST /session`)。
   - 立即向飞书回填一张 **"OpenCode 执行中..."** 的交互卡片（Interactive Card），保存消息 ID 以备后续更新。
   - 异步发送用户的请求 Prompt 至 OpenCode API (`POST /session/{id}/prompt_async`)。
5. **SSE 流式更新反馈**：
   - 全局建立一个对 OpenCode 引擎 `/event` (SSE 流) 的长连接监听。
   - 当 OpenCode 回复文本或推进步骤时，网关通过获取 `sessionID` 关联回原始用户，并积累增量文本。
   - 定时节流（例如每 3 秒）向飞书调用卡片更新接口 (`PATCH /im/v1/messages/:message_id`)。
   - 当事件提示会话进入空闲状态或结束时，更新飞书卡片状态为 **"✅ 任务完成"**，并将对话记录写入历史存储。

## 发现与修复的核心问题
在之前的逻辑中，“飞书发送给 OpenCode 能执行，但 OpenCode 回复后没有发送回飞书”的原因在于 **对 OpenCode SSE 事件的解析逻辑有严重偏差**：

1. **会话 ID 获取失败（无法关联请求）**
   - **问题原因**：旧逻辑尝试从根对象读取会话 ID (`event.sessionID`)，但实际上 OpenCode 的 SSE 载荷结构中，会话信息被包裹在了 `event.properties` 内部的多个不同层级下。
   - **修复方案**：多层级兼容提取会话 ID：`const sid = event.properties?.sessionID || event.properties?.part?.sessionID || ...;`

2. **文本拼接与增量提取错误**
   - **问题原因**：旧代码监听 `message.part.updated` 并不断追加完整文本，导致内容指数级重复。
   - **修复方案**：改用监听 `message.part.delta`，获取 `event.properties.delta` 作为增量内容追加。

3. **任务结束事件不匹配（永远处于执行中）**
   - **问题原因**：旧代码错误地监听了一个不存在的自定义事件 `"message.completed"`。
   - **修复方案**：修改结束钩子为监听 `"session.idle"`，从而正确发送“✅ 任务完成”的终态卡片。

## 指令使用
### 基础管理
- `oc-channels setup`: 交互式配置飞书 App ID 及 App Secret。
- `oc-channels start [-d]`: 启动服务（`-d` 为后台守护进程模式）。
- `oc-channels stop`: 停止后台服务。
- `oc-channels restart`: 重启后台服务。

### 权限管理 (`whitelist`)
- `oc-channels whitelist list`: 查看当前管理员、白名单用户及未授权访问记录。
- `oc-channels whitelist add <userId> [admin]`: 授权用户。若带 `admin` 参数则设为管理员。
- `oc-channels whitelist remove <userId>`: 移除用户授权。
