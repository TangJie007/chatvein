"""ChatVein Python backend.

Rust/Tauri 侧车进程：启动后把真实 base URL 推给前端，前端直连本服务。
模型管理等业务路由在 lifespan 中挂载；OpenAPI / Swagger UI 默认开启。
"""
import argparse
import os
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import cast

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db  # pyright: ignore[reportImplicitRelativeImport]
from agents.service import run_chat  # pyright: ignore[reportImplicitRelativeImport]
from conversations.module import (  # pyright: ignore[reportImplicitRelativeImport]
    conversations_router,
    conversations_service,
)
from mcps import shell_runtime, tool_catalog, tool_groups  # pyright: ignore[reportImplicitRelativeImport]
from mcps.bash_approval import decide, list_pending  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    use_conversation_sandbox,
)
from mcps.workspace import (  # pyright: ignore[reportImplicitRelativeImport]
    reset_workspace,
    set_workspace,
    workspace_view,
)
from embeddings.module import (  # pyright: ignore[reportImplicitRelativeImport]
    embeddings_router,
    on_module_init as on_embeddings_init,
)
from models.module import models_router, on_module_init  # pyright: ignore[reportImplicitRelativeImport]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    db_path = db.init_db()
    info = db.stats()
    print(
        f"CHATVEIN_DB path={db_path} schema=v{info['schema_version']}",
        flush=True,
    )
    on_module_init()
    on_embeddings_init()
    yield


app = FastAPI(
    title="ChatVein Backend",
    description="ChatVein Python API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models_router)
app.include_router(embeddings_router)
app.include_router(conversations_router)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32000)
    conversation_id: str | None = Field(default=None, max_length=64)


@app.post("/api/chat", tags=["chat"], summary="改写 + 难度路由 + 工具选择")
def chat(req: ChatRequest):
    prepared = conversations_service.open_for_chat(req.conversation_id, req.message)
    with use_conversation_sandbox(prepared["workspace_dir"]):
        result = run_chat(req.message)
    reply = str(result.get("reply") or "")
    route = str(result.get("difficulty") or result.get("route") or "simple")
    conversation_id, user_msg, assistant_msg = conversations_service.save_exchange(
        prepared["id"],
        req.message,
        reply,
        used_llm=bool(result.get("used_llm", False)),
        route=route,
    )
    return {
        "reply": reply,
        "from": "agents",
        "difficulty": route,
        "rewritten": result.get("rewritten"),
        "route": route,
        "route_reason": result.get("route_reason"),
        "tool_plan_reason": result.get("tool_plan_reason"),
        "selected_tools": list(result.get("selected_tools") or []),
        "used_llm": bool(result.get("used_llm", False)),
        "conversation_id": conversation_id,
        "user_message": user_msg,
        "assistant_message": assistant_msg,
    }


class BashDecision(BaseModel):
    id: str = Field(min_length=1, max_length=64)


@app.get("/api/bash/pending", tags=["bash"], summary="待确认的 Git Bash 命令")
def bash_pending():
    return {"pending": list_pending()}


@app.post("/api/bash/approve", tags=["bash"], summary="允许一条 Git Bash 命令")
def bash_approve(body: BashDecision):
    if not decide(body.id, allow=True):
        raise HTTPException(status_code=404, detail="没有这条待确认命令")
    return {"ok": True}


@app.post("/api/bash/deny", tags=["bash"], summary="拒绝一条 Git Bash 命令")
def bash_deny(body: BashDecision):
    if not decide(body.id, allow=False):
        raise HTTPException(status_code=404, detail="没有这条待确认命令")
    return {"ok": True}


@app.get("/api/health", tags=["health"], summary="健康检查")
def health():
    return {
        "status": "ok",
        "service": "chatvein-python",
        "python": sys.version.split()[0],
        "db": db.stats(),
    }


@app.get("/api/mcps/catalog", tags=["mcps"], summary="内置 MCP 工具目录")
def mcps_catalog():
    """设置页 / Agent 调试：分组工具清单（与前端 MCP_SERVERS id 对齐）。"""
    groups = tool_groups()
    catalog = tool_catalog()
    return {
        "groups": groups,
        "tools": catalog,
        "tool_count": len(catalog),
        "runtime": shell_runtime(),
    }


class WorkspaceUpdate(BaseModel):
    path: str = Field(min_length=1, max_length=1024)


@app.get("/api/workspace", tags=["workspace"], summary="当前主空间")
def get_workspace():
    """设置页：文件工具的沙箱根目录。"""
    return workspace_view()


@app.put("/api/workspace", tags=["workspace"], summary="设置主空间")
def put_workspace(body: WorkspaceUpdate):
    """把主空间切到用户选择的本机文件夹。"""
    try:
        return set_workspace(body.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/workspace", tags=["workspace"], summary="恢复默认主空间")
def delete_workspace():
    """清除用户选择，回到数据目录下的 workspace。"""
    try:
        return reset_workspace()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/db/info", tags=["db"], summary="数据库概况")
def db_info():
    """设置页「SQLite」分区的数据源：路径 / schema / 行数 / 占用。"""
    return db.info()


@app.post("/api/db/vacuum", tags=["db"], summary="整理数据库")
def db_vacuum():
    """VACUUM：重建文件并回收空闲页，返回整理后的概况。"""
    return db.vacuum()


@app.post("/api/db/backup", tags=["db"], summary="备份数据库")
def db_backup():
    """复制出一份一致快照（含 WAL 中未 checkpoint 的页）。"""
    try:
        return db.backup()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="ChatVein Python backend")
    parser.add_argument(  # pyright: ignore[reportUnusedCallResult]
        "--host",
        default=os.environ.get("CHATVEIN_HOST", "127.0.0.1"),
    )
    parser.add_argument(  # pyright: ignore[reportUnusedCallResult]
        "--port",
        type=int,
        default=int(os.environ.get("CHATVEIN_PORT", "8420")),
    )
    args = parser.parse_args()
    host = cast(str, args.host)
    port = cast(int, args.port)

    print(f"CHATVEIN_BACKEND_READY host={host} port={port}", flush=True)
    print(f"CHATVEIN_SWAGGER http://{host}:{port}/docs", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
