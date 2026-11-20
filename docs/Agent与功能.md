# Agent 与功能

> 本文由 `Agent流水线.md`（Agent 图设计：总图 / 三档子图 / 状态 / 参数 / 工具矩阵）与 `功能清单.md`（已实现能力与边界）合并而成。
> 章节号沿用原文，引用写法：`§Agent流水线 7`＝「Agent 流水线」部分第 7 节，`§功能清单 3` 同理。
> 拓扑与分层见 [`架构与目录.md`](./架构与目录.md)；机制类实现见 [`机制详解.md`](./机制详解.md)。

## Agent 流水线

> 全文分两部分：**流水线总览与工具矩阵**（能力面），**图设计**（节点、状态、参数）。
> 功能清单见 [`Agent与功能.md`](./Agent与功能.md)；工作区规则见 [`机制详解.md`](./机制详解.md)；工具人工测试集见 [`运维手册.md`](./运维手册.md)。

---

### 1. 流水线总览：改写 + 难度路由

```text
原文
  → [pipeline] understand（改写 + simple|medium|hard）
       ├─ simple  → 单节点直答图（主模型，无工具）
       ├─ medium  → [子图] tool_selector → ReAct（create_agent：agent⇄tools）
       └─ hard    → [子图] plan → tool_selector → ReAct → verify
                    （未通过可回环再选型/执行，有回环上限）
```

| 包 | 职责 |
| --- | --- |
| `agents/router.py` | 一次 structured：`rewritten` + `difficulty` |
| `agents/tool_selector.py` | 只缩工具集（吃改写后文本；hard 另附计划） |
| `agents/graphs/pipeline.py` | 入口 `run_pipeline` → 总图 |
| `agents/graphs/` | LangGraph：总图路由 + simple / medium / hard 子图 |
| `mcps/` | 工具注册 + 按名 invoke（实现见 `mcps/tools/`） |

全程使用**主模型**（`ModelsService.get_runtime_config()` → `agents.llm`）。落库 `Message.route` 写入难度档位；HTTP 额外返回 `rewritten` / `difficulty` / `tool_trace` / `workspace`。原文仍作为用户消息入库，改写只供下游 Agent 使用。

短期记忆来自会话空间 `logs/session.sqlite`（近若干轮，条数可由角色 `memory` 覆盖），注入 simple / medium / hard 图；无会话库记录时回落主库消息。角色勾选的工具（分组 id 或工具名）会限制 medium / hard 的候选集；空列表表示不限制。

### 2. 设计目标与边界

| 目标 | 做法 |
| --- | --- |
| 按任务成本分流 | simple 不挂工具；medium 少量工具；hard 规划 + 更高递归 + 结果核对 |
| 工具面可控 | 先选型缩集，再 `create_agent`；角色可再收窄分组 |
| 复杂任务可核对 | hard 用结构化 success_criteria，对照回复与 tool_trace |
| 可观测 | 节点写 `trace.note` / `span`；追踪窗展示 path |
| 可离线降级 | 无 API Key 时启发式路由与直接 `invoke_tools`，不拖垮会话 |

**不在图内做的事**：流式 token 推送、HITL 审批节点（Bash / 会话外路径 / 危险工具确认都在工具层走 `mcps/approval.py`，见批次 2 §2.2）、多智能体并行分发。

---

### 3. 总图与模块职责

```text
用户原文
    │
    ▼
┌───────────────────────────────────────┐
│  chat_pipeline（agents/graphs/pipeline）│
│                                         │
│  START → understand                     │
│            │                            │
│            ├─ simple → simple 子图 → END│
│            ├─ medium → medium 子图 → END│
│            └─ hard   → hard 子图   → END│
└───────────────────────────────────────┘
    │
    ▼
run_pipeline 组装 reply / difficulty / tool_trace / trace …
    │
    ▼
HTTP 落库 + 会话 workspace 洞察
```

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 入口 | `agents/graphs/pipeline.py` → `run_pipeline` | 对外唯一聊天入口 |
| 总图 | `agents/graphs/pipeline.py` | understand + 条件边分流 |
| 理解 | `agents/router.py` | structured：改写 + 难度 |
| simple | `agents/graphs/simple.py` | 无工具直答 |
| medium | `agents/graphs/medium.py` | 选型 → ReAct |
| hard | `agents/graphs/hard.py` | plan → 选型 → ReAct → verify |
| 选型 | `agents/tool_selector.py` | 候选工具缩集 + 角色白名单展开；允许空工具集（直答） |
| 状态 | `agents/graphs/state.py` | `ChatState` TypedDict |
| 记忆 | `agents/memory.py` | 历史 → LangChain messages（底层转换 / 降级） |
| 上下文 | `agents/context.py` | 按 token 预算装配历史；超预算时压缩较早对话为摘要 |
| 预算 | `agents/token_budget.py` | token 估算与四段预算分配 |
| 共用 | `agents/graphs/common.py` | `last_text` / `allowed_from_role` / `build_react_graph` / `merge_tool_traces` |

---

### 4. 共享状态 `ChatState`

