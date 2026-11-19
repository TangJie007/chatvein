# 生产级增强 · 第二批：体验与生态（详细设计评审稿）

> 对应总纲 [`production-roadmap.md`](./production-roadmap.md)。**设计评审中，尚未改代码**。
> 依赖第一批：2.2 依赖 1.3 checkpointer；2.3/2.4 复用 1.2 结构化错误模型。
> 四个能力：2.1 token 级流式 / 2.2 统一 HITL 审批 / 2.3 真 MCP 协议客户端 / 2.4 多 agent 并行编排。

---

## 2.1 token 级流式（SSE）

> **状态：已实现（2026-11-19）**。新增 `agents/streaming.py`（ContextVar 事件桥 + `StreamSink`）、`POST /api/chat/stream`；直答走 `model.stream()`，ReAct 走 `stream_mode=["values","messages"]` 只推纯文本增量；工具进度/阶段事件由中间件与图节点上报。前端 `backendStream`（`client.ts`）+ `sendChatStream`；拿不到可读流 / 后端 409 时自动回落旧接口。开关 `CHATVEIN_STREAM`（默认开）。

### 现状（证据）

- 全仓无 `StreamingResponse`；`sendChat`（`src/api/conversations.ts:118`）是一次性 POST，靠 `turn_id` 轮询 `GET /traces/{turn}` 看进度。
- `invoke_react`（`graphs/common.py:339`）已用 `agent.stream(..., stream_mode="values")`，但只在内部迭代取最后一份状态，未对外推流。
- 前端 `useChatSession` 用乐观气泡 + 轮询补齐，**没有 token 级增量渲染**。

### 目标

1. 助手回复逐 token（或小 chunk）推送到前端，边生成边显示，首次可见时间显著缩短。
2. 流式与现有 trace 轮询共存：流式是「加速体验」，trace 是「权威记录」，二者不互相替代。
3. 取消、工具调用、审批打断时流能正确收尾（发 `done`/`cancelled`/`error` 终止事件）。

### 方案

**协议**：新增 `POST /api/chat/stream`，`text/event-stream`。事件类型：

```text
event: token      data: {"turn_id","text":"增量文本"}
event: tool       data: {"name","status","tool_call_id"}     # 工具开始/结束
event: approval   data: {"request_id","kind","command"}      # 需要 HITL 审批（见 2.2）
event: trace      data: {"node":"understand|plan|react|verify"}  # 阶段切换
event: done       data: {"reply","tokens","duration_ms",...完整旧响应字段}
event: error      data: {"code","message","retryable"}        # 见 roadmap §4.3
event: cancelled  data: {"turn_id","resumable":true}
```

**后端**：

- `main.py` 新增 `@app.post("/api/chat/stream")` → 一个 `async def` 用 `StreamingResponse(generator)`。generator 内部仍需把重活放到工作线程，但**流 sink 必须是线程安全的队列**：
  - 新增 ContextVar `stream_sink`（`backend/agents/streaming.py`），在 `_run_chat_heavy` 与 `bind_turn` 一起设置。
  - `sink.push(event)` 把事件写入 `queue.Queue`，异步 generator 侧 `await asyncio.to_thread(queue.get)` 取出 yield（不阻塞事件循环）。
- **token 来源**：LangChain 模型用 `astream_events(version="v2")` 或在 `create_agent` 层加 `stream_messages` 回调拿 token chunk。最小侵入方案：在 `build_react_graph` 的 middleware 里挂一个 `after_model` 钩子，从 `AIMessage.content` 的增量文本推 `token` 事件（内容块级，非严格逐 token，但足够「边生成边显示」）。若模型 SDK 原生支持 token chunk，用 `astream_events` 的 `on_chat_model_stream` 事件升级为逐 token。
- `simple.py` 的 `model.invoke` 改 `model.stream()`，逐块推 `token`。
- `done` 事件携带与现有 `/api/chat` **完全相同**的响应体（`run_pipeline` 结果 + 落库后的消息），前端拿到后走与今天一致的收尾逻辑。
- 落库时机不变（仍在 `_chat_turn` 末尾、`request.is_disconnected()` 判断之后）；流结束前必须先发 `done`，再关闭 generator。
- **降级**：`CHATVEIN_STREAM=0` 或客户端不接受 SSE → 走旧 `/api/chat`。

