# 生产级增强 · 第三批：安全与运维（详细设计评审稿）

> 对应总纲 [`production-roadmap.md`](./production-roadmap.md)。**设计评审中，尚未改代码**。
> 边界：本批**不引入容器/OS 级隔离**（需求已确认），只在现有「路径约束 + 正则策略 + 审批」模型上加固。
> 依赖前两批：3.1 复用 1.2 错误模型；3.2 复用 2.2 审批策略 + 2.3 外部工具契约；3.3 复用全链路 trace。
> 三个能力：3.1 沙箱加固 / 3.2 细粒度权限 + 审计 / 3.3 eval 闭环 + OTel 可观测。

---

## 3.1 沙箱加固（不做容器）

### 现状（证据）

- `sandbox.py::sandbox_run_python`（L186-227）用 `env = os.environ.copy()` 继承**完整宿主环境**（可能含 API Key / `CHATVEIN_TOKEN`）；`shell=False`、超时 ≤120s，但无网络出口限制、无内存/CPU/磁盘配额。
- `sandbox_pip_install` 包名正则校验、≤8 个/次，但可拉任意 PyPI 包（供应链风险）；无镜像审计。
- `bash.py` / `powershell.py` 是普通子进程，可联网、可读环境变量；审批只发生在工具入口，Python 自身 I/O 可绕过路径策略。
- `ALWAYS_ON_TOOLS`（`common.py:94`）含 `sandbox_run_python`，**绕过角色白名单**无条件挂载。

### 目标

1. 执行子进程时默认不继承敏感环境变量（token / API Key / 凭据），需要白名单才能透传。
2. 限制沙箱进程的网络出口与资源（CPU 时间 / 内存 / 磁盘写入 / 进程数），用平台原生机制，不引入容器。
3. `pip install` 支持镜像白名单 + 可选离线锁文件；常驻代码工具可禁用。
4. 所有加固可被工具层感知并给模型可读提示（不静默失败）。

### 方案

**新增 `backend/mcps/sandbox_guard.py`**（c 级）：

- `sanitize_env(base: dict) -> dict`：从 `os.environ` 去掉敏感键（正则 `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CHATVEIN_TOKEN|API`），只保留白名单（`PATH`/`SYSTEMROOT`/`LANG`/`PYTHONIOENCODING`/`VIRTUAL_ENV` 等）。`sandbox_run_python` / bash / powershell 统一调用。敏感键命中记 trace（只记键名，不记值）。
- **资源限制**：
  - Python：用 `resource.setrlimit` 在 POSIX 设 `RLIMIT_CPU` / `RLIMIT_AS` / `RLIMIT_FSIZE`；Windows 无 `resource`，用 `subprocess.CREATE_JOB_OBJECT` + `JobObjectLimit`（Windows API via ctypes），限额 CPU/内存/进程数。封装 `apply_limits(process) -> cleanup`，跨平台。
  - 复用现有 `timeout` 作为最后兜底。
- **网络出口**：**评审确认（2026-11-19）：按最容易的方式实现**，不引入容器 / 防火墙规则 / 管理员权限：
  - 唯一开关 `CHATVEIN_SANDBOX_NETWORK=0`（默认禁用网络）控制；只用「Python `sitecustomize` hook + 黑洞代理环境变量」两层软隔离，跨平台一致。
  - **层 1（脚本进程）**：在会话 `runs/.venv` 里预置一份 `sitecustomize.py`（Python 启动时自动 import），在脚本代码执行前 patch `socket.socket` 的 `connect` / `connect_ex` / `create_connection`：对非本地地址（白名单 `127.0.0.1` / `::1` / `localhost`）直接抛错。仅影响走该 venv 的 `sandbox_run_python`，实现简单、无需管理员权限。用户脚本若显式 `del`/重绑 `socket` 可绕过 → 明确标注为**软隔离、非安全硬边界**。
  - **层 2（Shell / 子进程）**：对 bash / powershell / 沙箱进程统一注入黑洞代理环境变量（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` = `http://127.0.0.1:9`），让依赖代理的 HTTP 客户端默认连不通；不依赖代理的直连 socket 不受限，同样只作软约束。
  - 需要在沙箱内联网时：`CHATVEIN_SANDBOX_NETWORK=1` 关闭两层限制，联网需求优先引导用 `web_search` / `web_fetch`（它们不受沙箱网络开关影响，且自带 SSRF 防护）。
  - 工具层：给模型提示「当前沙箱网络已禁用，联网请用 web_search / web_fetch」，并在 trace / 审计记录实际生效模式。