```text
message          用户原文（HTTP 传入）
rewritten        改写后意图（下游只用这个）
difficulty       simple | medium | hard
route_reason     路由理由
history          短期记忆（不含本轮用户句）
role             RolesService.get_runtime（可空）

selected_tools / candidate_tools / tool_plan_reason
reply / used_llm / tool_trace

# hard 专用
plan / plan_text
verify_passed / verify_reason / verify_focus / verify_round
```

条件边只读 `difficulty`；子图读写选型与回复字段。角色提示通过 `_merged_system(role, BASE)` 叠在挡位 system **之上**，避免丢掉工作区 / 工具约定。

---

### 5. 总图节点

#### `understand`

1. 调用 `router.understand(message)`。
2. 主模型 structured（`UnderstandDecision`）：
   - `rewritten`：清晰中文意图（不编造新需求）
   - `difficulty`：`simple` | `medium` | `hard`
   - `reason`：简短理由
3. 写入 state，并 `note(route=…)` 供追踪。

**难度语义（提示词约定）**

| 档位 | 典型场景 |
| --- | --- |
| simple | 闲聊、寒暄、单句知识问答，通常不需要本地工具 |
| medium | 一次或少量工具：文件、搜索、计算、只读 SQL、知识库、沙箱跑一小段 Python |
| hard | 多步、要规划、多次工具或交叉验证（如据报错反复改代码再执行） |

**离线**：无模型时不改写；启发式命中工具 → `medium`，否则 `simple`（不会自动标 hard）。

#### 条件边 `_route`

```text
difficulty == "hard"   → hard
difficulty == "medium" → medium
否则                   → simple
```

#### 挡位节点

| 节点 | 调用 | system |
| --- | --- | --- |
| `simple` | `simple_mod.run_simple` | `_merged_system(role, SIMPLE_SYSTEM)` |
| `medium` | `medium_mod.run_medium(..., name="medium_react")` | `_merged_system(role, MEDIUM_SYSTEM)` |
| `hard` | `hard_mod.run_hard(..., name="hard_react")` | `_merged_system(role, HARD_SYSTEM)` |

挡位结果经 `_branch_result` 归一为 `reply / selected_tools / candidate_tools / tool_plan_reason / used_llm / tool_trace`；hard 额外可带 `plan`、`verify_reason`。

#### 收尾

`run_pipeline` 在 `tracing` 上下文中 `invoke` 总图，再 `complete(...)` 生成整轮 `trace`（含 path：理解 → 路由 → 上下文 → 直答或 规划/筛选/ReAct/核对）。

---

### 6. simple 子图（直答）

```text
START → chat → END
```

- 输入：改写文本 + `history`（`to_lc_messages`）+ system。
- 节点：单次 `model.invoke([SystemMessage, …messages])`。
- 无工具、无选型。
- 无模型：返回「（离线）…」。

编译名：`simple_chat`。

---

### 7. medium 子图（选型 → ReAct）

```text
START → select_tools → react → END
```

编译名：`medium_pipeline`；内部 ReAct agent 名：`medium_react`。

#### `select_tools`

1. `tool_selector.select_tools(rewritten, allowed=role.tools)`。
2. `allowed` 经 `expand_allowlist`：分组 id（如 `mcp-web`）展开为组内全部工具名；也可直接写工具名。
3. 空 `allowed` / 无角色 → **不限制**，候选 = 当前已注册全部工具。
4. 主模型 structured 选出子集；失败或离线走 `heuristic_tool_names`。
5. **允许空名单**：模型或启发式认为无需工具时，不强制塞默认工具；`react` 以无工具 Agent 直答。
6. 旧角色勾选（如 WorkBuddy 演示 id）无法匹配注册表时，回落为全部可用工具并在 reason 中注明。

`resolve_tools([])` 返回空列表，**不再**静默展开为全量工具。

#### `react`

1. `resolve_tools(selected_names)`；名字无效时回落全量（registry 行为）。
2. `create_agent(..., system_prompt=build_agent_system(tier="medium", role_prompt=…))`：
   Identity → **Environment（本轮会话绝对路径，靠前）** → Workspace → Tooling → Stopping → Response → Tier。
3. `invoke({messages: history + HumanMessage(rewritten)})`，`recursion_limit = 2 × max_model_calls + 10`（默认 34）。
4. 抽最后文本为 `reply`；`extract_tool_trace` 记工具调用。
5. 无模型：跳过 LLM，直接 `invoke_tools(text, names)`。

适合「一两跳工具就能答」的任务；**空转**靠工具/模型 call limit 收束，图步数只当安全网（须大于预算，避免天气「定位+搜索」误撞限）。

---

### 8. hard 子图（plan → 选型 → ReAct → verify）

```text
START → plan → select_tools → react → verify
                      ▲                    │
                      └──── 未通过且未达上限 ──┘
                                         │ 通过或达上限
                                         ▼
                                        END
```

编译名：`hard_pipeline`；内部 ReAct agent 名：`hard_react`。

相对 medium 的差异：