**前端**：

- `src/api/client.ts` 新增 `backendStream(endpoint, body, {signal, onEvent})`：复用 `getBackendUrl` / token 注入 / AbortController 语义，用 `@tauri-apps/plugin-http` 的 `fetch` 拿 `ReadableStream`，按 `\n\n` 切 SSE 帧解析。
- `src/api/conversations.ts` 新增 `sendChatStream(...)`，参数与 `sendChat` 对齐，多传 `onEvent`。
- `useChatSession`：优先走 stream，把 `token` 事件 append 到助手气泡；`done` 事件替换成权威消息；`error`/`cancelled` 走现有失败/停止清理路径。轮询 trace 保留但降频（仅拿结构化阶段信息）。
- 停止：现有 `cancelChat` + AbortController 双管齐下不变；收到 `cancelled` 事件后按 1.3 保留现场。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/streaming.py` | b | 新建：stream_sink ContextVar + 事件模型 + 队列桥 |
| `backend/main.py` | a | 新增 `/api/chat/stream` 路由；`_run_chat_heavy` 设置 sink |
| `backend/agents/graphs/common.py` / `simple.py` | a | middleware / 直答节点推 token 事件 |
| `src/api/client.ts` | a | `backendStream` SSE 解析 |
| `src/api/conversations.ts` | d | `sendChatStream` |
| `src/components/chat/useChatSession.ts` | a | 流式渲染 + 终止事件处理 |
| `src/components/chat/MarkdownMessage.tsx` | c | 流式中的 Markdown 增量渲染（Streamdown 已支持） |
| `backend/tests/test_stream.py` + `useChatSession.test.ts` | — | 事件序列、取消收尾、降级测试 |
| `docs/agent-graphs.md` | — | 补「流式不改图编排」说明 |

### 风险与回滚

- **Tauri HTTP 插件的 SSE 兼容性**：设计评审阶段先做 spike（小 demo 验证 `plugin-http` 能逐块读流）；若不稳，保留 `EventSource` 不可用的回退 = 现有轮询，功能不阻断。
- **ContextVar 线程**：sink 与 trace/sandbox/turn 四个 ContextVar 必须一起在 `_run_chat_heavy` 设置；线程池桥接用 `copy_context().run`（复用 `invoke_react` 模式）。
- **流中断重复落库**：`done` 事件是唯一「权威完成」信号；断流不落库，沿用现有 `is_disconnected` 判断。
- **回滚**：`CHATVEIN_STREAM=0` + 前端 flag 关流式，完全回到轮询路径。

### 验收

- 一次中等复杂对话，首个 token 在 < 2s 出现；工具调用阶段有 `tool` 事件；停止后收到 `cancelled` 且无幽灵气泡。
- 关流式开关后行为与当前一致。

---

## 2.2 统一 HITL 审批（interrupt 断点）

> **状态：已实现（2026-11-19）**，实现位置与评审稿有出入（见末节「实现纪要」）：审批设施落在**工具层**（`backend/mcps/approval.py`），而不是图内 `approval_node` + `Command(resume)`；图内 interrupt 留给 2.3 外部 MCP 危险工具时再补。开关 `CHATVEIN_UNIFIED_APPROVAL`（默认开，设 0 回退旧 `bash_approval`）；超时 `CHATVEIN_APPROVAL_TIMEOUT`（默认 120s）。

### 现状（证据）

- 审批在工具执行层：`bash_approval.create_pending()` / `wait_decision()`（`mcps/bash_approval.py`），内存 dict + 120s 超时；`path_access.py` 会话外访问复用同一确认弹窗。
- 图里**没有** `interrupt()`（全仓 `graph.compile()` 无 checkpointer，彻底查无中断）；`docs/agent-graphs.md` 明确写「HITL 审批节点不在图内」。
- 前端 `BashApproval.tsx` 监听审批事件并回传 decision。

### 目标

1. 把「Bash / 文件越界 / 外部 MCP 危险工具 / 长期记忆写入」等所有需人工确认的动作，统一到一个 `interrupt` 断点设施。
2. 审批状态可持久化（依赖 1.3 checkpointer）：进程重启后未决审批不丢；用户可稍后从其他入口批准。
3. 保留现有工具层审批作为兼容路径，逐步迁移。

### 方案

**设施**：基于 1.3 的 checkpointer + LangGraph `interrupt()`（需 `interrupt` 挂 checkpointer，正好具备）。

**新增 `backend/agents/approval.py`**（b 级）：

```python
@dataclass
class ApprovalRequest:
    request_id: str
    kind: str            # bash | path | mcp_tool | memory_write
    title: str           # 人话标题
    detail: str          # 命令 / 路径 / 工具名 + 参数
    risk: str            # low | medium | high
    tool_call_id: str | None

