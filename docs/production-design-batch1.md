# 生产级增强 · 第一批：内核韧性（详细设计评审稿）

> 对应总纲 [`production-roadmap.md`](./production-roadmap.md)。**设计评审中，尚未改代码**。
> 本批四个能力：1.1 上下文工程 / 1.2 工具可靠性 / 1.3 断点续跑 / 1.4 长期记忆。
> 全部在现有进程内链路增强，不引入容器、不改 Tauri。每个能力含：现状 → 目标 → 方案 → 改动文件 → 契约/数据 → 风险与回滚 → 验收。

---

## 1.1 上下文工程：自动压缩 + token 预算

### 现状（证据）

- `agents/memory.py::to_lc_messages()` 仅 `history[-limit:]`，`tool` 角色消息直接丢弃；limit 由 `main.py:285-295` 算 `clamp(role.memory*2, 0, 60)`，默认 24。
- 无摘要、无 token 计数、无相关性召回；长会话必然截断早期关键事实，且截断方式是把整条消息丢掉。
- `trace/recording.py` 记录了 `cached_tokens` 但只统计、不参与决策；`llm.py` 的 `max_tokens` 只限输出。

### 目标

1. 当历史 token 逼近模型上下文窗口时，自动把**较早**的消息压缩成摘要，保留关键事实/决策/产物路径，而不是粗暴丢弃。
2. 引入 token 预算分配：system / history(含摘要) / 本轮输入 / 输出预留 四段预算可控，避免超窗报错。
3. 摘要可追溯：压缩事件写 trace，用户可在追踪窗看到「哪几轮被压缩成什么」。

### 方案

**新增 `backend/agents/context.py`**（新模块，c 级）：

```python
# 对外唯一入口，取代 memory.to_lc_messages 在 pipeline / simple / medium / hard 的调用
def assemble_context(
    *,
    history: list[dict],
    message: str,
    system_prompt: str,
    model_id: str | None,
    role: dict | None,
    budget: ContextBudget,
) -> AssembledContext:  # .messages / .summary / .token_report / .compacted_turn_ids
    ...
```

处理流程（按顺序）：

1. **估算 token**：用 `tiktoken`（若模型是 OpenAI 系）按 `model_id` 选编码，否则用字符数 `/1.6` 的保守估算法。加 `backend/agents/token_budget.py` 封装 `count_tokens()`，只依赖 `tiktoken`（已在依赖中则直接用，否则走估算，不新增硬依赖）。
2. **预算计算**：`ContextBudget` 从角色/模型运行时读取 `context_window`（模型配置已有该字段），预留 `output_reserve`（默认 2048）+ system + 本轮输入，剩余给 history。
3. **分段裁剪**：
   - 保留最近 N 轮原文（`recent_turns`，默认 6，可配 `CHATVEIN_CTX_RECENT_TURNS`）不压缩。
   - 更早的消息按「对（user, assistant）」分组，若 history token 超预算，取最老的一组做摘要。
4. **摘要生成**：调用主模型一次（复用 `llm.invoke_structured`，输出 `SummaryDecision{summary, kept_facts[]}`），失败则降级为「抽取式摘要」——直接拼接各条消息前 200 字 + 关键词，绝不阻塞主流程。摘要作为一条 `SystemMessage(content="[历史摘要]\n…")` 置于历史最前。
5. **摘要缓存**：摘要结果写回会话库 `session.sqlite` 的 `context_summaries` 表（key = 压缩到 Message.id），下次同会话直接复用，避免重复付费。
6. **trace**：`note("context", detail={"compacted_ids": [...], "before_tokens":…, "after_tokens":…, "summary_chars":…})`；`_path` 新增 `context` 节点。

