# ChatVein 开发导航（AGENTS.md）

本文件是 **Cursor / Claude Code / Trae / CodeBuddy 共用的唯一代码地图**，三个入口（`CLAUDE.md`、`.cursor/rules/`、`.trae/rules/`）都指向它。

工作方式：**先在本文件定位，再按需读 30~80 行源码，最后改**。不要全库通读。

深度文件地图在 `.codebuddy/skills/chatvein-code-map/`（CodeBuddy 技能目录，Claude Code / Cursor 可直接按需读取）；Trae 用同内容的副本 `.trae/skills/chatvein-code-map/`。
每个源文件都标了 **a–f 重要性等级**（a 全局骨架 / b 主干业务 / c 模块内实现 / d 契约层 / e 支撑设施 / f 生成物），改 a 级文件必须全链路回归；等级定义见 `SKILL.md` 的「1.2 重要性等级」。
- `SKILL.md`：全量需求落点、链路、边界
- `references/frontend.md`：`src/` 每个文件的职责与 api 映射
- `references/backend-core.md`：`backend/` 核心模块
- `references/backend-tools.md`：`backend/mcps/` 工具与运行时
- `references/tauri-build.md`：Tauri 启动、打包、发布

## 1. 项目是什么

**ChatVein 桌面 Agent**：Tauri 2 外壳 + React 19 界面 + Python FastAPI 内核 + LangGraph Agent。后端由 Rust 作为子进程拉起，随机端口 + 一次性 token。

| 层 | 技术 | 位置 | 职责 |
|---|---|---|---|
| 前端 | React 19 + Vite 7 + Tailwind 4 + TS | `src/` | 聊天、群组、角色、技能、知识库、模型、设置、追踪 |
| 外壳 | Tauri 2 + Rust | `src-tauri/` | 启动后端、端口/token、窗口、更新、打包 |
| 后端 | Python 3.11+ + FastAPI + LangGraph | `backend/` | Agent 图、工具、持久化、追踪、文件与命令沙箱 |

## 2. 目录速查

| 目录 | 内容 |
|---|---|
| `src/components/views/` | 顶层页面：`ChatView` `GroupView` `GroupChatView` `SkillsView` `RolesView` `KnowledgeView` `ModelsView` `SettingsView` |
| `src/components/chat/` | 聊天内核：`ChatPanel` `Composer` `useChatSession` `InsightPanel` `insightData` `BashApproval` `mounts` `mentions` `SessionList` |
| `src/components/group/` | 群组：`GroupList` `GroupMembers` `GroupSkills` |
| `src/components/layout/` | `BackendGate` `Sidebar` `TitleBar` `ErrorBoundary` `CenterHint` |
| `src/components/settings/` | `prefs.ts`（MCP 分组元数据）、`AppSection` `McpSection` `SqliteSection` `UpdateSection` |
| `src/api/` | `client.ts`（底层 fetch/invoke）+ 各资源模块 |
| `src/lib/` | 路由、store、tokens、trace、updater、错误人话 |
| `backend/main.py` | FastAPI 入口：/api/chat、uploads、bash 审批、health、workspace、db |
| `backend/agents/` | 难度路由、理解/改写、工具选择、ReAct 图、提示词、取消、委派 |
| `backend/mcps/` | 工具注册表、分组、执行、沙箱、Bash/浏览器运行时 |
| `backend/conversations/` | 会话 CRUD、成员、turn 编排、历史装配 |
| `backend/chats/` | 群会话与成员（chat_groups / chat_group_members） |
| `backend/roles/` | 角色 CRUD、多角色种子、运行时解析 |
| `backend/skills/` | 技能市场/安装/本地读取/提示词注入 |
| `backend/knowledge/` | 知识库文档 + 向量 + 检索 |
| `backend/models/` | 模型配置（OpenAI 兼容） |
| `backend/embeddings/` | 向量模型配置 |
| `backend/trace/` | 追踪记录与查询 |
| `backend/db.py` | 主 SQLite 连接与迁移（SCHEMA_VERSION=13） |
| `src-tauri/src/` | `lib.rs` `main.rs` `backend.rs` `commands.rs` |
| `tools/` | 后端冻结、运行时整理、发布、图标、冒烟脚本 |

