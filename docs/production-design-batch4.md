# 生产级增强 · 第四批：横切治理（详细设计评审稿）

> 对应总纲 [`production-roadmap.md`](./production-roadmap.md) §4「贯穿三批的横切设计」。**已实现（2026-11），落地范围与偏差见文末「实现纪要」**。
> 本批是前三批（1.1–1.4 / 2.1–2.4 / 3.1–3.3）**遗留横切项的收口**：不含新页面、不引入第三方依赖、不改 Tauri 壳。
> 三个能力：4.3 统一错误模型 / 4.4 Prompt 与配置治理 / 4.7 成本预算与模型 fallback（本批新增编号）。
> 互不重叠、各自带开关，可独立交付与回滚；顺序上 4.3 先行（4.4 的报告与 4.7 的触发条件都要用它的错误码）。
> 每个能力含：现状（证据）→ 目标 → 方案 → 改动文件 → 风险与回滚 → 验收。

---

## 4.3 统一错误模型（`AgentError`）

### 现状（证据）

- **对外只有两种错误形状**，没有统一错误体：FastAPI 默认 `{"detail": "文字"}`，以及 SSE 的 `{"code","message","retryable","turn_id"}`。
- 对外错误面分散在 **12 个文件、65 处 `raise HTTPException`**（`main.py` 17 处 + 11 个 `controller.py` 共 48 处），全部走 FastAPI 默认 `{"detail": 文字}`；`detail` 质量参差：`main.py:243`（对话失败）走 `model_error_hint(exc) or f"对话失败：{exc}"`，其余多处直接 `str(exc)` 原样透出（`main.py:939` 工作区、`main.py:1059` db tables、`main.py:1072` db detail、`main.py:1091` db backup）。
- SSE `error` 事件（`main.py:626` 组帧、`main.py:671-682` 生产）：`code` 只有 `chat_failed` 一个值、`retryable` 硬编码 `true`、`message` 可能是 `null`（`llm.py:109-125` 的 `model_error_hint` 认不出就返回 `None`）。
- **后端错误码已存在，但只在工具层**：`mcps/tool_result.py:17-27` 定义 `TOOL_OK/TOOL_FAILED/TOOL_DENIED/TOOL_TRANSIENT_EXHAUSTED/TOOL_CIRCUIT_OPEN/TOOL_SKIPPED/TOOL_TIMEOUT/MCP_SERVER_DOWN`（模块级常量，不是 Enum）；`external/adapter.py:26` 的 `ExternalToolError.tool_code` 是唯一自带 code 的异常。
- **「可重试」靠字符串猜**，且分散三处：`llm.py:75-84` `is_rate_limit_error`（特征表 `llm.py:62-72`）；`mcps/resilience.py:124-151` `classify_exception`（isinstance + 字符串 + `status_code` + `errno`）；`graphs/common.py:451-468` `_failed_tool_names`（逐行正则 + 中文关键词），被 `concise_failure`（`common.py:471-493`）用来拼最终文案。
- **后端码到不了前端**：`ToolResult.code` 只出现在审计表（`src/api/audit.ts:12` `result_code`）。`src/api/client.ts:117-118` 的 `HttpError` **没有 code 字段、且未 export**；`backendStream`（`client.ts:320-323`）非 2xx 抛普通 `Error`；`httpErrorMessage`（`client.ts:234-247`）只认 `detail`/`message`。
- `useChatSession` 用**字符串匹配**判分支：流式回落（`useChatSession.ts:378-384` 判 `StreamUnsupportedError` 或 message 含「流式已关闭」）、`isAbortError`（`useChatSession.ts:94-99`）；SSE `error` 只取 `message`（`useChatSession.ts:371-374`），`code`/`retryable` 被丢弃。
- 全仓没有 `AgentError`/`ErrorCode`：`grep "class .*Error"` 只命中 `eval/cases.py:19` `CaseError`、`external/adapter.py:26`、`external/client.py:38`。

### 目标

1. **错误码单一来源**：一个模块定义全部 code + 人话文案 + 可重试性 + HTTP 映射，`tool_result.py` 的 `TOOL_*` 并入同一取值域（旧名字继续可用）。
2. **一处分类**：`classify(exc)` 是唯一「异常 → code」判定点；字符串特征匹配集中在该模块内，`is_rate_limit_error` / `classify_exception` / `_failed_tool_names` 改为复用而非自建规则。
3. **对外错误体统一**：REST 与 SSE 都带 `code/retryable/stage`，**同时保留顶层 `detail` 字符串**（不破坏既有前端与脚本）。
4. **前端按 code 决策**：`HttpError` 带 `code/retryable/detail` 并导出；`useChatSession` 依据 code 决定「可重试 / 去配置 / 丢弃断点 / 静默」。
5. **可观测**：code 进 trace（step 级 `error_code`、轮级 `error_code`），指标可按 code 聚合。

### 方案

**（a）新建 `backend/errors.py`（d 级契约层）**：只依赖标准库，`agents/`、`mcps/`、`trace/` 都能 import 而不产生循环依赖（`mcps` 不能反向依赖 `agents`，这是放根目录的原因）。

```python
# 取值域：模块级常量（与 tool_result.py 现有风格一致，不用 Enum）
MODEL_AUTH / MODEL_CONFIG / MODEL_RATE_LIMIT / MODEL_TIMEOUT / MODEL_NOT_FOUND / MODEL_FAILED
TOOL_OK / TOOL_FAILED / TOOL_DENIED / TOOL_TRANSIENT_EXHAUSTED / TOOL_CIRCUIT_OPEN /
TOOL_SKIPPED / TOOL_TIMEOUT / MCP_SERVER_DOWN
SANDBOX_VIOLATION / CHECKPOINT_EXPIRED / CANCELLED / EVAL_CASE_INVALID / INTERNAL

@dataclass(slots=True)
class AgentError(Exception):
    code: str
    message: str                 # 人话，直接给用户看
    retryable: bool = False      # 默认来自 code 表，允许调用点覆盖
    stage: str = ""              # understand|context|react|tool|stream|resume|db
    detail: dict | None = None   # 仅内部/日志，默认不外发
    status_code: int = 500       # 取 HTTP_STATUS[code]
```