**降级路径**：任何异常（无模型、超窗估算失败）→ 回退到现有 `to_lc_messages(history[-limit:])`，行为与今天完全一致。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/context.py` | c | 新建，压缩主流程 |
| `backend/agents/token_budget.py` | e | 新建，token 估算 + 预算 |
| `backend/agents/memory.py` | d | 保留 `to_lc_messages` 作为降级；新增 `history_pairs()` 分组助手 |
| `backend/agents/graphs/{simple,medium,hard}.py` | b/a | 把 `to_lc_messages(...)` 调用替换为 `assemble_context(...)`，传入 system/model/role |
| `backend/main.py::_chat_turn` | a | 从模型运行时取 `context_window` 注入 `budget`；不改落库顺序 |
| `backend/conversations/session_store.py` | b | 加 `context_summaries` 表读写 |
| `backend/trace/recording.py` | b | `_path` 加 `context` 节点 |
| `backend/tests/test_context.py` | — | 新测试：截断边界、无模型降级、摘要缓存命中 |
| 前端 `TraceWindow.tsx` / `insightData.ts` | c | `STEP_LABEL` 加 `context`；展示压缩摘要 |

### 风险与回滚

- **误压缩关键事实**：`kept_facts` 白名单 + 最近 N 轮强制原文 + 用户可在追踪里看摘要 → 可控。
- **额外模型调用成本/延迟**：仅超预算时触发；摘要用主模型但 `max_tokens` 限 512；开关 `CHATVEIN_CTX_COMPACT=0` 可一键回退旧行为。
- **回滚**：开关关闭即可；新增表不影响旧数据。

### 验收

- 造 50 轮对话，第 50 轮 system+history token < 窗口 - 预留；追踪里出现 `context` 节点与压缩明细。
- 关开关后行为与当前完全一致（对比测试）。
- `npm test` / `npm run test:backend` 通过。

---

## 1.2 工具可靠性：结构化错误 + 重试/熔断 + 幂等

### 现状（证据）

- `registry.py::invoke_tools()` 每个工具 `try/except` 拼 `f"[{name}] 失败: {exc}"` 字符串；ReAct 层工具由 LangChain `ToolNode` 执行，失败以字符串回灌模型。
- `common.py::same_arg_tool_guard()` 阻止同参重复；`rate_limit_retry_middleware()` **只覆盖模型限流**，普通工具失败无重试、无熔断。
- `concise_failure()` 靠字符串匹配 `失败/离线模式/error` 挑失败工具名——脆弱。

### 目标

1. 工具调用统一返回结构化结果（成功/失败/跳过 + code + 耗时 + 是否可重试），非空字符串。
2.  transient 失败（网络抖动、超时、5xx）自动重试（指数退避 + 抖动）；确定性失败（参数错误、权限拒绝）不重试。
3. 熔断：同一工具连续 N 次失败则本轮熔断，模型收到明确提示改用其他工具。
4. 幂等键：对有副作用的工具（写文件、支付类不存在但有 `write_file`/`delete_path`）用 `tool_call_id` 作为幂等键，防止重试重复写。

### 方案

**新增 `backend/mcps/tool_result.py`**（c 级）：

```python
@dataclass
class ToolResult:
    ok: bool
    content: str                 # 给模型看的文本（原有字符串放这里）
    code: str = "TOOL_OK"        # 见 production-roadmap §4.3 code 域
    retryable: bool = False
    duration_ms: int = 0
    error_kind: str | None = None  # transient | deterministic | denied
```

**新增 `backend/mcps/resilience.py`**（c 级）：

- `classify_exception(exc) -> error_kind`：白名单 transient（`TimeoutError`、连接异常、HTTP 5xx/429）→ retryable；`ValueError`/参数校验/`ToolDenied` → deterministic。
- `with_retry(tool, args, *, max_attempts=3, base=0.5, jitter=True, cancel_check)`：使用 `agents.cancellation.raise_if_cancelled()` 作为等待中的取消检查点；每次重试前记 trace。
- `CircuitBreaker`：本轮内 `fails[name]`，连续 `CHATVEIN_TOOL_CB_THRESHOLD`（默认 3）次失败 → 后续该工具调用直接返回 `TOOL_CIRCUIT_OPEN` 提示，不再执行。按 turn 隔离（ContextVar 或 middleware 局部状态）。

**接入方式**（关键：不改工具实现，在 middleware 层包裹）：

- `common.py::build_react_graph()` 的 middleware 列表新增 `resilient_tool_middleware()`：用 `wrap_tool_call` 拦截 `handler(request)`，包一层重试 + 熔断 + 结构化返回（仍以 `ToolMessage` 回灌，content 用 `ToolResult.content`，保证对 LangChain 透明）。
- `registry.py::invoke_tools()` 离线路径同步用 `with_retry`，输出格式兼容旧 `f"[{name}] …"`（展示不变）。
- `concise_failure()` 改为读 `ToolResult.error_kind` / `code`（保留旧字符串匹配作为兼容分支）。

**幂等**：`wrap_tool_call` 的 `request.tool_call.id` 作为幂等键；`resilience.py` 维护 `seen_idempotency: dict[str, ToolResult]`；重试命中相同 id 直接返回缓存结果。对 `write_file`/`edit_file`/`delete_path` 强制启用（工具名集合常量 `IDEMPOTENT_TOOLS`）。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/mcps/tool_result.py` / `resilience.py` | c | 新建 |
| `backend/agents/graphs/common.py` | a | middleware 加 resilient_tool；`concise_failure` 兼容新错误模型 |
| `backend/mcps/registry.py` | b | 离线 `invoke_tools` 接 retry |
| `backend/agents/cancellation.py` | b | `raise_if_cancelled` 暴露给 `resilience.wait` |
| `backend/tests/test_tool_resilience.py` | — | 新测试：retry 次数、熔断触发、幂等命中、取消打断退避 |
| 前端 `insightData.ts` | c | 工具失败展示 code（若有） |