| 维度 | medium | hard |
| --- | --- | --- |
| 规划 | 无 | 结构化 `TaskPlan` |
| 选型输入 | 仅改写文本 | 改写 + 计划文本（+ 核对缺口） |
| ReAct 递归 | `2×12+10=34` | `2×16+10=42` |
| 结束后 | 直接 END | `VerifyDecision`；可回环再选型/执行；`tool_trace` **跨轮累计** |
| 回环上限 | — | `_MAX_VERIFY_ROUNDS = 2` |

#### `plan`（结构化）

```text
TaskPlan:
  goal                 目标
  steps[]              有序步骤
  success_criteria[]   可核对的完成标准
  risks[]              卡点 / 需交叉验证处
```

- 写入 `plan`、`plan_text`（给人看的【执行计划】块），`verify_round=0`。
- 离线或失败：默认两步计划 + 通用成功标准。

#### `select_tools`

与 medium 相同选择器；查询串拼上 `plan_text`，若有 `verify_focus` 再追加「上一轮核对未通过，请优先补：…」。

#### `react`

- system = `build_agent_system(tier="hard", role_prompt=…, plan_text=…)`（Environment 含会话绝对路径）。
- 用户消息 = 改写 + 计划 +（可选）缺口焦点。
- `recursion_limit = 2 × _MAX_MODEL_CALLS + 10`（默认 42），便于「改代码 → 跑 → 看 stderr → 再改」。

#### `verify`（结构化）

```text
VerifyDecision:
  passed       是否满足成功标准
  reason       理由
  missing[]    缺口
  next_focus   下一轮优先补什么
```

输入：计划目标/标准、助手 `reply`、tool_trace 摘要。

**收束规则**

1. `passed=true` → 结束。
2. `passed=false` 且 `verify_round < 2` → 写 `verify_focus`，回到 `select_tools`。
3. 已达 2 轮仍未通过 → **强制视为通过并收束**（避免无限循环），理由中注明「已达核对上限」。
4. 核对调用失败 → 采用当前回复并结束。
5. 离线：有非空 reply 即通过。

#### 条件边 `after_verify`

```text
verify_passed 或 round >= 2 → end
否则 → select_tools
```

---

### 9. 接线：HTTP → 图 → 落库

```text
POST /api/chat
  message, conversation_id?, role_id?, skills?
        │
        ▼
open_for_chat → 确保会话 + workspace_dir
short_term_memory(limit ≈ role.memory × 2)
RolesService.resolve_for_chat
skill_prompt_blocks(skills) → 并入 role.prompt
use_conversation_sandbox(workspace_dir)   # 沙箱/文件工具绑本会话
        │
        ▼
run_pipeline → run_pipeline → LangGraph
        │
        ▼
save_exchange（主库消息 + route=difficulty）
record_turn（会话库消息 / tool_trace / 推理）
trace 按 turn_id 落会话库
返回 reply, difficulty, rewritten, tool_trace, workspace, turn_id, tokens…
```

要点：

- **原文入库**；改写只进 Agent，不替换用户气泡。
- **沙箱上下文**在图外用 contextvars 绑定，工具实现读当前会话目录。
- **Bash/PowerShell 确认**不在图节点里，在工具执行路径上挂起等待 UI。

---

### 10. 角色与技能如何进入图

```text
role.prompt  ─┐
技能目录(skills) ─┼─→ role_runtime.prompt ─→ _merged_system(..., BASE_SYSTEM)
role.model_* ─┘                              │
role.tools   ──────→ select_tools(allowed=…) │
role.memory  ──────→ history 条数（HTTP 层）  │
                     get_chat_model(role=…) ←┘
```

| 字段 | 作用层 |
| --- | --- |
| `prompt` | 叠在挡位 system 前 |
| `tools` | medium/hard 选型白名单（分组或工具名） |
| `memory` | 短期记忆窗口（HTTP 计算 limit） |
| `model_id` / 温度等 | `get_chat_model` |
| `skills`（请求体） | 安装包 `SKILL.md` 文本并入 prompt |

`stream` / `json_mode` / `retries` 已持久化，当前同步 `/api/chat` **尚未**驱动图行为。

---

### 11. 会话工作区布局
```text
<main workspace>/YYYYMMDD-HHMMSS-xxxxx/
  output/              # 产物：用户需要的文件
  logs/
    session.sqlite     # 本会话：消息(短期记忆) / 工具返回 / meta
  runs/
    .venv/             # 代码沙箱虚拟环境
    *.py               # 沙箱脚本
```

> 两层工作区（主工作区 vs 会话工作区）的权威说明、路径关系与「上传文件必须进会话工作区」的硬性规则见 [`机制详解.md`](./机制详解.md)，改动上传 / 文件落盘逻辑前务必通读。

### 12. 工具矩阵（WorkBuddy 对齐）

ChatVein 是本机桌面 Agent（Tauri + Python），前端设置页已规划 `builtin://mcp-*`。
内置能力用 **进程内 LangChain `@tool`** 实现（默认不另起 MCP 子进程），分组 id 与
`src/components/settings/prefs.ts` 的 `MCP_SERVERS` 对齐。

