# 决策笔记：MCP pyodide（工作区 Python + Pyodide）

状态：已落地

## 背景

需要与 vmsandbox（Node/JS）对称的「Agent 生成 Python 脚本 → 在工作区绑定下执行」能力。不宜直接调宿主本机 Python（环境分裂、难 jail）；也不走 design/07 完整 shell 沙箱（目标是短脚本 + 常用科学/数据库）。

## 决策

- 包 `@chatvein/mcp-pyodide-sdk`（`packages/mcps/pyodide`），CLI **必须** `workspaceRoot`。
- 运行时：**Pyodide**（WASM Python）；懒加载单例；主工具 `run_workspace_script`（默认 `scripts/**/*.py`）+ `list_workspace_scripts` + 内联 `run_py`。
- 依赖：`ensure_trusted_packages` / `check_package_trust`——硬白名单 ∪ PyPI `last_week` 下载量门槛（默认 100 万）；优先 `loadPackage`，否则 `micropip.install`；禁 git/file/URL。
- `@chatvein/tools`：目录 id `mcp_pyodide`，server 名 `pyodide`；有 workspace 且选中时 `withDefaultMcpPyodide` 注入。

## 备选方案

### 为什么不用宿主 python / venv？

路径、版本、site-packages 不可控；与 Electron 打包和跨平台一致性差。

### 为什么不用 Docker / design/07 SandboxProvider？

过重；本路径对齐 vmsandbox 的「软隔离短脚本」定位。

### 为什么不用 Jupyter kernel？

运维与协议更重；MCP 工具面要保持与 vmsandbox 对称的简洁。

## 影响

- 工具前缀：`pyodide__*`；首次执行会冷启动 WASM（较慢）。
- micropip 主要适合纯 Python 轮；含原生扩展的包依赖 Pyodide 预编译表。
- 非安全边界；真 shell/npm/git 仍走 design/07。
