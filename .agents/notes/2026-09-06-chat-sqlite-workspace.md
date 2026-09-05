# 决策笔记：对话持久化（drizzle + 会话工作区目录）

状态：已落地

## 背景

对话原先仅主进程内存，重启即空；UI 还会在空列表时自动建一条「新对话」。需要：空库真正空、可删除、每会话独立工作区/沙箱目录，并用 SQLite 记录。

## 决策

- DB：`userData/forge/chat.db`，`drizzle-orm`（`sqlite-core` + `node-sqlite` / `node:sqlite`），表 `conversations`（元数据）+ `messages`（会话历史）；`PRAGMA foreign_keys=ON`，删会话 CASCADE 消息。
- 工作区目录：只放 `scripts/`、`runs/` 等产物，**不**存聊天记录。
- 设置：仅配置工作区根；废弃独立 `runsRoot`。
- 新建会话：`slug = YYYYMMDD-HHmmss-<8hex>`；`workspacePath = effectiveWorkspaceRoot/slug`；`sandboxPath = workspacePath/runs`。
- 工具绑定：`resolveChatTools` 使用该会话的 `workspacePath`，不再一律用全局根。
- 删除：删库行（CASCADE 消息）+ 尽力 `rm` 会话根目录；列表提供删除按钮。
- 启动：不再自动 `create`；空列表提示用户点「+」。首条发送若无会话仍会 `ensureActive` 建一条。

## 备选方案

### 为什么不用 better-sqlite3？

Electron 主进程原生模块成本高；`node:sqlite` 已可用且与依赖选型一致。

### 为什么不用继续 JSON 落盘？

需要按会话关联路径与消息查询；SQL 表更清晰。

### 为什么 drizzle 用 1.0 RC？

稳定版尚未提供 `drizzle-orm/node-sqlite`；RC 去掉 `drizzle({ schema })`，查询处直接引用表对象即可。

## 影响

- 旧内存会话不迁移；遗留 `conversations.json` 仍会清理一次。
- 需 Electron/Node 支持 `node:sqlite`（本仓 engines ≥22.12）。
- 依赖 pin 在 `drizzle-orm@1.0.0-rc.4`，RC 升级时注意 API 变动。