### 风险与回滚

- **重试放大副作用**：只对 transient + 幂等工具重试；写操作靠 `tool_call_id` 去重。
- **与 LangChain middleware 顺序耦合**：resilient 放在 `same_arg_tool_guard` 之后、取消守卫之前；顺序在测试里固定断言。
- **回滚**：`CHATVEIN_TOOL_RETRY=0` 关闭重试与熔断，middleware 变为透传。

### 验收

- 单元测试：注入 `TimeoutError` 3 次 → 第 3 次成功；连续 3 次 → 熔断提示；同 id 重试不重复写。
- 冒烟：断网跑一次 `web_search`，观察重试日志与人话提示，无幽灵失败。

---

## 1.3 断点续跑：LangGraph checkpointer + 状态持久化

> 本能力是 2.2 统一 HITL 的前置。**评审已确认（2026-11-19）：「崩溃/重启后续跑」与「用户点停止后保留现场可恢复」两者都做。** 下文按此范围实现。

### 现状（证据）

- `pipeline.py:149`、`medium.py:197`、`hard.py:479`、`simple.py:32` 全部 `graph.compile(name=...)`，**无 `checkpointer=`**；`compile` 结果只在进程内缓存。
- `ChatState`（`graphs/state.py`）只在单次 invoke 内存流转；进程重启即丢。
- `cancellation.py` 的取消是协作式：检查点抛 `TurnCancelled` 后整轮结束，无现场保存。

### 目标

1. 每完成一个图节点（understand / plan / select_tools / react / verify）持久化一次 `ChatState`。
2. 进程崩溃/重启后，用户打开同一会话可「继续上次」，从最后一个成功节点恢复，不重复已执行的工具。
3. 用户点停止时**可选**保留现场（默认保留），提供「继续生成」按钮而非丢弃整轮。

### 方案

**checkpointer 实现**：不引入额外依赖，实现 LangGraph `BaseCheckpointSaver` 的轻量 SQLite 版本。

**新增 `backend/agents/checkpoint.py`**（b 级）：

```python
class SqliteCheckpointer(BaseCheckpointSaver):
    """会话库 logs/session.sqlite 内 agent_checkpoints 表。
    thread_id = f"{conversation_id}:{turn_id}"；按 (thread, checkpoint_id) 读写。"""
    def put(self, config, checkpoint, metadata, new_versions) -> None: ...
    def get(self, config) -> Checkpoint | None: ...
    def list(self, config, *, limit=1) -> list[CheckpointTuple]: ...
    ...
```

- 表结构（会话库）：`agent_checkpoints(thread_id, checkpoint_id, parent_id, state_json, metadata_json, created_at)`，索引 `(thread_id, created_at DESC)`。
- 状态序列化：`ChatState` 全字段 JSON；`role` 是 dict 可序列化；`history` 已是 dict 列表；无不可序列化对象（若发现 `BaseMessage` 对象则改在 state 里只存 dict，与现状一致）。
- 挂载：`build_pipeline()` / `build_react_graph()` 的 `compile(..., checkpointer=get_checkpointer())`；checkpointer 由 `use_conversation_sandbox` 同一 ContextVar 提供（保证指向本会话库），在 `_run_chat_heavy` 内设置。
- `config` 需带 `{"configurable": {"thread_id": …}}`：`runnable_config()`（`trace/recording.py`）已有 config 注入点，扩展它把 `thread_id` 带进去，避免改每张图的调用签名。

**续跑入口**：

- 新接口 `POST /api/conversations/{id}/resume`（`conversations/controller.py` + `module.py` + `main.py include_router`），body `{turn_id, action: "continue"|"discard"}`。
- service 层：按 thread_id 取最新 checkpoint → 调 `build_pipeline().invoke(None, config={...,"thread_id":…})`（LangGraph 从 checkpoint 恢复，从中断节点继续）→ 复用现有 `save_exchange` 落库；`action=discard` 则清 checkpoint 并按现有 `deleteLastTurn` 逻辑撤回乐观气泡。
- 前端：`useChatSession` 在会话加载时查 `GET /api/conversations/{id}/resumable`（新接口，返回未完成的 turn_id 列表）；有则显示「继续生成 / 放弃」提示；停止时不清 checkpoint。

