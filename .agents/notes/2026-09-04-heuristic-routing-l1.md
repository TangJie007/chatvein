# 决策笔记：启发式路由 L1/L1.5 落地

状态：已落地

## 背景

普通对话每条消息若一律走满配 ReAct，寒暄与简单问答浪费 token。需要在 Agent 前增加无 LLM、毫秒级分流；拉群必须由用户在客户端完成，Agent 侧多智能体只能是子 Agent。

## 决策

- 契约：`@chatvein/common` 导出 `RouteDecision` / `RoutePolicy`（含 `allowSubAgents`、`hintUserCreateGroup`、`hintUserForge`）。
- 实现：`@chatvein/agents` 的 `routing/`——`pipeline` → `l1/`（rules+BM25）→ 可选 `l2/` stub；语言资源在 `locales/zh.json`（一期仅中文）。
- 契约：`@chatvein/common` 按域拆为 `core/` / `forge/` / `chat/`（`RouteDecision` 在 `chat/route`），对外仍扁平 `export *`。
- app `chat.service` 在 ReAct 前调用路由，推送 `chat:event` 的 `route` 与 thinking 摘要；`/` 命令本地占位，不自动建群。

## 备选方案

**每条消息弱模型分类**：贵、慢，留给 L2 灰区。

**Semantic Router（embedding）作 L1**：违背无 AI/毫秒红线。

**用拉群表达 Agent 多智能体**：否决；产品拉群仅用户操作。

**自研规则引擎**：否决；采用成熟 `json-rules-engine`。

## 影响

- 收益：可测的确定性分流；思考面板可见 band/tier；为子 Agent 与 UI 提示留钩子。
- 代价：agents 新增 json-rules-engine、wink-bm25 依赖；先例语料需持续扩充。
- 后续注意：工具白名单落地后按 `policy.tools` 裁剪；L2 接 `unknown`；UI 结构化消费 `hintUserCreateGroup`。