**例外（批次 2 §2.3）**：用户可以在设置页「外部 MCP 服务」里自己填 stdio 命令 / SSE /
Streamable HTTP 地址，经真 MCP 协议客户端动态发现工具，落到分组 `mcp-ext::<server>`、
工具名 `mcp__<server>__<tool>`。打包物里**不附带**任何外部 server；`CHATVEIN_MCP_EXTERNAL=0`
或未安装 `mcp` SDK 时完全降级为内置工具面。

| 能力（WorkBuddy） | ChatVein 分组 | 工具 | 说明 |
| --- | --- | --- | --- |
| Filesystem（对齐 `@modelcontextprotocol/server-filesystem`，不含 `read_media_file`） | `mcp-fs` | `read_file` `read_text_file` `read_multiple_files` `write_file` `edit_file` `create_directory` `list_directory` `list_directory_with_sizes` `directory_tree` `move_file` `search_files` `get_file_info` `list_allowed_directories` `open_folder` `delete_path` | 默认当前会话工作区。相对路径仅会话内；会话外须**绝对路径 + 人机确认**（复用 Bash 确认弹窗）。产物优先 `output/`。`delete_path` 不能删会话根 |
| WebSearch / WebFetch | `mcp-web` | `web_search` `web_fetch` | 搜索：Claw Search（Parallel Free MCP）→ Tavily Keyless → Firecrawl Keyless → `ddgs`；抓取：Firecrawl → `httpx`/`bs4` |
| 本地库 / 数据 | `mcp-sqlite` | `sqlite_tables` `sqlite_schema` `sqlite_query` | **只读**打开 ChatVein SQLite |
| 知识沉淀 / 召回 | `mcp-kb` | `kb_add_note` `kb_search` `kb_search_messages` `kb_index_workspace` | 独立 `kb.sqlite`；向量模型就绪时走 sqlite-vec |
| 时间 / 计算 / 本机概况 | `core` | `get_current_time` `convert_time` `calculator` `get_system_info` `db_stats` `list_configured_models` | 对齐 WorkBuddy 文档中的 Time MCP（`mcp-server-time`）：按 IANA 时区取当前时间、时区换算；`CHATVEIN_LOCAL_TIMEZONE` 可覆盖本机时区。计算器为安全算术。本机概况含 OS/CPU/磁盘；另附 ChatVein 库表与模型列表。无独立设置卡片 |
| 代码沙箱 | `mcp-codesandbox` | `sandbox_info` `sandbox_create_venv` `sandbox_write_file` `sandbox_pip_install` `sandbox_run_python` | **与 mcp-fs 同一会话工作区**。`runs/` 放 `.venv` 与脚本；`sandbox_run_python` 的 cwd 是会话根（可相对写 `output/`）。删除会话时级联删掉该目录 |
| Git Bash | `mcp-bash` | `bash_info` `bash_run` | 优先本机 Git（`CHATVEIN_GIT_BASH` → 安装路径 / PATH）。Windows 未找到时按需下载 **MinGit** 到 `CHATVEIN_DATA_DIR/git-bash/`（钉版本 + SHA256，不进安装包）。`CHATVEIN_SKIP_BASH_DOWNLOAD=1` 关闭下载。**下载失败或不在 Windows：不注册该分组，降级依赖 `mcp-powershell`** |

| PowerShell（仅 Windows） | `mcp-powershell` | `powershell_info` `powershell_run` | 对齐 WorkBuddy：有 Bash 时两者并存；无 Bash 时它是唯一 shell。`CHATVEIN_POWERSHELL_PATH` / `pwsh` / Windows PowerShell；`CHATVEIN_USE_POWERSHELL_TOOL=0` 关闭。命令同样限会话目录 + 确认 |
| Browser 自动化 | `mcp-browser` | `browser_info` `browser_navigate` `browser_navigate_back` `browser_navigate_forward` `browser_reload` `browser_snapshot` `browser_find` `browser_click` `browser_hover` `browser_drag` `browser_drop` `browser_type` `browser_fill_form` `browser_select_option` `browser_press_key` `browser_file_upload` `browser_handle_dialog` `browser_evaluate` `browser_take_screenshot` `browser_console_messages` `browser_network_requests` `browser_network_request` `browser_wait_for` `browser_resize` `browser_close` `browser_tabs` | 进程内 Playwright，工具名/参数对齐 `@playwright/mcp` Core + Tabs。先 snapshot 再按 `ref` 交互。需本机 `playwright install chromium`（或 `CHATVEIN_BROWSER` / `CHATVEIN_BROWSER_EXECUTABLE`）；**未探测到则不注册**。默认 headed，`CHATVEIN_BROWSER_HEADLESS=1` 无头。不暴露 `browser_run_code_unsafe`。截图落盘主空间 `browser-output/` |
| IP 归属地 | `mcp-ip` | `get_my_location` `lookup_ip_region` | 免费降级：ipinfo.io → ipwhois-python → ip-api.com（均无 Key）；全失败返回原因 |
| OCR 识字 | `mcp-ocr` | `ocr_image` `ocr_image_base64` | 先 OCR.space（默认公共 key `helloworld`，可用 `CHATVEIN_OCR_SPACE_KEY`）；失败则在当前会话沙箱 `pip install rapidocr-onnxruntime`、写 `ocr_run.py` 并执行。支持 URL 或工作区/会话目录内路径 |
| PDF 处理 | `mcp-pdf` | `pdf_info` `pdf_read` `pdf_merge` `pdf_split` `pdf_split_files` `pdf_generate` `pdf_encrypt` `pdf_decrypt` | 读取用 `pypdf`（文本层、页数/元信息/页面尺寸、加密状态），生成用 `reportlab`（内置中文字体，不依赖字体文件）。`pdf_split` 抽取指定页合成一个文件，`pdf_split_files` 按页拆成每页一个文件。页数上限 400、文本截断 `max_chars`；扫描件（无文本层）返回提示并建议配合 `ocr_image`。路径规则同 `mcp-fs` |
| 外部 MCP server（自定义） | `mcp-ext::<server>` | 由 server 自己声明（`mcp__<server>__<tool>`） | 设置页「外部 MCP 服务」配置 stdio / SSE / Streamable HTTP；连接在后台线程建立，工具默认「每次确认」，详见 `生产级增强设计.md` §2.3 |