- **pip 加固**：`sandbox_pip_install` 从 `CHATVEIN_PIP_INDEX_URL`（默认官方镜像）取源，禁止 `file://` / 本地路径 / `--trusted-host` 任意值；支持 `requirements.lock`（会话内）固定版本。
- **常驻工具可禁用**：`ALWAYS_ON_TOOLS` 改为函数 `always_on_tools(role)`：若角色 `tools` 显式不含 `sandbox_run_python`（或新增 `deny_tools` 字段），则不挂载。修正「空列表=不限制」与「常驻绕过」的冲突语义——默认仍常驻保证体验，只有显式拒绝才移除。
- **审计**：沙箱进程启动/结束/超限写 `audit.sqlite`（见 3.2）；输出截断沿用 `clip()`，但超限写入审计而非丢弃。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/mcps/sandbox_guard.py` | c | 新建：env 清洗 + 资源限制 + 网络策略 + `sitecustomize.py` 模板生成 |
| `backend/mcps/tools/sandbox.py` | b | 接 sanitize_env / apply_limits / pip 白名单 |
| `backend/mcps/tools/bash.py` / `powershell.py` | b | 接 sanitize_env |
| `backend/agents/graphs/common.py` | a | `ALWAYS_ON_TOOLS` → `always_on_tools(role)` |
| `backend/roles/entity/dto.py` | d | 可选 `deny_tools` 字段（迁移） |
| `backend/mcps/audit.py` | e | 审计写入助手（与 3.2 共用） |
| `backend/tests/test_sandbox_guard.py` | — | env 泄漏、limits、pip 白名单、常驻禁用测试 |
| `docs/workspace.md` / `docs/agents.md` | — | 明确网络为软隔离（可被用户脚本绕过）、pip 策略 |

### 风险与回滚

- **网络为软隔离非硬边界**：`sitecustomize` hook 可被脚本主动绕过，黑洞代理只挡走代理的客户端 → 文档明确「防误用、非防对抗」，联网敏感任务仍需 `web_search` 白名单通道 + 用户审批，不假装有 OS 级隔离。
- **资源限制误杀**：限额设宽松默认（CPU 120s / 内存 1GB / 文件 100MB），`CHATVEIN_SANDBOX_LIMITS=0` 可回退旧的「仅超时」行为。
- **env 清洗破坏依赖**：白名单逐项测试 venv/python 能否正常跑；灰度开关。
- **回滚**：单开关关闭全部加固恢复旧行为。

### 验收

- 沙箱脚本 `os.environ` 打印不含 token/key；超限脚本被终止且写审计；pip 私源自定义被拒。
- 默认网络关闭时，脚本 `socket.create_connection(("8.8.8.8", 80))` 被 hook 拒绝且给出人话提示；`CHATVEIN_SANDBOX_NETWORK=1` 后可连通。
- 角色显式拒绝 `sandbox_run_python` 后该工具不挂载。
- 关闭加固开关后行为与当前一致。

---

## 3.2 细粒度权限 + 审计日志

### 现状（证据）

- 权限是角色级粗粒度白名单（`tools` 分组 id / 工具名），`registry.resolve_tools/invoke_tools/catalog` 无工具级鉴权；无配额、无安全审计（trace 是功能追踪，非审计）。
- 审批态仅内存 dict（`bash_approval.py`），无持久化/审计；3 个常驻工具绕过白名单（3.1 处理）。

### 目标

1. 权限从「工具名/分组」细化到「参数级 / 路径级 / 数据级」，用声明式策略表达。
2. 全量工具调用（含内置/外部/MCP）写不可篡改语义的审计日志，支持查询与回放。
3. 配额：按会话/工具限制调用次数与频率，超限自动拒绝并提示。

### 方案

**新增 `backend/mcps/permissions.py`**（b 级）：

- 策略模型 `PermissionRule(scope, effect, tool, conditions)`，`conditions` 支持：
  - 参数约束：`{"tool":"web_fetch","url_host_in":[...]}`、`{"tool":"sqlite_query","read_only":true}`；
  - 路径约束：`{"tool":"read_text_file","path_prefix":"session:output/**"}`（复用 `path_access` 解析）；
  - 数据约束：外部 MCP 工具的字段白名单。
- 决策 `check(tool_name, args, ctx) -> allow|ask|deny + reason`：与 2.2 `approval_policy` 合并——`ask` 直接产 `ApprovalRequest`；`deny` 由 1.2 结构化错误返回 `TOOL_DENIED`。
- **默认最小权限**：未知工具默认 `ask`；全局默认策略随分发，`CHATVEIN_PERMISSION_MODE=strict|normal`（默认 `normal` 保持体验，`strict` 为最小权限）。
- 配置：策略存 `<data>/permissions.json`（用户可编辑）+ 主库索引；设置页提供可视化编辑（简单模式：工具勾选；高级模式：JSON）。

**审计 `backend/mcps/audit.py`**（e 级）：

- 库 `<data>/audit.sqlite`，表 `audit_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts, actor, scope, action, tool, args_redacted_json, result_code, duration_ms, decision, decision_by)`。
- 只追加（应用无 UPDATE/DELETE 路径）；敏感字段脱敏后写（复用 3.1 sanitize 思路）。
- 接入点：1.2 的 `resilient_tool_middleware`（每次工具调用、`ToolResult.code`）+ 2.2 审批决定 + 3.1 沙箱事件。
- 新接口 `GET /api/audit/events?tool=&since=&limit=`（main.py + audit controller），设置页「审计日志」只读视图。

**配额**：`permissions.py::QuotaGuard` 按 `(conversation_id, tool)` 计数，规则来自配置（默认宽松）；与现有 `ToolCallLimitMiddleware`（按次数）互补——这里是**用户可配**的运营级配额。超限返回 `TOOL_DENIED(code=QUOTA_EXCEEDED)`。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/mcps/permissions.py` / `audit.py` | b/e | 新建策略与审计 |
| `backend/mcps/registry.py` | a | `resolve/invoke` 接 `check()` 网关 |
| `backend/agents/graphs/common.py` | a | middleware 接审计 + 配额 |
| `backend/mcps/approval_policy.py` | b | 与权限决策合并 |
| `backend/main.py` | a | `/api/audit/*` + `/api/permissions` 接口 |
| `src/api/audit.ts` / `permissions.ts` + `index.ts` | d | 新接口 |
| `src/components/settings/PermissionSection.tsx` | c | 权限 + 审计 UI |
| `backend/tests/test_permissions_audit.py` | — | 规则匹配、拒绝、审计落地、脱敏测试 |
| `docs/agents.md` / `features.md` | — | 补权限与审计说明 |