**取消语义调整**（关键，避免与现有冲突）：

- `raise_if_cancelled()` 抛 `TurnCancelled` 时**不再清 checkpoint**；`main.py::chat` 捕获 `TurnCancelled` 返回的 `_aborted_payload` 增加 `resumable_turn_id=turn_id`。
- `bind_turn/clear_turn` 保持现状（只清取消标记，不清 checkpoint）。checkpoint 的 TTL（默认 24h）由 checkpointer 自身管理，独立取消 TTL（30min）。
- `save_exchange` 只在正常完成 / 用户「放弃」时写；取消保留现场时跳过（沿用现有 `request.is_disconnected()` 跳落库逻辑，不产生幽灵消息）。

**hard 回环注意**：verify 未通过回 `select_tools` 时会覆盖 checkpoint 分支；list() 按 parent 链保存，续跑取最新即可，不丢分支。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/checkpoint.py` | b | 新建 SqliteCheckpointer |
| `backend/conversations/session_store.py` | b | 加 checkpoint 表 DDL / 读写 |
| `backend/agents/graphs/{pipeline,simple,medium,hard}.py` | a | compile 挂 checkpointer；config 带 thread_id |
| `backend/trace/recording.py` | b | `runnable_config` 注入 thread_id |
| `backend/agents/cancellation.py` | b | 取消不清 checkpoint（语义调整） |
| `backend/main.py::_chat_turn / chat` | a | 取消返回 resumable_turn_id；继续复用落库 |
| `backend/conversations/{controller,module,service}.py` | b/c | 新 resume / resumable 接口 |
| `src/api/conversations.ts` | d | `resumeChat` / `listResumable` |
| `src/components/chat/useChatSession.ts` | a | 停止后保留现场 + 恢复提示 |
| `src/components/chat/ChatPanel.tsx` | b | 「继续生成 / 放弃」按钮 |
| `backend/tests/test_checkpoint.py` | — | 新测试：节点级恢复、工具不重复、取消后可续 |

### 风险与回滚

- **a 级文件改动面大**：`main.py::_chat_turn` 和 `useChatSession` 是全链路高风险区。采用「开关 + 双路径」：`CHATVEIN_CHECKPOINT=0` 时 compile 不挂 checkpointer、取消语义回到旧行为、前端不显示恢复按钮。
- **checkpoint 体积**：history 全量存可能很大；限制 `state_json` ≤ 2MB，超限只存摘要 + 最近 6 轮（复用 1.1）。
- **重复工具副作用**：恢复时从 checkpoint 的下一个节点继续，已完成节点不重放；测试必须断言工具调用次数。
- **回滚**：开关关闭 + 新表留着不用；旧会话无 checkpoint 自动走老路径。

### 验收

- 在 hard 图 verify 后 kill 后端进程 → 重启 → 打开会话 → 点继续 → 从 verify 后恢复，无重复工具调用。
- 用户点停止 → 气泡标记「可继续」→ 点继续 → 正常完成并落一条助手消息。
- 关闭开关后 4 条基础冒烟全部与当前一致。

---

## 1.4 长期记忆：事实/偏好抽取 + 巩固 + 召回

### 现状（证据）

- Agent 框架内无自动长期记忆；只有工具驱动的 `mcps/tools/kb.py`（`kb_add_note` / `kb_search`）和按 `actor_id` 隔离的短期记忆。
- `kb.sqlite` 已具备向量 + 关键词检索能力，可复用为召回后端，但需与「自动记忆」分离（避免污染用户手动知识库）。

### 目标

1. 跨会话自动抽取事实/偏好（如「用户偏好中文回复」「项目用 Python 3.11」），经用户确认后写入。
2. 记忆有作用域（全局 / 角色 / 会话）、置信度、来源 turn、时间；支持巩固（合并重复）、遗忘（TTL / 用户删除）。
3. 每轮对话前召回相关记忆注入 system，不喧宾夺主（条数/token 上限）。

### 方案

**新库 `backend/memory/`**（模块，b 级）：`module.py`（`/api/memories`）+ `controller.py` + `service.py` + `repository.py` + `entity/{entity,dto}.py`。

**存储**：`<data>/memory.sqlite`（独立，跨会话），表 `memories(id, scope, scope_id, kind, content, facts_json, confidence, source_turn_id, created_at, updated_at, expires_at)`；sqlite-vec 映射表复用 `kb_vec_map` 模式（可选，向量模型就绪才用）。

**写入流程（抽取 → 确认 → 落库）**：

1. 每轮正常完成后（在 `_chat_turn` 落库之后，异步 fire-and-forget，不阻塞用户）调用 `memory.service.extract(turn_id, user_msg, assistant_msg)`。
2. `extract` 用主模型 `invoke_structured` 输出 `MemoryCandidate{items:[{kind, content, confidence}]}`，`kind ∈ {preference, fact, project, person}`。
3. **可发现 + 可确认**：候选不直接生效，标记 `status=pending`；前端设置页/侧栏提供「记忆管理」抽屉，用户确认/编辑/删除（可配置为自动确认 `CHATVEIN_MEMORY_AUTO_ACCEPT=1`，默认关闭以护隐私）。
4. 巩固：`service.consolidate()` 定期合并高相似候选（向量/关键词），提升 confidence 或合并内容；TTL 到期软删除。

**召回流程**：

- 在 `main.py::_chat_turn` 取 history 后、`assemble_context` 前，调用 `memory.service.recall(query=req.message, scope_ids=[role_id, conversation_id], limit=8, max_tokens=512)`。
- 召回结果注入 `role_runtime["prompt"]` 的 `# Memory` 段（与技能目录注入同位置，`main.py:296-321` 附近），或作为 `ChatState.extras["memories"]` 传给 `assemble_context`（推荐后者，避免污染角色定义）。
- trace 记 `note("memory", detail={"recalled_ids": [...], "tokens":…})`，`_path` 加 `memory` 节点。

