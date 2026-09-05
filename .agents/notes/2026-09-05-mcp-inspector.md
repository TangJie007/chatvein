# 决策笔记：根目录安装 MCP Inspector

状态：已落地

## 背景

自研 MCP（openfile / modsearch）与官方 filesystem 需要进程外冒烟：列工具、手动 call，不必每次绕 Chat ReAct。官方提供 [`@modelcontextprotocol/inspector`](https://modelcontextprotocol.io/docs/tools/inspector)。

## 决策

- 根 `devDependencies` 固定 `@modelcontextprotocol/inspector`（当前 ^2.5），避免每次 `npx` 漂版本。
- `pnpm-workspace.yaml` `allowBuilds` 放行该包 postinstall。
- 根脚本：`mcp:inspect`、`mcp:inspect:openfile|modsearch|filesystem`；子包 `inspect` 先 build 再拉起。

## 备选方案

### 为什么不用纯 `npx -y`？

可零安装，但团队脚本与文档要可复现；锁进 lockfile 更稳。日常仍可用 `npx`。

### 为什么不进 `@chatvein/tools` 运行时依赖？

Inspector 只服务开发调试，不应打进 Electron / sidecar 产物。

## 影响

- 文档：`docs/phase1/04`、`design/12`/`13`、`packages/mcps/README.md`。
- 首次 clone 若仍报 `ERR_PNPM_IGNORED_BUILDS`，确认 workspace `allowBuilds` 含 inspector 后重装。
