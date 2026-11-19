---
name: chatvein-code-map
description: ChatVein 桌面 Agent（Tauri 2 外壳 + React 19 + Python FastAPI + LangGraph）的代码地图。为前端、后端、工具运行时、Tauri 外壳的每个源文件提供一句话职责、a–f 重要性等级、关联文件，并给出「需求 → 应先改哪个文件」的定位表与六条主干链路。当需要在 chatvein 仓库定位功能实现、评估改动影响面、新增页面 / 接口 / 工具 / 数据表 / 发布流程，或排查 前端组件 ↔ api 封装 ↔ FastAPI 控制器 ↔ service/repository ↔ SQLite 的跨层调用链时，使用本技能。
---

# ChatVein 代码地图

> 目标：**先定位、再读 30~80 行、最后改**。不要全库通读。
> 所有路径相对仓库根 `chatvein/`。

## 何时使用 / 不适用

**使用**：

- 接到需求但不确定改哪个层（页面 / api 封装 / controller / service / 工具 / 外壳）。
- 评估「改这里会波及谁」，确定联动文件与回归范围。
- 新增页面、接口、工具、技能形态、数据表、打包/更新通道。
- 排查跨层调用链，确认某个类型或字段的归属方。

**不适用**：单纯跑构建、装依赖、看业务背景——见 §6 命令与 `docs/`；本技能只负责定位。

## 0. 30 秒用法

1. 先判断需求属于哪一层（前端 / 后端业务 / 工具运行时 / Tauri 外壳）。
2. 查 §4「需求 → 落点」拿到主文件，再按 §7 打开对应 reference。
3. 用搜索确认符号仍存在（文件可能已改），只读命中文件的相关区间。
4. 改完检查同一条链路上的「另一端」：后端加字段 → 前端 api 类型；工具加分组 → 角色勾选/设置页卡片。

## 1. 三层架构

| 层 | 位置 | 职责 | 入口 |
|---|---|---|---|
| 前端 React + TS | `src/` | 页面、会话流、乐观气泡、轮询追踪、设置 | `src/main.tsx` → `src/App.tsx` |
| Tauri / Rust | `src-tauri/src/` | 窗口、单实例、拉起并监督 Python、注入 token/数据目录、事件桥、更新 | `lib.rs::run` → `backend.rs::spawn_backend` |
| Python FastAPI | `backend/` | REST、LLM 编排、角色/技能/知识库、内置工具、SQLite/工作区 | `backend/main.py::app` + `lifespan` |

### 1.1 数据落点

| 数据 | 位置 | 代码入口 |
|---|---|---|
| 主库（会话索引/模型/角色） | `<data>/chatvein.db` | `backend/db.py::resolve_db_path` / `init_db` |
| 知识库 + 向量 | `<data>/kb.sqlite`（`kb_docs` / `kb_vec_map` / sqlite-vec） | `backend/mcps/tools/kb.py::kb_db_path` |
| 会话工作区 | `<主空间>/<YYYYMMDD-HHMMSS-xxxxx>/`，含 `output/` `logs/` `runs/`（上传时另建 `uploads/`） | `backend/mcps/sandbox.py` |
| 会话消息 / 短期记忆 / 追踪 | `<工作区>/logs/session.sqlite`（`turn_traces` 表） | `conversations/session_store.py`、`trace/store.py` |
| 已安装技能 | `<data>/skills/<slug>/SKILL.md` + `manifest.json` | `backend/skills/local_store.py` |
| 主空间设置 | `<data>/workspace.json` | `backend/mcps/workspace.py` |
| 群组 / 设置偏好 | 浏览器 localStorage：`chatvein.groups.v1`、`chatvein.settings.app.v1`、`chatvein.settings.mcp.v1` | `src/lib/groupsStore.ts`、`src/components/settings/prefs.ts` |

`<data>` = `CHATVEIN_DATA_DIR` > 仓库 `backend/data/`（见 `db.py` / `workspace.py` 的解析优先级）。
主空间 = 用户自选（`workspace.json`）> `CHATVEIN_WORKSPACE` > `<data>/workspace`。

