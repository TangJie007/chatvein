# ChatVein

一个基于 **Tauri 2** 的三层架构桌面应用：

| 层 | 技术 | 职责 |
|----|------|------|
| UI | React + TypeScript (Vite) | 界面与交互 |
| 消息层 | Rust (Tauri) | 进程生命周期、端口 / token、日志与事件桥接 |
| 后端 | Python (FastAPI) | 真正的业务逻辑 |

```
React ──fetch()──▶ Python(FastAPI, 真实端口)
  ▲                      │
  │  Rust 启动时推送后端 URL │
  └──── emit 事件 ◀────────┘ (stdout/stderr 日志 / 就绪通知)
```

前端**直接**访问 Python：Rust 在启动时把「真实后端 URL」（含动态端口）通过
`backend_url` 命令与 `backend-ready` 事件交给前端，之后 React 用 `fetch` 直连
Python。Rust 不再是每条请求的代理，而是**进程生命周期管理者 + URL / token 提供者 +
日志与事件桥接层**（负责编排，而非逐请求转发）。

> **维护入口**：改代码前先看 [`AGENTS.md`](AGENTS.md) 的「需求 → 改动落点」；
> 深层代码地图在 `.codebuddy/skills/chatvein-code-map/`；文档索引见 [`docs/README.md`](docs/README.md)。
>
> **平台**：当前仅支持 **Windows x64** —— 构建 / 冻结 / 发布脚本都是 PowerShell，
> 跨平台产物见 [`docs/运维手册.md`](docs/运维手册.md) §发布清单 4。

## 目录结构

```
chatvein/
├── src/                 # React 前端（`api/` 是唯一后端访问层，禁止手写 fetch）
├── src-tauri/           # Rust / Tauri 壳（后端进程与端口 / token 管理）
│   └── src/{lib,main,backend,commands}.rs
├── backend/             # Python 后端（FastAPI 侧车进程）
│   ├── main.py          # 入口：/api/chat(+/stream)、审批、上传、workspace、db 路由
│   ├── db.py            # 主库连接 + 迁移（schema v15，版本链见文件头注释）
│   ├── agents/          # Agent 编排：难度路由 + LangGraph 图 + 提示词 + 预算
│   ├── mcps/            # 工具注册 / 执行 / 沙箱 / 权限 / 审计 / 外部 MCP
│   ├── conversations/ chats/ roles/ models/ knowledge/ skills/ memory/ trace/ security/
│   └── tests/           # pytest（50 个用例文件，每例用独立数据目录）
├── tools/               # 构建、发布、离线评测、冒烟脚本
└── docs/                # 6 篇中文文档（索引：docs/README.md）
```

## 快速开始

### 1. 安装前端依赖

```bash
npm install
```

### 2. 准备 Python 后端（venv 必须建在仓库根 `.venv/`）

项目统一锁定 **Python 3.13**：dev 的 `.venv`、PyInstaller 冻结产物、
`pyrightconfig.json`（`pythonVersion: 3.13`）三者必须一致。**别用裸 `python -m venv`**
—— 很多机器上默认 `python` 是 3.14，建出来的环境会与类型检查 / 打包口径不符。

```powershell
# Windows：先确认 3.13 在哪（没有就装一个，不要用默认 python）
py -3.13 -c "import sys; print(sys.version)"
py -3.13 -m venv .venv
.venv/Scripts/pip install -r backend/requirements-dev.txt
```

```bash
# macOS / Linux
python3.13 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
```

> 开发 / 跑测试装 `requirements-dev.txt`（它 `-r requirements.txt` 并附带 `pytest`）；
> 打包只读 `requirements.txt`。装完自检：`.venv/Scripts/python.exe --version` 应为 `3.13.x`。
> `pyrightconfig.json` 从仓库根 `.venv/Lib/site-packages` 解析第三方库。

### 3. 应用图标（通常不用做）

`src-tauri/icons/` 已随仓库提供 Windows / macOS / 移动端全套图标。**只有换 logo 时才需要**重新生成：

```bash
npm run tauri icon src-tauri/icons/icon-source.png
```

### 4. 运行开发模式

```bash
npm run app:dev      # 等价于 npm run tauri dev：起 Vite + Rust 外壳 + Python 后端
```

