# 决策笔记：MCP filesystem 默认挂工作区

状态：已落地

## 背景

外部工具已定为 MCP 优先（见 [2026-09-05-mcp-first-tools.md](./2026-09-05-mcp-first-tools.md)）。官方 [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) 提供完整 FS 工具；若与 builtin 读/列/grep 并存，模型会在两套 API 间摇摆。

## 决策

- 有 `workspaceRoot` 且目录启用 `mcp_filesystem` 时，注入 MCP server `filesystem`：`createMcpFilesystemServer(root)`（CLI 参数仅为该根）。
- **不提供** builtin `read_file` / `list_dir` / `grep_search`；已删除 `categories/local-fs.ts`。
- 目录只保留一项 `mcp_filesystem`（`source: mcp:@modelcontextprotocol/server-filesystem`）供白名单。
- `CHATVEIN_MCP_SERVERS` 可覆盖同名 `filesystem`；`mcpFilesystem: false` 关闭自动注入（此时无本地文件工具）。

## 备选方案

### 为什么不保留 builtin 作后备？

双轨工具名与语义不一致，干扰选型；MCP 失败时应修连接，而不是静默降级到弱实现。

### 为什么不用 Roots 动态下发？

一期 adapters 未接 Roots；CLI args 固定 workspace 更直观。

## 影响

- 收益：模型只见 `filesystem__*`；与沙箱根对齐。
- 代价：MCP 挂不上则无本地文件能力；写工具已暴露，需尽快接 `confirmWrites`。