def request_approval(req: ApprovalRequest) -> ApprovalDecision: ...
```

- 在 ReAct 图的工具调用前插入一个 `approval_node`：检查工具名/参数是否命中审批策略 → 命中则 `interrupt(req)` 暂停图，把 request 推到 `stream_sink` 的 `approval` 事件（2.1）→ 等待前端通过新接口 `POST /api/approvals/{id}/decision` 提交 → `Command(resume=decision)` 恢复图。
- **审批策略集中化**：新增 `backend/mcps/approval_policy.py`，合并现有 `bash_policy.classify` / `path_access` / 外部 MCP 工具风险等级，返回 `allow | ask | deny` + `ApprovalRequest`。现有策略函数保留作底层判定。
- **持久化**：审批请求与决定写会话库 `approvals(request_id, turn_id, kind, payload_json, status, decision, created_at, decided_at)`；未决请求在会话加载时可查询/恢复。
- **超时**：默认 120s（`CHATVEIN_APPROVAL_TIMEOUT`），超时按「拒绝」处理并推事件；超时线程里也要 `raise_if_cancelled` 可打断。
- **兼容**：`bash_approval.wait_decision` 保留；迁移期两套并存，`CHATVEIN_INTERRUPT_APPROVAL=1` 时走新路径。

**前端**：`BashApproval.tsx` 扩展为通用 `ApprovalDialog`，识别 `kind` 渲染不同详情（命令 / 路径 / 工具 + 参数 / 记忆内容）；新增 `src/api/approvals.ts` 提交决定；`useChatSession` 收到 `approval` 事件弹窗。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/approval.py` / `mcps/approval_policy.py` | b | 新建设施与策略 |
| `backend/agents/graphs/{medium,hard}.py` | a | 工具前插入 approval_node；interrupt + Command(resume) |
| `backend/conversations/session_store.py` | b | approvals 表 |
| `backend/mcps/bash_approval.py` / `path_access.py` | b | 保留旧路径，接策略 New 判定 |
| `backend/main.py` | a | 新 `/api/approvals/*` 接口 + include_router |
| `src/api/approvals.ts` + `src/api/index.ts` | d | 新接口 |
| `src/components/chat/BashApproval.tsx` / `useChatSession.ts` | a/b | 通用审批弹窗 |
| `backend/tests/test_approval.py` | — | 中断/恢复/超时/重启持久化测试 |
| `docs/agent-graphs.md` / `features.md` | — | 撤销「不在图内做 HITL」表述 |

### 风险与回滚

- **interrupt 与 ContextVar**：恢复执行的线程必须重建 trace/sandbox/turn/sink 四个 ContextVar；用 `Command(resume)` 的入口统一走 `_run_chat_heavy` 的包装，避免裸恢复。
- **审批体验回退**：`CHATVEIN_INTERRUPT_APPROVAL=0` 回到现有工具层弹窗，零行为变化。
- **重启后恢复**：checkpoint + approvals 表都在会话库，重启后从最后一个节点恢复并重新推审批事件。
- **回滚**：开关关闭 + 旧审批路径完整保留。

### 验收

- Bash 危险命令 → 弹窗 → 批准 → 工具执行 → trace 有中断/恢复节点；拒绝 → 工具不执行。
- 弹窗期间杀后端 → 重启 → 会话出现「待审批」→ 批准 → 从中断点续跑。
- 关闭开关后审批行为与当前一致。

### 实现纪要（2026-11-19）

与评审稿的差异：**审批不落在图内 `interrupt()`，而落在工具执行层**。理由：审批天然发生在「工具即将执行」这一刻，工具层阻塞等待即可直接复用现有 `raise_if_cancelled` 取消语义；搬进图里需要为恢复路径重建 trace / sandbox / turn / sink 四个 ContextVar，收益不足以抵消恢复复杂度。图内 interrupt 留给 2.3 外部 MCP 危险工具（那时需要在模型看到工具结果前暂停）。