### 1.2 重要性等级 a–f

等级 = **理解与改动成本 × 影响半径**，不是业务优先级。

| 等级 | 含义 | 典型文件 | 改动要求 |
|---|---|---|---|
| **a** | 全局骨架：进程入口、请求底座、会话引擎、Agent 装配、工具注册表、数据模型、外壳监督 | `backend/main.py::_chat_turn`、`backend/agents/graphs/common.py`、`backend/mcps/registry.py`、`backend/db.py`、`src/api/client.ts`、`src/App.tsx`、`src/components/chat/useChatSession.ts`、`src-tauri/src/backend.rs` | 必读上下文 + 全链路回归 |
| **b** | 主干业务：单一业务域的主 service / 主页面 / 主组件 | `conversations/service.py`、`agents/graphs/pipeline.py`、`agents/router.py`、`roles/service.py`、`skills/service.py`、`knowledge/service.py`、`views/ChatView.tsx`、`chat/ChatPanel.tsx`、`lib/groupsStore.ts` | 读同目录全部文件 + 对端 |
| **c** | 模块内实现：控制器、DTO、子组件、单个 composable / 小组件 | `*/controller.py`、`views/roles/*`、`group/*`、`knowledge/*`、`skills/*`、`layout/*` | 局部影响，注意入参与契约 |
| **d** | 契约层：前端 api 封装、后端 DTO、跨层类型 | `src/api/*.ts`（除 `client.ts`）、`src/types/view.ts`、`backend/*/entity/dto.py` | 单侧改动必须双向同步，否则字段静默丢失 |
| **e** | 支撑设施：工具函数、UI 基础组件、样式、脚本 | `src/lib/{cn,errors,creationSteps}.ts`、`src/components/ui/*`、`src/styles.css`、`tools/*.ps1` | 低频但影响面广，先全局搜引用 |
| **f** | 生成物与样例：构建产物、依赖、冻结运行时 | `src-tauri/target/`、`backend-runtime/`、`dist/`、`node_modules/`、`.venv/` | 不手改，改源后重新生成 |

## 2. 六条主线链路（改哪里先看链）

### A. 启动

`src/main.tsx` → `BackendGate`（监听 Tauri 事件 / 轮询健康）→ `invoke("backend_url")` + `invoke("backend_token")`
→ Rust `spawn_backend`（dev 用 `.venv` Python 跑 `backend/main.py`；release 用 `backend-runtime/backend.exe`）
→ 注入 `CHATVEIN_TOKEN` / `CHATVEIN_DATA_DIR` → FastAPI `lifespan`：`db.init_db()` + 各模块初始化
→ 广播 `backend-ready` → 前端 `waitForBackend` 完成 → `App` 渲染。

### B. 单轮对话（最核心）

1. `Composer` → `useChatSession` 的 `send` → `sendChat`（`src/api/conversations.ts`）→ `POST /api/chat`（`client.ts` 自动带 `X-ChatVein-Token`）。
2. `main.py::chat` → `_chat_turn`：
   - `conversations_service.open_for_chat`（复用/新建会话 + 分配 `workspace_dir`）
   - `roles_service.resolve_for_chat`（角色 → 模型/参数/prompt/工具/记忆/常驻技能）
   - `short_term_memory` 取历史；`skill_prompt_blocks` 合并「常驻技能 + 会话技能」成目录
   - `chats_service.assemble_team`（有群成员则注入花名册 + `_team_mode`）
   - 生成/接收 `turn_id`，定位 `session.sqlite`
3. `asyncio.to_thread(_run_chat_heavy)`：`bind_turn` → `trace_service.recording` → `use_conversation_sandbox` → `run_pipeline`。
4. `agents/graphs/pipeline.py::run_pipeline`：`router.understand`（难度）→ `simple` / `medium` / `hard`。
   - 工具：`tool_retriever` 预筛 → `tool_selector.select_tools` → `registry.resolve_tools` → 图内调用工具（离线直调 `registry.invoke_tools`）。