目录 API：`GET /api/mcps/catalog`。内置 MCP 开关只读：由本机探测决定「运行中 / 不可用」，
用户不能切换；未探测到的 Bash / PowerShell / Browser 不注册工具分组。

#### 刻意不做（长期）

1. **通用 cmd**：不开放 `cmd.exe`。Bash / PowerShell 只在当前会话目录执行；危险命令直接拒绝，其余改动要用户在对话框里允许。未检测到对应解释器时，该分组不会注入 Agent。
2. **预置外置 MCP 子进程**（`npx @modelcontextprotocol/server-filesystem`、`npx @playwright/mcp` 等）：仍不做——与 `builtin://` 设计重复，体积与打包成本更高，优先内置工具；Browser 以进程内 Playwright 对齐上游工具面。用户**自配**的外部 server 走 `mcps/external/`（默认关闭、可整包关开关），不属于预置分发。
3. **GitHub / Notion / Slack 等 SaaS 连接器**：走用户自配 `mcp-http`，不塞进默认分发。
4. **`browser_run_code_unsafe`**：上游 `@playwright/mcp` 标明 RCE-equivalent（在 Playwright **服务端进程**执行任意 JS）。桌面 Agent 进程内工具面**不暴露**；复杂逻辑只用页面内 `browser_evaluate` 或拆成 Core 工具。Chromium 等浏览器二进制不打进安装包。

#### 当前不做、后期需要补

| 项 | 现状 | 后期补什么 | 备注 |
| --- | --- | --- | --- |
| **Browser `--caps`** | 只对齐 Core + Tabs | 按需对齐上游可选能力：`vision`（坐标鼠标）、`pdf`（`browser_pdf_save`）、`devtools`、`storage`、`network`、`testing` | 官方用 `--caps=` / `PLAYWRIGHT_MCP_CAPS` opt-in；补时需设置页开关、依赖探测、落盘与权限说明。细节见 `.agents/notes/mcp-browser.md` |
| **自定义 HTTP MCP（`mcp-http`）** | 设置页占位 | LangChain `MCPAdapter` 拉远程工具；用户自配 URL / headers | 承接 SaaS 连接器，不进默认分发 |
| **Skill 市场：安装 / 使用** | 可浏览、安装到 `CHATVEIN_DATA_DIR/skills/`、对话 Composer 注入 SKILL.md | 更新检测、可配置 registry、技能自动发现 | 浏览 / 安装 / 卸载 / 手动选用已接 |
| **Filesystem `read_media_file`** | 未对齐上游 | 若产品需要读图/音视频元数据再补 | 首版刻意省略 |
| **Browser caps 之外的体验** | headed 默认、截图进 `browser-output/` | 无头策略、多 profile、下载目录策略等按需打磨 | 不阻塞主路径 |

优先级建议：`mcp-http` 按产品节奏；Browser caps 按真实场景缺口（PDF / 坐标点击）逐项开，不要一次全开。Skill 安装/注入已接，后续重点是自动发现与更新检测。

### 13. 追踪 path（与图对应）

`trace.recording._path(difficulty)` 生成展示用路径：

| 节点 id | 标签 | simple | medium | hard |
| --- | --- | --- | --- | --- |
| understand | 理解 | ✓ | ✓ | ✓ |
| route | 路由 | ✓ | ✓ | ✓ |
| context | 上下文 | ✓ | ✓ | ✓ |
| simple | 直答 | ✓ | | |
| plan | 规划 | | | ✓ |
| select_tools | 筛选工具 | | ✓ | ✓ |
| react | ReAct / ReAct·复杂 | | ✓ | ✓ |
| verify | 核对 | | | ✓ |

运行时还有 `span("plan"|"select_tools"|"react"|"verify"|"simple")` 与 LLM/工具子步骤。

---

### 14. 关键参数一览

