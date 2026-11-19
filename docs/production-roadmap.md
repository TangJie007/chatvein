# ChatVein Agent 生产级增强路线图（设计评审稿）

> 状态：**设计评审中，尚未改代码**。本文件是总纲；三批能力的详细技术方案见
> [`production-design-batch1.md`](./production-design-batch1.md)（内核韧性）、
> [`production-design-batch2.md`](./production-design-batch2.md)（体验与生态）、
> [`production-design-batch3.md`](./production-design-batch3.md)（安全与运维）。
> 现有功能边界见 [`features.md`](./features.md) / [`agent-graphs.md`](./agent-graphs.md)；改代码前须同步这些文档。

## 1. 目标与边界

**目标**：把现有「原型可用」的桌面 Agent 提升到「生产级可用」——在长对话、工具失败、进程重启、联网不稳、外部生态接入等真实条件下仍能给出稳定、可恢复、可观测的结果。

**本轮已确认的边界**（来自需求澄清）：

| 项 | 决定 | 说明 |
|---|---|---|
| 落地范围 | 全都要，分 3 批推进，从内核韧性开始 | 每批独立可交付、可回滚 |
| 交付形态 | **先出详细设计 → 评审 → 再改代码** | 本文档即评审物；评审通过后逐批实现 |
| 外置 MCP 客户端 | **允许引入** | stdio / SSE / Streamable HTTP 外部 server 接入；推翻 `agents.md`「刻意不做外置 MCP 子进程」一条，评审后同步修订该文档 |
| 容器级沙箱 | **不引入** | 保持进程内 + 路径约束 + 审批模型；第三批只做「加固」不做 OS 级隔离 |
| 语言/框架 | 不引入新的全局状态库、不引入 Alembic、不新增前端构建链 | 遵循 `AGENTS.md` 硬约定 |

**非目标**（本轮不做）：多用户/租户、服务端部署、SaaS 连接器内置、通用 `cmd.exe`、浏览器 RCE 工具。

## 2. 现状评估（基线）

对 `backend/agents/`、`backend/mcps/`、`src/api/`、`src/components/chat/` 的只读盘点结论：

**已经扎实、作为地基保留**：

- 三级难度路由 + query 改写 + 离线启发式降级（`agents/router.py`）。
- simple / medium / hard 三张 LangGraph 子图，ReAct 带同参去重、模型/工具/搜索次数上限、墙钟超时、协作式取消（`graphs/common.py`）。
- 工具检索 BM25 + 向量 + RRF 融合 + LLM 精选 + 角色白名单（`tool_selector.py` / `tool_retriever.py`）。
- 16 分组约 84 个内置工具、会话工作区路径约束、Shell 三级策略 + 审批、全链路 trace。
- 团队委派（同步串行）、技能按需加载、短期记忆按 `actor_id` 隔离。

**四个维度的差距**（对应三批 + 一组横切）：

| 维度 | 现状 | 生产级目标 |
|---|---|---|
| 内核韧性 | 历史按条数截断；取消即终止；工具错误是裸字符串；无自动长期记忆 | 上下文压缩 + token 预算；checkpointer 断点续跑；结构化错误 + 重试/熔断；长期记忆抽取/召回 |
| 体验与生态 | 无 SSE，靠轮询 trace；审批在工具层内存态；纯进程内工具；委派同步串行 | token 级流式；统一 `interrupt` HITL；真 MCP 客户端；并行 fan-out + 结果聚合 |
| 安全与运维 | 沙箱继承宿主环境；3 个常驻工具绕过白名单；无 eval / OTel | 敏感环境过滤 + 网络/资源约束；细粒度权限 + 审计；eval 闭环 + OTel |
| 横切 | 无成本治理、无 prompt 治理、无跨模型 fallback | token/成本预算、prompt 版本化、模型降级与 fallback |

## 3. 三批路线图与依赖

