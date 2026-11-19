# ChatVein 已实现功能

对照 WorkBuddy 桌面 Agent 能力与本仓库产品边界，当前**已实现、可打包使用**的功能一览。
Agent 图细节见 [`agent-graphs.md`](./agent-graphs.md)；工具矩阵见 [`agents.md`](./agents.md)；工作区规则见 [`workspace.md`](./workspace.md)。

---

## 1. 对话与 Agent 流水线

| 功能 | 说明 | 主要位置 |
| --- | --- | --- |
| 改写 + 难度路由 | 主模型 structured：`rewritten` + `simple\|medium\|hard` | `agents/router.py` |
| simple 直答 | 无工具，单节点聊天 | `agents/graphs/simple.py` |
| medium ReAct | 选型 → `create_agent`（agent⇄tools） | `agents/graphs/medium.py` |
| hard 规划/核对 | plan → 选型 → ReAct → verify（可回环） | `agents/graphs/hard.py` |
| 工具缩集 | 按改写文本（hard 含计划）从目录选工具 | `agents/tool_selector.py` |
| 角色覆盖 | 提示词叠在挡位 system 上；模型 / 温度 / max_tokens 等 | `roles/` + `pipeline._merged_system` |
| 角色工具白名单 | 勾选 MCP **分组 id**（或工具名）限制候选集；空=不限制 | `rolesStore.TOOLSET` + `tool_selector.expand_allowlist` |
| 短期记忆 | 会话 `logs/session.sqlite`；条数 ≈ 角色 `memory × 2`；送模型前按 token 预算装配，超预算把较早对话压成摘要 | `conversations/service.py` + `agents/context.py` |
| 技能注入 | `POST /api/chat` 的 `skills[]` 把本机 `SKILL.md` 并入 system | `skills/local_store.py` |
| 轮次追踪 | span 树、LLM 请求/响应、工具、token；按 turn 落库 | `trace/` |
| HTTP 入口 | `POST /api/chat` 同事务写用户+助手消息，回写 workspace 洞察 | `main.py` |

离线回落：无主模型时 understand / 选型走启发式，simple 返回「离线」文案，medium/hard 直接 `invoke_tools`。

---

## 2. 会话工作区

| 功能 | 说明 |
| --- | --- |
| 建会话即建目录 | `YYYYMMDD-HHMMSS-` + 5 位随机字符，挂在主工作区下 |
| `output/` | Agent / 用户产物 |
| `logs/session.sqlite` | 本会话消息、工具返回、推理摘要、追踪 |
| `runs/` | 代码沙箱 `.venv` 与脚本，与产物隔离 |
| 上传落盘 | 拖拽 / 选择文件进**当前会话**工作区（见 workspace 文档） |
| 打开工作区 | 系统文件管理器打开会话目录 |
| 删除会话 | 级联删消息，并清理对应工作区目录 |

---

## 3. 内置工具（进程内 MCP 对齐）

设置页只读展示「运行中 / 不可用」；未探测到的分组不注册。

| 分组 | 能力摘要 |
| --- | --- |
| `core` | 时间、时区换算、计算器、本机概况、库统计、模型列表 |
| `mcp-fs` | 工作区文件读写 / 树 / 搜索 / 打开目录 / 删除（不含 `read_media_file`） |
| `mcp-web` | 搜索：Claw → Tavily Keyless → Firecrawl → ddgs；抓取：Firecrawl → httpx |
| `mcp-sqlite` | 只读查 ChatVein SQLite |
| `mcp-kb` | 笔记沉淀、向量/关键词检索、消息检索、工作区索引 |
| `mcp-codesandbox` | 会话 `runs/` 内 venv + pip + 跑 Python；默认清洗敏感环境变量、限额（CPU 120s / 内存 1GB / 文件 100MB）、外网软隔离（`sitecustomize` + 黑洞代理），`CHATVEIN_SANDBOX_NETWORK=1` 放开 |
| `mcp-bash` | Git Bash（可按需下 MinGit）；限会话目录 + 危险拦截 + 确认 |
| `mcp-powershell` | Windows PowerShell；策略同 Bash |
| `mcp-browser` | Playwright Core+Tabs；本机有 Chromium 才注册 |
| `mcp-ip` | 公网出口 / IP 归属（ipinfo → ipwhois → ip-api，免费无 Key） |
| `mcp-ocr` | OCR.space → 沙箱 RapidOCR 降级 |
| `mcp-pdf` | 文本/元信息读取、合并、按页拆分、文本生成、加密/解密（pypdf + reportlab） |
| `mcp-ext::<server>` | **用户自配**的外部 MCP 服务（stdio / SSE / Streamable HTTP）；工具名 `mcp__<server>__<tool>`，默认每次调用前确认 | `mcps/external/` + `McpExternalSection` |

