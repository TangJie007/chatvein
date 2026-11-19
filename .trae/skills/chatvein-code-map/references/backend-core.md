# 后端核心地图（`backend/`）

> 等级含义见 `../SKILL.md`「1.2 重要性等级 a–f」。路径相对仓库根。
> Python 根就是 `backend/`：跨模块 import 用 `import db` / `from agents import ...`，不要写 `backend.xxx`。
> 模块范式：`module.py`（router + service 单例）→ `controller.py`（路由）→ `service.py`（业务）→ `repository.py`（CRUD）→ `entity/{entity,dto}.py`。

## 0. 一分钟导航

| 我要… | 去这里 |
|---|---|
| 改单轮对话编排 / 技能注入 / 团队装配 | `backend/main.py::_chat_turn` + `_run_chat_heavy` |
| 改难度判定 / 改写 | `backend/agents/router.py` + `graphs/pipeline.py` |
| 改 ReAct 循环 / 步数 / 常驻工具 | `backend/agents/graphs/{common,medium,hard}.py` |
| 改 system prompt | `backend/agents/graphs/prompts.py` |
| 改模型接入 / 报错人话 | `backend/agents/llm.py` + `backend/models/service.py` |
| 改工具选择 / 预筛 | `backend/agents/tool_selector.py` / `tool_retriever.py` |
| 加表 / 加字段 | `backend/db.py`（`SCHEMA_VERSION`）+ 模块 `entity/` |
| 加接口 | `backend/<domain>/module.py` + `controller.py` + `main.py::include_router` |
| 消息 / 追踪存储 | `conversations/session_store.py`、`trace/store.py`（都在 `session.sqlite`） |

```text
backend/
├─ main.py             app 装配、/api/chat 编排、审批、健康、上传、DB 维护
├─ db.py               主库连接 / SCHEMA_VERSION / 幂等迁移
├─ backend.spec        PyInstaller 冻结配置
├─ agents/             路由、三张图、工具选择、LLM、记忆、取消、委派
├─ conversations/      会话 CRUD、turn 编排、session.sqlite 读写
├─ chats/              群会话 ↔ 成员角色映射（chat_groups）
├─ models/             模型配置 + API Key 加解密
├─ roles/              角色 CRUD 与运行时解析
├─ skills/             技能市场代理 + 本地落盘
├─ embeddings/         本地向量模型
├─ knowledge/          知识库文档与检索
├─ trace/              span 记录、存储、查询
├─ mcps/               工具注册表、执行、沙箱、Bash/浏览器运行时
├─ tests/              pytest
└─ scripts/            冒烟脚本
```

## 1. 进程入口与路由总表（a）

| 文件 | 等级 | 职责 |
|---|---|---|
| `backend/main.py` | a | FastAPI app、CORS、Token 中间件、模块路由挂载、`/api/chat` 编排、Bash 审批、健康检查、工具目录、主空间、上传、DB 维护 |
| `backend/backend.spec` | e | PyInstaller（onedir）冻结配置 |
| `backend/requirements.txt` / `requirements-dev.txt` | e | 运行/开发依赖 |

`main.py` 路由（除模块 router 外）：

| 路由 | 作用 |
|---|---|
| `POST /api/chat` | 对话主入口（`chat` → `_chat_turn`） |
| `POST /api/chat/cancel` | 标记 `turn_id` 取消 |
| `GET /api/bash/pending` / `POST /api/bash/approve` / `POST /api/bash/deny` | Bash 逐条审批 |
| `GET /api/health` | 健康检查（BackendGate 轮询） |
| `GET /api/mcps/catalog` | 内置工具目录 + shell/browser 运行时状态 |
| `GET/PUT/DELETE /api/workspace` | 主空间读取/设置/恢复默认 |
| `POST /api/uploads` | 用户文件落到会话工作区 `uploads/` |
| `GET /api/db/info`、`/api/db/tables`、`/api/db/tables/{name}`、`POST /api/db/vacuum`、`POST /api/db/backup` | 数据库概览/维护 |

Token：Rust 通过 `CHATVEIN_TOKEN` 注入，前端带 `X-ChatVein-Token`，中间件逐请求校验；`/api/health` 也在校验范围内（前端先取 token）。

## 2. `main.py` 关键符号（a）

