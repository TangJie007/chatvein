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

端口完全由 Rust 消息层内部管理（前端经 `backend_request` 命令代理，不直接连端口）：

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
