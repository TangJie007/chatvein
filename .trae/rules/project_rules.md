# ChatVein 项目规则

完整代码地图与「需求 → 落点」见 `AGENTS.md`；技能目录在 `.trae/skills/chatvein-code-map/`。

## 分层

- `src/`：React 19 + Vite + Tailwind，页面在 `src/components/views/`，聊天内核在 `src/components/chat/`
- `src-tauri/`：Tauri 2，`src/backend.rs` 负责启动 Python 后端、端口、token、清理
- `backend/`：FastAPI + LangGraph + SQLite，入口 `main.py`

## 必须遵守

1. 先定位再改：按 `AGENTS.md` 的需求表，不要全库通读。
2. 后端新模块 = `controller.py` + `service.py` + `module.py`，并在 `main.py include_router`。
3. 前端请求只走 `src/api/client.ts`（自动带 `X-Chatvein-Token`）。
4. 工具必须导出 `TOOLS` + `heuristic`；新增工具同步 `backend/mcps/tools/__init__.py`、`src/components/settings/prefs.ts`、`src/lib/rolesStore.ts`。
5. 文件/命令必须经 `path_access` / `bash_policy`，不得绕过审批。
6. 对话无 SSE：乐观插入 + 轮询 `/traces/{turn_id}`；停止调 `/api/chat/cancel`。
7. 主库迁移只追加且幂等；消息存会话工作区 `logs/session.sqlite`。
8. 长任务用 `asyncio.to_thread`；`ContextVar` 不跨线程。