| 符号 | 说明 |
|---|---|
| `ChatRequest` | `message`、`conversation_id`、`role_id`、`skills`、`turn_id`、`append_user_message`、`group_members` |
| `CancelChatRequest` | `turn_id` |
| `chat()` | async 路由；断连不落库；`TurnCancelled` 返回占位而非 500；异常经 `model_error_hint` 转人话 |
| `_chat_turn()` | **核心编排**：开/取会话 → 角色运行时 → 历史 → 技能目录 → 团队装配 → `to_thread(_run_chat_heavy)` → `save_exchange` → `workspace_insight` |
| `_run_chat_heavy()` | 工作线程内：`bind_turn` → `trace_service.recording` → `use_conversation_sandbox` → `run_pipeline` → token 统计 |
| `_collect_tokens()` | 从 usage callback 汇总 `total_tokens` |
| `_aborted_payload()` | 客户端断开时的占位响应（不落库） |

改 `_chat_turn` 时的顺序约束（非常容易踩坑）：

1. `open_for_chat` 必须先于所有需要 `workspace_dir` 的步骤。
2. 技能目录必须在 `assemble_team` 之前并入 `role_runtime["prompt"]`，否则团队花名册会覆盖/打乱角色 prompt 顺序。
3. `trace.recording`、`use_conversation_sandbox`、`bind_turn` 必须全部在 `_run_chat_heavy` 的**同一线程**内进入。
4. `save_exchange` 必须在 `_run_chat_heavy` 返回之后、且在再次检查 `is_disconnected()` 之后。

## 3. `db.py`（a）

| 符号 | 说明 |
|---|---|
| `SCHEMA_VERSION = 13` | 迁移版本；新增列/表必须 +1 并写幂等迁移 |
| `DB_FILENAME = "chatvein.db"` | 主库文件名 |
| `resolve_db_path()` | `CHATVEIN_DB_PATH` > `CHATVEIN_DATA_DIR/chatvein.db` > `backend/data/chatvein.db` |
| `init_db()` | 注册各模块实体 → `create_all` → 迁移 → sqlite-vec 扩展 |
| `session_scope()` / `connect()` | SQLModel Session / 原生 sqlite3 连接（已挂 vec 扩展） |
| `stats()`、`tables()`、`table_detail()`、`info()`、`vacuum()`、`backup()` | `/api/db/*` 使用 |
| 向量 | sqlite-vec 逐连接加载；业务侧 `CREATE VIRTUAL TABLE ... USING vec0` |

主库表：`llm_models`、`roles`、`conversations`、`chat_groups`（v12 起）。**消息与追踪不在主库**。

## 4. Agent 编排（`backend/agents/`）（a）

| 文件 | 等级 | 职责 | 关键符号 |
|---|---|---|---|
| `router.py` | b | 理解/改写 + 难度判定（simple/medium/hard）；无模型走启发式 | `understand`、`UnderstandDecision`、`_offline` |
| `graphs/pipeline.py` | a | 按难度分发到三张图；构图缓存 | `run_pipeline`、`build_pipeline`、`reset_pipeline_cache` |
| `graphs/simple.py` | b | 直答图：system prompt + 最近历史 | `run_simple`、`build_simple_graph` |
| `graphs/medium.py` | a | `tool_selector` → ReAct（agent ⇄ tools）；上限：12 次模型 / 10 次工具 / 3 次搜索 / 300s | `build_medium_graph`、`run_medium` |
| `graphs/hard.py` | a | 规划 → 选工具 → ReAct → 验证循环（16 次模型 / 10 次工具 / 2 轮验证 / 420s） | `build_hard_graph`、`run_hard` |
| `graphs/common.py` | a | 共用 ReAct 图、工具合并、递归上限、步数上限、常驻工具 | `ALWAYS_ON_TOOLS`（`load_skill` / `sandbox_run_python` / `get_current_time`）、`allowed_from_role`、`build_react_graph`、`invoke_react`、`react_recursion_limit`、`step_limit_reply` |
| `graphs/prompts.py` | a | system prompt 拼装：角色段、环境段（工作区/时间）、技能目录 | `build_agent_system`、`environment_section`、`MEDIUM_SYSTEM_STATIC`、`HARD_*` |
| `graphs/state.py` | c | LangGraph 状态定义 | `ChatState` |
| `graphs/tool_trace.py` | c | 从消息中抽取工具调用轨迹 | `extract_tool_trace` |
| `llm.py` | a | 按角色绑定的模型构造 ChatOpenAI 兼容客户端；结构化输出；限流/鉴权重试；错误人话 | `get_chat_model`、`invoke_structured`、`model_error_hint` |
| `tool_selector.py` | a | 候选工具 → LLM 精选 `ToolPlan`；无模型走启发式；角色勾选展开 | `select_tools`、`expand_allowlist`、`ToolPlan` |
| `tool_retriever.py` | b | 向量 + BM25 预筛，收窄工具候选池 | `prefilter_tools`（或 `ToolRetriever`） |
| `memory.py` | b | 会话历史 → LangChain 消息 | `to_lc_messages` |
| `cancellation.py` | b | 每轮取消 ContextVar 与检查点 | `bind_turn`、`clear_turn`、`raise_if_cancelled`、`TurnCancelled` |
| `delegation.py` | b | 团队上下文 + `delegate_to_agent` 工具 | 团队 ContextVar、工具构造 |
| `__init__.py` | e | 包导出 | — |

