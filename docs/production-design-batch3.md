# 生产级增强 · 第三批：安全与运维（详细设计评审稿）

> 对应总纲 [`production-roadmap.md`](./production-roadmap.md)。**3.1–3.3 全部已实现（2026-11-20）**。
> 边界：本批**不引入容器/OS 级隔离**（需求已确认），只在现有「路径约束 + 正则策略 + 审批」模型上加固。
> 依赖前两批：3.1 复用 1.2 错误模型；3.2 复用 2.2 审批策略 + 2.3 外部工具契约；3.3 复用全链路 trace。
> 三个能力：3.1 沙箱加固 / 3.2 细粒度权限 + 审计 / 3.3 eval 闭环 + OTel 可观测。

---

## 3.1 沙箱加固（不做容器）

> **状态：已实现（2026-11-20）**。新增 `backend/mcps/sandbox_guard.py` + `backend/mcps/audit.py`；沙箱 / bash / powershell 统一走 `run_limited()`（env 清洗 + 限额 + 黑洞代理），`sandbox_run_python` 额外注入 `sitecustomize` 网络钩子；`ALWAYS_ON_TOOLS` 改为 `always_on_tools(role)`。
> 开关：`CHATVEIN_SANDBOX_GUARD=0`（整体回退）、`CHATVEIN_SANDBOX_LIMITS=0`、`CHATVEIN_SANDBOX_NETWORK=1`、`CHATVEIN_SANDBOX_CPU_SECONDS` / `_MEMORY_MB` / `_FILE_MB`、`CHATVEIN_SANDBOX_ENV_PASSTHROUGH`、`CHATVEIN_PIP_INDEX_URL`、`CHATVEIN_AUDIT=0`。

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

### 实现纪要

| 文件 | 内容 |
|---|---|
| `backend/mcps/sandbox_guard.py` | `sanitize_env` / `is_sensitive_key` / `dropped_env_keys`（只回键名）；`limits()` + `limits_notice()`；`network_enabled()` + `apply_network_env()`（黑洞代理）；`ensure_network_guard` / `guard_pythonpath` / `with_guard_pythonpath`（`sitecustomize` 钩子）；`pip_index_url` / `pip_base_args`；`run_limited()`（POSIX `setrlimit`、Windows Job Object、超时兜底） |
| `backend/mcps/audit.py` | 独立 `audit.sqlite`、`audit_events` 只追加；`record_event` 永不抛错；`redact` / `mask_secrets` 递归脱敏（键名命中、`sk-` / `Bearer` / `token=` 形态） |
| `backend/mcps/tools/sandbox.py` | `_run()` 统一走 `run_limited` + 审计（`sandbox.exec`）；`sandbox_run_python` 接 env 清洗 / 黑洞代理 / `sitecustomize` / `guard=` 提示行 / `sandbox.env` 审计；`sandbox_pip_install` 接源白名单；`sandbox_info` 报 `guard=` 与清洗数量 |
| `backend/mcps/tools/bash.py` / `powershell.py` | `_child_env` 起点改为 `sanitize_env()`，末尾 `apply_network_env()`；执行改 `run_limited` 并写 `shell.exec` 审计 |
| `backend/agents/graphs/common.py` | `always_on_tools(role)` + `denied_tools(role)`；`allowed_from_role` 过滤 `!` / `-` 条目 |
| `backend/agents/graphs/medium.py` / `hard.py` / `agents/delegation.py` | 常驻工具改用 `always_on_tools(role)` |
| `backend/tests/test_sandbox_guard.py` | 24 项：清洗 / 透传 / 开关、网络两层、钩子幂等与 PYTHONPATH、pip 源校验、子进程环境、超时、内存上限、审计脱敏与开关、常驻工具拒绝 |
| `backend/tests/test_codesandbox.py` | 集成补：`guard=` 自报、钩子落盘、脚本看不到 `OPENAI_API_KEY`、`example.com` 被拒 |

与评审稿的差异：

