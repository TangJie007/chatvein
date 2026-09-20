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
    ├── graph.py         # LangGraph 工作流
    ├── db.py            # SQLite 持久化层
    └── requirements.txt
```

## 快速开始

### 1. 安装前端依赖

```bash
npm install
```

### 2. 准备 Python 后端（推荐用虚拟环境）

```bash
python -m venv backend/.venv
# Windows
backend/.venv/Scripts/pip install -r backend/requirements.txt
# macOS / Linux
backend/.venv/bin/pip install -r backend/requirements.txt
```

> 若不使用虚拟环境，也可直接 `pip install -r backend/requirements.txt`，
> Rust 会自动探测 `python` / `python3` 以及 `backend/.venv`。

### 3. 生成应用图标（首次需要）

```bash
npm run tauri icon src-tauri/icons/icon-source.png   # 见下方说明
```

### 4. 运行开发模式

```bash
npm run tauri dev
```

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

## LangGraph 集成

`/api/chat` 已接入 LangGraph 工作流（见 `backend/graph.py`）：

```
START → classify（判断是否为问句）
          ├─ 问句 → llm 节点（真实 LLM，未配置 key 时自动降级）
          └─ 非问句 → echo 节点（回声 / 可替换为检索、工具调用等）
                ↓
              END
```

- **离线可跑**：未设置 `OPENAI_API_KEY` 时，`generate` 节点走确定性降级回复，开发期无需任何 key。
- **接入真实 LLM**：在 `backend` 目录下设置环境变量即可，无需改代码：

  ```bash
  export OPENAI_API_KEY=sk-xxx
  export OPENAI_MODEL=gpt-4o-mini      # 可选
  export OPENAI_BASE_URL=https://...   # 可选，兼容代理 / 第三方 OpenAI 兼容服务
  ```

- **扩展**：在 `graph.py` 里增删 `add_node` / `add_conditional_edges` 即可编排多步 agent（工具调用、检索、记忆等），`/api/chat` 无需改动。

## 数据持久化（SQLite）

会话与消息通过 Python 标准库 `sqlite3` 落盘（`backend/db.py`），**不引入任何新依赖**
（`requirements.txt` 未变），打包后的 standalone Python 自带该模块。

**数据库位置由 Rust 消息层决定**，通过 `CHATVEIN_DATA_DIR` 注入，Python 只负责读取：

| 场景 | 位置 |
| --- | --- |
| Tauri 运行（dev / 打包） | `app_data_dir()`：Windows `%APPDATA%\com.chatvein.app`、macOS `~/Library/Application Support/com.chatvein.app`、Linux `~/.local/share/com.chatvein.app` |
| 直接跑后端 `python backend/main.py` | `backend/data/chatvein.db`（已在 `.gitignore` 中） |
| 显式覆盖 | `CHATVEIN_DB_PATH`（完整文件路径）优先于 `CHATVEIN_DATA_DIR`（目录） |

> 打包后的 `backend/` 位于只读的资源目录，数据库不能写在那里 —— 这正是把路径决策
> 交给 Rust、由它注入环境变量的原因。

**表结构**（用 `PRAGMA user_version` 记录 schema 版本，后续加表/改表在 `db.py::_migrate`
中追加分支即可）：

- `conversations(id TEXT PK, title, created_at, updated_at)`
- `messages(id INTEGER PK AUTOINCREMENT, conversation_id → conversations.id
  ON DELETE CASCADE, role CHECK(user/assistant/system), content, used_llm, route, created_at)`

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
| `GET` | `/api/db/info` | 数据库文件路径、schema 版本、行数统计（`/api/health` 也内嵌了该字段） |

`POST /api/chat` 的 `conversation_id` 省略（或传入已失效的 id）时会自动新建会话，
标题取首条用户消息前 30 字，无需前端额外调用建会话接口。

**冒烟测试**（覆盖落库、读回、删除、清空）：

```powershell
# 终端 1：用临时数据库启动后端
$env:CHATVEIN_DB_PATH="$env:TEMP\chatvein-test.db"
backend/.venv/Scripts/python.exe backend/main.py --port 18794

# 终端 2
python tools/test_backend.py
```

## 打包发布

打包时会把 **Python 解释器 + 后端代码** 一起封装进安装包，最终用户无需安装
任何 Python 环境。原理：

- `tools/prepare_runtime.ps1` 下载官方
  [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
  （一个免安装、可再分发的 Python），解压到 `python-runtime/`，并安装
  `backend/requirements.txt` 中的依赖。
- `tauri.conf.json` 的 `bundle.resources` 把 `backend/` 和 `python-runtime/`
  复制进应用资源目录。
- Rust 在运行时自动区分两种布局：打包后从 `资源目录/python-runtime/python.exe`
  启动；开发时回落到 `backend/.venv` 或系统 `python`。

```bash
# 1) 准备运行时（npm run tauri build 的 beforeBuildCommand 会自动执行，也可手动跑）
npm run prepare:runtime

# 2) 构建并打包（首次会编译 Release 版 Rust，耗时较长）
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/` 下（Windows 默认生成 NSIS 安装包 / MSI）。

> 说明：`prepare_runtime.ps1` 当前面向 Windows x86_64。macOS / Linux 请参考
> 同一份 standalone 发行物换成对应平台的压缩包，并调整脚本里的 URL 与解压逻辑；
> `python-runtime/` 已被 `.gitignore` 忽略，属于构建产物而非源码。