| 常量 | 位置 | 值 | 含义 |
| --- | --- | --- | --- |
| `RECURSION_LIMIT_MARGIN` | `common.py` | **10** | 图步余量（middleware / 并行 tool 节点）；对齐社区 create_agent 相对「纯 2×轮次」的常见缓冲 |
| `react_recursion_limit(n)` | `common.py` | `2×n+10` | 图 `recursion_limit` 公式；空转由 call limit 收束 |
| medium `_RECURSION_LIMIT` | `medium.py` | **34**（`2×12+10`） | 由公式推导，勿手写偏小 |
| hard `_RECURSION_LIMIT` | `hard.py` | **42**（`2×16+10`） | 同上 |
| hard `_MAX_VERIFY_ROUNDS` | `hard.py` | 2 | 核对回环次数上限 |
| `_MAX_WEB_SEARCH` | medium/hard | 3 | 对齐 LangChain 文档 search `run_limit` |
| `_MAX_TOOL_CALLS` | medium/hard | 10 | 对齐 LangChain 文档全体工具 `run_limit` |
| `_MAX_MODEL_CALLS` | medium / hard | 12 / 16 | 模型调用触顶 end |
| `DEFAULT_HISTORY_LIMIT` | `memory.py` | 24 | 未传角色时的默认历史条数 |
| 角色 memory | HTTP | `memory × 2`，夹在 0…60 | 短期记忆条数 |

---

### 15. 扩展指引

| 需求 | 建议 |
| --- | --- |
| 新难度档 | 新子图模块 + pipeline 条件边 + router 枚举 + trace `_path` |
| hard 更强核对 | 调 `_MAX_VERIFY_ROUNDS`；或 verify 失败时强制重跑 sandbox 工具 |
| 人审节点 | 优先接 `mcps/approval.py`（工具层统一登记 + 审批卡片）；确需在模型看到工具结果前暂停时才用 `interrupt` |
| 流式 | 挡位 `react`/`chat` 改 `astream`；总图仍可同步选型 |
| 共享选型逻辑 | medium/hard 的 `select_tools_node` 已趋同，可再抽到 `graphs/common.py` |

改图时同步：本文件、`backend/tests/test_agent_graphs.py`、前端 `TraceWindow` 的 `STEP_LABEL`。

---

### 16. 相关源码速查

```text
backend/agents/
  graphs/pipeline.py      run_pipeline（聊天入口）
  router.py               understand
  tool_selector.py        select_tools / expand_allowlist
  memory.py               to_lc_messages
  llm.py                  get_chat_model / invoke_structured
  graphs/
    pipeline.py           总图
    simple.py / medium.py / hard.py
    state.py / common.py / tool_trace.py
backend/trace/            追踪记录与落库
backend/tests/test_agent_graphs.py
```


---

## 功能清单（已实现能力）

对照 WorkBuddy 桌面 Agent 能力与本仓库产品边界，当前**已实现、可打包使用**的功能一览。
Agent 图细节见本文 §Agent流水线；工具矩阵见 §Agent流水线 12；工作区规则见 [`机制详解.md`](./机制详解.md) §工作区模型。

---

### 1. 对话与 Agent 流水线

| 功能 | 说明 | 主要位置 |
| --- | --- | --- |
| 改写 + 难度路由 | 主模型 structured：`rewritten` + `simple\|medium\|hard` | `agents/router.py` |
| simple 直答 | 无工具，单节点聊天 | `agents/graphs/simple.py` |
| medium ReAct | 选型 → `create_agent`（agent⇄tools） | `agents/graphs/medium.py` |
| hard 规划/核对 | plan → 选型 → ReAct → verify（可回环） | `agents/graphs/hard.py` |
| 工具缩集 | 按改写文本（hard 含计划）从目录选工具 | `agents/tool_selector.py` |
| 角色覆盖 | 提示词叠在挡位 system 上；模型 / 温度 / max_tokens 等 | `roles/` + `pipeline._merged_system` |
| 角色工具白名单 | 勾选 MCP **分组 id**（或工具名）限制候选集；空=不限制 | `rolesStore.TOOLSET` + `tool_selector.expand_allowlist` |
| 短期记忆 | 会话 `logs/session.sqlite`；条数 ≈ 角色 `memory × 2`；送模型前按 token 预算装配，超预算把较早对话压成摘要 | `conversations/service.py` + `agents/context.py` |
| 技能注入 | `POST /api/chat` 的 `skills[]` 把本机 `SKILL.md` 并入 system | `skills/local_store.py` |
| 轮次追踪 | span 树、LLM 请求/响应、工具、token；按 turn 落库 | `trace/` |
| HTTP 入口 | `POST /api/chat` 同事务写用户+助手消息，回写 workspace 洞察 | `main.py` |

离线回落：无主模型时 understand / 选型走启发式，simple 返回「离线」文案，medium/hard 直接 `invoke_tools`。

---

### 2. 会话工作区