- `to_dict(with_detail=False)` → `{"code","message","retryable","stage"}`；`detail` 默认不外发（避免把底层 request_id / 路径漏给 UI）。
- `MESSAGES: dict[code, str]`：**唯一**人话表（例：`MODEL_RATE_LIMIT` →「模型供应商限流，自动重试后仍未通过：稍后再试，或在「模型」里换一条更宽松的线路」）。
- `HTTP_STATUS`：`MODEL_AUTH 502`、`MODEL_CONFIG 409`、`MODEL_RATE_LIMIT 429`、`MODEL_TIMEOUT 504`、`MODEL_FAILED 502`、`TOOL_DENIED 403`、`SANDBOX_VIOLATION 403`、`CHECKPOINT_EXPIRED 409`、`INTERNAL 500`。
- `classify(exc, *, stage="") -> AgentError` 判定顺序：①已是 `AgentError`（补 stage）②`getattr(exc,"tool_code")` ③`isinstance`（`TurnCancelled`→`CANCELLED`、`PermissionError`→`TOOL_DENIED`、`TimeoutError`→`MODEL_TIMEOUT`…）④`status_code`（401/403→`MODEL_AUTH`、404→`MODEL_NOT_FOUND`、429→`MODEL_RATE_LIMIT`、≥500→`MODEL_FAILED`）⑤字符串特征（`_RATE_LIMIT_MARKERS` / `_TIMEOUT_MARKERS` / `_CONNECT_MARKERS`）⑥`INTERNAL`。`model_error_hint` 的结果优先塞进 `message`（保留「供应商原话 + request_id」体验）。

**（b）收敛现有判定点（不删旧壳）**

| 现状函数 | 改为 |
|---|---|
| `llm.py::model_error_hint` | 内部调 `classify()`，返回 `err.message`（签名不变） |
| `llm.py::is_rate_limit_error` | 改判 `classify().code == MODEL_RATE_LIMIT`（函数名保留，`test_llm_rate_limit.py` 不动） |
| `mcps/resilience.py::classify_exception` | 由 `classify().code` 映射回 `transient/deterministic/denied/cancelled`，删除自带字符串规则 |
| `graphs/common.py::_failed_tool_names` | **不再参与判定**，只作「本轮失败工具名」展示；`concise_failure` 优先 `AgentError.message`，否则 `MESSAGES[code]` |
| `mcps/tool_result.py` 的 `TOOL_*` | 改为 `from ..errors import ...` + re-export（旧 import 路径全部继续可用） |

**（c）REST 错误体（双写兼容）**

```json
{ "detail": "模型供应商限流……",
  "error": { "code": "MODEL_RATE_LIMIT", "message": "…", "retryable": true, "stage": "react" } }
```

- `main.py` 注册 `@app.exception_handler(AgentError)`：状态码取 `HTTP_STATUS[code]`，同时写 `detail`（字符串）与 `error`（对象）。
- 替换分两步，避免一次动 65 处：**第一步只换 `main.py` 的 17 处**（对话/上传/工作区/db 等主链路，`detail` 由 handler 填 `message`，文案逐字不变）；**controller 的 48 处 4xx 保持原样**（都是明确的输入校验与 404，detail 已可读），第二步再按模块迁 `AgentError`。
- 开关 `CHATVEIN_ERROR_ENVELOPE`（默认开）：`=0` 只回 `{"detail"}`，即今天的形状（回滚用）。

**（d）SSE**：`error` 事件改为 `{"code","message","retryable","stage","turn_id"}`，`code` 来自 `classify`（不再恒为 `chat_failed`）；`cancelled` 事件不变（取消不是故障）。

**（e）前端**：`client.ts` 导出 `HttpError`（增 `status/code/retryable/detail`）；`httpErrorMessage` 先读 `error.message` → `detail` → `message`；`backendStream` 非 2xx 也抛 `HttpError`。流式回落仍用 `StreamUnsupportedError`，但删掉 message 含「流式已关闭」的字符串匹配（改判 code）。`useChatSession` 增 `errorAction: "retry"|"configure"|"resume"|null`：

| code | 前端动作 |
|---|---|
| `MODEL_AUTH` / `MODEL_CONFIG` / `MODEL_NOT_FOUND` | `configure`：错误条带「去模型设置」按钮 |
| `MODEL_RATE_LIMIT` / `MODEL_TIMEOUT` / `MODEL_FAILED` / `TOOL_FAILED` | `retry`：提示「再试一次」，乐观气泡清理逻辑不变 |
| `CHECKPOINT_EXPIRED` | `resume`：提示该轮现场已失效，引导「放弃」 |
| `TOOL_DENIED` / `SANDBOX_VIOLATION` | 无动作，`muted` 语气 |
| `CANCELLED` | 沿用「已取消本次生成」 |

`ChatPanel` 错误条从纯文本扩展为「文本 + 一个按钮」，不新增弹窗。