1. **env 清洗用「按类别黑名单」而非纯白名单**：白名单会把 `JAVA_HOME` / `GOPATH` / 自定义 `NPM_CONFIG_*` 一起砍掉，脚本会莫名跑不起来。现在只删敏感类别（`KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/AUTH/COOKIE/SESSION/API`）与全部 `CHATVEIN_*`，验收要求（打印 `os.environ` 不含 token/key）仍然成立。
2. **`sitecustomize` 不放 `site-packages`**：实测宿主只要设了 `PYTHONPATH`（IDE / 启动脚本很常见），`import sitecustomize` 会先命中宿主那份，venv 里的钩子根本不生效。改为写 `runs/.chatvein-guard/sitecustomize.py` 并**前置**到子进程 `PYTHONPATH`，同时把钩子注入 bash / powershell（shell 里起的 python 也受控）。
3. **`apply_limits(process)` 改为 `run_limited(cmd, ...)`**：Windows Job Object 必须在 spawn 之后立刻拿到 pid/句柄，而 `subprocess.run` 不暴露进程对象，包一层执行器才能跨平台一致。
4. **bash / powershell 与沙箱共用同一执行器**：评审稿只要求「沙箱进程」限额，但 shell 才是最容易跑飞的入口；统一后 `shell.exec` 也有了审计记录（限额仍宽松，可用 `CHATVEIN_SANDBOX_LIMITS=0` 回退）。
5. **`deny_tools` 不落库**：用角色 `tools` 里的 `!工具名` / `-工具名` 表达显式拒绝（运行时也认 `deny_tools` 键，留给 3.2 的权限模型接管），因此没有迁移、没有改角色 DTO / 前端表单。
6. **pip 未做 `requirements.lock`**：只固定源（`CHATVEIN_PIP_INDEX_URL`，强制 http(s)）与包名白名单；锁文件固定版本的价值等到 3.2 配额 / 供应链策略一起做。
7. **审计粒度**：一次执行写一条 `sandbox.exec`（带 `duration_ms` + `result_code`：`OK` / `FAILED` / `TIMEOUT` / `SIGNAL` / `SPAWN_FAILED`），env 清洗另写一条 `sandbox.env`（只含被移除的键名）。启动/结束拆两条会让事件数翻倍，回放价值不变。

---

## 3.2 细粒度权限 + 审计日志

> **状态：已实现（2026-11-20）**。规则 DSL 落成扁平字段（路径 / URL / 只读 SQL），`deny_tools` 不落库（继续用角色 `tools` 的 `!` / `-` 前缀），审计沿用 `audit.sqlite`，配额为进程内计数。实现细节与偏差见文末「实现纪要」「与评审稿的差异」。

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

### 实现纪要

| 文件 | 等级 | 实际改动 |
|---|---|---|
| `backend/mcps/permissions.py` | b | 新建：`PermissionRule` / `PermissionConfig`（`mode` + `rules` + `quota`）、顺序首命中判定、`strict` 未命中 → `ask`、`static_deny` 预过滤、`QuotaGuard`、`config_view` / `save_config`（校验 + 原子写）、mtime+size 缓存、坏配置审计 |
| `backend/mcps/audit.py` | e | `list_events` 增加 `decision` 过滤；沿用 3.1 的 `audit_events` 表（`decision` / `decision_by` 已存在，无新库新表） |
| `backend/agents/graphs/common.py` | a | `permission_gate_middleware` 置于最外层；`_denied_tool_message`（`TOOL_DENIED` 结构化结果 + `tool.deny`）；`_audit_tool_call`（成功/失败统一 `tool.call`） |
| `backend/mcps/registry.py` | a | `resolve_tools` 用 `static_deny` 摘掉无参数条件的 deny 工具；`invoke_tools` 离线路径过 `check()` + 审计（`ask` 按拒绝处理） |
| `backend/mcps/approval_policy.py` | b | `permission_approval(tool, args, reason)`，`kind="permission"`，复用统一审批弹窗 |
| `backend/security/{dto,service,controller,module}.py` | b | `GET/PUT /api/permissions`、`GET /api/audit/events`、`GET /api/audit/status`；`security_router` 前缀 `/api` |
| `backend/main.py` | a | `include_router(security_router)` |
| `backend/tests/test_permissions_audit.py` | — | 23 项：规则匹配 / 三态 / glob / 路径与 URL 条件 AND / 静态拒绝 / `resolve_tools` / 两种配额 / 配置往返与坏配置 / 网关 deny+allow 审计 / 审批形状 / REST 往返 / 审计过滤与脱敏 / 关闭审计 |
| `src/api/permissions.ts`、`src/api/audit.ts`、`src/api/index.ts` | d | 新接口封装 + 桶导出 |
| `src/components/settings/PermissionSection.tsx`、`src/components/views/SettingsView.tsx` | c | 「权限与审计」分区：模式切换、两个配额、规则 JSON + 4 个模板、规则摘要、审计筛选（工具 / 判定）与只读表格、配置错误横幅 |

