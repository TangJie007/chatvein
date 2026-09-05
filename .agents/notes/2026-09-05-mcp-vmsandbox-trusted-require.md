# 决策笔记：vmsandbox 开启 require + 可信包安装

状态：已落地

取代：[2026-09-05-mcp-vmsandbox.md](./2026-09-05-mcp-vmsandbox.md) 中「只用 VM、禁用 require」的约定。

## 背景

工作区脚本常需 lodash / dayjs 等库；禁用 `require` 迫使 Agent 手写重复逻辑。需要在软隔离前提下允许 `node_modules`，但不能任意 `npm install` 冷门/恶意包。

## 决策

- 工作区脚本改用 vm2 **`NodeVM`**：`require.root = workspaceRoot`，`external: true`；builtin 仅 `SAFE_NODE_BUILTINS`（无 fs/net/child_process）。
- 新增 MCP：`ensure_trusted_packages` / `check_package_trust`。安装前校验：硬白名单 ∪ npm `last-week` 下载量 ≥ 默认 100 万；拒绝 git/file/URL；`npm install --ignore-scripts`。
- 内联 `run_js` 仍用纯 `VM`（无 require）。表达式脚本无 `exports`/`require` 时包装为 `module.exports = (expr)`。

## 备选方案

### 为什么不用「任意 npm install」？

供应链与恶意 postinstall 风险过高；下载量门槛 + 白名单是粗粒度但可自动化的信任信号。

### 为什么不用完全离线白名单？

白名单维护成本高，会挡住大量「虽不在名单但极大众」的包；下载量 API 作补充。

### 为什么仍不用 design/07 SandboxProvider？

本路径目标是短脚本 + 常用库，不是完整 npm/git/build；真 shell 仍走工作区沙箱。

## 影响

- 工具：`vmsandbox__ensure_trusted_packages` / `check_package_trust`；`run_workspace_script` 可 require 已装包。
- 风险面大于纯 VM；须持续强调软隔离与 `--ignore-scripts`。
- 下载量门槛可调（`minWeeklyDownloads`）；API 不可达则非白名单包一律拒绝。