| 功能 | 说明 |
| --- | --- |
| 建会话即建目录 | `YYYYMMDD-HHMMSS-` + 5 位随机字符，挂在主工作区下 |
| `output/` | Agent / 用户产物 |
| `logs/session.sqlite` | 本会话消息、工具返回、推理摘要、追踪 |
| `runs/` | 代码沙箱 `.venv` 与脚本，与产物隔离 |
| 上传落盘 | 拖拽 / 选择文件进**当前会话**工作区（见 workspace 文档） |
| 打开工作区 | 系统文件管理器打开会话目录 |
| 删除会话 | 级联删消息，并清理对应工作区目录 |

---

### 3. 内置工具（进程内 MCP 对齐）

分组、每组的工具名、能力边界与降级链见本文 §Agent流水线 12「工具矩阵」。设置页只读展示「运行中 / 不可用」，未探测到的分组不注册。

- 目录 API：`GET /api/mcps/catalog`；外部服务配置 API：`/api/mcp-servers/`（CRUD + `/reconnect`）。
- 外部 server 仅按用户配置 opt-in，不随包分发；沙箱限额与网络软隔离（`CHATVEIN_SANDBOX_NETWORK=1`）见 [`运维手册.md`](./运维手册.md) §配置总表。
- **未实现（占位或刻意不做）**：预置外置 MCP 子进程 / `npx` 分发、通用 `cmd.exe`、SaaS 连接器、`browser_run_code_unsafe`，理由见 §Agent流水线 12「刻意不做」。

---

### 4. 模型 / 角色 / 技能

| 功能 | 说明 |
| --- | --- |
| 模型配置 | 多模型、启用/默认、API Key、上下文窗口等；主模型供 Agent | `models/` |
| 角色管理 | 人格提示、绑定模型、生成参数、工具分组、记忆轮数、一句话描述（列表副标题 / 花名册）；主角色不可删 | `roles/` + `RolesView` |
| SkillHub 浏览 | 列表 / 搜索 / 详情 / `SKILL.md` 代理 | `skills/service.py` |
| Skill 安装 | 落到 `CHATVEIN_DATA_DIR/skills/<slug>/`；可卸载 | `skills/local_store.py` |
| Composer 选用技能 | 优先展示已安装；发送时带 `skills` 注入 | `Composer.tsx` |

后期可补：技能自动发现、版本更新检测、可配置 registry UI。

---

### 5. 前端与桌面壳

| 功能 | 说明 |
| --- | --- |
| 三栏对话 | 会话列表 + 消息流 + 洞察（轨迹 / 产物） | 对齐 WorkBuddy UI 壳 |
| Markdown | Streamdown + CJK / 代码高亮 | 助手气泡 |
| 输入区 | 模型名、上下文占比、添加技能、添加文件、拖放上传 | `Composer` |
| 统一确认卡片 | 命令 / 会话外路径 / 危险工具统一弹窗批准，决定落会话库、续跑复用 | `BashApproval` + `mcps/approval.py` |
| 执行加固 | 子进程默认拿不到宿主的 `*_KEY` / `*_TOKEN` / `CHATVEIN_*`；沙箱与 shell 统一走限额执行器；沙箱进程启动/超时/失败与 shell 命令写 `audit.sqlite`（不知情就不静默） | `mcps/sandbox_guard.py` + `mcps/audit.py` |
| 细粒度权限 | 声明式规则按「路径前缀 / URL 域名 / 只读 SQL」判定，`allow` / `ask` / `deny` 三态，`ask` 复用统一确认卡片；`strict` 下未命中规则即需确认，`normal` 下放行；坏配置不静默（退回空策略并暴露错误） | `mcps/permissions.py` + `graphs/common.py::permission_gate_middleware` |
| 全量工具审计 | 每次工具调用（内置 / 外部 MCP / 离线直调）写 `audit.sqlite`：脱敏参数、`result_code`、耗时、`decision` / `decision_by`；设置页可按工具 / 判定查询 | `mcps/audit.py` + `backend/security/` + `PermissionSection.tsx` |
| 中断续跑 | 停止或崩溃后消息流上方出现「继续生成 / 放弃」 | `useChatSession` → `/api/conversations/{id}/resume` |
| 追踪窗口 | 独立窗看整轮 path / LLM / 工具 / token；侧栏显示近 14 天健康度（成功率 / P95 token / 工具失败率 / 首条告警） | `TraceWindow` + `/api/conversations/{id}/metrics` |
| 离线评测门禁 | `tools/run_eval.ps1` 跑用例集：工具与关键事实做规则断言（必跑），可选 LLM 评分（默认关）；每例在临时会话沙箱内执行，退出码 `0/1/2` 可接 CI | `backend/eval/` + `tools/run_eval.ps1` |
| 可选 OTel 导出 | `CHATVEIN_OTEL=1` 时把一轮 span 树导出到 console / OTLP，时间轴按 `start_ms` 还原；缺 SDK 静默跳过，不影响对话 | `trace/otel.py` + `trace/recording.py` |
| 群组 | 左栏整栏是群对话列表（一行 = 一个群组），建群时选成员并开好群对话；右栏是独立的群聊面板：无模型条、无技能，上下文用量放在气泡上方；输入区可「@ 指派」给某个成员，由该成员绑定模型单独执行，气泡与指派记录按成员显示 | `GroupView` / `GroupChatView` |
| 群组注册 | 会话持久化 `group_members`（角色 id 列表）：创建注册 / 补注册 / 随 `/api/chat` 消息透传，合并去重 | `conversations/` + `main.py` |
| 团队模式 | `group_members` 非空时主 agent 自动进入团队模式：花名册注入 prompt，挂 `delegate_to_agent`（串行）与 `parallel_delegate`（并行）两个派发工具；成员用自己绑定的模型 / 工具 / 按 `actor_id` 隔离的独立短期记忆完成子任务，回复写回成员名下；小任务主 agent 直接完成不派发 | `agents/delegation.py` + `agents/orchestration.py` + `agents/graphs/medium|hard.py` |
| 并行 fan-out | 多条无依赖子任务一次派发、线程池并发执行、成员 trace 子树隔离、完成后主模型汇总；会话库 `agent_tasks` 任务板记录每条状态，`GET /api/conversations/{id}/agent-tasks` 可查；`CHATVEIN_PARALLEL_DELEGATE=0` 回退串行 | `agents/orchestration.py` + `trace/recording.py`（`child_span`） |
| 气泡耗时 | 对话气泡 100% 完整展示上下文（不压缩代码块高度）；tokens · 耗时显示在气泡内容之后 | `ChatPanel.tsx` / `MarkdownMessage.tsx` |
| 长期记忆 | 每轮结束后异步抽取事实 / 偏好做候选（默认 `pending`，用户确认后生效）；作用域 全局 / 角色 / 会话，类型 fact / preference / identity / project / other；归一化去重 + 敏感内容（`sk-` key、手机号）整条拒绝；命中召回时只改 role prompt 副本，trace 点亮 `memory` 节点；设置页可确认 / 编辑 / 删除 / 整理；`CHATVEIN_MEMORY=0` 关闭，`CHATVEIN_MEMORY_AUTO_ACCEPT=1` 免确认 | `backend/memory/` + `MemorySection.tsx` |
| 设置 | 应用偏好（本地）、内置 MCP 状态、权限与审计、SQLite 信息 / VACUUM / 备份、长期记忆 | |
| Tauri 消息层 | 启停 Python、注入 `CHATVEIN_DATA_DIR`、推送后端 URL | `src-tauri` |

