# 决策笔记：MCP filesystem 默认挂工作区

状态：已落地

## 背景

外部工具已定为 MCP 优先（见 [2026-09-05-mcp-first-tools.md](./2026-09-05-mcp-first-tools.md)），但文件系统仍主要靠 builtin 读/列/grep，能力偏窄（无写/移/元数据）。官方 [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) 提供完整 FS 工具集；若随意开放宿主路径会违反 [07 沙箱](../../docs/design/07-沙箱方案.md) 工作区红线。

## 决策

- 有 `workspaceRoot` 时，`resolveChatTools` **默认**注入 MCP server 名 `filesystem`：`createMcpFilesystemServer(root)` → `process.execPath` 跑包内 `dist/index.js`，CLI 参数仅为该根（Allowed directories）。
- 依赖落在 `@chatvein/tools`（固定版本），避免每次 `npx -y`；Electron 设 `ELECTRON_RUN_AS_NODE=1`。
- MCP 拉起成功则 **跳过** builtin `read_file` / `list_dir` / `grep_search`；失败则回落 builtin。
- `CHATVEIN_MCP_SERVERS` 可覆盖同名 `filesystem`；`mcpFilesystem: false` 可关闭自动注入。
- 工具名带前缀：`filesystem__read_text_file` 等。

## 备选方案

### 为什么不继续只用 builtin local_fs？

缺写文件、移动、搜索文件名、媒体读等；与 MCP UI / 生态不一致。builtin 仅作后备。

### 为什么不用 Roots 动态下发、省略 CLI 目录参数？

`@langchain/mcp-adapters` 一期未接 Roots；CLI args 固定 workspace 更直观，且与设置页「工作区根」一致。

### 为什么不默认允许多目录 / 用户主目录？

越权面大；一期只挂 `effectiveWorkspaceRoot`。

## 影响

- 收益：Chat 在 `tools=full` 且有工作区时自动具备完整 FS 工具；与沙箱根对齐。
- 代价：首次/冷启动要 spawn MCP 子进程；写工具已暴露给模型，须尽快接 `confirmWrites`（T1）。
- 文档：`docs/design/12-Agent工具层.md` v0.3。