行为要点：

- **判定顺序**：`permissions.json` 的 `rules` 按列表顺序取第一条命中；未命中时 `strict` → `ask`、`normal` → `allow`（空策略 = 3.2 之前的老行为，删文件即可回滚）。
- **拦截位置**：ReAct 中间件最外层，先于「同参去重 / 熔断」。否则模型看到的是「重复调用」而不是「权限被拒绝」，会无意义重试。
- **`ask`**：复用 `approval.py::request_approval`，审批 id 仍是 `(turn_id, tool_call_id)` 确定性哈希，续跑复用历史决定；用户拒绝 / 超时归为 deny 并写 `tool.deny`。
- **`deny`**：返回 `ToolMessage` + `tool_result.code=TOOL_DENIED`，正文提示「换工具/参数或请用户改规则」。
- **配额**：`(会话, 工具)` 与本轮总调用两个上限，默认 0（不限），进程内计数、重启清零。
- **配置容错**：解析失败退回空配置 + normal，`/api/permissions` 暴露 `error`，并按文件版本只写一条 `permission.config` 审计；判定函数自身异常兜底 `allow`（权限设施坏了不能锁死应用）。
- **开关**：`CHATVEIN_PERMISSION_MODE=strict|normal`（环境变量优先于文件）、`CHATVEIN_PERMISSIONS_PATH`、`CHATVEIN_AUDIT=0`。

与评审稿的差异：

1. **规则 DSL 是扁平的，不是 `(scope, tool, conditions)` 嵌套**：`effect` + `tool` 通配 + `path_prefix` / `path_not_prefix` / `url_host_in` / `read_only`（同时给出即 AND）；OR 语义拆多条规则。评审稿的「外部 MCP 字段白名单」未实现——字段级约束要等真实 server schema 稳定，先靠 `url_host_in` + `tool` 通配覆盖。
2. **`deny_tools` 不落库、没有 v15 迁移**：角色 `tools` 里的 `!` / `-` 前缀（3.1 起）已能表达显式拒绝，参数级 / 路径级拒绝交给 `permissions.json`；策略不进主库，唯一事实来源就是那个 JSON 文件。
3. **审计不写「判定 + 结果」两条**：`allow` 只写一条 `tool.call`（带 `result_code` + `duration_ms`），`deny` / 用户拒绝 / 超时写一条 `tool.deny`，`decision_by` 记录是规则、模式还是用户。事件数减半，回放信息不丢。
4. **配额默认关闭且进程内计数**：这是运营级「防跑飞」阀，不是计费；落库会引入清理与漂移问题，重启清零可接受。
5. **离线直调 `ask` 按拒绝**：`invoke_tools` 没有弹窗通道，`ask` 会跳过并说明原因（安全优先，绝不静默放行）。
6. **权限设施异常兜底 `allow`**：`check()` 抛异常返回 allow + 原因（`by="fallback"`），`static_deny` 异常返回 `None`；但配置语法错误不静默（见上）。
7. **没有审计「回放 UI」**：接口返回脱敏后的 `args`，设置页只读表格 + 工具/判定过滤。播放器对安全排查没有增量价值。
8. **前端只做 JSON 编辑 + 模板，没做可视化勾选**：条件组合空间用表单表达会失真；模板 + 摘要列表比半吊子表单可靠。