5. 返回后 `save_exchange` 写 `session.sqlite` 并回写主库预览；`workspace_insight` 返回产物列表。
6. 前端先插乐观气泡，生成中轮询 `GET /api/conversations/{id}/traces/{turn_id}` 渲染思考流。

### C. 群组 / 团队模式

`GroupView`（群组存 localStorage）→ `GroupChatView` → `useChatSession` 透传 `groupMemberIds`
→ `POST /api/chat` 带 `group_members` → `chats_service.register_group_members` 落 `chat_groups`
→ `assemble_team` 给主 agent 花名册 + `delegate_to_agent`（`agents/delegation.py`，ContextVar 团队上下文）。
真正执行分工的是 medium/hard 的 ReAct 图。

### D. 技能

`SkillsView` 市场浏览/安装 → `skills/service.install_from_hub` → `local_store.install_skill` 落盘
→ Composer 勾选 → `PUT /api/conversations/{id}/skills`
→ `/api/chat` 时 `skill_prompt_blocks` 只注入「name + description + slug」
→ 模型需要时调 `load_skill`（`mcps/tools/skills.py`，常驻工具）读取完整 `SKILL.md`。

### E. 工具执行

角色勾选的分组/工具 → `tool_selector.expand_allowlist` → 候选池（`tool_retriever` 向量 + BM25 预筛）
→ LLM 精选 `ToolPlan`（无模型走 `heuristic_hits`）→ `registry.resolve_tools`
→ ReAct 图内调用工具（在线）；离线直调走 `registry.invoke_tools`
→ 文件越界 `path_access`、Bash 策略/审批在工具内部 `bash_policy` / `bash_approval`、工作区 `sandbox.current_sandbox()`。

### F. 追踪

`trace_service.recording`（ContextVar）→ `TraceRecorder` 回调记录 span / LLM / 工具 / token
→ `trace/store.save_turn_trace` 写 `session.sqlite.turn_traces`
→ `GET /api/conversations/{id}/traces` / `.../{turn_id}` → `openTraceWindow` 打开独立窗口
→ `TraceWindow` + `JsonBlock` 展示；聊天内 `insightData` / `InsightPanel` 复用同一 payload。

## 3. 定位工作流

```text
① 关键词定位：搜索 "skill" / "群组" / "approval" / "token" 等
② 路由定位：先找 APIRouter(prefix=...) 或 @app.post，再进 controller → service
③ 反向依赖：改函数前搜 "from X import" / "import X"，确认谁在用
④ 前端定位：先 api/*.ts 找请求函数，再搜函数名找调用组件
⑤ 工具定位：先查 group id，再进 mcps/tools/<module>.py
```

路由前缀速查：

| 前缀 | 文件 |
|---|---|
| `/api/chat`、`/api/chat/cancel`、`/api/bash/*`、`/api/health`、`/api/mcps/catalog`、`/api/workspace`、`/api/uploads`、`/api/db/*` | `backend/main.py` |
| `/api/conversations` | `backend/conversations/module.py` |
| `/api/conversations/{id}/traces` | `backend/trace/module.py`（与 conversations 同前缀，注意顺序） |
| `/api/models` | `backend/models/module.py` |
| `/api/roles` | `backend/roles/module.py` |
| `/api/skills` | `backend/skills/module.py` |
| `/api/kb` | `backend/knowledge/module.py` |
| `/api/embeddings` | `backend/embeddings/module.py` |
| `/api/chats` | `backend/chats/module.py`（群组成员） |

## 4. 需求 → 落点

