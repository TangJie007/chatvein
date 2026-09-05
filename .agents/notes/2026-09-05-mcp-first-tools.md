# 决策笔记：外部工具 MCP 优先接入

状态：已落地

## 背景

`@langchain/community` 已 sunset；曾试点 `@tools/modsearch`（CLI 包装）作默认联网，但增加专用适配包与维护面，且与官方「独立包 / 应用内工具 / MCP」方向不完全一致。产品侧已有 MCP 管理 UI（一期 mock），需要把 **Chat 真实绑工具** 接到同一路径。

## 决策

- **外部能力优先 MCP**：`@chatvein/tools` 用 `@langchain/mcp-adapters` 的 `MultiServerMCPClient` 拉工具；`resolveChatTools({ mcpServers })` 合并结果，**同名时 MCP 覆盖 catalog**。
- Chat 主进程通过 `CHATVEIN_MCP_SERVERS` JSON 注入额外 server；**有工作区时默认再挂 MCP filesystem**（见 [2026-09-05-mcp-filesystem-workspace.md](./2026-09-05-mcp-filesystem-workspace.md)）。
- **本地差异化**：builtin 仅作 MCP filesystem 失败时的读/列/grep 后备；sqlite / `js_eval` / `fetch_url` 仍 builtin。
- **删除** `@tools/modsearch` 及一切引用；不再以专用 CLI 包装包作为默认联网方案。
- community 计算器/百科/DDG 等保留为无 MCP 时的过渡默认集。

相对 [2026-09-05-tools-catalog-community.md](./2026-09-05-tools-catalog-community.md)：默认外部接入策略改为 MCP；community 仅残余。

## 备选方案

### 为什么不用每个能力一个 `packages/tools/*` 适配包？

重复造壳、版本锁死上游 CLI；MCP 已是跨 harness 标准，LangChain 有成熟适配。自研适配只留给 jail / 治理差异。

### 为什么早期否决「默认 MCP filesystem」？

当时担心任意路径越权。现已改为 **仅挂 `workspaceRoot`**，与沙箱红线一致；详见后继笔记。

### 为什么不内嵌 Firecrawl/Tavily SDK？

用户可用对应 MCP server 注入；产品不锁定单一搜索供应商。

## 影响

- 收益：联网/第三方可热插拔；工作区 FS 走官方 MCP；去掉 modsearch 包依赖。
- 代价：开箱联网仍可能依赖 community/DDG；FS 写能力需后续确认流。
- 后续：设置页持久化 MCP 配置；community 日落。
