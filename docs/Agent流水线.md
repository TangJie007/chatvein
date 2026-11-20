# Agent 流水线

> 全文分两部分：**流水线总览与工具矩阵**（能力面），**图设计**（节点、状态、参数）。
> 功能清单见 [`功能清单.md`](./功能清单.md)；工作区规则见 [`工作区模型.md`](./工作区模型.md)；工具人工测试集见 [`工具测试用例.md`](./工具测试用例.md)。

---

## 1. 流水线总览：改写 + 难度路由

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

## 2. 设计目标与边界

| 目标 | 做法 |
| --- | --- |
| 按任务成本分流 | simple 不挂工具；medium 少量工具；hard 规划 + 更高递归 + 结果核对 |
| 工具面可控 | 先选型缩集，再 `create_agent`；角色可再收窄分组 |
| 复杂任务可核对 | hard 用结构化 success_criteria，对照回复与 tool_trace |
| 可观测 | 节点写 `trace.note` / `span`；追踪窗展示 path |
| 可离线降级 | 无 API Key 时启发式路由与直接 `invoke_tools`，不拖垮会话 |

**不在图内做的事**：流式 token 推送、HITL 审批节点（Bash / 会话外路径 / 危险工具确认都在工具层走 `mcps/approval.py`，见批次 2 §2.2）、多智能体并行分发。

---

## 3. 总图与模块职责

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

## 4. 共享状态 `ChatState`

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

## 5. 总图节点

### `understand`

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

### 条件边 `_route`

```text
difficulty == "hard"   → hard
difficulty == "medium" → medium
否则                   → simple
```

### 挡位节点

| 节点 | 调用 | system |
| --- | --- | --- |
| `simple` | `simple_mod.run_simple` | `_merged_system(role, SIMPLE_SYSTEM)` |
| `medium` | `medium_mod.run_medium(..., name="medium_react")` | `_merged_system(role, MEDIUM_SYSTEM)` |
| `hard` | `hard_mod.run_hard(..., name="hard_react")` | `_merged_system(role, HARD_SYSTEM)` |

挡位结果经 `_branch_result` 归一为 `reply / selected_tools / candidate_tools / tool_plan_reason / used_llm / tool_trace`；hard 额外可带 `plan`、`verify_reason`。

### 收尾

`run_pipeline` 在 `tracing` 上下文中 `invoke` 总图，再 `complete(...)` 生成整轮 `trace`（含 path：理解 → 路由 → 上下文 → 直答或 规划/筛选/ReAct/核对）。

---

## 6. simple 子图（直答）

```text
START → chat → END
```

- 输入：改写文本 + `history`（`to_lc_messages`）+ system。
- 节点：单次 `model.invoke([SystemMessage, …messages])`。
- 无工具、无选型。
- 无模型：返回「（离线）…」。

编译名：`simple_chat`。

---

## 7. medium 子图（选型 → ReAct）

```text
START → select_tools → react → END
```

编译名：`medium_pipeline`；内部 ReAct agent 名：`medium_react`。

### `select_tools`

1. `tool_selector.select_tools(rewritten, allowed=role.tools)`。
2. `allowed` 经 `expand_allowlist`：分组 id（如 `mcp-web`）展开为组内全部工具名；也可直接写工具名。
3. 空 `allowed` / 无角色 → **不限制**，候选 = 当前已注册全部工具。
4. 主模型 structured 选出子集；失败或离线走 `heuristic_tool_names`。
5. **允许空名单**：模型或启发式认为无需工具时，不强制塞默认工具；`react` 以无工具 Agent 直答。
6. 旧角色勾选（如 WorkBuddy 演示 id）无法匹配注册表时，回落为全部可用工具并在 reason 中注明。

`resolve_tools([])` 返回空列表，**不再**静默展开为全量工具。

### `react`

1. `resolve_tools(selected_names)`；名字无效时回落全量（registry 行为）。
2. `create_agent(..., system_prompt=build_agent_system(tier="medium", role_prompt=…))`：
   Identity → **Environment（本轮会话绝对路径，靠前）** → Workspace → Tooling → Stopping → Response → Tier。
3. `invoke({messages: history + HumanMessage(rewritten)})`，`recursion_limit = 2 × max_model_calls + 10`（默认 34）。
4. 抽最后文本为 `reply`；`extract_tool_trace` 记工具调用。
5. 无模型：跳过 LLM，直接 `invoke_tools(text, names)`。

适合「一两跳工具就能答」的任务；**空转**靠工具/模型 call limit 收束，图步数只当安全网（须大于预算，避免天气「定位+搜索」误撞限）。

---

## 8. hard 子图（plan → 选型 → ReAct → verify）

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

### `plan`（结构化）

```text
TaskPlan:
  goal                 目标
  steps[]              有序步骤
  success_criteria[]   可核对的完成标准
  risks[]              卡点 / 需交叉验证处
```

- 写入 `plan`、`plan_text`（给人看的【执行计划】块），`verify_round=0`。
- 离线或失败：默认两步计划 + 通用成功标准。

### `select_tools`

与 medium 相同选择器；查询串拼上 `plan_text`，若有 `verify_focus` 再追加「上一轮核对未通过，请优先补：…」。