## 3. 需求 → 改动落点（优先看这里）

| 需求 | 先改 | 连带 |
|---|---|---|
| 新页面/导航 | `src/types/view.ts`、`src/App.tsx` | `src/components/layout/Sidebar.tsx`、`src/styles.css` |
| 聊天交互/流式/停止 | `src/components/chat/useChatSession.ts` | `ChatPanel.tsx`、`Composer.tsx`、`src/api/conversations.ts` |
| 单轮对话编排 | `backend/main.py`（`/api/chat`） | `backend/conversations/service.py`、`backend/agents/graphs/pipeline.py` |
| 难度路由/改写 | `backend/agents/router.py` | `backend/agents/graphs/pipeline.py` |
| Agent 决策逻辑 | `backend/agents/graphs/{simple,medium,hard}.py` | `common.py`、`prompts.py`、`state.py` |
| 工具选择/预筛 | `backend/agents/tool_selector.py`、`tool_retriever.py` | `backend/mcps/registry.py` |
| 新增工具 | `backend/mcps/tools/<module>.py` | `backend/mcps/tools/__init__.py`、`src/components/settings/prefs.ts`、`src/lib/rolesStore.ts` |
| 工具执行/审批 | `backend/mcps/registry.py` | `bash.py`、`bash_policy.py`、`bash_approval.py` |
| 工作区/沙箱 | `backend/mcps/sandbox.py`、`workspace.py`、`path_access.py` | `backend/main.py`（uploads） |
| 新后端接口 | `backend/<module>/controller.py` | `module.py`、`main.py include_router`、`src/api/*.ts` |
| 会话/群组数据 | `backend/conversations/`、`backend/chats/` | `src/api/conversations.ts`、`src/api/db.ts` |
| 角色 | `backend/roles/service.py`、`src/components/views/RolesView.tsx` | `src/components/roles/*`、`rolesStore.ts` |
| 技能 | `backend/skills/`、`src/components/views/SkillsView.tsx` | `src/components/skills/*`、`backend/mcps/tools/skills.py` |
| 知识库 | `backend/knowledge/`、`src/components/views/KnowledgeView.tsx` | `src/components/knowledge/*` |
| 模型/向量模型 | `backend/models/`、`backend/embeddings/` | `src/api/models.ts`、`src/api/embeddings.ts`、`src/components/models/*` |
| 追踪/面板 | `backend/trace/`、`src/components/trace/*`、`insightData.ts` | `src/lib/openTrace.ts`、`src/api/traces.ts` |
| 提示词 | `backend/agents/graphs/prompts.py` | `router.py`、`tool_selector.py`、`hard.py` |
| 启动/端口/token | `src-tauri/src/backend.rs` | `src/api/client.ts`、`BackendGate.tsx` |
| 打包/更新 | `src-tauri/tauri.conf.json`、`tools/release_updater.ps1` | `src/lib/updater.ts`、`tools/build_backend.ps1` |

## 4. 关键链路（只记顺序）

- **启动**：`lib.rs::run()` → `backend.rs::spawn_backend`（选空闲端口、生成 token、注入 env）→ `emit("backend-ready")` → `BackendGate` → `client.ts` 请求。
- **单轮**：`useChatSession.send` → `sendChat` → `POST /api/chat` → `router.understand` → `conversations.prepare_turn`（历史/短期记忆/技能/群成员）→ `pipeline.run_pipeline` → `trace.recording` → 历史落盘 + 前端轮询 `/traces/{turn_id}`。
- **群组**：`ChatView/GroupChatView` → `mode` + `members` → 后端 `is_group` → `chats.assemble_team` → `tool_selector` 限定发言角色工具 → `delegate_to_agent`。
- **技能**：`SkillsView` → `/api/skills` → 保存 SKILL.md → 渲染技能目录进 prompt → `load_skill` 读全文。
- **工具**：角色勾选 → `registry.resolve_tools` → 图内调用工具；离线直调 `registry.invoke_tools`。Bash/PowerShell 在工具内部走审批，文件越界走 `path_access`。
- **追踪**：`agents/graphs/pipeline.run_pipeline` → `trace.recording.tracing` → span 树 → `turn_traces.payload_json` → `/api/conversations/{id}/traces/{turn}` → `TraceWindow`。

