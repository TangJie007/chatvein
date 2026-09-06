# 决策笔记：MCP 工具描述覆盖（向量化）

状态：已落地

## 背景

工具选用方案（[docs/tool-selection-design.md](../../docs/tool-selection-design.md)）要用工具描述做 per-turn 检索（关键词 / embedding Top-K）。官方 / 自研 MCP 的 description 或偏长、或跨 server 同名语义不同——直接 embedding 区分度差，也不利于层 D 的 token 压缩。

## 决策

- **不** fork / patch 上游包；行为与 schema 仍来自各 MCP server。
- 在 `@chatvein/tools` 的 `loadMcpTools` 之后，用 `applyMcpDescriptionOverrides` 就地改写 `description`。
- 覆盖表：`mcp-description-overrides.ts`，按 server 拆分再合并为 `MCP_TOOL_DESCRIPTION_OVERRIDES`：
  - filesystem / openfile / modsearch / vmsandbox / pyodide / playwright
- key 规则：裸工具名优先；**跨 server 同名**必须用 `{server}__{tool}`（如 `list_allowed_directories`、`run_workspace_script`）。
- 文案原则：短句、去共有套话、中英意图同义词并存。
- 向量索引用 `mcpToolEmbedText(name, server?)`，不必起 MCP 进程。

## 备选方案

### 为什么不改官方/上游包源码？

升级与补丁成本高；我们只改「怎么跟模型/检索说话」。

### 为什么不用单独 `retrievalText`、保留官方长描述给模型？

一期 StructuredTool 进模型的就是 `description`；短描述同时服务层 D 与层 C。若损害 tool-calling 准确率，再拆双轨。

### 为什么不在 MultiServerMCPClient 配置里改？

adapters 无稳定的 per-tool rewrite API；load 后覆盖可单测。

## 影响

- 收益：各 MCP 工具描述可区分、更短，利于 embedding 选用。
- 代价：上游改工具名需同步覆盖表；Inspector 直连原进程仍见原描述。
