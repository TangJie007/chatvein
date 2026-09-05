# `@chatvein/mcp-vmsandbox-sdk`

MCP：**绑定工作区**，用 **vm2 `NodeVM`** 执行 `scripts/` 下脚本；可 `require` 工作区 `node_modules`。

依赖安装必须先过信任校验（硬白名单 ∪ npm 近一周下载量门槛，默认 ≥ 100 万），再 `npm install --ignore-scripts`。

典型流程：

1. `ensure_trusted_packages`（如 `lodash`、`dayjs`）→ 校验并安装到工作区
2. Agent 写入 `scripts/foo.js`（可用 `require('lodash')`）
3. `run_workspace_script` → NodeVM 执行，返回 `module.exports`

> **不是** design/07 的工作区 `child_process` 沙箱。vm2 软隔离；允许 require 后风险更高，靠白名单/下载量 + `--ignore-scripts` + 禁危险 builtin 缓解。

## Tools

| 工具 | 说明 |
|------|------|
| `run_workspace_script` | NodeVM 执行工作区脚本（默认可 require `node_modules`） |
| `list_workspace_scripts` | 列出 `scripts/` 下 `.js/.cjs/.mjs` |
| `ensure_trusted_packages` | 信任校验后安装（禁 git/file/URL；`--ignore-scripts`） |
| `check_package_trust` | 只校验不安装 |
| `run_js` | 内联短 JS，**无 require** |

## 信任策略

- **硬白名单**：lodash、zod、dayjs、es-toolkit 等常用包
- **否则**：`api.npmjs.org/downloads/point/last-week/{pkg}` ≥ `minWeeklyDownloads`（默认 `1_000_000`）
- **拒绝**：`git+` / `file:` / URL / 路径穿越
- **NodeVM builtin**：仅 `path`/`util`/`url` 等；**无** `fs` / `child_process` / `net`

## CLI / Inspector

```bash
node dist/cli.js D:/Chatvein/workspaces/my-ws
node dist/cli.js D:/ws --timeout=8000 --allow-any-js

pnpm mcp:inspect:vmsandbox
```

## Chatvein

目录 id：`mcp_vmsandbox`；有 `workspaceRoot` 时自动挂 server `vmsandbox`。
