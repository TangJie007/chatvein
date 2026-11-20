# 配置总表（环境变量）

本文件是 **唯一全量表**：想知道某个 `CHATVEIN_*` 干什么、默认值是多少，只看这里。
代码里新增开关必须同步本表（`backend/tests/test_config.py` 会用 AST 扫一遍代码，
漏写就测试失败）。

## 0. 口径

- **布尔开关**：没设 → 用默认值；显式设了 → `""` / `0` / `false` / `no` / `off` 算关，
  其余算开。统一读 `backend/agents/config.py::flag`，别再各写一套 `== "1"`。
- **数字开关**：写错直接抛 `ValueError`（启动即失败），不静默退回默认值——
  否则「为什么设了没生效」要查一天。读 `config.number`。
- **生效时机**：启动时读取。开发期 `CHATVEIN_RELOAD=1` 会重载 Python 代码，
  但环境变量本身要重启进程才变。
- Tauri 打包版由外壳（`src-tauri/src/backend.rs`）注入 `CHATVEIN_TOKEN` / 端口 / 数据目录，
  **不要**在设置文件里手写这些，会覆盖掉真实值。

## 1. 模型与采样

| 变量 | 默认 | 作用 |
|---|---|---|
| `CHATVEIN_STREAM` | 开 | `0` 关闭 SSE，前端自动回落 `POST /api/chat`（错误码 `STREAM_DISABLED`） |
| `CHATVEIN_ERROR_ENVELOPE` | 开 | `0` 时错误响应只回 `detail`，不带 `error` 信封（排障对照用） |
| `CHATVEIN_EMBED_MODEL` | 见 `embeddings/service.py::DEFAULT_MODEL` | 向量模型 ID，换模型后既有向量需重建 |
| `CHATVEIN_HF_ENDPOINT` | HuggingFace 官方 | 向量模型下载源 |
| `CHATVEIN_MODELSCOPE_BASE` | ModelScope 官方 | 国内镜像源 |
| `CHATVEIN_SKILLHUB_API` / `CHATVEIN_SKILLHUB_SITE` | `https://api.skillhub.cn` / `https://skillhub.cn` | 技能市场地址（自建市场时改） |
| `CHATVEIN_LOCAL_TIMEZONE` | 系统时区 | 提示词里的「现在几点」按此计算 |
| `CHATVEIN_OCR_SPACE_KEY` | 内置公共额度 | OCR 空间 Key，见 `knowledge/ocr.py` |
| `CHATVEIN_MODEL_FALLBACK` | 开 | `0` 关闭「主模型限流/超时/5xx 时切备用模型」（结构化调用，见 4.7） |
| `CHATVEIN_PRICE_CURRENCY` | `CNY` | 追踪里金额展示的单位；单价在「模型」页按每百万 token 填 |
| `CHATVEIN_LLM_RATE_LIMIT_RETRIES` | `3` | 429 长退避重试次数（openai SDK 那层 2 次秒级退避对配额无效） |
| `CHATVEIN_LLM_RATE_LIMIT_DELAY` | `10` 秒 | 长退避首次间隔 |
| `CHATVEIN_LLM_RATE_LIMIT_MAX_DELAY` | `60` 秒 | 长退避单次上限 |

模型本身（地址 / Key / ID / 采样参数）在「模型」页存主库 `models` 表，不走环境变量。

## 2. 执行与沙箱

| 变量 | 默认 | 作用 |
|---|---|---|
| `CHATVEIN_CHECKPOINT` | 开 | `0` 关闭断点续跑（`/resume` 无现场可用） |
| `CHATVEIN_SANDBOX_GUARD` | 开 | `0` 整体关掉子进程加固（env 清洗 + 限额 + 网络） |
| `CHATVEIN_SANDBOX_LIMITS` | 开 | `0` 只关资源限额，env 清洗仍生效 |
| `CHATVEIN_SANDBOX_NETWORK` | 关 | `1` 放开子进程出网（默认黑洞代理 + sitecustomize） |
| `CHATVEIN_SANDBOX_CPU_SECONDS` | `120` | 子进程 CPU 时间上限 |
| `CHATVEIN_SANDBOX_MEMORY_MB` | `1024` | 子进程地址空间上限（按平台尽力而为） |
| `CHATVEIN_SANDBOX_FILE_MB` | `100` | 子进程可写文件大小上限 |
| `CHATVEIN_SANDBOX_ENV_PASSTHROUGH` | 空 | 逗号分隔的变量名：额外透传给子进程（宿主 Key/Token 一律不给） |
| `CHATVEIN_PIP_INDEX_URL` | 空 | 沙箱内 pip 源，只接受 `http(s)://` |
| `CHATVEIN_PERMISSION_MODE` | 空（读 `permissions.json`） | `strict` / `normal`，临时收紧权限无需改文件 |
| `CHATVEIN_PERMISSIONS_PATH` | 主库同目录 `permissions.json` | 权限规则文件 |
| `CHATVEIN_UNIFIED_APPROVAL` | 开 | `0` 退回旧的 `bash_approval` 单一通道 |
| `CHATVEIN_APPROVAL_TIMEOUT` | `120` 秒 | 审批等待上限；超时只作废本次等待（`expired`），不写 `deny` |
| `CHATVEIN_BASH_APPROVAL_TIMEOUT` | `120` 秒 | 上一条的旧名（优先级低） |
| `CHATVEIN_GIT_BASH` | 自动探测 | 显式指定 bash 路径；无效时报错（除非关掉检查） |
| `CHATVEIN_SKIP_GIT_BASH_CHECK` | 关 | `1` 时路径无效只告警并回落自动探测 |
| `CHATVEIN_SKIP_BASH_DOWNLOAD` | 关 | `1` 禁止 Windows 自动下载 MinGit，降级用 PowerShell |
| `CHATVEIN_FORCE_BASH_DOWNLOAD` | 关 | `1` 强制重新下载 MinGit |
| `CHATVEIN_POWERSHELL_PATH` | 自动探测 | 显式指定 PowerShell |
| `CHATVEIN_USE_POWERSHELL_TOOL` | 开 | `0` 不注册 PowerShell 工具 |
| `CHATVEIN_BROWSER` | `chromium` | `chrome` / `chromium` / `firefox` / `webkit` / `msedge` |
| `CHATVEIN_BROWSER_EXECUTABLE` | 自动探测 | 浏览器可执行文件路径 |
| `CHATVEIN_BROWSER_HEADLESS` | 关 | `1` 无头模式（对齐 `@playwright/mcp` 默认 headed） |
| `CHATVEIN_USE_BROWSER_TOOL` | 开 | `0` 关闭浏览器工具分组 |
| `CHATVEIN_MCP_EXTERNAL` | 开 | `0` 完全不加载外部 MCP server（内置工具不受影响） |
| `CHATVEIN_TOOL_RETRY` | 开 | `0` 关闭工具失败重试（熔断同时关闭，见 `mcps/resilience.py`） |
| `CHATVEIN_TOOL_MAX_ATTEMPTS` | `3` | 单个工具最多尝试次数（1..5） |
| `CHATVEIN_TOOL_RETRY_BASE` | `0.5` 秒 | 重试退避基数（0..5，指数增长） |
| `CHATVEIN_TOOL_CB_THRESHOLD` | `3` | 连续失败多少次熔断该工具（1..10） |
| `CHATVEIN_PARALLEL_DELEGATE` | 开 | `0` 关闭群组并行派发，退回串行 `delegate_to_agent` |
| `CHATVEIN_DELEGATE_MAX_PARALLEL` | `4` | 并行成员上限（1..8，`1` 等于关闭并行） |
| `CHATVEIN_DELEGATE_BATCH_TIMEOUT` | `420` 秒 | 一批派发的总超时（最小 60 秒） |