开发态 Rust 会拉起仓库里的 `backend/main.py`（不是打包后的 `backend.exe`），并设置
`CHATVEIN_RELOAD=1`：改 `backend/**/*.py` 后 uvicorn 会自动重启，一般不用整应用重启。
前端仍走 Vite HMR。若要关热重载，可在启动前设 `CHATVEIN_RELOAD=0`。

### 5. 改完代码怎么自查

| 改了什么 | 至少跑一遍 | 说明 |
| --- | --- | --- |
| 前端 `src/**` | `npm run typecheck` + `npm test` | `tsc --noEmit` 与 vitest（`src/test/setup.ts` 已配好 jsdom） |
| 后端 `backend/**` | `npm run test:backend` | `.venv` 里的 pytest，每个用例自动用临时数据目录 |
| 跨层 / 聊天链路 | `tools/test_backend.py` + 手动发一条消息 | 见下方「冒烟测试」 |
| prompt / 工具 / 路由 | `.\tools\run_eval.ps1 --dry-run`（有条件就全跑） | 用例在 `backend/eval/cases/` |
| 新增 / 改接口 | 同步 `src/api/*.ts` 与 `docs/README.md` | 硬约定见 `AGENTS.md` §5 |

> 只改文档也要保证「文档里说的事能在代码里指出位置」；一旦发现文档与代码不一致，
> **以代码为准**并当次修文档（维护约定见 `docs/README.md` §三）。

## 后端端口策略

端口完全由 Rust 消息层内部管理（Rust 启动时把真实 URL 推给前端，前端直接 `fetch` 连 Python，不经代理）：

- **开发阶段（`tauri dev`，debug 构建）**：固定使用 `8420`，方便本地调试与抓包。
- **生产打包（`tauri build`，release 构建）**：启动时自动探测一个 `3000+` 的空闲端口，避免与宿主机已有服务冲突。

端口在进程内只解析一次并缓存，Rust 的启动、就绪探测与前端直连共用同一端口，无需手动配置。

## 新增一个后端接口

按现有模块结构来（`backend/<module>/`），**不要**把业务路由塞进 `main.py`：

1. `backend/<module>/controller.py`：`APIRouter()` + 处理函数；
2. `backend/<module>/module.py`：`APIRouter(prefix="/api/xxx")` 并挂上 controller；
3. `backend/main.py`：在 `include_router` 区域登记新 router（初始化逻辑放 `lifespan`）；
4. `src/api/<module>.ts`：用 `backendRequest` 封装；前端**不要手写 fetch**
   （token、超时、重试、错误文案都在 `src/api/client.ts` 里统一处理）。

```ts
// src/api/yourModule.ts
import { backendRequest } from "./client";

export const yourApi = (payload: SomeType) =>
  backendRequest<YourResult>("/api/your-endpoint", "POST", payload);
```

Rust 只负责把真实后端 URL 交给前端，新增接口无需改动 Rust 代码。

## Agent 集成

`/api/chat` → 主模型 **改写 + 难度分流**（LangGraph：simple 直答 / medium ReAct / hard：plan→ReAct→verify）→ 工具选择缩集 → agent⇄tools。
每会话工作区：`output/` 产物、`logs/session.sqlite` 短期记忆与工具轨迹、`runs/` 沙箱执行；历史会注入 Agent。
技能可安装到本机并在对话中注入 `SKILL.md`。

内置 MCP（进程内工具，对齐设置页）：文件系统沙箱 / 联网搜索 / 只读 SQLite / 本地知识库 / 代码沙箱 / Git Bash·PowerShell / 浏览器自动化（Playwright，需本机安装浏览器）/ IP 归属地（ipinfo → ipwhois → ip-api）。

文档：

- [文档索引](docs/README.md)
- [架构与目录](docs/架构与目录.md)
- [Agent 与功能](docs/Agent与功能.md)（Agent 流水线 / MCP 工具矩阵 / 已实现功能）
- [机制详解](docs/机制详解.md)（工作区 / 短期记忆 / 技能 / 群组）
- [运维手册](docs/运维手册.md)（配置总表 / 离线评测 / 工具用例 / 发布清单）
- [生产级增强设计](docs/生产级增强设计.md)

## 数据持久化（SQLite）