### `react`

- system = `build_agent_system(tier="hard", role_prompt=…, plan_text=…)`（Environment 含会话绝对路径）。
- 用户消息 = 改写 + 计划 +（可选）缺口焦点。
- `recursion_limit = 2 × _MAX_MODEL_CALLS + 10`（默认 42），便于「改代码 → 跑 → 看 stderr → 再改」。

### `verify`（结构化）

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

### 条件边 `after_verify`

```text
verify_passed 或 round >= 2 → end
否则 → select_tools
```

---

## 9. 接线：HTTP → 图 → 落库

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

## 10. 角色与技能如何进入图

```text
role.prompt  ─┐
技能系统.md    ─┼─→ role_runtime.prompt ─→ _merged_system(..., BASE_SYSTEM)
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

## 11. 会话工作区布局
```text
<main workspace>/YYYYMMDD-HHMMSS-xxxxx/
  output/              # 产物：用户需要的文件
  logs/
    session.sqlite     # 本会话：消息(短期记忆) / 工具返回 / meta
  runs/
    .venv/             # 代码沙箱虚拟环境
    *.py               # 沙箱脚本
```

> 两层工作区（主工作区 vs 会话工作区）的权威说明、路径关系与「上传文件必须进会话工作区」的硬性规则见 [`工作区模型.md`](./工作区模型.md)，改动上传 / 文件落盘逻辑前务必通读。

## 12. 工具矩阵（WorkBuddy 对齐）

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

### 刻意不做（长期）

1. **通用 cmd**：不开放 `cmd.exe`。Bash / PowerShell 只在当前会话目录执行；危险命令直接拒绝，其余改动要用户在对话框里允许。未检测到对应解释器时，该分组不会注入 Agent。
2. **预置外置 MCP 子进程**（`npx @modelcontextprotocol/server-filesystem`、`npx @playwright/mcp` 等）：仍不做——与 `builtin://` 设计重复，体积与打包成本更高，优先内置工具；Browser 以进程内 Playwright 对齐上游工具面。用户**自配**的外部 server 走 `mcps/external/`（默认关闭、可整包关开关），不属于预置分发。
3. **GitHub / Notion / Slack 等 SaaS 连接器**：走用户自配 `mcp-http`，不塞进默认分发。
4. **`browser_run_code_unsafe`**：上游 `@playwright/mcp` 标明 RCE-equivalent（在 Playwright **服务端进程**执行任意 JS）。桌面 Agent 进程内工具面**不暴露**；复杂逻辑只用页面内 `browser_evaluate` 或拆成 Core 工具。Chromium 等浏览器二进制不打进安装包。

### 当前不做、后期需要补

| 项 | 现状 | 后期补什么 | 备注 |
| --- | --- | --- | --- |
| **Browser `--caps`** | 只对齐 Core + Tabs | 按需对齐上游可选能力：`vision`（坐标鼠标）、`pdf`（`browser_pdf_save`）、`devtools`、`storage`、`network`、`testing` | 官方用 `--caps=` / `PLAYWRIGHT_MCP_CAPS` opt-in；补时需设置页开关、依赖探测、落盘与权限说明。细节见 `.agents/notes/mcp-browser.md` |
| **自定义 HTTP MCP（`mcp-http`）** | 设置页占位 | LangChain `MCPAdapter` 拉远程工具；用户自配 URL / headers | 承接 SaaS 连接器，不进默认分发 |
| **Skill 市场：安装 / 使用** | 可浏览、安装到 `CHATVEIN_DATA_DIR/skills/`、对话 Composer 注入 SKILL.md | 更新检测、可配置 registry、技能自动发现 | 浏览 / 安装 / 卸载 / 手动选用已接 |
| **Filesystem `read_media_file`** | 未对齐上游 | 若产品需要读图/音视频元数据再补 | 首版刻意省略 |
| **Browser caps 之外的体验** | headed 默认、截图进 `browser-output/` | 无头策略、多 profile、下载目录策略等按需打磨 | 不阻塞主路径 |

优先级建议：`mcp-http` 按产品节奏；Browser caps 按真实场景缺口（PDF / 坐标点击）逐项开，不要一次全开。Skill 安装/注入已接，后续重点是自动发现与更新检测。

## 13. 追踪 path（与图对应）

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

## 14. 关键参数一览

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

## 15. 扩展指引

| 需求 | 建议 |
| --- | --- |
| 新难度档 | 新子图模块 + pipeline 条件边 + router 枚举 + trace `_path` |
| hard 更强核对 | 调 `_MAX_VERIFY_ROUNDS`；或 verify 失败时强制重跑 sandbox 工具 |
| 人审节点 | 优先接 `mcps/approval.py`（工具层统一登记 + 审批卡片）；确需在模型看到工具结果前暂停时才用 `interrupt` |
| 流式 | 挡位 `react`/`chat` 改 `astream`；总图仍可同步选型 |
| 共享选型逻辑 | medium/hard 的 `select_tools_node` 已趋同，可再抽到 `graphs/common.py` |

改图时同步：本文件、`backend/tests/test_agent_graphs.py`、前端 `TraceWindow` 的 `STEP_LABEL`。

---

## 16. 相关源码速查

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
