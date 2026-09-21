# ChatVein

一个基于 **Tauri 2** 的三层架构桌面应用：

| 层 | 技术 | 职责 |
|----|------|------|
| UI | React + TypeScript (Vite) | 界面与交互 |
| 消息层 | Rust (Tauri) | 进程管理、HTTP 代理、事件转发 |
| 后端 | Python (FastAPI) | 真正的业务逻辑 |

```
React ──fetch()──▶ Python(FastAPI, 真实端口)
  ▲                      │
  │  Rust 启动时推送后端 URL │
  └──── emit 事件 ◀────────┘ (stdout/stderr 日志 / 就绪通知)
```

前端**直接**访问 Python：Rust 在启动时把「真实后端 URL」（含动态端口）通过
`backend_url` 命令与 `backend-ready` 事件交给前端，之后 React 用 `fetch` 直连
Python。Rust 不再是每条请求的代理，而是**进程生命周期管理者 + URL 提供者 + 日志/
事件桥接层**，这正好契合“Rust 是中间消息层”的定位（负责编排，而非逐请求转发）。

## 目录结构

```
chatvein/
├── src/                 # React 前端
├── src-tauri/           # Rust / Tauri 应用（消息层）
│   └── src/{lib,main,backend,commands}.rs
└── backend/             # Python 后端（FastAPI 侧车进程）
    ├── main.py
    ├── db.py            # SQLite 连接层
    ├── agents/          # Agent 编排（聊天入口）
    ├── conversations/   # 会话 / 消息
    ├── models/          # LLM 模型配置
    └── requirements.txt
```

## 快速开始

### 1. 安装前端依赖

```bash
npm install
```

### 2. 准备 Python 后端（推荐用虚拟环境）

项目统一锁定 **Python 3.13**（dev 的 `.venv`、PyInstaller 冻结产物、
类型检查的 `pyrightconfig.json` 必须一致）。venv 建在**仓库根**（`.venv/`）。

```bash
# 使用本机已安装的 Python 3.13
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt   # Windows
# .venv/bin/pip install -r backend/requirements.txt     # macOS / Linux
```

> `pyrightconfig.json` 从仓库根 `.venv/Lib/site-packages` 解析第三方库；
> 改完 `requirements.txt` 后在同一 venv 里重装即可。

### 3. 生成应用图标（首次需要）

```bash
npm run tauri icon src-tauri/icons/icon-source.png   # 见下方说明
```

### 4. 运行开发模式

```bash
npm run tauri dev
```

开发态 Rust 会拉起仓库里的 `backend/main.py`（不是打包后的 `backend.exe`），并设置
`CHATVEIN_RELOAD=1`：改 `backend/**/*.py` 后 uvicorn 会自动重启，一般不用整应用重启。
前端仍走 Vite HMR。若要关热重载，可在启动前设 `CHATVEIN_RELOAD=0`。

## 后端端口策略

端口完全由 Rust 消息层内部管理（Rust 启动时把真实 URL 推给前端，前端直接 `fetch` 连 Python，不经代理）：

- **开发阶段（`tauri dev`，debug 构建）**：固定使用 `8420`，方便本地调试与抓包。
- **生产打包（`tauri build`，release 构建）**：启动时自动探测一个 `3000+` 的空闲端口，避免与宿主机已有服务冲突。

端口在进程内只解析一次并缓存，Rust 的启动、就绪探测与前端直连共用同一端口，无需手动配置。

## 自定义后端接口

在 `backend/main.py` 中新增 FastAPI 路由，然后在前端通过（前端直接 `fetch` 该 URL）：

```ts
import { backendRequest } from "./api";
await backendRequest("/api/your-endpoint", "POST", { ... });
```

Rust 只负责把真实后端 URL 交给前端，新增接口无需改动 Rust 代码。

## Agent 集成

`/api/chat` → 主模型 **改写 + 难度分流**（LangGraph：simple 直答 / medium·hard ReAct）→ 工具选择缩集 → agent⇄tools。

内置 MCP（进程内工具，对齐设置页）：文件系统沙箱 / 联网搜索 / 只读 SQLite / 本地知识库 / 代码沙箱 / Git Bash·PowerShell / 浏览器自动化（Playwright，需本机安装浏览器）/ IP 归属地（ip2region，xdb 按需下载）。
详见 [docs/agents.md](docs/agents.md)。

## 数据持久化（SQLite）

