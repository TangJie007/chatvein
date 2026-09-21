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
| 时间 / 计算 / 本机概况 | `core` | `get_current_time` `convert_time` `calculator` `get_system_info` `db_stats` `list_configured_models` | 对齐 WorkBuddy 文档中的 Time MCP（`mcp-server-time`）：按 IANA 时区取当前时间、时区换算；`CHATVEIN_LOCAL_TIMEZONE` 可覆盖本机时区。计算器为安全算术。本机概况含 OS/CPU/磁盘；另附 ChatVein 库表与模型列表。无独立设置卡片 |
| 代码沙箱 | `mcp-codesandbox` | `sandbox_info` `sandbox_create_venv` `sandbox_write_file` `sandbox_pip_install` `sandbox_run_python` | 创建对话时在主空间建 `YYYYMMDD-HHMMSS-` + 5 位随机字符目录，这是该对话的工作区。只在此目录建 `.venv`、写 `.py`、执行并读 stdout/stderr。删除会话时一并删掉该目录 |
| Git Bash | `mcp-bash` | `bash_info` `bash_run` | 优先本机 Git（`CHATVEIN_GIT_BASH` → 安装路径 / PATH）。Windows 未找到时按需下载 **MinGit** 到 `CHATVEIN_DATA_DIR/git-bash/`（钉版本 + SHA256，不进安装包）。`CHATVEIN_SKIP_BASH_DOWNLOAD=1` 关闭下载。**下载失败或不在 Windows：不注册该分组，降级依赖 `mcp-powershell`** |

| PowerShell（仅 Windows） | `mcp-powershell` | `powershell_info` `powershell_run` | 对齐 WorkBuddy：有 Bash 时两者并存；无 Bash 时它是唯一 shell。`CHATVEIN_POWERSHELL_PATH` / `pwsh` / Windows PowerShell；`CHATVEIN_USE_POWERSHELL_TOOL=0` 关闭。命令同样限会话目录 + 确认 |
| Browser 自动化 | `mcp-browser` | `browser_info` `browser_navigate` `browser_navigate_back` `browser_navigate_forward` `browser_reload` `browser_snapshot` `browser_find` `browser_click` `browser_hover` `browser_drag` `browser_drop` `browser_type` `browser_fill_form` `browser_select_option` `browser_press_key` `browser_file_upload` `browser_handle_dialog` `browser_evaluate` `browser_take_screenshot` `browser_console_messages` `browser_network_requests` `browser_network_request` `browser_wait_for` `browser_resize` `browser_close` `browser_tabs` | 进程内 Playwright，工具名/参数对齐 `@playwright/mcp` Core + Tabs。先 snapshot 再按 `ref` 交互。需本机 `playwright install chromium`（或 `CHATVEIN_BROWSER` / `CHATVEIN_BROWSER_EXECUTABLE`）；**未探测到则不注册**。默认 headed，`CHATVEIN_BROWSER_HEADLESS=1` 无头。不暴露 `browser_run_code_unsafe`。截图落盘主空间 `browser-output/` |
| IP 归属地 | `mcp-ip` | `get_my_location` `lookup_ip_region` | 离线 `py-ip2region`。`get_my_location` 先探测公网出口再查库；`lookup_ip_region` 查给定 IPv4/IPv6。xdb 首次使用下载到 `CHATVEIN_DATA_DIR/ip2region/`，可用 `CHATVEIN_IP2REGION_V4` / `CHATVEIN_IP2REGION_V6` 指向本地文件 |
| OCR 识字 | `mcp-ocr` | `ocr_image` `ocr_image_base64` | 先 OCR.space（默认公共 key `helloworld`，可用 `CHATVEIN_OCR_SPACE_KEY`）；失败则在当前会话沙箱 `pip install rapidocr-onnxruntime`、写 `ocr_run.py` 并执行。支持 URL 或工作区/会话目录内路径 |
| 自定义 HTTP MCP | `mcp-http` | （配置位） | 设置页占位；后续用 LangChain `MCPAdapter` 拉远程工具 |

目录 API：`GET /api/mcps/catalog`。内置 MCP 开关只读：由本机探测决定「运行中 / 不可用」，
用户不能切换；未探测到的 Bash / PowerShell / Browser 不注册工具分组。

### 刻意不做（长期）

1. **通用 cmd**：不开放 `cmd.exe`。Bash / PowerShell 只在当前会话目录执行；危险命令直接拒绝，其余改动要用户在对话框里允许。未检测到对应解释器时，该分组不会注入 Agent。
2. **外置 MCP 子进程**（`npx @modelcontextprotocol/server-filesystem`、`npx @playwright/mcp` 等）：与 `builtin://` 设计重复，体积与打包成本更高；优先内置工具。Browser 以进程内 Playwright 对齐上游工具面，不另起 Node MCP。
3. **GitHub / Notion / Slack 等 SaaS 连接器**：走用户自配 `mcp-http`，不塞进默认分发。
4. **`browser_run_code_unsafe`**：上游 `@playwright/mcp` 标明 RCE-equivalent（在 Playwright **服务端进程**执行任意 JS）。桌面 Agent 进程内工具面**不暴露**；复杂逻辑只用页面内 `browser_evaluate` 或拆成 Core 工具。Chromium 等浏览器二进制不打进安装包。

### 当前不做、后期需要补

| 项 | 现状 | 后期补什么 | 备注 |
| --- | --- | --- | --- |
| **Browser `--caps`** | 只对齐 Core + Tabs | 按需对齐上游可选能力：`vision`（坐标鼠标）、`pdf`（`browser_pdf_save`）、`devtools`、`storage`、`network`、`testing` | 官方用 `--caps=` / `PLAYWRIGHT_MCP_CAPS` opt-in；补时需设置页开关、依赖探测、落盘与权限说明。细节见 `.agents/notes/mcp-browser.md` |
| **自定义 HTTP MCP（`mcp-http`）** | 设置页占位 | LangChain `MCPAdapter` 拉远程工具；用户自配 URL / headers | 承接 SaaS 连接器，不进默认分发 |
| **Skill 市场：安装 / 使用** | 侧边栏可浏览 SkillHub 目录（`GET /api/skills/`） | 下载到本机 skills 目录、发现 `SKILL.md`、注入 Agent；更新 / 卸载 | 浏览已接；registry URL 宜可配置。与 MCP 工具轨分离 |
| **Filesystem `read_media_file`** | 未对齐上游 | 若产品需要读图/音视频元数据再补 | 首版刻意省略 |
| **Browser caps 之外的体验** | headed 默认、截图进 `browser-output/` | 无头策略、多 profile、下载目录策略等按需打磨 | 不阻塞主路径 |

优先级建议：`mcp-http` 与 Skill 安装/使用按产品节奏；Browser caps 按真实场景缺口（PDF / 坐标点击）逐项开，不要一次全开。