---

## 3.3 eval 闭环 + OTel 可观测

> **状态：已实现（2026-11-20）**。eval 在 `backend/eval/`（用例 `backend/eval/cases/`），judge 默认关闭（`--judge` 才开），规则断言必跑；OTel 只在 `CHATVEIN_OTEL=1` 时启用且 SDK 不进安装包；指标是查询时聚合的 JSON，没有 `trace_metrics` 表。详见文末「实现纪要」「与评审稿的差异」。

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

### 实现纪要

| 文件 | 等级 | 实际改动 |
|---|---|---|
| `backend/eval/{cases,judge,runner}.py` | c | 新建：用例读取与校验（`load_cases` / `normalize_case`）、规则断言（`check_rules`）、结构化评分（`JudgeScores` 四维 0-5）、批量运行 + 报告 + CLI |
| `backend/eval/cases/smoke.json` | — | 4 条冒烟用例（直答 / 时间工具 / 计算工具 / 闲聊不调工具） |
| `backend/trace/otel.py` | c | 新建：`enabled()` / `export_turn()` 懒加载 SDK，span 树一次性导出，时间戳按 `start_ms` 还原 |
| `backend/trace/metrics.py` | c | 新建：`compute_metrics`（成功率 / 取消率 / 错误率 / 平均与 P95 token·耗时 / 按天 / 按难度）、`count_tool_failures`、`merge_tool_stats`、告警 |
| `backend/trace/recording.py` | b | `tracing(..., turn_id)`；`finally` 里 `flush` 后调 `otel.export_turn`（取消 / 报错的轮次也导出） |
| `backend/trace/store.py` | e | `iter_turn_payloads(db_path, limit)`：一次连接读最近 N 轮完整 payload（`created_at DESC, rowid DESC`） |
| `backend/trace/service.py` / `controller.py` | b / e | `TraceService.metrics()` + `GET /api/conversations/{id}/metrics?days&scan`（会话不存在 404） |
| `backend/tests/test_eval.py` | — | 21 项：用例校验、规则断言、runner 判定 / 错误 / judge 阈值、报告口径、judge 假模型、指标数学与告警、`iter_turn_payloads`、`/metrics` 路由、OTel 默认关闭与 span 映射 |
| `tools/run_eval.ps1` | e | 评测入口（`-Cases` / `-Judge` / `-Report` / 透传参数），退出码直接传递 |
| `src/api/traces.ts` | d | `ConversationMetrics` 等类型 + `getConversationMetrics` |
| `src/components/trace/TraceWindow.tsx` | c | 侧栏「近 N 天」健康度条幅：成功率、平均/P95 token、工具失败率、首条告警 |
| `docs/eval.md` | — | 用例格式、命令、退出码、报告字段、局限 |

行为要点：

- **硬门槛与软评分分离**：`check_rules`（工具是否被调用、回复是否含关键 / 禁用片段、回复非空）必跑；`--judge` 只影响「分数」不影响「能不能跑」，避免模型抖动把评测本身弄坏。
- **临时会话沙箱**：每条用例 `create_conversation_dir()` + `use_conversation_sandbox()` + `bind_turn()`，跑完 `remove_conversation_dir()`——工具的文件 / 命令落在一次性目录，不污染用户工作区，也不会因为没有沙箱直接失败。
- **退出码**：`0` 全通过；`1` 有 fail / error / 预算跳过；`2` 用例文件不合法或没有可用模型。接 CI 只需要执行这一步。
- **时间预算而非硬超时**：`--max-seconds` 到点就不再开新用例；单条硬超时会留下无法安全终止的线程与在途请求，宁可标记跳过。
- **OTel 时间轴**：`base = now - elapsed_ms`，每步 `start = base + start_ms`、`end = start + elapsed_ms`，所以外部 APM 的瀑布图和追踪窗一致；导出放在 `tracing` 的 `finally`，取消与报错也留痕。
- **指标口径**：轮次指标来自 `turn_traces` 摘要并按 `days` 过滤；工具失败率来自最近 `scan`（默认 100）轮 payload 扫描——两者分母不同，报告里分开列出，前端只展示失败次数。
- **告警门槛**：窗口内 ≥5 轮才判定（错误率 ≥20% warn / ≥40% critical，取消率 ≥30% warn，工具失败率 ≥50% warn），少量样本不报警。

