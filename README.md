# ChatVein

一个基于 **Tauri 2** 的三层架构桌面应用：

| 层 | 技术 | 职责 |
|----|------|------|
| UI | React + TypeScript (Vite) | 界面与交互 |
| 消息层 | Rust (Tauri) | 进程管理、HTTP 代理、事件转发 |
| 后端 | Python (FastAPI) | 真正的业务逻辑 |

```
React ──invoke()──▶ Rust(Tauri) ──HTTP──▶ Python(FastAPI)
                         ▲                    │
                         └──── emit 事件 ◀────┘ (stdout/stderr 日志)
```

前端**不直接**访问 Python，所有请求都经过 Rust 的 `backend_request` 命令代理，
因此 Rust 既是“中间消息层”，也是 Python 进程的生命周期管理者。

## 目录结构

```
chatvein/
├── src/                 # React 前端
├── src-tauri/           # Rust / Tauri 应用（消息层）
│   └── src/{lib,main,backend,commands}.rs
└── backend/             # Python 后端（FastAPI 侧车进程）
    ├── main.py
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

## 自定义后端接口

在 `backend/main.py` 中新增 FastAPI 路由，然后在前端通过：

```ts
import { backendRequest } from "./api";
await backendRequest("/api/your-endpoint", "POST", { ... });
```

即可经由 Rust 消息层调用，无需改动 Rust 代码。

## 打包发布

```bash
npm run tauri build
```

正式打包时，需要把 Python 解释器与依赖一起随应用分发（Tauri `externalBin`
侧车方案）。本初始化模板在 `dev` 下直接调用系统/venv 中的 Python，便于开发；
生产打包请参考 Tauri 官方 [Sidecar 文档](https://v2.tauri.app/develop/sidecar/)。
