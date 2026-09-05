# 决策笔记：MCP vmsandbox（工作区脚本 + vm2）

状态：已落地（部分约定已被取代）

> **require / 安装策略**：见更新笔记 [2026-09-05-mcp-vmsandbox-trusted-require.md](./2026-09-05-mcp-vmsandbox-trusted-require.md)（已改为 NodeVM + 信任校验安装）。

## 背景

需要在 Chat 里跑「Agent 生成的 Node 脚本」，且与当前工作区绑定：脚本落在 workspace 的 `scripts/`，再由沙箱执行。这不是 design/07 的 shell/npm 工作区沙箱，而是 **读工作区脚本文件 → vm2 求值**。

## 决策

- `@chatvein/mcp-vmsandbox-sdk` **必须** CLI 传入 `workspaceRoot`（与 openfile / filesystem 一致）。
- 主工具：`run_workspace_script`（默认仅 `scripts/**/*.{js,cjs,mjs}`）+ `list_workspace_scripts`；保留次要 `run_js` 内联。
- ~~只用 vm2 `VM`，不启用 `NodeVM`/`require`。~~ → 已由信任安装笔记取代。
- `@chatvein/tools`：`createMcpVmsandboxServer(workspaceRoot)`；无 workspace 不注入。

## 备选方案

### 为什么不默认跑工作区任意 .js？

缩小可执行面到 `scripts/`，避免误跑 `node_modules` 或配置文件。调试可用 `--allow-any-js`。

## 影响

- 推荐工作流：filesystem 写 `scripts/` →（可选）`ensure_trusted_packages` → `vmsandbox__run_workspace_script`。
- 仍须标明 vm2 软隔离、非安全边界。
