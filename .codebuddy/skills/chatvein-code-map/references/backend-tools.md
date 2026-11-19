# 工具与运行时地图（`backend/mcps/`）

> 等级含义见 `../SKILL.md`「1.2 重要性等级 a–f」。路径相对仓库根。
> 这一层负责「Agent 能做什么」。改工具先想清楚：是新增工具、挂分组、改权限，还是改执行运行时？
> 工具模块协议：`TOOLS: tuple[BaseTool, ...]` + `heuristic(text) -> list[str]`（关键词命中，供无模型/预筛使用）。

## 0. 一分钟导航

| 我要… | 去这里 |
|---|---|
| 新增一个工具 | `tools/<module>.py` → `tools/__init__.py::build_tool_groups` → `prefs.ts` → `rolesStore.ts` |
| 改工具分组 / 常驻工具 | `tools/__init__.py` + `agents/graphs/common.py::ALWAYS_ON_TOOLS` |
| 改按角色勾选哪些工具 | `registry.py::resolve_tools` / `heuristic_tool_names` |
| 改离线直调执行 | `mcps/registry.py::invoke_tools` |
| 改审批 / 命令策略 | `bash_policy.py` / `powershell_policy.py` / `bash_approval.py` |
| 改文件越界判定 | `path_access.py` |
| 改工作区目录结构 | `sandbox.py`（`output/` `logs/` `runs/`，上传时才有 `uploads/`） |
| 改主空间位置 | `workspace.py` |

```text
backend/mcps/
├─ __init__.py          仅包说明，不做 re-export
├─ registry.py          注册表、分组、解析、目录元数据、离线直调
├─ sandbox.py           会话工作区 + ContextVar + 执行 cwd
├─ workspace.py         主空间解析
├─ path_access.py       路径解析 + 越界审批
├─ bash_policy.py       Bash 命令分类
├─ bash_approval.py     待审批队列
├─ bash_runtime.py / bash_download.py
├─ powershell_policy.py
├─ browser_runtime.py / browser_session.py
├─ ipwhois_runtime.py
└─ tools/               16 个工具模块（core / fs / web / sqlite / kb / sandbox / ip / ocr / pdf / skills / docx / pptx / excel / bash / powershell / browser）
```

## 1. 装配与执行

| 文件 | 等级 | 职责 | 关键符号 |
|---|---|---|---|
| `__init__.py` | e | 仅包说明；调用方直接 import 子模块 | — |
| `registry.py` | a | 工具注册表、分组定义、按角色勾选解析、目录元数据、离线直调 | `all_tools`、`tool_groups`、`tool_catalog`、`tool_catalog_text`、`resolve_tools`、`heuristic_tool_names`、`invoke_tools`（自动填参、异常转文本）、`suggest_tools_route` |
| `tools/__init__.py` | a | **分组装配**：把各模块 `TOOLS` 汇成 `core` / `mcp-*` 分组；运行时可用才加 `mcp-bash` / `mcp-powershell` / `mcp-browser` | `build_tool_groups` |
| `sandbox.py` | a | 会话工作区布局 + ContextVar + 执行 cwd；`output/` `logs/` `runs/` `uploads/` | `use_conversation_sandbox`、`current_sandbox`、`conversation_root` |
| `workspace.py` | b | 主空间解析：设置文件 > `CHATVEIN_WORKSPACE` > `<data>/workspace` | `workspace_root`、`set/reset` |
| `path_access.py` | a | 路径解析与越界访问审批（工作区内直接放行，工作区外人工确认） | `resolve_path`、越界审批 |
| `bash_policy.py` | a | Bash 命令分类：只读放行 / 需审批 / 直接拒绝 | `classify`、policy 规则 |
| `bash_approval.py` | b | 待审批队列（`/api/bash/pending` 数据源） | `pending`、`approve`、`deny` |
| `bash_runtime.py` | b | Git Bash 探测、持久会话、cwd 管理 | `probe`、session |
| `bash_download.py` | c | 下载类命令执行/超时 | 下载封装 |
| `powershell_policy.py` | b | PowerShell 命令策略 | 分类/审批 |
| `browser_runtime.py` | b | Playwright/浏览器运行时探测与安装 | 状态 |
| `browser_session.py` | c | 浏览器会话持久化/恢复 | session |
| `ipwhois_runtime.py` | c | IP 归属数据加载 | 数据源 |

## 2. 工具模块（`backend/mcps/tools/`）