```text
批次 1 内核韧性（先做，最高杠杆，全部在现有进程内链路增强）
  1.1 上下文工程（压缩/摘要 + token 预算）
  1.2 工具可靠性（结构化错误码 + 重试/熔断 + 幂等）
  1.3 断点续跑（LangGraph checkpointer + 状态持久化）
  1.4 长期记忆（事实/偏好抽取 + 巩固 + 召回）
        ↓ 依赖 1.3 的 checkpointer 作为 HITL 断点基础
批次 2 体验与生态
  2.1 token 级流式（SSE）
  2.2 统一 HITL 审批（interrupt）
  2.3 真 MCP 协议客户端（stdio / SSE / Streamable HTTP）
  2.4 多 agent 并行编排（fan-out + 聚合）
        ↓ 依赖 1.2 的结构化错误码 / 2.3 的工具契约
批次 3 安全与运维
  3.1 沙箱加固（环境变量/网络/资源约束，不做容器）
  3.2 细粒度权限 + 审计日志
  3.3 eval 闭环 + OTel 可观测
```

**排序理由**：1.1/1.2 不依赖任何新设施、收益最快；1.3 是 2.2 的前置；2.3 让 3.2 的外部工具也能纳入权限；3.x 需要在前面能力稳定后才好定策略。

**每批交付定义**：详细设计评审通过 → 实现 → `npm test` + `npm run test:backend` 通过 → 相关文档同步 → 给出回滚点。任一批可单独叫停，不影响已交付批次。

## 4. 贯穿三批的横切设计

### 4.1 数据落点扩展（统一原则）

现有：`backend/db.py` `SCHEMA_VERSION=13`，主库存会话索引/模型/角色，消息与追踪在会话 `session.sqlite`（`logs/`）。

新增数据一律遵循「主库只加索引、明细进会话库」：

- **checkpointer / 断点状态**：会话 `logs/session.sqlite` 新表 `agent_checkpoints`（见 P1.3），按 `(conversation_id, turn_id, checkpoint_id)` 定位。
- **长期记忆**：主库存作用域与开关，明细在 `<data>/memory.sqlite`（跨会话，故不能放单个会话库）。
- **MCP 配置**：主库存 server 配置 + 工具白名单，凭据引用 `models/crypto.py` 的加密存储（禁止明文）。
- **审计日志**：`<data>/audit.sqlite`（追加写、不可篡改语义，与业务库分离）。

所有迁移只在 `backend/db.py::_migrate` 末尾追加、幂等、`SCHEMA_VERSION` 递增；不引入 Alembic。会话库 / 新库用各自的轻量 `init_*` 函数，同样幂等。

### 4.2 ContextVar 与线程约束（最容易踩的坑）

`AGENTS.md` 硬约定 9：trace / sandbox / turn 用 `ContextVar`，设置与读取必须同线程。现有 `_run_chat_heavy`（`main.py:403`）在 `asyncio.to_thread` 里 `bind_turn` → `recording` → `use_conversation_sandbox` → `run_pipeline`，全部同线程。

**新增能力的约束**：

- checkpointer、流式回调、HITL 断点都必须在这**同一个工作线程**内读取/写入；对应新增的 ContextVar（如 `stream_sink`、`interrupt_controller`）必须与现有三个一起在 `_run_chat_heavy` 里设置。
- 多 agent 并行（2.4）若用线程池，`copy_context()` 必须连同全部相关 ContextVar 一起传递；`pass_contextvars` 不得拆分。
- 真 MCP 客户端的异步事件循环不得阻塞该工作线程；用独立 asyncio loop + 线程安全队列桥接。

### 4.3 错误模型统一（贯穿 1.2 / 2.x / 3.x）

引入统一结构化错误，`main.py` 与前端 `src/api/client.ts` 共用一套 code：

```text
AgentError(code, message, retryable, stage, detail)
  code 取值域：MODEL_AUTH / MODEL_RATE_LIMIT / MODEL_TIMEOUT / TOOL_NOT_FOUND /
              TOOL_ARG_INVALID / TOOL_TIMEOUT / TOOL_DENIED / TOOL_FAILED /
              SANDBOX_VIOLATION / MCP_SERVER_DOWN / CHECKPOINT_EXPIRED / CANCELLED
```

