# 决策笔记：MCP shellsandbox（仅 exec/git）

状态：已落地

## 背景

曾落地 `@chatvein/mcp-sandbox-sdk` / 目录组 `mcp_sandbox`，把 Forge 同套 read/apply_patch/write/list/exec/git 挂到 Chat。随后发现读写/局部编辑与官方 `mcp_filesystem`（`read_text_file` / `edit_file` / `write_file` / `list_directory`）重复，目录膨胀且易让模型在两套写文件工具间摇摆。需要把 Chat 侧职责拆清：文件走 filesystem，白名单命令走专用 MCP。

## 决策

1. **包更名为 `@chatvein/mcp-shellsandbox-sdk`**（`packages/mcps/shellsandbox`）；目录组 **`mcp_shellsandbox`**，server 名 / 前缀 `shellsandbox` / `shellsandbox__*`。
2. **MCP 仅暴露 `exec_shell`、`git_op`**（`LocalSandboxProvider`）；不再注册 read/write/patch/list。
3. **Chat 文件读写统一用 `mcp_filesystem`**；Forge 仍用进程内 `createForgeTools` + `@chatvein/sandbox` coding-ops（含敏感路径拦截），运输层不统一。
4. 取代 [2026-09-07-mcp-sandbox-catalog.md](./2026-09-07-mcp-sandbox-catalog.md) 中「MCP 暴露全套编码工具 / 组名 mcp_sandbox」的部分。

## 备选方案

### 为什么不用保留 `mcp_sandbox` 全套并关掉 filesystem 写工具？

filesystem 已是官方默认、功能更全（多文件读、目录树、search_files、edit dryRun）；用自研复刻读写没有收益。

### 为什么不用继续叫 `sandbox`？

与 `@chatvein/sandbox` 能力包、`vmsandbox` 易混；收窄为 shell/git 后 `shellsandbox` 更贴切。

### 为什么不把 filesystem 的 edit 换成自研 apply_patch（带 .env 拦截）？

Chat 侧优先少工具、少分叉；敏感路径策略仍由 Forge coding-ops 守住热路径。若 Chat 也要拦 `.env`，应在挂载层或 filesystem 外包一层，而不是再挂第三套写文件工具。

## 影响

- **收益**：Chat 工具面更清晰；Coder 默认同时开 `mcp_filesystem` + `mcp_shellsandbox`。
- **代价**：Chat 写文件不再走 coding-ops 的敏感路径拦截（与 filesystem 一致）。
- **注意**：旧 agent 白名单里的 `mcp_sandbox` 失效，需改成 `mcp_shellsandbox` 或重置默认 Agent。