## 3. 可观测、预算与记忆

| 变量 | 默认 | 作用 |
|---|---|---|
| `CHATVEIN_TURN_TOKEN_BUDGET` | `0`（不限） | 单轮 token 预算：超了就走收尾（注入收尾提示 + 禁用工具，见 `agents/cost.py`） |
| `CHATVEIN_CTX_COMPACT` | 开 | `0` 退回「原样截断历史」的旧装配方式 |
| `CHATVEIN_CTX_RECENT_TURNS` | `6` | 保留最近多少轮原文（其余压成摘要） |
| `CHATVEIN_CTX_SUMMARY_LLM` | 开 | `0` 只用规则摘要，不额外发一次 LLM（省 token，质量略降） |
| `CHATVEIN_CTX_WINDOW` | 按模型配置 | 覆盖模型的上下文窗口（token），调试长上下文时用 |
| `CHATVEIN_CTX_OUTPUT_RESERVE` | 按 max_tokens | 给输出预留的 token（至少 512，最多窗口一半） |
| `CHATVEIN_OTEL` | 关 | `1` 导出 OpenTelemetry；SDK 不进安装包，缺依赖只打一行日志 |
| `CHATVEIN_OTEL_ENDPOINT` | 空 | OTLP HTTP 收集地址，空则用 SDK 默认 |
| `CHATVEIN_AUDIT` | 开 | `0` 关闭审计写入（安全排查会缺证据，仅排障时关） |
| `CHATVEIN_AUDIT_DB_PATH` | 主库同目录 `audit.sqlite` | 审计库位置 |
| `CHATVEIN_MEMORY` | 开 | `0` 关闭记忆抽取与召回（已存记忆保留） |
| `CHATVEIN_MEMORY_AUTO_ACCEPT` | 关 | `1` 抽取结果直接生效，跳过人工确认 |
| `CHATVEIN_MEMORY_EXTRACT_TURN_INTERVAL` | `1` | 每 N 轮抽取一次；写非整数会启动即报错 |
| `CHATVEIN_MEMORY_DB_PATH` | 主库同目录 `memory.sqlite` | 记忆库位置 |

## 4. 路径与启动

| 变量 | 默认 | 作用 |
|---|---|---|
| `CHATVEIN_DB_PATH` | `<data>/chatvein.db` | 主库（会话 / 角色 / 模型 / 追踪元数据） |
| `CHATVEIN_DATA_DIR` | `backend/data` | 数据根；主空间默认 `<data>/workspace` |
| `CHATVEIN_WORKSPACE` | `<data>/workspace` | 主空间（非会话内的文件操作落在这里） |
| `CHATVEIN_HOST` | `127.0.0.1` | 监听地址（只在本机用，别改成 0.0.0.0） |
| `CHATVEIN_PORT` | `8420` | 独立跑后端的端口；Tauri 模式用随机端口 |
| `CHATVEIN_TOKEN` | 空 | 一次性访问令牌，由外壳注入；手跑后端时留空则不校验 |
| `CHATVEIN_RELOAD` | 关 | 开发期代码热重载 |

## 5. 还没走统一口径的老开关

以下开关仍由各自模块直接读环境变量（判定口径是 `== "1"` 或 `!= "0"`），
逐批迁移到 `agents/config.py`，迁移前**行为以原模块为准**：

- `SHELL` 相关的 `CHATVEIN_SANDBOX_GUARD` / `LIMITS` / `NETWORK`（`sandbox_guard.py`）
- `CHATVEIN_POWERSHELL_PATH` / `BROWSER_*` 等路径类（本就只读路径，不判真假）
- `CHATVEIN_PERMISSION_MODE`（枚举值，不是布尔）