SQLite 分**两层**：主库放配置与会话索引，消息与工具轨迹放各自的**会话空间库**。
连接层与全部迁移都在 `backend/db.py`（SQLModel = SQLAlchemy 2.0 + Pydantic，
一张表 = 一个类，查询走 `select()`；改字段 = 改实体 + 追加迁移，不手写 SQL 字符串）。

| 库 | 位置 | 存什么 |
| --- | --- | --- |
| 主库 `chatvein.db` | `CHATVEIN_DB_PATH` > `CHATVEIN_DATA_DIR/chatvein.db` > `backend/data/chatvein.db` | 配置与会话索引：`conversations`（含 `message_count` / `last_message` 冗余列）、`roles`、`llm_models`、`chat_groups`、`mcp_servers`、`turn_traces`、`audit_events`、`agent_checkpoints` 等 |
| 会话空间库 `logs/session.sqlite` | 每个会话自己的工作区目录下 | 消息与工具轨迹：`messages`、`tool_calls`、`context_summaries`、`approvals`、`agent_tasks`、`meta` |
| `memory.sqlite` / `audit.sqlite` | 主库同目录（`CHATVEIN_MEMORY_DB_PATH` / `CHATVEIN_AUDIT_DB_PATH` 可覆盖） | 长期记忆 / 审计流水，各自独立，不建在主库里 |

> **消息不在主库**（v5 起迁到会话空间）：主库只留会话级冗余计数，列表页不用逐个打开会话库。
> 准确表结构与字段以代码为准：`GET /api/db/tables`、`GET /api/db/info`，或设置页「SQLite」分区。

**数据库位置由 Rust 消息层决定**，通过 `CHATVEIN_DATA_DIR` 注入，Python 只负责读取：

| 场景 | 位置 |
| --- | --- |
| Tauri 运行（dev / 打包） | `app_data_dir()`：Windows `%APPDATA%\com.chatvein.app`（macOS / Linux 对应目录见 `src-tauri/src/backend.rs`） |
| 直接跑后端 `python backend/main.py` | `backend/data/chatvein.db`（已在 `.gitignore` 中） |
| 显式覆盖 | `CHATVEIN_DB_PATH`（完整文件路径）优先于 `CHATVEIN_DATA_DIR`（目录） |

> 打包后的 `backend-runtime/` 位于只读的资源目录，数据库不能写在那里 —— 这正是把路径决策
> 交给 Rust、由它注入环境变量的原因。

> ⚠️ `db.py` 及任何用 `relationship()` 的实体模块中**不要**加
> `from __future__ import annotations`：PEP 563 会让 `list["Message"]` 以字符串
> `"list['Message']"` 的形式传给 SQLAlchemy 的 `relationship()`，mapper 初始化报
> `InvalidRequestError`。

**schema 版本**由 `PRAGMA user_version` 记录，当前 **v15**。v1→v15 的逐版说明与迁移函数
都在 `backend/db.py` 顶部注释 + `_migrate` 里（单一事实来源，文档不重复列举）。

迁移约定：**只追加、保持幂等**。`SQLModel.metadata.create_all` 只负责建缺失的表，
列变更写在 `_migrate` 的 `_ensure_*` 分支里（每个分支自带 `PRAGMA table_info` 探测，
重复执行无副作用）；改表时追加分支并同步 `SCHEMA_VERSION`。

### 向量存储（sqlite-vec）