与评审稿的差异：

1. **用例目录 `evals/cases/` → `backend/eval/cases/`**：跟着包走，后端冻结/打包时不用再补一条资源路径。
2. **`--no-judge`（评审稿）→ `--judge`（实现）**：默认就是关，不需要反向开关；CI 只跑规则断言即可。
3. **没有 `trace_metrics` 表**：指标是查询时从追踪聚合出来的视图，落表会引入清理与口径漂移；`GET /api/conversations/{id}/metrics` 直接返回 JSON（带 `schema_version`）。
4. **`prompt_version` 联动未做**：prompt registry（§4.4）还没落地，报告先带 `role/model_id`；等 registry 有了再补版本字段，避免先造一个假字段。
5. **`OtelBridge` 不是 trace callbacks 的附加 handler**：回调拿到的是整棵树的快照，逐帧 diff 既容易错、也会丢父子关系；改为 `tracing()` 结束时一次性导出。实时性换成正确性，外部 APM 拿到的是完整瀑布图。
6. **OTel 依赖不进 `requirements.txt`**：桌面安装包不该为可选导出多背体积；`pip install opentelemetry-sdk`（要 OTLP 再加 `opentelemetry-exporter-otlp-proto-http`）即可，缺依赖静默跳过。
7. **前端指标条幅放在追踪窗侧栏**，不是「洞察」页：`InsightPanel` 是产物 / 线程视图，健康度属于追踪上下文，放一起才能「看到告警 → 点进某轮」。
8. **复查修正（2026-11-20）**：`otel.py` 两处缺陷——①父 span 原先用 `start_span(parent=...)` 传，真实 SDK 的 `Tracer` 只认 `context=`（`set_span_in_context`），会 TypeError 并被 `export_turn` 吞掉，导致整轮 span 全丢；现改为 `_parent_kwargs()` 按是否有 OTel 依赖走 `context` / `parent` 两条路。②根 span 收尾时没带 `elapsed_ms`，结束时间等于开始时间，瀑布图里父比子短；现补整轮耗时，并在测试里断言「根覆盖所有子 span」。
9. **可读性整理（2026-11-20，行为不变）**：`metrics.py` 的 `compute_metrics` 拆成 `_overall / _day_rows / _difficulty_rows / _alerts` 四个分块，状态分桶与 `totals` 取值收敛成 helper（未知状态统一算 `error`，坏 `totals` 不再可能崩接口），阈值/窗口/回看轮数提成命名常量并由 service / controller / 前端共用；`otel.py` 建 span 与收尾抽成 `_start_span / _start_step_span / _set_root_attributes / _finish`，去掉隐式 kwargs 与伪 step 字典；`eval` 的规则字段、报告 schema、judge 阈值各留一处常量，`--dry-run` 不再手抄字段名；`trace/store.py` 三处 JSON 解码合并成 `_decode_payload`。指标口径已用「旧版 vs 新版同输入逐字段对照」验证，唯一差异是负值 token / 耗时统一按 0 计（旧版日/难度维度会显示负数）。
8. **用例暂不支持按例准备文件**（评审稿也没要求）：沙箱是空的，先只覆盖「不需要预置本地文件」的用例；要测文件类工具再加 `${case_dir}` 约定。
9. **没有 CI 门禁接线**：仓库当前没有 workflow 文件，先把退出码规范好（`0/1/2`），接入 CI 是纯配置动作，不阻塞能力交付。

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
| 3.3 | eval+OTel | `CHATVEIN_OTEL` / `--judge` | —（指标查询时聚合，不落表） | recording.py | eval 门禁 |
