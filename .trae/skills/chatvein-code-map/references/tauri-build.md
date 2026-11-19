# Tauri / 启动 / 打包地图

> ChatVein 是「Rust 外壳 + Python 内核 + React 界面」的桌面应用。改启动/窗口/打包时，先确认是 Rust、Tauri 配置还是打包脚本的问题。

## 1. Rust 侧（`src-tauri/src/`）

| 文件 | 职责 | 关键符号 / 注意 |
|---|---|---|
| `main.rs` | 程序入口，调用库 `run()` | `chatvein_lib::run()` |
| `lib.rs` | Tauri Builder：插件、单实例、窗口、`setup` 中拉起后端、命令注册 | `run()`、`generate_handler!`、单实例回调聚焦主窗口 |
| `backend.rs` | **后端进程监督**：数据目录、找 Python/冻结 exe、选空闲端口、spawn、等健康、事件广播、退出清理（Windows Job Object 防孤儿） | `spawn_backend`、`find_python_exe`、`resolve_data_dir`、`find_free_port`、`wait_for_backend`、`kill_backend`、`start_supervisor`、`backend_base_url` |
| `commands.rs` | 暴露给前端的 invoke | `backend_url`、`backend_token` |
| `build.rs` | tauri-build | — |

启动时序：

```text
lib.rs::run()
 → single-instance 判定（已有实例则聚焦并退出）
 → 创建 main window
 → setup: backend.rs::spawn_backend
     → 解析数据目录（CHATVEIN_DATA_DIR 或 app data）
     → dev: .venv/Scripts/python.exe backend/main.py
       release: 资源目录 backend-runtime/backend.exe
     → 生成 token；注入 CHATVEIN_TOKEN / CHATVEIN_DATA_DIR / 端口
     → 轮询 /api/health
     → emit "backend-ready"（url + token）
     → 失败 emit "backend-error"；日志 emit "backend-log"
 → 前端 BackendGate / client.ts 收到后开始请求
```

| 事件 | 方向 | 消费方 |
|---|---|---|
| `backend-ready` | Rust → 前端 | `BackendGate.tsx` |
| `backend-error` | Rust → 前端 | `BackendGate.tsx` |
| `backend-log` | Rust → 前端 | 调试/错误页 |

## 2. Tauri 配置与能力

| 文件 | 作用 |
|---|---|
| `src-tauri/tauri.conf.json` | 产品名/标识、`devUrl`（Vite 5183）、窗口尺寸/最小尺寸、打包资源（`backend-runtime`）、updater 配置、安全策略 |
| `src-tauri/capabilities/default.json` | 主窗口权限（opener、dialog、updater、窗口操作等） |
| `src-tauri/capabilities/trace.json` | 独立追踪窗口（label `trace`）权限 |
| `src-tauri/Cargo.toml` | Rust 依赖与插件（single-instance、opener、updater、dialog、http、log、process 等） |
| `src-tauri/icons/` | 应用图标（`tools/make_icon.py` 生成） |
| `src-tauri/build.rs` | 构建脚本 |

> 新增窗口/权限时，**同时**改 `tauri.conf.json`（窗口定义）与 `capabilities/*.json`（权限），否则运行时报 not allowed。

## 3. 打包 / 发布

| 文件 | 作用 |
|---|---|
| `tools/build_backend.ps1` | PyInstaller onedir 冻结 `backend/main.py` → `backend-runtime/`（含 `_internal`） |
| `tools/prepare_runtime.ps1` | 整理运行时目录/启动 shim |
| `tools/release_updater.ps1` | 构建安装包 → 生成签名与 `latest.json` → 上传（腾讯云 COS 等） |
| `tools/make_icon.py` | 生成 `src-tauri/icons` |
| `tools/test_backend.py` | 后端冒烟 |
| `src-tauri/target/` | 构建产物（勿提交/勿搜索） |

npm 脚本对应：`npm run prepare:backend`、`npm run prepare:runtime`、`npm run app:dev`、`npm run build`、`npm test`、`npm run test:backend`。
发布说明见 `docs/release.md`。

## 4. 前端与外壳的交互

| 位置 | 说明 |
|---|---|
| `src/api/client.ts` | `invoke("backend_url")` / `invoke("backend_token")`；浏览器 dev 用 `VITE_BACKEND_URL` 兜底 |
| `src/components/layout/BackendGate.tsx` | 监听后端事件、轮询健康、失败重试 |
| `src/lib/openTrace.ts` | 打开独立 `trace` 窗口（`#/trace/:conversationId`） |
| `src/lib/openExternal.ts` | Tauri opener 打开系统浏览器 |
| `src/lib/updater.ts` + `settings/UpdateSection.tsx` | 检查/下载/安装更新 |

## 5. 常见改动落点

| 需求 | 改这里 |
|---|---|
| 改后端启动命令/找 Python 逻辑 | `src-tauri/src/backend.rs` |
| 改端口/token/数据目录 | `backend.rs` + `main.py`（读取环境变量） |
| 改窗口尺寸/标题/透明/最小尺寸 | `tauri.conf.json` |
| 新增 invoke 命令 | `commands.rs` + `lib.rs::generate_handler` + `capabilities` |
| 新增独立窗口 | `lib.rs` + `tauri.conf.json` + `capabilities/*.json` |
| 改打包进安装包的资源 | `tauri.conf.json` 的 `bundle.resources` + `build_backend.ps1` |
| 改自动更新 | `tauri.conf.json` 的 updater + `release_updater.ps1` + `updater.ts` |
| 后端启动白屏/一直转圈 | `BackendGate.tsx` → `backend.rs` 日志事件 → 手动起后端复现 |

## 6. 文档索引

| 文档 | 何时读 |
|---|---|
| `docs/agent-graphs.md` | simple / medium / hard 图、ReAct、工具循环、提示词 |
| `docs/agents.md` | 理解/改写、工具选择、上下文装配 |
| `docs/skills.md` | 技能市场、安装、注入、`load_skill` |
| `docs/workspace.md` | 主空间、会话工作区、沙箱、产物 |
| `docs/short-term-memory.md` | 历史裁剪、短期记忆 |
| `docs/群组模式.md` | 群组、团队、@、delegate |
| `docs/features.md` | 功能全景 |
| `docs/release.md` | 构建、签名、更新源 |
| `docs/项目目录总结.md` | 目录速览（**部分内容滞后，以代码为准**） |
| `docs/核心架构总结.md` / `docs/设计架构总结.md` / `docs/实现思想总结.md` | 设计背景 |
| `docs/test/` | 探测/验证脚本 |
| `.agents/notes/` | 开发过程笔记（非权威） |

## 7. 排障顺序

1. 后端起不来：手动 `python backend/main.py --port 8420` 看 Python 报错 → 再查 `backend.rs` 环境变量/路径。
2. 前端 401：`CHATVEIN_TOKEN` 与 `getBackendToken()` 不一致（Rust 重启后前端未刷新）。
3. 前端一直「连接中」：`backend-ready` 未 emit / 健康检查失败 / 端口被占。
4. 打包后后端找不到：`backend-runtime` 未打进 resources，或相对路径在安装目录下失效。
5. 更新失败：签名/`latest.json` 与 `tauri.conf.json` 公钥不匹配。
