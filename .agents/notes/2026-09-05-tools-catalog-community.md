# 决策笔记：Agent 工具目录用 community + builtin

状态：已落地（**外部接入策略已被 [MCP 优先](./2026-09-05-mcp-first-tools.md) 取代；本文仅保留目录 + builtin jail 依据**）

## 背景

L3 ReAct 需要真实工具才能验证「调工具 → 回灌 → 作答」闭环；`@chatvein/tools` 此前仅为版本占位。用户要求按七大品类组织，并优先使用 `@langchain/community`。同期官方已 sunset 该包，需在「复用现成实现」与「桌面沙箱红线」之间定案。

## 决策

- 在 `@chatvein/tools` 落地 `TOOL_CATALOG`（七类）与 `resolveChatTools({ policy, allowIds, workspaceRoot, secrets })`。
- **搜索 / 计算 / 百科 / StackExchange / Trends** 等：工厂内动态 import `@langchain/community/tools/*`，外包 `DynamicTool` 做超时与输出截断。
- **本地文件 / 受限 js_eval / fetch_url / sqlite 只读**：builtin，路径限制在设置中的 `effectiveWorkspaceRoot`。
- Chat：`policy.tools=full` 时绑定；`agent.tools=[]` 视为未配置白名单 → 默认集；非空则求交。
- 依赖选型写入 `docs/phase1/04-依赖选型.md`；设计见 `docs/design/12-Agent工具层.md`。

## 备选方案

**整包默认 MCP filesystem**：与 [07 沙箱](../../docs/design/07-沙箱方案.md) 工作区/命令白名单冲突，分发与越界控制难，否决为默认。

**完全自研全部工具**：违背「优先成熟第三方」；搜索/计算器无必要自写。

**立即只依赖 `@langchain/tavily` 等独立包**：联网搜索更好，但密钥与分发成本高于 DuckDuckGo；作 T1 演进，不挡 T0。

**继续强依赖 community 作为长期主路径**：包已 sunset，仅作过渡锚点，目录 `source` 字段预留迁出。

## 影响

- 收益：L3 在 `tools=full` 时可验证 ReAct；品类清晰，密钥类可渐进打开。
- 代价：community 弃用警告；部分 peer 工具需额外安装；Trends/Brave/Serp 依赖环境变量。
- 后续注意：写文件 / shell 必须进 `SandboxProvider`；BudgetGuard；community 日落项迁独立包。