**常驻工具**：`graphs/common.py::ALWAYS_ON_TOOLS`（至少含 `load_skill`），medium/hard 的 ReAct 会无条件附加；角色未勾选技能也要能 `load_skill`。

## 5. 会话 / 消息（`backend/conversations/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `module.py` | b | `APIRouter(prefix="/api/conversations")` + service 单例 |
| `controller.py` | c | 会话 CRUD、消息列表、撤回、技能、群成员、工作区、产物、计数 |
| `service.py` | a | **业务核心**：`open_for_chat`、`save_exchange`、`delete_last_exchange`、`short_term_memory`、`workspace_insight`、`workspace_root_for`、`set/get_conversation_skills`、`set_conversation_role`、`record_turn`、`open_workspace_folder`、`open_artifact_location`、`counts` |
| `repository.py` | c | 主库 `conversations` CRUD + `message_count/last_message` 冗余列 |
| `session_store.py` | a | 会话库 `session.sqlite`：建表、追加/列表、撤回、预览、短期记忆 |
| `entity/entity.py` | c | `Conversation` SQLModel |
| `entity/dto.py` | d | `CreateConversationDto`、`ConversationRecord`、`MessageRecord` 等 |
| `__init__.py` | e | 延迟导出（避免循环依赖） |

要点：

- v5 起消息只存 `session.sqlite`；主库只存会话索引和预览冗余列。
- `workspace_dir` 是目录名（`YYYYMMDD-HHMMSS-xxxxx`），不是绝对路径；解析走 `mcps.sandbox.conversation_root`。
- `save_exchange` 同时负责 trace 指标回填、预览刷新、产物扫描。

## 6. 群组（`backend/chats/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `module.py` | b | `APIRouter(prefix="/api/chats")` |
| `controller.py` | c | 群成员注册/读取 |
| `service.py` | b | `register_group_members`（合并去重落 `chat_groups`）、`get_group_members`、`assemble_team`（花名册注入 + `_team_mode` + 团队 ContextVar） |
| `repository.py` | c | `chat_groups` 表 CRUD |
| `entity/*` | d | `ChatGroup` + DTO |

群组本身（名称、成员列表）存前端 localStorage；后端只持久化「群会话 ↔ 成员角色」映射。

## 7. 模型（`backend/models/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `module.py` | b | `/api/models` |
| `controller.py` | c | 列表/详情/新增/更新/删除/测试连通性 |
| `service.py` | b | OpenAI 兼容模型配置；`test_connection`；`mask_api_key`；**不区分主/默认模型**，聊天必须由角色绑定模型 |
| `crypto.py` | b | API Key 加密/解密（本机密钥） |
| `repository.py` | c | `llm_models` CRUD |
| `entity/*` | d | `LlmModel` + DTO |

前端对应：`api/models.ts`、`ModelsView`、`AddModelDialog`。
报错人话与限流识别在 `agents/llm.py::model_error_hint`。

## 8. 角色（`backend/roles/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `module.py` | b | `/api/roles` |
| `controller.py` | c | 角色 CRUD |
| `service.py` | b | `resolve_for_chat`（显式 id 优先，否则主角色/首个）、`get_runtime`（模型/prompt/温度/记忆/工具/常驻技能）、`seed_primary_if_empty` |
| `repository.py` | c | `roles` CRUD + `primary` |
| `entity/*` | d | `Role` + DTO |