| 需求 | 主文件（先改这里） | 连带改动 |
|---|---|---|
| 新增页面 / 导航 | `src/types/view.ts`、`src/App.tsx`、`layout/Sidebar.tsx` | `src/components/views/`、`styles.css` |
| 新增 REST 接口 | `backend/<domain>/controller.py` + `module.py` + `entity/dto.py` | `main.py` 注册、`src/api/<domain>.ts` + `api/index.ts` |
| 改对话主流程（技能注入/团队/落库） | `backend/main.py::_chat_turn` / `_run_chat_heavy` | `conversations/service.py`、`chats/service.py` |
| 改难度路由 / 改写 | `backend/agents/router.py` | `graphs/pipeline.py` |
| 改 ReAct / 步数 / 提示词 | `agents/graphs/medium.py`、`hard.py`、`common.py`、`prompts.py` | `simple.py`、`state.py` |
| 改工具选择 / 预筛 | `agents/tool_selector.py`、`tool_retriever.py` | `mcps/registry.py` |
| 新增内置工具 | `backend/mcps/tools/<module>.py` | `tools/__init__.py`、`prefs.ts` 的 `MCP_SERVERS`、`common.py::ALWAYS_ON_TOOLS`（常驻才加） |
| 工具审批 / 沙箱 / 越界访问 | `mcps/bash_policy.py`、`path_access.py`、`bash_approval.py`、`powershell_policy.py` | `mcps/registry.py`、`BashApproval.tsx` |
| 模型接入 / 报错提示 / 用量 | `backend/models/service.py`、`agents/llm.py` | `src/api/models.ts`、`ModelsView`、`AddModelDialog`、`lib/tokens.ts` |
| 角色配置 / 常驻技能 / 记忆 | `backend/roles/service.py::get_runtime`、`controller.py` | `api/roles.ts`、`RolesView`、`views/roles/*` |
| 技能市场 / 安装 / 注入 | `backend/skills/service.py`、`local_store.py` | `SkillsView`、`SkillDetailDrawer`、`mcps/tools/skills.py` |
| 知识库 / RAG | `backend/knowledge/service.py`、`mcps/tools/kb.py` | `embeddings/service.py`、`KnowledgeView`、`KbDocEditor`、`KbImportDialog` |
| 追踪 / 思考流 | `backend/trace/recording.py`、`store.py`、`service.py` | `TraceWindow`、`lib/openTrace.ts`、`useChatSession` 轮询、`insightData.ts` |
| 会话 / 消息 / 撤回 / 工作区 | `conversations/service.py`、`session_store.py` | `mcps/sandbox.py`、`ChatView`、`SessionList`、`useChatSession` |
| 群组 / @ / 团队分工 | `lib/groupsStore.ts`、`GroupView`、`GroupChatView`、`group/*` | `chats/service.py`、`agents/delegation.py` |
| 设置页 / 工具目录 | `components/settings/*`、`prefs.ts` | `main.py /api/mcps/catalog`、`registry.py::tool_catalog` |
| 数据库表 / 迁移 | `backend/db.py`（`SCHEMA_VERSION` + 迁移） | 模块 `entity/entity.py`、`repository.py` |
| 启动 / 端口 / token / 后端掉线 | `src-tauri/src/backend.rs`、`lib.rs`、`commands.rs` | `src/api/client.ts`、`BackendGate.tsx` |
| 打包 / 运行时 / 更新 | `tools/build_backend.ps1`、`prepare_runtime.ps1`、`release_updater.ps1` | `tauri.conf.json`、`lib/updater.ts`、`docs/release.md` |
| 文件上传 / 导入 | `main.py` 的 `/api/uploads` | `knowledge` 导入、`KbImportDialog`、`Composer` 附件 |
| 追踪窗口 / 外部链接 | `lib/openTrace.ts`、`lib/openExternal.ts`、`TraceWindow` | `src-tauri/capabilities/*.json`、`tauri.conf.json` |
| 测试 | `backend/tests/*.py`、`useChatSession.test.ts` | `tools/test_backend.py` |

## 5. 硬约定（违反会踩坑）