**（f）trace**：`recording.py:603` / `recording.py:669` 在 `error_detail` 补 `code`；`snapshot()`（`recording.py:485-507`）加轮级 `error_code`；前端 `traces.ts:31` `TraceErrorDetail` 加 `code?` 并在步骤详情显示。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/errors.py` | d | 新建：code 常量、`AgentError`、`MESSAGES`、`HTTP_STATUS`、`classify`、特征表 |
| `backend/main.py` | a | 注册异常处理器；17 处 `HTTPException` 改抛 `AgentError`；SSE `error` 帧 |
| `backend/*/controller.py`（11 个） | d | 第二步再迁（本批只在 handler 侧兼容，不动 48 处 4xx） |
| `backend/agents/llm.py` | b | `model_error_hint` / `is_rate_limit_error` 改走 `classify` |
| `backend/agents/graphs/common.py` | b | `concise_failure` 走 code→人话；`_failed_tool_names` 只作展示 |
| `backend/mcps/resilience.py` | b | `classify_exception` 复用 `classify` |
| `backend/mcps/tool_result.py` | d | `TOOL_*` 从 `errors.py` 导入并 re-export |
| `backend/trace/recording.py` | b | step `error_detail.code`、轮级 `error_code` |
| `src/api/client.ts` | d | `HttpError` 导出 + code/retryable/detail；`backendStream` 抛 `HttpError` |
| `src/components/chat/useChatSession.ts` | a | `errorAction` + 按 code 分支；删两处字符串匹配 |
| `src/components/chat/ChatPanel.tsx` | c | 错误条加按钮（去设置 / 重试 / 放弃） |
| `src/api/traces.ts` + `TraceWindow.tsx` | d/c | `TraceErrorDetail.code` + 展示 |
| `backend/tests/test_errors.py` | — | 新建：分类矩阵、HTTP 映射、envelope 双写、`TOOL_*` 恒等 |

### 风险与回滚

- **`main.py` 是 a 级**：handler 是纯附加，但「把 17 处 `HTTPException` 换成 `AgentError`」会动主链路返回路径。缓解：先加 handler + 双写并保证 detail 逐字不变，再分批替换，每批跑全量 pytest。
- **controller 层暂不迁**：48 处 4xx 仍是 `{"detail"}` 形状，前后端要能同时吃两种形状——`httpErrorMessage` 已按 `error` → `detail` 顺序回落，因此不需要同步改 controllers；第二步迁移时才统一。
- **码表两份**：`tool_result.py` 只 re-export、禁止再定义；`test_errors.py` 断言两处常量恒等。
- **可重试误标**：`retryable` 必须来自 code 默认表，禁止调用点随手 `True`（仅 `MODEL_RATE_LIMIT`/`MODEL_TIMEOUT`/瞬时工具错误默认可重试）。
- **回滚**：`CHATVEIN_ERROR_ENVELOPE=0` 回旧错误体；前端 `errorAction=null` 时按今天纯文本展示，天然兼容。

### 验收

- `pytest backend/tests` 全绿；新增用例覆盖 401/403/404/429/≥500/超时/取消/`tool_code` 分类、HTTP 映射、双写与 `=0` 回退。
- 两个真实场景（断网、错误 key）：UI 出现「去模型设置」按钮，且不再透出裸 `str(exc)`。
- `npm run build` + `npm test` 通过；4 条人工冒烟不变。

---

## 4.4 Prompt 与配置治理

### 现状（证据）

提示词分散在 **12 处**，全部是模块级静态字符串，**没有任何版本号、hash 或注册表**（全仓搜 `prompt_version|PROMPT_VERSION|prompt_hash|PROMPT_REGISTRY|template_registry|_PROMPT_V` → 0 命中）：

| 文件 | 常量 | 用途 |
|---|---|---|
| `agents/router.py` | `_SYSTEM`（:17） | 理解 + 改写 + 三档难度判定 |
| `agents/tool_selector.py` | `_SYSTEM`（:20，:120 拼「可用工具:」目录） | 工具精选裁决 |
| `agents/graphs/prompts.py` | `_IDENTITY/_WORKSPACE/_TOOLING/_STOPPING/_RESPONSE/_TIER_*`（:18-54）、`build_agent_system()`（:80）、`MEDIUM_SYSTEM_STATIC`（:112）、`HARD_SYSTEM_STATIC`（:123） | medium / hard 系统提示词分片拼装 |
| `agents/graphs/simple.py` | `_SYSTEM`（:17）、`SIMPLE_SYSTEM`（:19） | simple 直答 |
| `agents/graphs/hard.py` | `_HARD_SYSTEM`（:46）、规划内联（:157）、核对内联（:414） | `TaskPlan` 规划 / `VerifyDecision` 核对 |
| `agents/orchestration.py` | `_AGG_SYSTEM`（:118） | 并行派发结果聚合 |
| `agents/context.py` | 摘要 `SystemMessage` 内联（:171-179） | 历史压缩 |
| `memory/service.py` | `_EXTRACT_SYSTEM`（:423）、召回注入块（:295） | 记忆抽取 / 召回注入 |
| `eval/judge.py` | `_SYSTEM`（:17）、`_prompt()`（:59） | 四维评分 |
| `skills/{local_store,service}.py` | `format_skill_catalog_for_prompt` / `skill_prompt_blocks` | 技能目录注入 |
| `roles/service.py` | 主角色种子 prompt（:241） | 默认人设（存 DB，无版本列） |
| `mcps/tools/*.py` | `@tool` docstring / `description` | 工具 schema 描述（另一类提示词面） |

组装顺序（每轮）：`main.py::_prepare_chat_turn`（:495 技能块并入 `role_runtime["prompt"]` → :511 `assemble_team`）→ `main.py::_run_chat_heavy`（:768 `memory.recall_into_role` 返回 prompt 副本）→ `pipeline._merged_system`（`pipeline.py:24`，simple 叠角色）或 `build_agent_system(tier=...)`（`medium.py:133-137` / `hard.py:261-266`）→ `common.build_react_graph`（:496 `create_agent`）。

可挂版本的现成位点（都已在 trace 里）：`step["invocation"]`（`recording.py:214`）、llm step 的 `request.messages[0]`（system 全文已被 `_dump_message` 记录）、`note(...)` 的任意 detail、`TraceRecorder.meta`（`recording.py:292`，当前只 snapshot `role/model` 四项，`recording.py:498-502`）。

配置侧：`CHATVEIN_*` 开关已 **30+ 个**，默认值与读取点散落在 20 余个文件（全量清单见文末附录），`docs/` 没有任何一处集中说明。

### 目标

1. 提示词的**身份、版本、渲染入口**集中一处：代码里出现提示词时能回答「这是哪个模板、第几版」。
2. 版本进 trace（轮级 `prompts`）与 eval 报告，让「改 prompt → 质量变化」可对比（补上 3.3 遗留的 `prompt_version` 缺口）。
3. 配置不新增第二套开关系统：本批新增开关统一走一个读取函数；旧开关不强制迁移，但默认值在 `docs/configuration.md` 有唯一表格。

### 方案

**（a）新建 `backend/agents/prompt_registry.py`（d 级）**

```python
@dataclass(frozen=True, slots=True)
class PromptSpec:
    name: str        # "router.understand" / "agent.medium" / "hard.plan" ...
    version: str     # 人工维护，如 "v3"
    template: str    # 原始文本（含 $var 占位）
    tags: tuple[str, ...] = ()

class PromptRegistry:
    def register(self, spec: PromptSpec) -> None   # 重名/重版本 → ValueError（导入期就炸）
    def get(self, name: str) -> PromptSpec
    def render(self, name: str, **vars) -> str     # string.Template.substitute
    def versions(self) -> dict[str, dict]          # {"router.understand": {"version":"v3","fingerprint":"ab12cd34"}}
```

- **占位用 `string.Template`（`$var`）而不是 f-string**：f-string 要求占位在定义处就存在，模板无法集中；`Template` 还能对未知变量报 `KeyError`，直接指出缺哪个变量。
- `fingerprint = sha1(template)[:8]`：防「改了文本忘了改版本号」。trace 与 eval 报告同时写 `version` 与 `fingerprint`，不一致即说明漂移。
- 注册点在**各模块导入期**调 `register()`，不是让 registry 反向 import：`prompt_registry` 只依赖 `string`/`hashlib`，避免被 `agents/*` 循环依赖。

**（b）本批只做「登记 + 版本 + 渲染入口」，不搬文本**

理由：把 12 处文本一次性搬进新模块，等于在同一个 PR 里同时改「治理设施 + 全部提示词」，质量回归无法归因（3.3 刚建立 eval 基线，正是为了能归因）。因此：

- 各模块保留自己的常量作为文本来源，导入期 `registry.register(PromptSpec(...))`；
- 已有拼装函数（`build_agent_system`、`judge._prompt` 等）改为从 registry 取 spec 再 `render`，**输出字符串逐字不变**（靠现有测试 + eval `--dry-run` 校验）；
- 后续新增提示词必须走 registry，禁止再写裸常量。

登记清单（11 个 spec）：`router.understand`、`tool.selector`、`agent.simple`、`agent.medium`、`agent.hard`、`hard.plan`、`hard.verify`、`orchestrate.aggregate`、`context.summary`、`memory.extract`、`eval.judge`。技能目录 / 记忆召回块属于**运行时数据**，不是模板，不登记。

**（c）trace 与 eval 联动**

- `TraceRecorder` 增 `prompt_versions`，`snapshot()` 输出 `prompts: {"agent.medium": {"version":"v3","fingerprint":"ab12cd34"}}`；**只记本轮真正用到的**（simple 轮不记 `agent.hard`），由各节点 `note()` 带 `used_prompts`、`tracing()` 结束时按 `difficulty` 取并集。
- `TraceWindow` 侧栏加一行「提示词」：显示本轮用到的 spec 版本与数量（只读，不做编辑器）。
- `eval/runner.py` 报告增 `prompts`（registry 快照）+ 每条结果的本轮 spec 版本，形成「改 prompt → 跑 eval → 比报告」闭环；`--dry-run` 额外校验 registry 完整性（未注册 / 重名 / 指纹与版本不一致 → 退出码 `2`）。

**（d）配置治理（轻量，本批不做全量迁移）**

- 新建 `docs/configuration.md`：把附录 30+ 个 `CHATVEIN_*` 整理成「变量 | 默认值 | 文件:行 | 一句话」，作为唯一表格；后续新增开关必须同步此表。
- 新建 `backend/agents/config.py`（e 级）只提供 `flag(name, default) -> bool` 与 `number(name, default, lo, hi)`：**本批新增的开关全部走它**；旧调用点不强制迁移（避免一次性碰 20 个文件），在 `docs/configuration.md` 标「待迁移」。
- 不做运行时改配置的 UI 与热加载：桌面端改开关需重启，避免同进程两套默认值。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/prompt_registry.py` | d | 新建：`PromptSpec` / `PromptRegistry` / `fingerprint` / `versions` |
| `backend/agents/config.py` | e | 新建：`flag` / `number`（仅新开关使用） |
| `backend/agents/{router,tool_selector}.py`、`graphs/{prompts,simple,hard,medium}.py`、`orchestration.py` | b | 导入期登记 spec；拼装改走 `render`（文本不变） |
| `backend/agents/context.py`、`memory/service.py`、`eval/judge.py` | b/c | 同上（摘要 / 抽取 / 评分模板） |
| `backend/trace/recording.py` | b | `prompt_versions` + `snapshot()["prompts"]` |
| `backend/eval/runner.py` | c | 报告加 `prompts`；`--dry-run` 校验 registry |
| `src/api/traces.ts` + `src/components/trace/TraceWindow.tsx` | d/c | `prompts` 类型 + 侧栏一行 |
| `docs/configuration.md` | — | 新建：`CHATVEIN_*` 全量表格 |
| `backend/tests/test_prompt_registry.py` | — | 新建：重名/重版本报错、`render` 变量缺失、指纹稳定性、11 个 spec 齐全 |

### 风险与回滚

- **「登记」把提示词变成启动期依赖**：注册失败（重名）会在 import 期抛错，等于后端起不来。缓解：`register()` 只做常量登记、不读文件不联网；重名属开发期错误，`test_prompt_registry.py` 先拦住。
- **渲染改动引入空白差异**：`Template.substitute` 与 f-string 对换行/尾随空格的差异会导致 prompt 文本变化 → eval 分数抖动。缓解：`render` 输出与旧常量逐字比对（单测里做 `assert render(...) == 旧常量`）。
- **版本号沦为形式**：只写 `version` 不更新等于没有。缓解：`fingerprint` 与 `version` 双写，eval `--dry-run` 与报告对不上就报错。
- **回滚**：`CHATVEIN_PROMPT_REGISTRY=0` 时 `render` 直接返回原常量（等价于不启用）；trace 不写 `prompts` 字段；eval 报告退回 3.3 的字段集。

### 验收

- 同一轮对话的 trace 里能看到 `prompts` 及其 `version/fingerprint`；把 `agent.medium` 改一个字、不升版本 → eval `--dry-run` 退出码 `2` 并指出是哪个 spec。
- 改动前后 prompt 文本逐字一致（单测断言），eval 冒烟用例结果不变。
- `npm run build` + `npm test` + `pytest` 通过。

---

## 4.7 成本预算与模型 fallback（本批新增编号）

> 总纲 §2 横切行写的「token/成本预算、模型降级与 fallback」此前没有编号，本批补为 4.7。

### 现状（证据）

- **有「窗口预算」，没有「成本预算」**：`agents/token_budget.py` 已有 `estimate_text_tokens`（:59）、`count_message_tokens`（:98）、`ContextBudget`（:114，四段窗口预算）、`resolve_budget`（:144，读 `context_window_k` / `max_tokens` / `CHATVEIN_CTX_WINDOW`）。它回答的是「这轮能不能塞进上下文」，**不回答「这轮花了多少钱、要不要收手」**。
- **没有 fallback**：`models/service.py:1-7` 明示「不再区分主/默认模型、不存在回退链」；实体字段（`models/entity/entity.py:20-47`）= `id,name,provider,model_id,base_url,api_key,temperature,max_tokens,presence_penalty,frequency_penalty,stream,json_mode,retries,context_window_k,enabled,description,created_at,updated_at`，无备用模型引用、无价格字段。
- 唯一客户端工厂 `agents/llm.py::get_chat_model`（:239，仅 `openai`/`deepseek` 两条线路，:227）：`model_id` 空 / `enabled=False` / key 空 → 返回 `None`（:254-261），**上层只能降级成「不调模型」**，没有「换另一个模型继续」的路径。
- 每次调用的用量已经落 trace：`totals`（`recording.py:472-484`）= `input_tokens/output_tokens/total_tokens/llm_calls/tool_calls/llm_ms/tool_ms`（+cached/reasoning）；`metrics.py` 已有均值与 P95。**数据齐了，缺的是判定与收敛**。
- 放大成本的地方：并行派发（`orchestration.parallel_delegate`，默认并行度 4、批次上限 420s）、hard 的 plan/verify、上下文摘要、judge。这些都没有总额约束。

### 目标

1. 每轮有**可选的 token 预算**：到阈值不再继续调工具，强制基于现有信息收尾（不是硬中断、不留半截答案）。
2. 主模型不可用时**按配置降级到备用模型**，且只降级一次、只在「本轮还没有产出」时降级。
3. 成本与降级都进 trace，追踪窗能看出「这轮花了多少、有没有降级」。

### 方案

**（a）预算 `backend/agents/cost.py`（c 级）**

```python
@dataclass(slots=True)
class TurnBudget:
    token_limit: int      # CHATVEIN_TURN_TOKEN_BUDGET，默认 0 = 关
    used_input: int = 0
    used_output: int = 0
    def exceeded(self) -> bool
    def note_usage(self, usage: dict) -> None      # 由 TraceHandler.on_llm_end 之后回灌

def resolve_budget() -> TurnBudget                 # 读 env + 模型 max_tokens，默认 0 表示不限
def turn_usage() -> TurnBudget                     # ContextVar，与 tool_scope 同生命周期
```

- 挂载点在 ReAct 循环的 `wrap_tool_call` 之前：超预算时**改走「收尾」而不是拒绝工具**——注入一条 `HumanMessage`（「已达到本轮预算，请基于已有信息给出结论」）并禁用后续工具调用，本轮正常收尾落盘。理由：硬砍会造成半截答案与幽灵气泡（2.1/1.3 的老坑）。
- 计数来源只用 trace 已经拿到的 `usage`（不额外估算、不重复调用分词器）；`note_usage` 在 `on_llm_end` 回调里顺手回灌，避免两套计量口径。
- 预算默认 **0（关闭）**：桌面端单轮几百 token 是常态，默认限死会误伤；开启是给重度用户/评测用的阀，不是计费。
- 成本（金额）本批**只做可选展示**：`models` 表若填了 `price_input`/`price_output`（每百万 token，追加列、可空）则 `cost.py` 估算金额，未填就只报 token。**不内置价格表**（供应商改价频繁，内置等于长期错误），也不做币种换算。

**（b）fallback**

- `models` 表追加 `fallback_config_id`（`db.py` 迁移 v15，追加列 + 幂等，`SCHEMA_VERSION=14 → 15`）；外键不建（模型可被删除，悬空引用按「无 fallback」处理）。
- `llm.py` 新增 `with_fallback(model, fallback)`：返回一个**轻量包装对象**，只实现 `invoke` / `with_structured_output().invoke`（即**结构化调用**：router / tool_selector / plan / verify / summary / memory / judge）——这些是单次调用，降级语义清晰。
- **流式主循环不包装**：中途换模型会把两种风格的增量混在一起（且已推给前端无法撤回）。主循环失败仍走 4.3 的 `MODEL_*` 错误 + 前端「再试一次」。
  > **实现修正（2026-11-20）**：`graphs/simple.py` 的直答路径在**尚未吐字**时也走一次降级（换备用模型 + 一次性 `invoke`），因为此时没有增量可混；已吐字则原样抛出。判定与取备统一收在 `llm.py::try_fallback`，不在调用点各写一套。
- 降级触发条件（全部满足才降）：①`classify(exc).retryable` 为真且 code ∈ {`MODEL_AUTH`, `MODEL_RATE_LIMIT`, `MODEL_TIMEOUT`, `MODEL_NOT_FOUND`, `MODEL_FAILED`}；②已配置且 `enabled=True` 的 `fallback_config_id`；③本轮**尚未因降级切换过**（每轮最多一次，防抖与防循环）；④不处于取消中。
- 降级留痕：`note("model_fallback", status="warn", from_config=..., to_config=..., code=...)`；`snapshot()` 加轮级 `model_fallback: {from, to, code}`；`TraceWindow` 顶部条幅提示「本轮已降级到 <name>」（用现有 `config_name` 字段展示）。
- `resolve_budget()` 与 fallback 的模型参数（温度、max_tokens）各自独立：备用模型用自己的配置，不继承主模型参数。

**（c）开关**

| 开关 | 默认 | 含义 |
|---|---|---|
| `CHATVEIN_TURN_TOKEN_BUDGET` | `0` | 单轮 token 上限；`0` = 不限（只统计不干预） |
| `CHATVEIN_MODEL_FALLBACK` | `1` | `0` 关闭降级（已配置的备用模型也不生效） |
| `CHATVEIN_PRICE_CURRENCY` | 空 | 仅展示用币种符号，不做换算 |

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/agents/cost.py` | c | 新建：`TurnBudget`、`resolve_budget`、`turn_usage`、金额估算（可选） |
| `backend/agents/llm.py` | b | `with_fallback` 包装（`invoke` / `with_structured_output`） |
| `backend/agents/graphs/common.py` | b | ReAct 循环接预算：超限注入收尾提示并禁工具 |
| `backend/agents/graphs/pipeline.py` / 各结构化调用点 | b | 结构化调用改走 `with_fallback` |
| `backend/trace/recording.py` | b | `note_usage` 回灌、`model_fallback` note、`snapshot()["model_fallback"]` |
| `backend/db.py` | a | 迁移 v15：`models` 追加 `fallback_config_id` / `price_input` / `price_output`（均可空） |
| `backend/models/{entity,service,controller}.py` | b/d | 三个新字段的读写与校验（fallback 必须指向存在且 enabled 的配置） |
| `src/components/models/*` | c | 模型表单加「备用模型」下拉（价格两个输入框可选填） |
| `src/api/models.ts` | d | 类型补三个字段 |
| `src/api/traces.ts` + `TraceWindow.tsx` | d/c | `model_fallback` 类型 + 顶部条幅 |
| `backend/tests/test_cost.py` | — | 预算阈值、收尾注入、降级条件矩阵（含「一轮只降一次」）、迁移幂等 |

### 风险与回滚

- **`db.py` 迁移是 a 级**：只追加可空列 + 幂等，`SCHEMA_VERSION=15`；回滚不需要改库（旧代码忽略新列），但**降级字段一旦被写入，旧版本会静默忽略**——所以回滚只回行为，不回数据。
- **降级掩盖真实故障**：连续降级会让用户以为主模型正常。缓解：降级必留 `model_fallback` note + 前端条幅，且不改变 `success_rate` 口径（指标里单列 `fallback` 计数）。
- **预算误伤长任务**：默认 `0`（关），只有显式设置才生效；超限是「收尾」不是「报错」，落盘与追踪照常。
- **金额口径**：价格由用户填、只做展示，避免内置价目表的长期错误；没有价格时只报 token。
- **回滚**：`CHATVEIN_TURN_TOKEN_BUDGET=0` + `CHATVEIN_MODEL_FALLBACK=0` 即回到今天的行为。

### 验收

- 设 `CHATVEIN_TURN_TOKEN_BUDGET=5000` 跑一个多工具任务：轮次正常收尾、trace 里能看到预算命中、没有半截气泡。
- 配置一个错误 key 的主模型 + 一个正常备用模型：结构化步骤（路由/工具选择）自动降级，trace 有 `model_fallback`，UI 顶部提示降级目标。
- 迁移在既有库上重复执行两次无副作用；`pytest` 全绿。

---

## 实施顺序与依赖

```text
4.3 统一错误模型（先做：唯一错误码 + classify）
   ↓ classify 的 code 被 4.7 的降级条件直接引用；prompts 版本进 trace 复用同一套 payload 扩展
4.4 Prompt 与配置治理（独立可并行；只动提示词登记与 trace 字段，不改文本）
   ↓ eval 报告带 prompt 版本，才能归因 4.7 的预算改动带来的质量变化
4.7 成本预算与 fallback（最后做：碰 db 迁移与 ReAct 循环）
```

三者各自带开关、可独立回滚；每项结束跑全量回归（`pytest` + `npm test` + `npm run build`）+ 对应专项冒烟。

---
## 交付核对表（评审后逐项打勾）

| 能力 | 开关 | 新增数据 | a 级文件改动 | 专项冒烟 |
|---|---|---|---|---|
| 4.3 统一错误模型 | `CHATVEIN_ERROR_ENVELOPE` | —（trace 加 `error_code`） | `main.py`、`useChatSession.ts` | 断网 / 错误 key 两个场景的「去配置」按钮 |
| 4.4 Prompt 治理 | 无（`eval --dry-run` 自检当门禁） | —（trace/eval 加 `prompts`） | — | 改一个字不升版本 → `--dry-run` 报错 |
| 4.7 预算 + fallback | `CHATVEIN_TURN_TOKEN_BUDGET` / `CHATVEIN_MODEL_FALLBACK` | `llm_models` 三列（主库 v15） | `db.py` | 5000 token 预算收尾 + 备用模型降级 |

## 实现纪要（batch4 落地记录）

### 落地位置

| 能力 | 落在哪 | 备注 |
|---|---|---|
| 4.3 错误码表 + 分类 | `backend/errors.py`（`classify` / `AgentError` / `MESSAGES` / `HTTP_STATUS`） | `tool_result.py` 只 re-export `TOOL_*`，`test_errors.py` 断言两处恒等 |
| 4.3 REST/SSE 信封 | `main.py` 异常处理器 + SSE `error` 帧（`code/retryable/stage`，保留 `detail`） | `CHATVEIN_ERROR_ENVELOPE=0` 回到旧形状 |
| 4.3 前端按码决策 | `client.ts`（`ErrorEnvelope` / 具名 `HttpError`）、`useChatSession.ts`（`actionForCode` → `configure`/`retry`）、`ChatPanel.tsx`（`ErrorNote` 按钮）、`ChatView.tsx`（落地动作） | 回落判定改用 `STREAM_DISABLED` 码，不再匹配中文文案 |
| 4.3 trace | `recording.py` step `error_detail.code`、轮级 `error_code`；`TraceWindow` 显示码徽标 | — |
| 4.4 提示词版本 | `agents/prompt_registry.py`：7 个 spec（framework / agent.medium / agent.hard / route.understand / tools.select / team.aggregate / eval.judge）、版本 = 原文 sha256 前 8 位 | 进 `pipeline` 的 trace meta、`TraceWindow` 头部、eval 报告与 `--dry-run` 输出 |
| 4.4 配置口径 | `agents/config.py::flag/number` + `docs/configuration.md` 全量表 | `backend/tests/test_config.py` 用 AST 扫「真的读环境变量」的调用，漏写即失败 |
| 4.7 预算 | `agents/cost.py`（`TurnBudget` / `begin_turn` / `note_usage` / `over_budget` / `mark_curtailed`）、`common.budget_middlewares()`（`before_model` 注入收尾提示 + `wrap_tool_call` 挡工具）、`pipeline` 轮开始/结束复位 | 用量来自 `TraceHandler.on_llm_end` 回灌，不另起计量口径 |
| 4.7 fallback | `llm.try_fallback`（判码 + 取备 + 记账）：`invoke_structured` 命中 `MODEL_RATE_LIMIT/TIMEOUT/FAILED` 切一次；`graphs/simple.py` 直答**尚未吐字**时换线 + 一次性 `invoke`；`reset_fallback_used()` 每轮复位 | 正文流中途不换模型（会混增量）；额度放在 `ContextVar` 的**可变对象**里，并行派发成员共享，一轮只降一次 |
| 4.7 数据 | `db.py` v15（可空三列，幂等）、`models` entity/dto/service/controller（写入即校验） | 悬空 `fallback_config_id` 运行期按「无备用」处理 |
| 4.7 展示 | `ModelsView` 备用模型下拉 + 两个价格输入；`TraceWindow` 降级条幅、金额、预算进度 | 金额只在填了单价时出现（`CHATVEIN_PRICE_CURRENCY` 仅换单位） |

### 与原设计的偏差（有意为之）

1. **提示词不搬文本、也不在导入期 `register()`**：注册表用 `ast` 读源码字符串常量，避免把「提示词版本」变成启动期依赖与循环依赖；代价是 `verify()` 只能校验「源符号存在 / id 唯一 / 常量可读」，不能做 `Template.substitute` 渲染校验。`CHATVEIN_PROMPT_REGISTRY` 开关取消——没有需要回滚的运行时行为。
2. **fallback 不做成 `with_fallback(model, fallback)` 包装**：降级逻辑收在 `try_fallback` 一处（`invoke_structured` 与 `graphs/simple.py` 共用），调用点无需各自判断；模型实例构造时打 `_chatvein_config_id` / `_chatvein_config_name` 私有标记，分别用于找回备用配置与在追踪里显示可读名字。
3. **降级触发码收窄为 429 / 超时 / 5xx**：鉴权错（`MODEL_AUTH`）与「模型名不存在」不降级——多半是配置填错，备用模型往往同样失败，只会掩盖真因。
4. **金额只做展示**：单价由用户在模型表单填（每百万 token），未填只报 token；不内置价目表、不做币种换算（`CHATVEIN_PRICE_CURRENCY` 只影响符号）。
5. **配置口径统一到「新开关 + 本次触碰的开关」**：`mcps/resilience.py`、`agents/orchestration.py`、`token_budget.py` 的数值开关保留各自的钳位函数（有上下限、支持小数），已在 `docs/configuration.md` 第 5 节标注。

### 回归记录

- `pytest backend/tests`：全绿（含新增 `test_errors.py` / `test_prompt_registry.py` / `test_config.py` / `test_cost.py` / `test_model_fallback.py` / `test_models_fallback_fields.py`）。
- `npm run build`：通过。
- `tools/run_eval.ps1 -Rest @("--dry-run")`：退出码 0，输出 7 条 spec 版本号。


## 待评审确认

1. **`backend/errors.py` 放根目录而不是 `agents/`**：为了让 `mcps/` 也能 import 而不产生 `mcps → agents` 反向依赖。是否接受把「契约层」放在 `backend/` 根（与 `db.py` 同级）？
2. **错误体双写 `detail` + `error`**：保留 `detail` 是为了不破坏既有前端与外部脚本。是否同意长期保留（而不是计划内移除）？
3. **`TOOL_*` 常量迁到 `errors.py`**（`tool_result.py` 只 re-export）：会动一个被 `registry`/`common`/`resilience`/审计广泛引用的模块，但只是移动定义、旧路径可用。是否接受？
4. **4.4 不搬提示词文本**：本批只做登记 + 版本 + trace，文本留在原模块。是否同意「搬文本」拆到后续单独一批（便于 eval 归因）？
5. **配置治理只做文档 + 新开关入口**：旧的 30+ 处 `os.getenv` 不强制迁移。是否接受（否则本批会扩散到 20 个文件）？
6. **成本只做 token 预算，金额可选**：不内置价目表、不做币种换算，价格由用户在模型表单填。是否需要把价格换成「按模型 ID 内置默认价」？
7. **fallback 的覆盖面**（已按主流做法落地）：结构化调用全量 + 直答**尚未吐字**时换线重跑（此时无增量可混）；正文流中途不换模型，失败仍交前端「再试一次」。若要让正文流也换线，只能做成「失败后整轮重跑并撤回已推内容」，另开一项。

## 附录：`CHATVEIN_*` 现状清单（`docs/configuration.md` 以此为源）

| 变量 | 读取点 | 含义 |
|---|---|---|
| `CHATVEIN_TOKEN` / `CHATVEIN_HOST` / `CHATVEIN_PORT` / `CHATVEIN_RELOAD` | `main.py:144/1098/1103/1108` | 请求令牌 / 监听地址与端口 / dev 热重载 |
| `CHATVEIN_DB_PATH` / `CHATVEIN_DATA_DIR` / `CHATVEIN_WORKSPACE` | `db.py:64/68`、`mcps/workspace.py:14` 等 | 主库路径 / 数据根 / 主工作区 |
| `CHATVEIN_STREAM` / `CHATVEIN_CHECKPOINT` | `main.py:719`、`checkpoint.py:65` | `=0` 关流式 / 关断点续跑 |
| `CHATVEIN_CTX_COMPACT` / `_RECENT_TURNS` / `_SUMMARY_LLM` / `_WINDOW` / `_OUTPUT_RESERVE` | `agents/context.py:262/273/202`、`token_budget.py:171/177` | 上下文压缩 / 保留轮数 / 摘要模型 / 窗口覆盖 |
| `CHATVEIN_TOOL_PREFILTER` / `_TOPK` | `agents/tool_retriever.py:24/25` | 工具预筛 / 候选数 |
| `CHATVEIN_LLM_RATE_LIMIT_RETRIES` / `_DELAY` / `_MAX_DELAY` | `agents/llm.py:57-59` | 限流退避 |
| `CHATVEIN_PARALLEL_DELEGATE` / `CHATVEIN_DELEGATE_MAX_PARALLEL` / `_BATCH_TIMEOUT` | `agents/orchestration.py:67/57/74` | 并行派发 / 并行度 / 批次超时 |
| `CHATVEIN_TOOL_RETRY` / `_MAX_ATTEMPTS` / `_CB_THRESHOLD` / `_RETRY_BASE` | `mcps/resilience.py:109-121` | 工具重试 / 熔断 / 退避 |
| `CHATVEIN_PERMISSIONS_PATH` / `CHATVEIN_PERMISSION_MODE` | `mcps/permissions.py:123/133` | 权限规则文件 / 档位 |
| `CHATVEIN_UNIFIED_APPROVAL` / `_APPROVAL_TIMEOUT` / `CHATVEIN_BASH_APPROVAL_TIMEOUT` | `mcps/approval.py:44/52`、`path_access.py:15` 等 | 统一审批 / 超时 |
| `CHATVEIN_AUDIT` / `CHATVEIN_AUDIT_DB_PATH` | `mcps/audit.py:78/83` | 审计开关 / 审计库 |
| `CHATVEIN_SANDBOX_GUARD` / `_LIMITS` / `_NETWORK` / `_ENV_PASSTHROUGH` / `_CPU_SECONDS` / `_MEMORY_MB` / `_FILE_MB` | `mcps/sandbox_guard.py:123-205` | 沙箱守卫与限额 |
| `CHATVEIN_GIT_BASH` / `_SKIP_GIT_BASH_CHECK` / `CHATVEIN_SKIP_BASH_DOWNLOAD` / `CHATVEIN_FORCE_BASH_DOWNLOAD` / `CHATVEIN_POWERSHELL_PATH` / `CHATVEIN_USE_POWERSHELL_TOOL` | `mcps/bash_runtime.py:63-68`、`bash_download.py:50/54` | Bash / PowerShell 运行时 |
| `CHATVEIN_BROWSER` / `_EXECUTABLE` / `_HEADLESS` / `CHATVEIN_USE_BROWSER_TOOL` | `mcps/browser_runtime.py:31-68` | 浏览器运行时 |
| `CHATVEIN_MCP_EXTERNAL` | `mcps/external/config.py:33` | `=0` 不加载外部 MCP |
| `CHATVEIN_MEMORY` / `_AUTO_ACCEPT` / `_EXTRACT_TURN_INTERVAL` / `CHATVEIN_MEMORY_DB_PATH` | `memory/service.py:64-72`、`memory/store.py:59` | 长期记忆 |
| `CHATVEIN_OTEL` / `CHATVEIN_OTEL_ENDPOINT` | `trace/otel.py:30/54` | 可选 OTel 导出 |
| `CHATVEIN_OCR_SPACE_KEY` / `CHATVEIN_LOCAL_TIMEZONE` | `mcps/tools/ocr.py:40`、`mcps/tools/core.py:53` | OCR key / 时区 |
| `CHATVEIN_SKILLHUB_API` / `_SITE` / `CHATVEIN_HF_ENDPOINT` / `CHATVEIN_MODELSCOPE_BASE` / `CHATVEIN_EMBED_MODEL` / `_EMBED_MIRROR` / `CHATVEIN_PIP_INDEX_URL` | `skills/service.py:29-32`、`embeddings/service.py:127-312`、`sandbox_guard.py:465` | 技能市场 / 向量与 pip 镜像 |

注：`conversations/`、`chats/` 不读任何 `CHATVEIN_*`；另有非前缀的 `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL`（`models/service.py:210-217`）用于首次播种。

