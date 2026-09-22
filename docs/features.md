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
| 短期记忆 | 会话 `logs/session.sqlite`；条数 ≈ 角色 `memory × 2` | `conversations/service.py` + `main.py` chat |
| 技能注入 | `POST /api/chat` 的 `skills[]` 把本机 `SKILL.md` 并入 system | `skills/local_store.py` |
| 轮次追踪 | span 树、LLM 请求/响应、工具、token；按 turn 落库 | `trace/` |
| HTTP 入口 | `POST /api/chat` 同事务写用户+助手消息，回写 workspace 洞察 | `main.py` |

离线回落：无主模型时 understand / 选型走启发式，simple 返回「离线」文案，medium/hard 直接 `run_tools`。

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
| `mcp-codesandbox` | 会话 `runs/` 内 venv + pip + 跑 Python |
| `mcp-bash` | Git Bash（可按需下 MinGit）；限会话目录 + 危险拦截 + 确认 |
| `mcp-powershell` | Windows PowerShell；策略同 Bash |
| `mcp-browser` | Playwright Core+Tabs；本机有 Chromium 才注册 |
| `mcp-ip` | 公网出口 / IP 归属（ipinfo → ipwhois → ip-api，免费无 Key） |
| `mcp-ocr` | OCR.space → 沙箱 RapidOCR 降级 |

目录 API：`GET /api/mcps/catalog`。

**未实现（占位或刻意不做）**：`mcp-http`、外置 MCP 子进程、通用 `cmd.exe`、SaaS 连接器、`browser_run_code_unsafe`。详见 [`agents.md`](./agents.md)。

---

## 4. 模型 / 角色 / 技能

| 功能 | 说明 |
| --- | --- |
| 模型配置 | 多模型、启用/默认、API Key、上下文窗口等；主模型供 Agent | `models/` |
| 角色管理 | 人格提示、绑定模型、生成参数、工具分组、记忆轮数；主角色不可删 | `roles/` + `RolesView` |
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
| Bash/PowerShell 确认 | 危险或写盘命令弹窗批准 | `BashApproval` |
| 追踪窗口 | 独立窗看整轮 path / LLM / 工具 / token | `TraceWindow` |
| 设置 | 应用偏好（本地）、内置 MCP 状态、SQLite 信息 / VACUUM / 备份 | |
| Tauri 消息层 | 启停 Python、注入 `CHATVEIN_DATA_DIR`、推送后端 URL | `src-tauri` |

占位页（未做产品逻辑）：群组、独立知识库管理 UI。应用偏好里的托盘 / 开机启动 / 自动更新尚未接 Tauri 插件。

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
| [`README.md`](../README.md) | 快速开始与打包 |