实际落地：

| 文件 | 内容 |
|---|---|
| `backend/mcps/approval_policy.py`（新） | `ApprovalNeed(kind,title,detail,risk)`；`shell_approval` / `path_approval` 集中决定文案与风险等级 |
| `backend/mcps/approval.py`（新） | `request_approval` 阻塞等待 → `allow/deny/timeout`；`decide` 供 HTTP 线程提交；`pending` 供轮询；`bind_tool_call` 绑定本轮 `tool_call_id`；`unified_enabled` / `approval_timeout` 开关 |
| `backend/conversations/session_store.py` | 会话库新表 `approvals` + `save_approval` / `decide_approval` / `expire_approval` / `get_approval` / `list_pending_approvals` |
| `backend/agents/streaming.py` | `StreamSink.approval` / `approval_resolved` → SSE `approval` / `approval_resolved` 事件 |
| `backend/agents/graphs/common.py` | `wrap_tool_call` 内 `with bind_tool_call(call_id)`，让审批 id 与 turn/tool_call 绑定 |
| `backend/mcps/tools/bash.py`、`powershell.py`、`path_access.py` | `unified_enabled()` 时走 `request_approval`，否则旧路径 |
| `backend/mcps/bash_approval.py` | 旧 `list_pending` / `decide` 在统一开启时转发同一登记表 |
| `backend/main.py` | `GET /api/approvals/pending`、`POST /api/approvals/{id}/decision`；旧 `/api/bash/*` 兼容转发 |
| `src/api/approvals.ts`（新） | `listApprovals` / `decideApproval` |
| `src/components/chat/BashApproval.tsx` | 通用审批卡片：按 `kind` 渲染标题/详情/风险；1s 起指数退避到 5s 轮询 |
| `backend/tests/test_approval.py` | 策略、allow/deny、超时=expired、确定性 id 复用、跨重启待批复用、SSE 事件 |

关键语义：

- **确定性 request_id**：`blake2s(f"{turn_id}:{tool_call_id}")`，续跑重放同一条工具调用时命中历史决定（不重复弹窗、不重复执行）。
- **超时 ≠ 拒绝**：超时只把记录置 `expired`，恢复时会重新提问；`deny` 才写 `decided`。
- **旧接口不破**：`/api/bash/pending|approve|deny` 始终返回与统一登记表一致的数据。

---

## 2.3 真 MCP 协议客户端（stdio / SSE / Streamable HTTP）

> **本能力推翻 `docs/agents.md` 既有边界**：由「刻意不做外置 MCP 子进程」改为「内置工具优先，外置 MCP 按需 opt-in」。评审通过后须同步修订 `docs/agents.md` §「刻意不做」与 `features.md`。

### 现状（证据）

- 全仓搜 `mcp.client|stdio_client|sse_client|ClientSession|FastMCP|import mcp` = 0；依赖中无 MCP SDK。
- `mcp-http` 仅前端占位（`McpSection.tsx`）；`web.py` 的 Claw Search 是普通 HTTP API，不是 MCP 会话。
- 工具注册表 `registry.py` 静态汇总 `tools/__init__.py::build_tool_groups()`，无动态发现。

### 目标

1. 用户可在设置页配置外部 MCP server（命令启动 stdio / SSE URL / Streamable HTTP URL），动态发现其工具并纳入现有工具注册表。
2. 外部工具与内置工具**同等待遇**：参与选型、角色白名单、trace、审批策略、结构化错误。
3. 连接失败/超时不拖垮会话，降级为「该 server 不可用」并在目录标注。

### 方案

**依赖**：引入官方 `mcp` Python SDK（提供 `ClientSession` + `stdio_client` / `sse_client` / `streamablehttp_client`）。为控制打包体积，做**可选依赖 + 延迟导入**：未配置任何外部 server 时不 import。

**新增 `backend/mcps/external/`**（b 级）：