向量与业务数据放在**同一个 SQLite 库**：`db.py` 在每个连接上加载
[sqlite-vec](https://github.com/asg017/sqlite-vec) 扩展（依赖见 `requirements.txt`
的 `sqlite-vec`，约 300KB 的纯二进制 wheel），业务侧直接建 `vec0` 虚拟表：

```sql
CREATE VIRTUAL TABLE message_vec USING vec0(embedding float[768]);
```

- 写入：`INSERT INTO message_vec(rowid, embedding) VALUES (:rid, :vec)`，`vec` 用
  `sqlite_vec.serialize_float32(vec)` 绑成 bytes（float32 原始格式，比文本快且省空间）。
- 检索：`SELECT rowid, distance FROM message_vec WHERE embedding MATCH :q AND k = 10
  ORDER BY distance`。
- 诊断：`GET /api/db/info`（`/api/health` 内嵌）返回 `vector_extension.loaded / version / error`。
  扩展加载失败不会阻断启动（聊天等主流程不依赖向量），但会把原因打印到 stdout。

> 原方案是 `lancedb`，但它会连带引入 `pyarrow` 等重型依赖，占用约 **380MB**
> （`lancedb` ~298MB + `pyarrow` ~85MB），对桌面端安装包不可接受，故整体移除。
> 改依赖后请重跑 `npm run prepare:runtime`，用干净的 PyInstaller 产物覆盖
> `dist-backend/`，避免旧包残留进安装包。

**核心接口**（这里只列新手最常碰到的；完整清单请看运行中的 Swagger —— 后端启动后打开
`http://127.0.0.1:8420/docs`，或 `GET /api/db/tables`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/chat` | 跑一遍 LangGraph，并在**同一事务**内写入「用户消息 + 助手回复」 |
| `POST` | `/api/chat/stream` | 同语义的 SSE 版本（`token` / `tool` / `trace` / `done` / `cancelled` / `error`），前端默认走它 |
| `POST` | `/api/chat/cancel` | 取消在途一轮；**停止 / 撤回必须先调这里**，只 abort HTTP 不会让后端停手 |
| `GET` | `/api/conversations` | 会话列表（含消息数、最后一条消息预览） |
| `POST` | `/api/conversations` | 新建空会话（`201`，体里带 `id`） |
| `GET` | `/api/conversations/{id}` | 单个会话 + 其消息 |
| `DELETE` | `/api/conversations/{id}` | 删除会话（会话空间目录一并清理） |
| `GET` | `/api/health` | 健康检查（内嵌数据库概况与向量扩展状态） |
| `GET` | `/api/db/info` / `/api/db/tables` | 数据库概况 / 表清单（设置页「SQLite」分区的数据源） |
| `POST` | `/api/db/vacuum` / `/api/db/backup` | 整理（VACUUM）/ 备份主库 |

其余资源（模型、角色、技能、知识库、追踪、权限、审计、外部 MCP）都在各自模块里：
后端路由前缀见 `backend/<module>/module.py`，前端封装见同名 `src/api/<module>.ts`。

`POST /api/chat` 的 `conversation_id` 省略（或传入已失效的 id）时会自动新建会话，
标题取首条用户消息前 30 字，无需前端额外调用建会话接口。

**冒烟测试**（不需要模型配置也能跑完；覆盖健康检查、数据库概况、空会话 CRUD 与一轮对话落库）：

```powershell
# 终端 1：用临时数据库启动后端（别指向真实数据目录）
$env:CHATVEIN_DB_PATH="$env:TEMP\chatvein-test.db"
.venv/Scripts/python.exe backend/main.py --port 18794

# 终端 2
.venv/Scripts/python.exe tools/test_backend.py
```

脚本先清空再自测，退出码 `0` 表示通过；未配置模型时聊天相关断言会打印 `[SKIP]`，不判失败。

## 打包发布

发布包内嵌 **PyInstaller 冻结的后端**（onedir：`backend.exe` + `_internal/`），
最终用户无需安装 Python。原理：

- `tools/build_backend.ps1`（`npm run prepare:runtime` / `prepare:backend`）在仓库根
  `.venv` 中安装依赖与 PyInstaller，按 [`backend/backend.spec`](backend/backend.spec)
  产出 `dist-backend/`。
- `tauri.conf.json` 的 `bundle.resources` 把 `dist-backend/` 复制为资源目录下的
  `backend-runtime/`。
- Rust：打包后直接启动 `backend-runtime/backend.exe`；开发时回落到
  `.venv` + `backend/main.py`。

```bash
# 1) 冻结后端（tauri build 的 beforeBuildCommand 会自动执行，也可手动跑）
npm run prepare:runtime

# 2) 构建并打包（首次会编译 Release 版 Rust，耗时较长）
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/` 下（Windows 默认生成 NSIS 安装包 / MSI）。

> 说明：当前构建脚本面向 Windows。`dist-backend/` 已被 `.gitignore` 忽略，
> 属于构建产物而非源码。模型权重仍不打进安装包，首次使用时下载到
> `CHATVEIN_DATA_DIR/embeddings`。