- 后端所有对外错误由 `model_error_hint` / `concise_failure` 收敛到 code（保留人话 message）。
- 前端 `HttpError` 携带 code，`useChatSession` 据此决定「重试 / 提示改配置 / 清理乐观气泡」。
- 不再用裸字符串匹配判断是否可重试（现有 `_failed_tool_names` 仅作展示兼容）。

### 4.4 Prompt / 配置治理（贯穿三批）

- 现有 prompt 分散在 `router.py`、`tool_selector.py`、`graphs/prompts.py`、`hard.py`。新增 `backend/agents/prompt_registry.py`：集中管理模板 + 版本号，返回带 `prompt_version` 的构建结果，写入 trace。
- 每批新增的可调参数统一从 `CHATVEIN_*` 环境变量读取，默认值写进 `docs/`，不散落魔数。

### 4.5 契约同步清单（每批必查）

| 改动 | 后端 | 前端 |
|---|---|---|
| 新增 REST 接口 | `controller.py` + `module.py` + `main.py include_router` | `src/api/*.ts` + `src/api/index.ts` 桶导出 |
| 新增工具分组 | `tools/<m>.py`（`TOOLS` + `heuristic`）、`tools/__init__.py`、`prefs.ts::MCP_SERVERS` | `rolesStore.ts` 的 `TOOLSET` |
| 新增数据表 | `backend/db.py` 迁移或会话库 init | `src/api/db.ts`（若需展示） |
| 追踪节点变化 | `trace/recording._path`、`docs/agent-graphs.md` | `TraceWindow` 的 `STEP_LABEL`、`insightData.ts` |

### 4.6 回归与验收基线

每批结束后必须跑：

```powershell
npm test
npm run test:backend
npm run build
```

人工冒烟固定 4 条：① 纯闲聊（simple）② 一次联网搜索 + 总结（medium）③ 改代码→跑沙箱→再改（hard）④ 停止生成后无幽灵消息。涉及 MCP / 流式 / 断点另加对应专项冒烟（见各批文档）。

## 5. 风险登记（整体）

| 风险 | 影响 | 缓解 |
|---|---|---|
| checkpointer 改动触碰 a 级 `main.py::_chat_turn` 落库顺序 | 幽灵消息 / 追踪丢失 | 分批引入，先新表双写、旧链路不动；保留开关回退 |
| 流式与 Tauri HTTP 插件兼容性 | 前端收不到 chunk | 设计阶段先做 spike；保留轮询 trace 作为降级路径 |
| 真 MCP 引入 NetworkX/SDK 依赖膨胀 | 打包体积、冻结时长 | 依赖按需导入 + 可选分组，未配置 server 时不加载 |
| 长期记忆误存敏感信息 | 隐私 | 写入前脱敏 + 用户可查看/删除（3.2 审计配套） |
| 评审期间代码继续演进 | 设计稿与代码漂移 | 每批实现前重读对应文件一遍，漂移则先更新本目录文档 |

## 6. 评审清单（请在评审时确认）

1. 三批顺序与「从内核韧性开始」：默认认可（未提异议）。
2. ~~P1.3 断点续跑范围~~ **已确认（2026-11-19）：崩溃续跑 + 停止后保留现场，两者都做**，见 P1.3。
3. P2.1 流式 **已确认**：新增 `POST /api/chat/stream`，旧 `POST /api/chat` 保留兼容。
4. P2.3 真 MCP OAuth：未特别说明 → **按设计稿默认**：支持 header token，OAuth 列为可选扩展（本轮不实现）。
5. P3.3 eval **已确认**：LLM-as-judge 默认提供开关（默认关，规则断言必跑）。
6. P3.1 沙箱 Windows 网络隔离 **已确认**：按最容易方式实现 → `sitecustomize` hook + 黑洞代理的软隔离，见 batch3 §3.1。
