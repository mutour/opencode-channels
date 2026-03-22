# OpenCode Channels 设计文档

## 1. 目标
构建一个安全的、基于内网的网关，允许用户通过飞书远程控制本地 OpenCode 实例，支持动态指令扩展和自动化状态反馈。

## 2. 核心组件
- **Feishu Connector**: 使用 WebSocket 模式，支持 `HTTPS_PROXY`，适配内网环境。
- **Command Registry**: 动态扫描 `scripts/` 目录并注册 `/指令`。支持预设指令（如启动、停止、状态查询）和自定义插件。
- **OpenCode Bridge**: 封装 `opencode serve` 的 REST/SSE 调用，处理 prompt 异步发送和 SSE 流式接收。
- **Whitelist Manager**: 基于文件的授权机制（`whitelist.json`）。支持“认领”管理员和动态授权。
- **Storage Engine**: 纯文件存储（JSON/JSONL）。消息历史存储在 `storage/history/{chat_id}.jsonl`。

## 3. 数据流
1. **输入**：飞书 WebSocket 接收消息 -> 安全检查（白名单） -> 指令匹配。
2. **逻辑处理**：
   - 如果是指令：执行对应的 `script` 或内置逻辑。
   - 如果是 OpenCode 对话：将消息转发给关联的 OpenCode Session。
3. **反馈与心跳**：
   - 监听 OpenCode 的 SSE 更新。
   - 每 1 分钟或在重要阶段更新飞书消息卡片（通过 `PATCH /im/v1/messages/:message_id`）。
   - 如果长时间无响应，卡片显示超时并提供停止按钮。

## 4. 安全性
- 默认拒绝所有非白名单请求。
- 启动时自动捕获未授权请求并记录其 ID。
- 管理员可通过指令或修改配置文件添加 ID。

## 5. 目录结构
```text
/
├── config.json          # 核心配置
├── scripts/             # 动态脚本指令
├── src/
│   ├── lib/             # 核心库逻辑
│   └── index.js         # 入口文件
├── storage/
│   ├── sessions.json    # 活动会话状态
│   └── history/         # 历史记录 (JSONL)
└── logs/                # 系统日志
```
