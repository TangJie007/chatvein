# 决策笔记：MCP shellsandbox（仅 exec/git）

状态：已落地

## 背景

曾落地 `@chatvein/mcp-sandbox-sdk` / 目录组 `mcp_sandbox`，把 Forge 同套 read/apply_patch/write/list/exec/git 挂到 Chat。读写与官方 MCP filesystem 重复，目录膨胀。需要把 Chat 侧职责拆清：文件与命令分离。

## 决策

1. **包更名为 `@chatvein/mcp-shellsandbox-sdk`**（`packages/mcps/shellsandbox`）；目录组 **`mcp_shellsandbox`**，server 名 / 前缀 `shellsandbox` / `shellsandbox__*`。
2. **MCP 仅暴露 `exec_shell`、`git_op`**（`LocalSandboxProvider`）；不再注册 read/write/patch/list。
3. **文件读写**：已改 deepagents Composite（见 [2026-09-07-deepagents-filesystem-composite.md](./2026-09-07-deepagents-filesystem-composite.md)）；本笔记落地时曾用 MCP filesystem，现已删除。
4. 取代 [2026-09-07-mcp-sandbox-catalog.md](./2026-09-07-mcp-sandbox-catalog.md) 中「MCP 暴露全套编码工具 / 组名 mcp_sandbox」的部分。

## 备选方案

### 为什么不用保留 `mcp_sandbox` 全套？

与文件工具面重复；命令与读写拆开更清晰。

### 为什么不用继续叫 `sandbox`？

与 `@chatvein/sandbox` 能力包、`vmsandbox` 易混；收窄为 shell/git 后 `shellsandbox` 更贴切。

## 影响

- **收益**：Chat 工具面清晰；Coder 默认开 `mcp_shellsandbox`（文件走 Composite `/workspace/`）。
- **注意**：旧 agent 白名单里的 `mcp_sandbox` / `mcp_filesystem` 失效。