**脱敏**：`extract` 前用正则过滤疑似密钥/token/手机号/邮箱（复用 `models/crypto.py` 的敏感字段识别思路），命中的片段不写入。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/memory/`（整套） | b | 新建模块 6 文件 + init_db |
| `backend/main.py` | a | `include_router(memory.module.router)`；`_chat_turn` 召回注入 + 异步抽取调用 |
| `backend/agents/context.py` | c | `assemble_context` 接收 `memories` 参数 |
| `backend/agents/graphs/state.py` | b | `extras` 里放 memories（无新增必填字段，兼容旧 state） |
| `backend/trace/recording.py` | c | `_path` 加 `memory` 节点 |
| `src/api/memories.ts` + `src/api/index.ts` | d | 新接口封装 |
| `src/components/settings/MemorySection.tsx` | c | 记忆管理抽屉（确认/删除/作用域） |
| `src/components/layout/Sidebar.tsx` | c | 入口 |
| `backend/tests/test_memory.py` | — | 抽取、召回、脱敏、TTL 测试 |
| 前端 `TraceWindow.tsx` / `insightData.ts` | c | `memory` 节点标签 |

### 风险与回滚

- **隐私**：默认「抽取候选需确认」；脱敏正则 + 用户可删 + TTL；任何时刻 `CHATVEIN_MEMORY=0` 关闭抽取与召回（表保留）。
- **注入质量下降**：召回条数/token 硬上限，且置信度低于阈值不注入；trace 可追溯。
- **额外成本**：抽取每轮一次结构化调用；可配 `CHATVEIN_MEMORY_EXTRACT_TURN_INTERVAL=5` 每 5 轮抽一次。
- **回滚**：开关关闭后主链路无感知；新库不影响主库。

### 验收

- 跨两轮对话让模型记住偏好，第三轮召回命中并出现在 trace。
- 含疑似 token 的消息不被写入记忆表。
- 关闭开关后召回/抽取均不发生，4 条基础冒烟无变化。

---

## 第一批实施顺序与依赖

```text
1.1 上下文工程（独立，先做，立即收益）
   ↓ 提供 token 估算给 1.2 / 1.4
1.2 工具可靠性（独立，可与 1.1 并行开发）
   ↓ 结构化错误码被后续所有批复用
1.3 断点续跑（a 级文件最多，单独一个 PR，开关默认先关再开）
   ↓ checkpointer 成为 2.2 HITL 的断点设施
1.4 长期记忆（依赖 1.1 的预算与 1.3 的 trace 扩展，最后做）
```

四能力全部带开关，可独立上线、独立回滚。评审通过后按此顺序逐项实现，每项结束跑一次全量回归（roadmap §4.6）。