## 5. 硬约定

1. 后端 **禁止顶层 import 会触发循环依赖或重依赖的模块**；`main.py` 只在 `lifespan` 里做模块初始化。
2. 新后端模块 = `controller.py` + `service.py` + `module.py`（`APIRouter(prefix="/api/...")`），在 `main.py` `include_router`。
3. 工具模块必须导出 `TOOLS: tuple` + `heuristic(text) -> list[str]`；新增分组要同步 `tools/__init__.py`、`prefs.ts`、`rolesStore.ts`。
4. 文件/命令必须经 `path_access` 与 `bash_policy`，不能在工具里自行放行；会话工作区优先 `current_sandbox()`，不要用全局 cwd。
5. 前端所有请求走 `src/api/client.ts`（自动带 `X-Chatvein-Token`）；不要手写 fetch。
6. 对话无 SSE：先乐观插入本轮，再用 `/traces/{turn_id}` 轮询补齐；停止必须调 `/api/chat/cancel`，否则落盘回滚。
7. 主库迁移只追加、保持幂等；主库不存消息（v5 起），消息在会话工作区 `logs/session.sqlite`。
8. 技能目录必须在 `assemble_team` 之前并入 `role_runtime["prompt"]`；`load_skill` 常驻。
9. 长任务在 `asyncio.to_thread` 中执行（阻塞 SDK / 图同步调用）；`ContextVar` 不会自动跨线程。
10. 文案要人话，错误给可执行下一步；新增/改名接口必须同步 `src/api/*.ts`。
11. 不要提交 `src-tauri/target/`、`backend/data/`、`.venv/`、构建产物。
12. 安全：不要把 token、API Key、密钥写进日志/工具输出/前端。
13. 注释只写「为什么 / 坑」，不复述代码；同一事实只在离代码最近的唯一一处解释，别处留一行指针（如 `见 graphs/common.py::ALWAYS_ON_TOOLS`）。

## 6. 常用命令

```powershell
# 前端
npm install
npm run dev            # Vite 5183（浏览器调试）
npm run app:dev        # Tauri dev（自动起后端）
npm run build          # tsc && vite build
npm test               # vitest run
npm run test:backend   # .venv pytest

# 后端（独立）
.\.venv\Scripts\python.exe backend\main.py --port 8420
```

数据位置：`CHATVEIN_DB_PATH` > `CHATVEIN_DATA_DIR/chatvein.db` > `backend/data/chatvein.db`；主空间 `CHATVEIN_WORKSPACE` > `<data>/workspace`。

## 7. 定位方法（省 token）

1. 先查本文件「需求 → 改动落点」。
2. 用关键词 grep（接口路径、函数名、组件名），不要列全目录。
3. 后端路由前缀见 `backend/<module>/module.py`；前端接口见 `src/api/*.ts`。
4. 找“谁引用了它”用 `search_content` 搜符号名，再看 30~80 行。
5. 需要深层细节再读 `.codebuddy/skills/chatvein-code-map/references/` 对应文件。

## 8. 高风险区（改前必读）

- `backend/main.py`：`/api/chat` 是单轮总编排，动它要同时核对落盘/取消/追踪。
- `backend/agents/graphs/medium.py`、`hard.py`：有步数/时间上限，改循环易死循环或提前截断。
- `backend/mcps/registry.py`、`tools/__init__.py`：工具分组、常驻工具、审批入口。
- `backend/conversations/service.py`：历史装配、短期记忆、群成员上下文。
- `backend/db.py`：迁移一错就伤用户数据。
- `src/components/chat/useChatSession.ts`：流式、乐观更新、失败清理、取消。
- `src-tauri/src/backend.rs`：端口/token/进程清理，改错会导致白屏或孤儿进程。