会话与消息通过 **SQLModel** 持久化到 SQLite（`backend/db.py`）。SQLModel 由
**SQLAlchemy 2.0 + Pydantic** 驱动，和项目既有的 pydantic / FastAPI 生态同源：
一张表 = 一个类，查询走 `select()` 而不手写 SQL 字符串，后续加字段、加关联、加迁移
都只需改模型。依赖已在 `backend/requirements.txt` 中声明（`sqlmodel>=0.0.22,<2.0`）；
发布打包时由 `npm run prepare:runtime`（PyInstaller）打进 `dist-backend/`。

> ⚠️ `db.py` 中**不要**加 `from __future__ import annotations`：PEP 563 会让
> `list["Message"]` 以字符串 `"list['Message']"` 的形式传给 SQLAlchemy 的
> `relationship()`，导致 mapper 初始化报 `InvalidRequestError`。

**数据库位置由 Rust 消息层决定**，通过 `CHATVEIN_DATA_DIR` 注入，Python 只负责读取：

| 场景 | 位置 |
| --- | --- |
| Tauri 运行（dev / 打包） | `app_data_dir()`：Windows `%APPDATA%\com.chatvein.app`、macOS `~/Library/Application Support/com.chatvein.app`、Linux `~/.local/share/com.chatvein.app` |
| 直接跑后端 `python backend/main.py` | `backend/data/chatvein.db`（已在 `.gitignore` 中） |
| 显式覆盖 | `CHATVEIN_DB_PATH`（完整文件路径）优先于 `CHATVEIN_DATA_DIR`（目录） |

> 打包后的 `backend-runtime/` 位于只读的资源目录，数据库不能写在那里 —— 这正是把路径决策
> 交给 Rust、由它注入环境变量的原因。

**表模型**（`db.py` 中的 `Conversation` / `Message`；缺失的表由
`SQLModel.metadata.create_all` 自动补齐，改表时在 `db.py::_migrate` 中追加分支）：

- `Conversation`：`id` / `title` / `created_at` / `updated_at`，并以 `Relationship`
  关联 `messages`（`cascade_delete=True`，删除会话时消息一并删除）
- `Message`：`id` / `conversation_id`（外键 → `conversations.id`，`ON DELETE CASCADE`
  兜底）/ `role`（CHECK 约束限定 user/assistant/system）/ `content` / `used_llm` /
  `route` / `created_at`

**schema 版本**由 `PRAGMA user_version` 记录，当前为 **v2**：

| 版本 | 说明 |
| --- | --- |
| v2 | 改用 SQLModel；时间戳统一按 naive UTC 存储，启动时自动把 v1 的 `T` + `+00:00` 文本时间戳规范化（只影响旧库，幂等） |
| v1 | 手写 `sqlite3`（已被 v2 取代） |

### 向量存储（sqlite-vec）

向量与业务数据放在**同一个 SQLite 库**：`db.py` 在每个连接上加载
[sqlite-vec](https://github.com/asg017/sqlite-vec) 扩展（依赖见 `requirements.txt`
的 `sqlite-vec`，约 300KB 的纯二进制 wheel），业务侧直接建 `vec0` 虚拟表：

```sql
CREATE VIRTUAL TABLE message_vec USING vec0(embedding float[384]);
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

**接口**：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/chat` | 跑一遍 LangGraph，并在**同一事务**内写入「用户消息 + 助手回复」 |
| `GET` | `/api/conversations` | 会话列表（含消息数、最后一条消息预览） |
| `POST` | `/api/conversations` | 新建空会话 |
| `GET` | `/api/conversations/{id}` | 单个会话 + 其消息 |
| `GET` | `/api/conversations/{id}/messages` | 仅消息列表 |
| `DELETE` | `/api/conversations/{id}` | 删除会话（消息级联删除） |
| `DELETE` | `/api/conversations` | 清空全部历史 |
| `GET` | `/api/db/info` | 数据库文件路径、schema 版本、行数统计、占用与向量扩展状态（`/api/health` 也内嵌了连接层字段） |
| `POST` | `/api/db/vacuum` | 整理数据库（VACUUM）：重建文件、回收空闲页，返回整理后的概况 |
| `POST` | `/api/db/backup` | 复制出一份一致快照（含 WAL 中未 checkpoint 的页）到 `<库名>.bak-<时间戳>.db` |

`POST /api/chat` 的 `conversation_id` 省略（或传入已失效的 id）时会自动新建会话，
标题取首条用户消息前 30 字，无需前端额外调用建会话接口。

**冒烟测试**（覆盖落库、读回、删除、清空）：

```powershell
# 终端 1：用临时数据库启动后端
$env:CHATVEIN_DB_PATH="$env:TEMP\chatvein-test.db"
.venv/Scripts/python.exe backend/main.py --port 18794

# 终端 2
python tools/test_backend.py
```

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