目录 API：`GET /api/mcps/catalog`；外部服务配置 API：`/api/mcp-servers/`（CRUD + `/reconnect`）。

**未实现（占位或刻意不做）**：预置外置 MCP 子进程/`npx` 分发、通用 `cmd.exe`、SaaS 连接器、`browser_run_code_unsafe`。外部 server 仅按用户配置 opt-in，不随包分发；详见 [`agents.md`](./agents.md)。

---

## 4. 模型 / 角色 / 技能

| 功能 | 说明 |
| --- | --- |
| 模型配置 | 多模型、启用/默认、API Key、上下文窗口等；主模型供 Agent | `models/` |
| 角色管理 | 人格提示、绑定模型、生成参数、工具分组、记忆轮数、一句话描述（列表副标题 / 花名册）；主角色不可删 | `roles/` + `RolesView` |
| SkillHub 浏览 | 列表 / 搜索 / 详情 / `SKILL.md` 代理 | `skills/service.py` |
| Skill 安装 | 落到 `CHATVEIN_DATA_DIR/skills/<slug>/`；可卸载 | `skills/local_store.py` |
| Composer 选用技能 | 优先展示已安装；发送时带 `skills` 注入 | `Composer.tsx` |

后期可补：技能自动发现、版本更新检测、可配置 registry UI。

---

## 5. 前端与桌面壳

| 功能 | 说明 |
| --- | --- |
| 三栏对话 | 会话列表 + 消息流 + 洞察（轨迹 / 产物） | 对齐 WorkBuddy UI 壳 |
| Markdown | Streamdown + CJK / 代码高亮 | 助手气泡 |
| 输入区 | 模型名、上下文占比、添加技能、添加文件、拖放上传 | `Composer` |
| 统一确认卡片 | 命令 / 会话外路径 / 危险工具统一弹窗批准，决定落会话库、续跑复用 | `BashApproval` + `mcps/approval.py` |
| 执行加固 | 子进程默认拿不到宿主的 `*_KEY` / `*_TOKEN` / `CHATVEIN_*`；沙箱与 shell 统一走限额执行器；沙箱进程启动/超时/失败与 shell 命令写 `audit.sqlite`（不知情就不静默） | `mcps/sandbox_guard.py` + `mcps/audit.py` |
| 中断续跑 | 停止或崩溃后消息流上方出现「继续生成 / 放弃」 | `useChatSession` → `/api/conversations/{id}/resume` |
| 追踪窗口 | 独立窗看整轮 path / LLM / 工具 / token | `TraceWindow` |
| 群组 | 左栏整栏是群对话列表（一行 = 一个群组），建群时选成员并开好群对话；右栏是独立的群聊面板：无模型条、无技能，上下文用量放在气泡上方；输入区可「@ 指派」给某个成员，由该成员绑定模型单独执行，气泡与指派记录按成员显示 | `GroupView` / `GroupChatView` |
| 群组注册 | 会话持久化 `group_members`（角色 id 列表）：创建注册 / 补注册 / 随 `/api/chat` 消息透传，合并去重 | `conversations/` + `main.py` |
| 团队模式 | `group_members` 非空时主 agent 自动进入团队模式：花名册注入 prompt，挂 `delegate_to_agent`（串行）与 `parallel_delegate`（并行）两个派发工具；成员用自己绑定的模型 / 工具 / 按 `actor_id` 隔离的独立短期记忆完成子任务，回复写回成员名下；小任务主 agent 直接完成不派发 | `agents/delegation.py` + `agents/orchestration.py` + `agents/graphs/medium|hard.py` |
| 并行 fan-out | 多条无依赖子任务一次派发、线程池并发执行、成员 trace 子树隔离、完成后主模型汇总；会话库 `agent_tasks` 任务板记录每条状态，`GET /api/conversations/{id}/agent-tasks` 可查；`CHATVEIN_PARALLEL_DELEGATE=0` 回退串行 | `agents/orchestration.py` + `trace/recording.py`（`child_span`） |
| 气泡耗时 | 对话气泡 100% 完整展示上下文（不压缩代码块高度）；tokens · 耗时显示在气泡内容之后 | `ChatPanel.tsx` / `MarkdownMessage.tsx` |
| 长期记忆 | 每轮结束后异步抽取事实 / 偏好做候选（默认 `pending`，用户确认后生效）；作用域 全局 / 角色 / 会话，类型 fact / preference / identity / project / other；归一化去重 + 敏感内容（`sk-` key、手机号）整条拒绝；命中召回时只改 role prompt 副本，trace 点亮 `memory` 节点；设置页可确认 / 编辑 / 删除 / 整理；`CHATVEIN_MEMORY=0` 关闭，`CHATVEIN_MEMORY_AUTO_ACCEPT=1` 免确认 | `backend/memory/` + `MemorySection.tsx` |
| 设置 | 应用偏好（本地）、内置 MCP 状态、SQLite 信息 / VACUUM / 备份、长期记忆 | |
| Tauri 消息层 | 启停 Python、注入 `CHATVEIN_DATA_DIR`、推送后端 URL | `src-tauri` |

