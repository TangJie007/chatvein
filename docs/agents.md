# Agent 流水线：改写 + 难度图

全程使用 **主模型**（`ModelsService.get_runtime_config()` → `agents.llm`）。

| 包 | 职责 |
| --- | --- |
| `agents/router.py` | 一次 structured：`rewritten` + `difficulty` |
| `agents/tool_selector.py` | 只缩工具集（吃改写后文本） |
| `agents/service.py` | 按难度进不同图 |
| `mcps/` | 工具注册 + 按名 invoke（实现见 `mcps/tools/`） |

```text
原文
  → understand（改写 + simple|medium|hard）
       ├─ simple  → 直接对话（主模型）
       ├─ medium  → tool_selector → create_agent（简洁 system）
       └─ hard    → tool_selector → create_agent（多步/核对 system）
```

落库 `Message.route` 写入难度档位；HTTP 额外返回 `rewritten` / `difficulty`。
原文仍作为用户消息入库，改写只供下游 Agent 使用。

## WorkBuddy 对齐：内置 MCP / 工具矩阵

ChatVein 是本机桌面 Agent（Tauri + Python），前端设置页已规划 `builtin://mcp-*`。
本仓库用 **进程内 LangChain `@tool`** 实现同等能力（不另起 MCP 子进程），分组 id 与
`src/components/settings/prefs.ts` 的 `MCP_SERVERS` 对齐。

| 能力（WorkBuddy） | ChatVein 分组 | 工具 | 说明 |
| --- | --- | --- | --- |
| Filesystem（对齐 `@modelcontextprotocol/server-filesystem`，不含 `read_media_file`） | `mcp-fs` | `read_file` `read_text_file` `read_multiple_files` `write_file` `edit_file` `create_directory` `list_directory` `list_directory_with_sizes` `directory_tree` `move_file` `search_files` `get_file_info` `list_allowed_directories` `open_folder` `delete_path` | 主空间（设置页）优先，否则 `CHATVEIN_DATA_DIR/workspace`。`open_folder` 打开目录；`delete_path` 删除文件或文件夹，不能删主空间根 |
| WebSearch / WebFetch | `mcp-web` | `web_search` `web_fetch` | 先 Firecrawl（`FIRECRAWL_API_KEY`，无 key 走免费档）；402/失败降级 `ddgs` + `httpx`/`bs4` |
| 本地库 / 数据 | `mcp-sqlite` | `sqlite_tables` `sqlite_schema` `sqlite_query` | **只读**打开 ChatVein SQLite |
| 知识沉淀 / 召回 | `mcp-kb` | `kb_add_note` `kb_search` `kb_search_messages` `kb_index_workspace` | 独立 `kb.sqlite`；向量模型就绪时走 sqlite-vec |
| 时间 / 计算 / 本机概况 | `core` | `get_current_time` `calculator` `db_stats` `list_configured_models` | 无独立设置卡片 |
| 代码沙箱 | `mcp-codesandbox` | `sandbox_info` `sandbox_create_venv` `sandbox_write_file` `sandbox_pip_install` `sandbox_run_python` | 创建对话时在主空间建 `YYYYMMDD-HHMMSS-` + 5 位随机字符目录，这是该对话的工作区。只在此目录建 `.venv`、写 `.py`、执行并读 stdout/stderr。删除会话时一并删掉该目录 |
| Git Bash | `mcp-bash` | `bash_info` `bash_run` | 优先 `CHATVEIN_GIT_BASH`，其次资源目录或 `resources/git` 里的 Portable Git，最后本机 Git for Windows。每条命令独立进程，当前目录在会话内保留，环境变量不保留。只读命令直接执行；改文件需界面确认；`rm`、下载执行、盘符和 `..` 直接拒绝。不开放 PowerShell / cmd |
| Browser 自动化 | — | （暂缓） | 可后续接 Playwright MCP |
| 自定义 HTTP MCP | `mcp-http` | （配置位） | 设置页占位；后续用 LangChain `MCPAdapter` 拉远程工具 |

目录 API：`GET /api/mcps/catalog`。

### 刻意不做 / 延后

1. **通用 Shell**：不开放 `cmd` / PowerShell。Git Bash 只在当前会话目录执行，危险命令直接拒绝，其余改动要用户在对话框里允许。
2. **外置 MCP 子进程**（`npx @modelcontextprotocol/server-filesystem` 等）：与 `builtin://` 设计重复，体积与打包成本更高；优先内置工具。
3. **GitHub / Notion / Slack 等 SaaS 连接器**：走用户自配 `mcp-http`，不塞进默认分发。