### 风险与回滚

- **策略语法复杂度**：先支持三种 conditions，复杂逻辑走 JSON 高级模式；错误 JSON 不生效并给明确提示（不静默全放行）。
- **审计性能**：同步写 SQLite（WAL + busy_timeout），批量场景可异步队列；默认开，低频无感。
- **回滚**：`CHATVEIN_PERMISSION_MODE=normal` + 空策略 = 现有行为；审计独立开关 `CHATVEIN_AUDIT=0`。

### 验收

- 配「禁止 write_file 到 output 外」→ 越界调用被拒且写审计；allow/ask/deny 三态正确。
- 审计日志无 token/key 明文；按工具查询可回放参数。
- 关闭权限/审计后行为与当前一致。

---

## 3.3 eval 闭环 + OTel 可观测

### 现状（证据）

- 有完整自研 trace（span / LLM / 工具 / token，落 `session.sqlite.turn_traces`），但无离线 eval 集、无 LLM-as-judge、无质量指标回归；`hard.verify` 是唯一运行期自检。
- 无结构化事件导出（OTel）、无指标告警。

### 目标

1. 建立可回归的 eval 集与运行器：给定 case 输入 → 跑管线 → LLM-as-judge 打分 → 出报告，纳入 CI/发版门禁。
2. 把现有 trace 桥接到 OTel（可选导出）：span / LLM 调用 / 工具 / token 以标准语义输出，便于接入外部 APM。
3. 从 trace 聚合质量指标（成功率、重试率、取消率、平均 token/耗时），设置告警阈值。

### 方案

**eval 模块 `backend/eval/`**（c 级）：

- Case 格式 `evals/cases/*.json`：`{id, message, difficulty, expect_tools[], expect_substring[], rubric}`。
- `runner.py`：批量跑 `run_pipeline`（离线/直连模式，不依赖桌面壳）→ 收集 `reply/tool_trace/trace`。
- `judge.py`：`LLM-as-judge` 结构化打分（`relevance/correctness/tool_use/format`，0-5），可关（关闭时只用规则断言：`expect_substring` / `expect_tools`）。
- 命令 `tools/run_eval.ps1` → `python -m eval.runner --report eval-report.json`；CI 门禁：规则断言通过率 100%、judge 均分 ≥ 阈值（阈值评审确认）。
- 与 prompt registry（roadmap §4.4）联动：报告带 `prompt_version`，可对比不同 prompt 版本质量。

**OTel 桥接 `backend/trace/otel.py`**（c 级）：

- 可选依赖 `opentelemetry-sdk` + 导出器（OTLP HTTP / console）；未安装或 `CHATVEIN_OTEL=0` 时 no-op。
- `OtelBridge` 作为 trace callbacks 的附加 handler：把 `trace.recording` 的 span 事件映射到 OTel Span（属性：turn_id / difficulty / tool / tokens / duration / error_code），父子关系沿用现有 span 树。
- 不替换现有落库 trace（桌面端离线可用），两者并行；OTel 只是可选导出。