知识库管理已上线（`KnowledgeView.tsx` + `knowledge/` 模块 + `backend/knowledge/` REST）：左栏文档列表 / 搜索（向量模型就绪时语义召回，否则关键词兜底）、新建 / 编辑 / 删除 / 批量导入（文本文件或粘贴）/ 清空 / 全量重建索引；与 Agent 侧 `kb_*` 工具共用同一份 `kb.sqlite`（`kb_vec_map` 表做 rowid 映射，WAL + busy_timeout 支撑并发）。应用偏好里的托盘 / 开机启动 / 自动更新尚未接 Tauri 插件。

团队模式能力边界见 [`机制详解.md`](./机制详解.md)：成员角色无模型 / 主 agent 无模型时退化，不支持嵌套派发（子 agent 不挂 `delegate_to_agent` / `parallel_delegate`）。并行派发的实现差异见 [`生产级增强设计.md`](./生产级增强设计.md) §2.4「实现纪要」，长期记忆见该文 §1.4「实现纪要」，沙箱加固见该文 §3.1「实现纪要」，细粒度权限与审计见该文 §3.2「实现纪要」，离线评测与 OTel 见该文 §3.3「实现纪要」。

---

### 6. 数据与可观测

| 功能 | 说明 |
| --- | --- |
| 主库 SQLite | 会话、消息、模型、角色等（SQLModel） |
| sqlite-vec | 同库向量扩展；失败不阻断主流程 |
| 会话库 | 每会话独立 sqlite：短期记忆 + 工具轨迹 + 追踪 JSON |
| 轮次元数据 | `turn_id`、tokens、耗时、route、难度等 |
| 审计库 | `<data>/audit.sqlite`：工具调用 / 沙箱 / shell / 权限配置，只追加、写前脱敏 |
| 质量指标 | 由追踪**查询时聚合**（不落表）：成功率 / 取消率 / token 与耗时分布 / 工具失败率 / 告警 |
| OTel 导出 | 可选，`CHATVEIN_OTEL=1` 才加载 SDK；默认关，不影响安装包体积 |

---

### 7. 打包与运行

| 项 | 说明 |
| --- | --- |
| 开发 | `npm run tauri dev`：固定端口 8420，后端可热重载 |
| 发布 | `npm run tauri build` → `prepare:runtime`（PyInstaller）+ 前端 + NSIS/MSI |
| 运行时 | 用户机无需装 Python；Chromium / MinGit / 向量权重 **不进包**，按需下载 |
| 数据目录 | Rust `app_data_dir` → `CHATVEIN_DATA_DIR` |

---

### 文档入口

全部文档的导航见 [`README.md`](./README.md)：架构与目录 / Agent 与功能 / 机制详解 / 运维手册 / 生产级增强设计（存档）。