- `config.py`：server 配置模型（name / transport / command|url / env / headers / enabled / allow_tools），存主库新表 `mcp_servers`（迁移 v14）+ 前端设置页 CRUD。凭据走 `models/crypto.py` 加密，不明文落库/日志。
- `client.py`：`McpClientManager` 单例，维护每个 server 的连接会话。
  - stdio：`async with stdio_client(...)` 启动子进程；生命周期由管理器持有，后端退出时统一 close（对齐 Rust 监督逻辑，避免孤儿进程）。
  - SSE / Streamable HTTP：`sse_client` / `streamablehttp_client`，带 header token。
  - **线程桥接**：LangGraph 在工作线程跑，MCP 客户端是 asyncio；用每条 server 一个后台事件循环线程 + `asyncio.run_coroutine_threadsafe` 调 `session.list_tools()` / `call_tool()`，超时由 `concurrent.futures` 控制。
- `adapter.py`：把 MCP 工具适配成 LangChain `BaseTool`（name 加前缀 `mcp__<server>__<tool>` 防冲突；`args_schema` 由 MCP `inputSchema` 转 Pydantic；`_run` 调 `call_tool`），异常映射为 1.2 的 `ToolResult` code（`MCP_SERVER_DOWN` / `TOOL_TIMEOUT`）。

**注册表接入**（`registry.py` / `tools/__init__.py`）：

- `refresh_tool_groups()` 末尾 merge 外部工具分组 `mcp-ext::<server>`；`tool_catalog` / `tool_groups` 自动包含。
- 角色白名单 `expand_allowlist` 支持 `mcp-ext::<server>` 分组 id 与 `mcp__<server>__<tool>` 工具名。
- 外部工具加入 `ALWAYS_ON_TOOLS` 之外，仍走选型；风险等级高的外部工具默认进审批策略（2.2）。
- 热重载：`PUT /api/mcp-servers` 后调 `refresh_tool_groups()` 重建；前端目录即时刷新。