**指标聚合 `backend/trace/metrics.py`**（c 级）：

- 从 `turn_traces` 聚合：按天/角色的成功率、取消率、工具失败率、平均 tokens/耗时、P95 延迟；写 `trace_metrics` 表或生成 JSON 报告。
- 前端「洞察」页可展示趋势；告警阈值超限时在设置页提示（本地告警，不外发）。

### 改动文件

| 文件 | 等级 | 改动 |
|---|---|---|
| `backend/eval/{runner,judge}.py` + `evals/cases/` | c | 新建 eval 框架与样例集 |
| `backend/trace/{otel,metrics}.py` | c | 新建 OTel 桥与指标聚合 |
| `backend/trace/recording.py` | b | callbacks 挂 OtelBridge（可选） |
| `requirements.txt` / `requirements-dev.txt` | e | 可选 OTel / eval 依赖 |
| `tools/run_eval.ps1` | e | 新脚本 |
| `src/components/trace/InsightPanel.tsx` / `insightData.ts` | c | 指标趋势展示 |
| `.github/workflows/*`（若有 CI） | e | eval 门禁（评审确认是否已有 CI） |
| `backend/tests/test_eval.py` | — | judge 解析、rule 断言、报告结构 |
| `docs/` 新增 `eval.md` | — | eval 用法与门禁说明 |

### 风险与回滚

- **LLM-as-judge 成本**：默认规则断言必跑、judge 可选（`--no-judge`）；CI 用便宜模型或本地规则。
- **OTel 依赖体积**：可选依赖，默认不装不导出；no-op 实现保证零影响。
- **指标口径**：与现有 trace 字段对齐，避免两套定义；报告带 schema 版本。
- **回滚**：三个开关（eval / otel / metrics）独立；关闭后主链路零影响。

### 验收

- `tools/run_eval.ps1` 产出报告，规则断言全过；故意改坏 prompt 后报告分数下降（门禁有效）。
- 开 `CHATVEIN_OTEL=1` 配 console 导出，追踪窗与 OTel 输出节点一致。
- 指标报告给出成功率/取消率/平均 token 等真实数据。

---

## 第三批实施顺序与依赖

```text
3.1 沙箱加固（独立；先做，安全性收益最高，需确认 Windows 网络隔离取舍）
   ↓ sanitize_env / 审计助手被 3.2 复用
3.2 权限 + 审计（依赖 3.1 审计助手 + 2.2 审批 + 2.3 外部工具契约）
   ↓ 结构化审计事件供 3.3 聚合
3.3 eval + OTel（最后做，需要前面能力稳定后才有稳定指标口径）
```

每能力带独立开关、可独立回滚；评审通过后逐项实现，每项结束跑全量回归 + 对应专项冒烟。

---

## 三批整体交付核对表（评审后逐项打勾）

| 批次 | 能力 | 开关 | 新增主表/库 | a 级文件改动 | 专项冒烟 |
|---|---|---|---|---|---|
| 1.1 | 上下文工程 | `CHATVEIN_CTX_COMPACT` | context_summaries（会话库） | main, graphs/* | 50 轮长对话 |
| 1.2 | 工具可靠性 | `CHATVEIN_TOOL_RETRY` | — | common.py | 断网重试 |
| 1.3 | 断点续跑 | `CHATVEIN_CHECKPOINT` | agent_checkpoints（会话库） | main, graphs/*, useChatSession | kill 进程续跑 |
| 1.4 | 长期记忆 | `CHATVEIN_MEMORY` | memory.sqlite | main | 跨会话召回 |
| 2.1 | 流式 | `CHATVEIN_STREAM` | — | main, common, client.ts | SSE spike |
| 2.2 | HITL | `CHATVEIN_INTERRUPT_APPROVAL` | approvals（会话库） | main, graphs/*, useChatSession | 重启后审批 |
| 2.3 | 真 MCP | `CHATVEIN_MCP_EXTERNAL` | mcp_servers（主库 v14） | main, registry | stdio/SSE server |
| 2.4 | 并行编排 | `CHATVEIN_PARALLEL_DELEGATE` | agent_tasks（会话库） | graphs/* | 3 成员并行 |
| 3.1 | 沙箱加固 | `CHATVEIN_SANDBOX_LIMITS` | —（写 audit） | common.py | env/限额/pip |
| 3.2 | 权限审计 | `CHATVEIN_PERMISSION_MODE` / `CHATVEIN_AUDIT` | audit.sqlite | registry, common | 拒绝/审计回放 |
| 3.3 | eval+OTel | `CHATVEIN_OTEL` / `--no-judge` | trace_metrics（会话库） | recording.py | eval 门禁 |