知识库管理已上线（`KnowledgeView.tsx` + `knowledge/` 模块 + `backend/knowledge/` REST）：左栏文档列表 / 搜索（向量模型就绪时语义召回，否则关键词兜底）、新建 / 编辑 / 删除 / 批量导入（文本文件或粘贴）/ 清空 / 全量重建索引；与 Agent 侧 `kb_*` 工具共用同一份 `kb.sqlite`（`kb_vec_map` 表做 rowid 映射，WAL + busy_timeout 支撑并发）。应用偏好里的托盘 / 开机启动 / 自动更新尚未接 Tauri 插件。

团队模式能力边界见 [`群组模式.md`](./群组模式.md)：成员角色无模型 / 主 agent 无模型时退化，不支持嵌套派发（子 agent 不挂 `delegate_to_agent` / `parallel_delegate`）。并行派发的实现差异见 [`production-design-batch2.md`](./production-design-batch2.md) §2.4「实现纪要」，长期记忆见 [`production-design-batch1.md`](./production-design-batch1.md) §1.4「实现纪要」，沙箱加固见 [`production-design-batch3.md`](./production-design-batch3.md) §3.1「实现纪要」。

---

## 6. 数据与可观测

| 功能 | 说明 |
| --- | --- |
| 主库 SQLite | 会话、消息、模型、角色等（SQLModel） |
| sqlite-vec | 同库向量扩展；失败不阻断主流程 |
| 会话库 | 每会话独立 sqlite：短期记忆 + 工具轨迹 + 追踪 JSON |
| 轮次元数据 | `turn_id`、tokens、耗时、route、难度等 |

---

## 7. 打包与运行

| 项 | 说明 |
| --- | --- |
| 开发 | `npm run tauri dev`：固定端口 8420，后端可热重载 |
| 发布 | `npm run tauri build` → `prepare:runtime`（PyInstaller）+ 前端 + NSIS/MSI |
| 运行时 | 用户机无需装 Python；Chromium / MinGit / 向量权重 **不进包**，按需下载 |
| 数据目录 | Rust `app_data_dir` → `CHATVEIN_DATA_DIR` |

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`features.md`](./features.md) | 本文：已实现功能清单 |
| [`agent-graphs.md`](./agent-graphs.md) | Agent 图设计（总图 / 三挡位 / 状态 / 接线） |
| [`agents.md`](./agents.md) | 流水线摘要 + MCP 工具矩阵 + 边界 |
| [`workspace.md`](./workspace.md) | 主工作区 vs 会话工作区 |
| [`team-mode-design.md`](./team-mode-design.md) | 团队模式 + 群组注册 + 角色描述 + UI 气泡耗时 实现设计 |
| [`README.md`](../README.md) | 快速开始与打包 |