`resident_skills` 是角色级常驻技能 slug；聊天时与「会话级 skills」按 `dict.fromkeys` 保序去重。
前端对应：`api/roles.ts`、`RolesView`、`views/roles/*`、`lib/rolesStore.ts`。

## 9. 技能（`backend/skills/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `service.py` | b | SkillHub 代理：列表/详情/安装/卸载；`skill_prompt_blocks` 生成「name + description + slug」目录 |
| `local_store.py` | b | `<data>/skills/<slug>/` 落盘、读取 `SKILL.md`、安装清单、卸载；注入正文长度上限 |
| `controller.py` | c | `/api/skills` 路由 |
| `module.py` | b | router + service 单例 |

注入链路：前端勾选 → `PUT /api/conversations/{id}/skills` → `/api/chat` 读取 → `skill_prompt_blocks` 追加到 role prompt → 模型按需 `load_skill`（`mcps/tools/skills.py`）。
**不要**把 SKILL.md 全文塞进 system prompt。

## 10. 向量（`backend/embeddings/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `service.py` | b | 本地向量模型：状态、下载（HuggingFace / 备用源）、`embed` / `embed_query` / `embed_passages`、维度 |
| `controller.py` | c | `/api/embeddings`：状态、准备/下载 |
| `module.py` / `entity/dto.py` | b / d | 装配 + `EmbeddingStatusDto` |

知识库与工具检索共用该服务；切换模型维度变化时，向量表需重建。

## 11. 知识库（`backend/knowledge/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `service.py` | b | 状态/列表/详情/增删改/搜索/批量导入/重建索引/清空；写操作加进程内锁 |
| `controller.py` | c | `/api/kb` 路由（注意前缀是 **`/api/kb`**） |
| `module.py` | b | router + service 单例 |
| `entity/dto.py` | d | `KbCreateIn` / `KbUpdateIn` / `KbImportIn` |

存储与 Agent 工具共享 `mcps/tools/kb.py` 的 `kb.sqlite`：

- `kb_docs`：文档
- `kb_vec_map`：rowid → doc_id
- sqlite-vec 虚拟表：向量

前端对应：`api/knowledge.ts`、`KnowledgeView`、`KbDocEditor`、`KbImportDialog`。

## 12. 追踪（`backend/trace/`）

| 文件 | 等级 | 职责 |
|---|---|---|
| `recording.py` | a | LangChain 回调 → span 树 / LLM / 工具 / 参数 / 用量；上下文管理器 `tracing`；`span`、`note`、`trace_checkpoint`、`record_tools_if_absent`、`complete`、`cancel_current_turn` |
| `store.py` | b | 会话库 `turn_traces(turn_id, payload_json, created_at)` 读写 |
| `service.py` | b | `recording`、`list_traces`、`get_trace`、`_session_db`（定位会话库） |
| `controller.py` | c | `/api/conversations/{id}/traces` 与 `/{turn_id}` |
| `module.py` | b | `APIRouter(prefix="/api/conversations")`（与 conversations 同前缀，注册顺序需注意） |

前端对应：`api/traces.ts`、`useChatSession.toLiveSteps`、`InsightPanel`、`TraceWindow`、`lib/openTrace.ts`。

## 13. 测试与脚本

| 位置 | 等级 | 内容 |
|---|---|---|
| `backend/tests/conftest.py` | c | pytest 夹具（临时数据目录、app client） |
| `backend/tests/test_*.py` | c | 图、路由、工具、沙箱、追踪、技能、知识库、限流、取消等 |
| `backend/scripts/smoke_tools_docs_test.py` | e | 工具/文档冒烟 |
| `tools/test_backend.py` | e | 后端冒烟入口 |

## 14. 后端硬约定

1. 新模块：建 `module.py/controller.py/service.py/entity/dto.py`，在 `main.py` `include_router`；不要绕过模块直接在 `main.py` 写业务。
2. 路由处理保持薄：参数校验放 DTO，业务放 service，SQL 放 repository。
3. 错误：业务异常 → `HTTPException`；模型异常先过 `model_error_hint`。
4. SQLite：主库用 SQLModel；会话库用 `session_store` 的裸 sqlite3；不要跨库 join。
5. 迁移：`db.py` 手写幂等迁移，版本号严格递增；禁止新增 Alembic。
6. ContextVar（trace / sandbox / turn / team）只在 `_run_chat_heavy` 同线程使用。
7. 新增字段要同步：`entity` → `dto` → `service` → `controller` → 前端 `api` 类型 → 组件。