| 文件 | 等级 | 分组 id | 能力 | 依赖/注意 |
|---|---|---|---|---|
| `core.py` | b | `core` | 当前时间、时区换算、计算器、系统信息、模型列表 | 无外部依赖 |
| `fs.py` | a | `mcp-fs` | 读/写/编辑/列目录/搜索文件/打开位置/删除 | 必须经 `path_access` |
| `web.py` | b | `mcp-web` | `web_search`、`web_fetch` | keyless 抓取；网络失败要人话 |
| `sqlite_tools.py` | c | `mcp-sqlite` | SQLite schema/只读查询 | 只读、结果截断 |
| `kb.py` | b | `mcp-kb` | 知识库增/查/列/删 | 与 `knowledge` 服务共用 `kb.sqlite` |
| `sandbox.py` | b | `mcp-codesandbox` | `run_python` 代码沙箱 | 超时/输出截断；工作区 cwd |
| `ip.py` | c | `mcp-ip` | IP 地理/ASN | 依赖 `ipwhois_runtime` |
| `ocr.py` | c | `mcp-ocr` | 图片 OCR | 本地 OCR 依赖可选 |
| `pdf.py` | c | `mcp-pdf` | PDF 信息/读取/合并/拆分/生成/加解密 | pypdf 等 |
| `skills.py` | b | `mcp-skills` | `load_skill` 读取完整 `SKILL.md` | **常驻工具**（`ALWAYS_ON_TOOLS`） |
| `word_tools.py` | c | `mcp-docx` | Word 生成/编辑 | python-docx |
| `pptx_tools.py` | c | `mcp-pptx` | PPT 生成/读取 | python-pptx |
| `excel_tools.py` | c | `mcp-excel` | Excel 读写/统计 | openpyxl |
| `bash.py` | a | `mcp-bash`（运行时可用才注册） | 持久 Git Bash 执行 | **默认需审批**；`bash_policy` 分类 |
| `powershell.py` | b | `mcp-powershell`（运行时可用才注册） | PowerShell 执行 | 默认需审批；`powershell_policy` |
| `browser.py` | b | `mcp-browser`（运行时可用才注册） | 浏览器打开/点击/输入/截图 | Playwright 探测 |

> 工具名以各文件 `TOOLS` 为准；新增/改名后要同步设置页与角色勾选展示，不要只改后端。

## 3. 新增一个工具（完整落点）

1. `backend/mcps/tools/<module>.py`：定义 `@tool` + `TOOLS = (...)` + `heuristic(text)`。
2. `backend/mcps/tools/__init__.py::build_tool_groups`：把 `TOOLS` 加入现有分组，或新建 `ToolGroup(id="mcp-xxx", ...)`。
3. 需要无条件可用：加入 `backend/agents/graphs/common.py::ALWAYS_ON_TOOLS`（通常只有 `load_skill` 属于此类）。
4. 前端设置页卡片：`src/components/settings/prefs.ts` 的 `MCP_SERVERS` 增加同 id 的卡片（标题/说明/图标/默认开启）。
5. 角色勾选：确认 `src/lib/rolesStore.ts::TOOLSET` 与设置页分组 id 对齐。
6. 测试：`backend/tests/test_*tools*.py`；跨平台/缺依赖时工具应返回可读错误，而不是 import 崩溃。
7. 涉及文件/命令：必须复用 `path_access` / `bash_policy`，不要在工具内自行放行。

## 4. 工具执行约定

- **上下文**：工具执行时通过 `current_sandbox()` 拿工作区；不要用全局 cwd。
- **审批**：Bash/PowerShell 在工具内部（`bash.py` / `powershell.py` + `bash_approval.py`）挂起，等 `/api/bash/approve|deny`；前端 `BashApproval` 轮询展示。
- **路径**：`path_access` 判断是否在工作区内；越界必须人工确认，不能静默读写。
- **截断**：长输出/大文件读取有上限；返回错误要可被模型理解。
- **异常**：工具异常转成「错误文本」回给模型，不要让整轮聊天 500。
- **追踪**：工具参数/结果由 `trace/recording.py` 记录；新增工具无需自己写 trace。
- **安全**：不要把 API Key、token、密钥写进工具输出或日志。

## 5. 运行时与环境变量

| 变量 | 作用 | 读取位置 |
|---|---|---|
| `CHATVEIN_TOKEN` | API token（Rust 注入） | `main.py` 中间件 |
| `CHATVEIN_DATA_DIR` | 数据根（主库/工作区/技能） | `db.py`、`workspace.py` |
| `CHATVEIN_DB_PATH` | 主库路径覆盖 | `db.py` |
| `CHATVEIN_WORKSPACE` | 主空间覆盖 | `mcps/workspace.py` |
| `CHATVEIN_PORT` / `--port` | 后端端口（Rust 探测后传入） | `main.py` |

工具运行时状态在 `GET /api/mcps/catalog` 返回（shell / powershell / browser 是否可用），设置页据此置灰。