1. **Python 顶层根是 `backend/`**：所有跨模块 import 写 `import db` / `from agents import ...`，**禁止** `from backend.xxx`；`pyrightconfig.json` 的 `extraPaths` 已指向 `backend`。
2. **后端模块分层固定**：`module.py`（`APIRouter(prefix=...)` + service 单例 + `register_routes`）→ `controller.py`（纯路由）→ `service.py`（业务）→ `repository.py`（SQLModel/CRUD）→ `entity/{entity,dto}.py`。新模块必须在 `main.py` 里 `include_router`。
3. **工具模块契约**：每个 `mcps/tools/*.py` 导出 `TOOLS: tuple[BaseTool, ...]` 与 `heuristic(text) -> list[str]`；并在 `tools/__init__.py::build_tool_groups` 注册 group id（`core` / `mcp-fs` / `mcp-web` / `mcp-sqlite` / `mcp-kb` / `mcp-codesandbox` / `mcp-ip` / `mcp-ocr` / `mcp-pdf` / `mcp-skills` / `mcp-docx` / `mcp-pptx` / `mcp-excel` / 运行时按需 `mcp-bash` / `mcp-powershell` / `mcp-browser`）。
4. **长任务必须 `asyncio.to_thread`**：`trace` / `sandbox` / `turn` 用 ContextVar，**设置与读取必须同一线程**；不要随意把 `run_pipeline` 拆到别的线程池。
5. **取消是协作式**：每轮 `bind_turn(turn_id)`，`agents/cancellation.py` 的检查点负责抛 `TurnCancelled`；不要吞掉这个异常。
6. **前端只经 `src/api/*` 访问后端**，不要页面里直接 `fetch`；新增 API 必须加进 `src/api/index.ts` 桶导出。
7. **长请求**：`sendChat` 用 `timeoutMs: 0` + `AbortController`；区分「用户停止 / 超时 / 后端掉线」，停止要走 `/api/chat/cancel` 上报，光断 HTTP 不会停后端。
8. **数据归属**：模型/角色/会话索引在主库；消息与追踪只在会话 `session.sqlite`（v5 起主库不存消息）；群组和设置偏好只在 localStorage。
9. **没有 SSE / WebSocket**：生成中的思考流靠轮询 trace。
10. **安全默认收紧**：Bash 逐条审批（`bash_policy` + `bash_approval`）；工作区外路径走 `path_access` 人工确认；API Key 由 `models/crypto.py` 加解密，禁止写入日志。
11. UI 文案与注释保持中文风格；不要引入新的全局状态库（现有仅 localStorage + React context）。
12. 文档可能滞后：`docs/项目目录总结.md` 仍把 `chats` 写成「预留」，实际已是群组表模块；**以代码为准**。

## 6. 工程命令 / 文档

| 目的 | 命令 / 文件 |
|---|---|
| 前端 dev（Vite 5183） | `npm run dev` |
| Tauri 全应用 dev | `npm run app:dev` |
| 前端构建（tsc + vite） | `npm run build` |
| 冻结 Python 后端 | `npm run prepare:backend` → `tools/build_backend.ps1` |
| 前端测试 | `npm test`（`useChatSession.test.ts`） |
| 后端测试 | `npm run test:backend`（`.venv/Scripts/python.exe -m pytest`，默认收集 `backend/tests`） |
| 手动起后端 | `python backend/main.py --port 8420`（需 `X-ChatVein-Token`） |
| Python 依赖 | `pyproject.toml`；`backend/requirements.txt` / `requirements-dev.txt` |
| 类型检查配置 | `pyrightconfig.json`、`tsconfig.json`、`.flake8` |

文档（按需读，不要全读）：

| 文档 | 何时读 |
|---|---|
| `docs/agent-graphs.md` | 改 simple/medium/hard 图、工具循环、提示词 |
| `docs/agents.md` | 改理解/改写、工具选择、上下文装配 |
| `docs/features.md` | 了解功能边界 |
| `docs/skills.md` | 改技能市场/安装/注入 |
| `docs/workspace.md` | 改工作区/沙箱/产物 |
| `docs/short-term-memory.md` | 改历史/短期记忆 |
| `docs/群组模式.md` | 改群组/团队/@ |
| `docs/release.md` | 改打包/更新 |
| `docs/项目目录总结.md`、`docs/核心架构总结.md`、`docs/设计架构总结.md`、`docs/实现思想总结.md` | 需要整体背景时 |

