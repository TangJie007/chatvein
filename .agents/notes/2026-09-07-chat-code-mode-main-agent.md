# 决策笔记：单对话编程档仍走主 Agent

状态：已落地

## 背景

[`2026-09-07-chat-code-mode-orchestrator.md`](./2026-09-07-chat-code-mode-orchestrator.md) 曾约定 `workMode=code` 时优先绑定内置 `coder` Agent。这与产品边界冲突：UI「编程开发」只表达执行意图（Forge），单对话应始终由主 Agent 接待；内置「编程开发」角色是为后续群组准备的，不应被对话场景选中。此前还会把 `conversation.agentId` 持久化成 `coder`，列表与气泡显示错乱。

## 决策

单对话解析模型时：

1. **不再**因 `workMode=code` 切换到 `CODER_AGENT_ID`；编程档只换引擎（Forge），角色仍用会话绑定 Agent（默认 `main`）。
2. 若会话误绑到内置 `coder`，回退 `MAIN_AGENT_ID`，避免历史脏数据继续走角色 Agent。
3. 模型取自主 Agent 绑定；未绑定时报错提示去 Agents 给主对话选模型。
4. 内置 `coder` Agent 配置保留，供群组使用；`agent.store` 描述标明其非单对话默认。

取代旧笔记中「优先绑定内置 coder」的条款；Forge 直连、`devProjectRoot`、Harness 覆盖等工作区约定不变。

## 备选方案

**继续 code→coder 绑定，仅改 UI 文案**：角色与引擎耦合，群组角色会污染单聊；否决。

**删除内置 coder、编程档专用配置全塞进 main**：丢掉群组角色预设，后续还要重建；否决。

**custom 档才允许非 main、office/code 强制 main**：当前 UI 三档均声明「统一主 Agent 接待」，强制 main 与「会话绑定」等价（新建会话即 main）；误绑 coder 的显式回退已覆盖脏数据。

## 影响

- 收益：切「编程开发」后 `run_start.agent` / 会话 `agentId` 显示主对话；模型始终跟主 Agent。
- 代价：曾只给 `coder` 绑模型、主对话未绑的用户需改绑到主对话（错误提示已引导）。
- 后续注意：群组派单到 `coder` 时勿再套用本回退逻辑。
