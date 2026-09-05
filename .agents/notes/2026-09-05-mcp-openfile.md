# 决策笔记：MCP openfile（打开文件夹）

状态：已落地

## 背景

Agent 需要「在资源管理器 / Finder 中打开工作区路径」：目录直接打开；若路径是文件则打开其所在文件夹。文件系统 MCP 只负责读写，不覆盖 OS UI。能力需可走 MCP（与 MCP-first 一致），并继续 jail 在 `workspaceRoot`。

## 决策

- 新增包 `@chatvein/mcp-openfile-sdk`，路径 `packages/mcps/openfile`。
- 工具：`open_folder`（文件→父目录）、`list_allowed_directories`。
- 打开实现：子进程 `explorer` / `open` / `xdg-open`（MCP 是独立进程，不用 Electron `shell`）。
- `@chatvein/tools` 目录项 `mcp_openfile`；有 workspace 时 `withDefaultMcpOpenfile` 自动注入 server `openfile`。

## 备选方案

### 为什么不用 Electron `shell.openPath` 直接绑 LangChain 工具？

MCP 子进程与主进程隔离；统一走 MCP 后 Cursor / CLI 也能复用同一 server，不必再维护一套主进程 IPC。

### 为什么不用 `explorer /select` 高亮文件？

产品要求是「打开文件夹」；文件场景只打开父目录，行为跨平台一致、语义更简单。

### 为什么不塞进 `server-filesystem`？

官方 filesystem 专注读写；打开 UI 是正交能力，独立包便于版本与权限说明。

## 影响

- workspace 新增 `packages/mcps/*`。
- CodeReview 默认白名单含 `mcp_openfile`。
- 未传允许目录时可打开任意路径（仅调试）；Chat 默认始终传入 `workspaceRoot`。