## 7. 参考索引（按域打开）

| 文件 | 等级 | 内容 | 何时打开 |
|---|---|---|---|
| `references/frontend.md` | b | `src/` 全量文件职责、a–f 等级、api 映射、组件依赖、前端约定 | 改页面/组件/请求/状态 |
| `references/backend-core.md` | a | `main.py`、`db.py`、`agents/`、`conversations/`、`chats/`、`models/`、`roles/`、`skills/`、`embeddings/`、`knowledge/`、`trace/` | 改业务/Agent/存储/接口 |
| `references/backend-tools.md` | a | `mcps/` 注册表、16 个工具模块、运行时、分组、审批与沙箱 | 改工具/权限/文件访问 |
| `references/tauri-build.md` | b | Rust 启动监督、事件、打包、更新、脚本、测试、文档 | 改启动/打包/窗口/更新 |

## 8. 高风险改动（先读整段再动）

| 文件 | 风险 |
|---|---|
| `backend/main.py::_chat_turn` | 技能注入、团队装配、trace/沙箱 ContextVar、断连落库顺序；顺序错会导致追踪丢失或幽灵消息 |
| `backend/agents/graphs/hard.py` | 规划/验证循环、步数上限、递归上限；容易死循环或提前截断 |
| `backend/agents/graphs/common.py` | `ALWAYS_ON_TOOLS`、`recursion_limit`、工具合并；改错会影响所有会话 |
| `backend/mcps/registry.py` + `tools/__init__.py` | import 时探测运行时；新增分组/工具名冲突 |
| `backend/mcps/bash_policy.py` / `path_access.py` | 安全边界；放宽等于允许任意命令/任意路径 |
| `backend/db.py` 迁移 | 必须幂等、按 `SCHEMA_VERSION` 递增；不要新增 Alembic |
| `src-tauri/src/backend.rs` | 进程生命周期、端口探测、重启广播；Windows Job Object 防孤儿进程 |
| `src/api/client.ts` | token 注入、超时、重试、backend-lost 广播；改错会全站请求失败 |

## 9. 跨工具使用（单一真源，不逐工具复制）

地图内容只写在本目录；仓库根 `AGENTS.md` 是共享入口，各 Agent 命中入口后按需读本目录 reference，**新增 Agent 不需要再写一套**。

| 工具 | 如何找到 | 需要新增文件 |
|---|---|---|
| CodeBuddy | 原生技能，自动发现 `.codebuddy/skills/` | 否 |
| Claude Code | 根 `CLAUDE.md` 用 `@AGENTS.md` 导入 | 否 |
| Cursor | 根 `AGENTS.md` 常驻，另有 `.cursor/rules/chatvein-code-map.mdc` 按需触发 | 否 |
| Trae | `.trae/rules/project_rules.md` + `.trae/skills/chatvein-code-map/`（本目录副本） | 否（改本目录后同步副本） |

约束：`AGENTS.md` 只放精简地图并指向本目录，不重复 `references/` 细节；引用增删只改本目录。

## 10. 维护本技能

代码结构变动后同步更新 `references/`，否则会误导后续 Agent：

1. 新增/删除/重命名源文件 → 更新对应 reference 的条目。
2. 新增业务模块或页面目录 → 补 §4「需求 → 落点」一行 + reference 分组小节 + 一分钟导航。
3. 条目统一格式：`| 相对路径 | 等级 | 一句话职责 + 关键导出/入口 | 关联文件 |`。
4. 等级升级判据：影响半径扩大（被多处引用或进入全局链路）就上调（c → b → a）。
5. 本目录改名/移动 → 只改本目录内链接；`AGENTS.md` 只指目录不指具体文件，通常无需改。
6. `.trae/skills/chatvein-code-map/` 是副本：改完本目录后整目录覆盖过去。
