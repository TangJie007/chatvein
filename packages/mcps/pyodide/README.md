# `@chatvein/mcp-pyodide-sdk`

MCP：**绑定工作区**，用 **Pyodide**（WASM Python）执行 `scripts/**/*.py`。

依赖安装必须先过信任校验（硬白名单 ∪ PyPI 近一周下载量门槛，默认 ≥ 100 万），再 `loadPackage` / `micropip.install`。

典型流程：

1. `ensure_trusted_packages`（如 `numpy`、`pandas`）
2. Agent 写入 `scripts/foo.py`
3. `run_workspace_script` → 返回最后表达式结果与 stdout

与 Node 侧 `@chatvein/mcp-vmsandbox-sdk` 对称；**不是**宿主本机 Python / design/07 沙箱。

## Tools

| 工具 | 说明 |
|------|------|
| `run_workspace_script` | 执行工作区 `.py`（默认仅 `scripts/`） |
| `list_workspace_scripts` | 列出 `scripts/` 下 `.py` |
| `ensure_trusted_packages` | 信任校验后安装到 Pyodide 运行时 |
| `check_package_trust` | 只校验不装 |
| `run_py` | 内联短 Python |

## CLI / Inspector

```bash
node dist/cli.js D:/Chatvein/workspaces/my-ws
pnpm mcp:inspect:pyodide
```

## Chatvein

目录 id：`mcp_pyodide`；有 `workspaceRoot` 时自动挂 server `pyodide`。