**降级**：`CHATVEIN_MCP_EXTERNAL=0` 完全不加载外部工具；SDK 缺失时导入失败只记 warning，不影响内置工具。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/mcps/external/{config,client,adapter}.py` | b | 新建协议客户端 |
| `backend/mcps/registry.py` / `tools/__init__.py` | a | 动态分组 merge + 热重载 |
| `backend/db.py` | a | v14 迁移加 `mcp_servers` 表 |
| `backend/models/crypto.py` | b | 复用：server 凭据加密 |
| `backend/main.py` | a | `/api/mcp-servers` CRUD + lifespan 初始化/清理 |
| `requirements.txt` | e | 新增可选 `mcp` 依赖（带版本） |
| `src/components/settings/McpSection.tsx` | c | 外部 server 配置 UI（增删启停 + 工具列表） |
| `src/api/mcps.ts` + `src/api/index.ts` | d | 新接口 |
| `src/components/settings/prefs.ts` | e | 外部 server 分组元数据 |
| `backend/tests/test_mcp_external.py` | — | 用 mock server 测发现/调用/降级/冲突 |
| `docs/agents.md` / `features.md` | — | 修订边界表述 |

### 风险与回滚

- **打包体积/冻结**：`mcp` SDK 是可选依赖；`tools/build_backend.ps1` 需确认冻结包含它（或按 opt-in 单独装）。评审时确认打包策略。
- **子进程孤儿**：沿用 Rust 的进程监督思路；管理器统一在 lifespan shutdown 关闭所有 stdio 子进程，测试覆盖。
- **安全**：外部 server 的工具默认「问」级审批；参数脱敏；SSRF 策略复用 `web.py::_ssrf_blocked`；禁止 server 反向访问主库。
- **回滚**：开关关闭 + 表保留；内置工具完全不受影响。

### 验收

- 配一个本地 stdio echo server → 目录出现 `mcp__<name>__*` → 对话中可调用 → trace 有记录。
- SSE server 连接失败 → 会话正常，目录标「不可用」，无异常日志泄漏 URL token。
- 卸载 SDK / 关开关 → 内置工具全部正常。

---

## 2.4 多 agent 并行编排（fan-out + 聚合）

### 现状（证据）

- `delegation.py::delegate_to_agent` 是单一工具，主 agent 在 ReAct 里调用；成员用自己模型/工具/独立记忆，**同步串行**等待返回。
- 无并行 fan-out、无共享任务板、无专用聚合器；花名册经 `ContextVar` 注入，防递归（成员不挂 delegate）。

### 目标

1. 主 agent 能把一个任务拆成多个子任务**并行**派给多个成员（`fan-out`），而不是一个个等。
2. 有共享任务板记录子任务状态，结果由专用聚合步骤汇总后交回主 agent，减少主 ReAct 负担。
3. 保持对现有「@ 指派单个成员」链路的兼容；不引入嵌套派发。

### 方案

**新增 `backend/agents/orchestration.py`**（b 级）：

- `parallel_delegate` 工具（替代/增强 `delegate_to_agent`）：入参 `{tasks: [{role_id, task, instruction}]}`。
- 并行执行：用 `ThreadPoolExecutor(max_workers=CHATVEIN_DELEGATE_MAX_PARALLEL=4)` 并发调用现有 `delegation.py::_run_member`（每个成员仍独立模型/工具/记忆/ContextVar）。
  - **ContextVar 传递**：`copy_context().run(_run_member, …)` 每个任务复制主线程的 trace/sandbox/turn 上下文；成员写 trace 用派生 span，避免串台（现有 `delegation` 已按 actor_id 隔离记忆，这里补 trace 隔离）。
- **任务板**：会话库 `agent_tasks(turn_id, task_id, role_id, status, result_json, error_code, created_at, updated_at)`；每个子任务开始/结束更新状态，trace 可见。
- **聚合**：`aggregate(results)` 复用主模型做一次结构化汇总（`AggregateDecision{synthesis, conflicts[]}`），失败则退化为拼接各成员回复（带「成员 X 认为…」前缀）。
- **与主 ReAct 的衔接**：`parallel_delegate` 返回聚合文本作为 ToolMessage 回灌，主 agent 继续其 ReAct；`snapshot`/`delegate` 工具与现有 `@` 指派不变。
- **限额**：并行度上限、单成员超时（沿用 medium 的 300s）、总墙钟超时；取消时 `raise_if_cancelled` 在等待 `future.result()` 时也能打断（轮询 future + cancel check）。
- **开关**：`CHATVEIN_PARALLEL_DELEGATE=0` 回退到现有串行 `delegate_to_agent`。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/orchestration.py` | b | 新建并行编排 |
| `backend/agents/delegation.py` | b | 抽出可复用的 `_run_member`，补 trace 派生隔离 |
| `backend/agents/graphs/common.py` / `medium.py` / `hard.py` | a | 团队模式下挂 `parallel_delegate`（保留旧 delegate） |
| `backend/conversations/session_store.py` | b | `agent_tasks` 表 |
| `backend/agents/cancellation.py` | b | 等待 future 时支持 cancel check |
| `backend/trace/recording.py` | b | 派生 span 区分成员 |
| `src/components/trace/TraceWindow.tsx` / `insightData.ts` | c | 展示并行子任务与聚合 |
| `backend/tests/test_orchestration.py` | — | 并行数量、失败隔离、取消、聚合降级 |
| `docs/team-mode-design.md` / `features.md` | — | 补并行模式说明 |

### 风险与回滚

- **ContextVar 串台**：每任务 `copy_context()` + 独立 span；测试断言成员 A 的工具不写到成员 B 的 workspace。
- **资源放大**：并行度 + 单成员次数上限 + 总超时三重约束；成员上限沿用现有 medium 级。
- **结果冲突**：聚合输出 `conflicts[]` 提示主 agent，不强行裁决；由用户/主模型判断。
- **回滚**：开关关闭回到同步串行，现有 @ 指派链路不变。

### 验收

- 3 成员并行子任务，墙钟耗时 < 串行之和；任务板 3 条状态齐全；聚合结果进入主 agent 最终回复。
- 1 成员失败不影响其他成员，trace 标 `error_code`。
- 关闭开关后团队模式行为与当前一致。

---

## 第二批实施顺序与依赖

```text
2.1 流式（独立，先做；同时验证 Tauri SSE spike）
   ↓ stream_sink 成为审批事件通道
2.2 HITL（依赖 1.3 checkpointer + 2.1 sink；单独 PR，开关先关后开）
2.3 真 MCP（独立，可与 2.2 并行；需确认打包策略）
   ↓ 外部工具默认纳入审批策略
2.4 并行编排（依赖 1.2 错误模型 + 2.2 的 trace 隔离，最后做）
```

每能力带开关、可独立回滚；评审通过后逐项实现，每项结束跑全量回归 + 对应专项冒烟。
