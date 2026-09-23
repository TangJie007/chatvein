"""ChatVein Python backend.

Rust/Tauri 侧车进程：启动后把真实 base URL 推给前端，前端直连本服务。
模型管理等业务路由在 lifespan 中挂载；OpenAPI / Swagger UI 默认开启。
"""
import argparse
import base64
import os
import re
import secrets
import shutil
import sys
import time
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

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
    session_db_path,
    use_conversation_sandbox,
)
from trace.module import trace_router, trace_service  # pyright: ignore[reportImplicitRelativeImport]
from mcps.workspace import (  # pyright: ignore[reportImplicitRelativeImport]
    reset_workspace,
    set_workspace,
    workspace_root,
    workspace_view,
)
from embeddings.module import (  # pyright: ignore[reportImplicitRelativeImport]
    embeddings_router,
    on_module_init as on_embeddings_init,
)
from models.module import models_router, on_module_init  # pyright: ignore[reportImplicitRelativeImport]
from roles.module import roles_router, on_module_init as on_roles_init  # pyright: ignore[reportImplicitRelativeImport]
from skills.module import skills_router  # pyright: ignore[reportImplicitRelativeImport]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    db_path = db.init_db()
    info = db.stats()
    print(
        f"CHATVEIN_DB path={db_path} schema=v{info['schema_version']}",
        flush=True,
    )
    on_module_init()
    on_roles_init()
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
app.include_router(roles_router)
app.include_router(embeddings_router)
app.include_router(conversations_router)
app.include_router(trace_router)
app.include_router(skills_router)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32000)
    conversation_id: str | None = Field(default=None, max_length=64)
    role_id: str | None = Field(default=None, max_length=64)
    # 已选技能 slug 列表：由前端 Composer 从「附件菜单 → Skill」里勾选后带上；
    # chat() 里用它去查本机 <data>/skills/<slug>/ 目录，把 SKILL.md 正文注入 role prompt。
    skills: list[str] | None = Field(default=None, max_length=16)


try:  # langchain-core 版本差异：拿不到用量回调就退化为不统计
    from langchain_core.callbacks import (  # pyright: ignore[reportMissingImports]
        get_usage_metadata_callback,
    )
except Exception:  # noqa: BLE001
    get_usage_metadata_callback = None  # type: ignore[assignment]

_usage_callback = get_usage_metadata_callback


def _collect_tokens(usage: Any) -> int:
    """累加本轮所有 LLM 调用的 ``total_tokens``。"""
    meta = getattr(usage, "usage_metadata", None) or {}
    total = 0
    for item in meta.values():
        if isinstance(item, dict):
            total += int(item.get("total_tokens") or 0)
        else:
            total += int(getattr(item, "total_tokens", 0) or 0)
    return total


@app.post("/api/chat", tags=["chat"], summary="改写 + 难度路由 + 工具选择")
def chat(req: ChatRequest):
    prepared = conversations_service.open_for_chat(req.conversation_id, req.message)
    # 会话级技能：req.skills 非 None 时覆盖会话技能集合并持久化。前端 Composer
    # 勾选 / 移除时已通过 PUT /api/conversations/{id}/skills 即时保存，发送时再兜底
    # 同步一次（空数组 = 清空会话技能）。技能在本会话内持续生效，不随单条消息消失。
    if req.skills is not None:
        conversations_service.set_conversation_skills(
            prepared["id"], [str(s) for s in req.skills]
        )
    from roles.service import RolesService  # pyright: ignore[reportImplicitRelativeImport]
    from skills.service import skill_prompt_blocks  # pyright: ignore[reportImplicitRelativeImport]

    role_runtime = RolesService().resolve_for_chat(req.role_id)
    # 角色已选但未绑定模型：直接给出提示，不走理解/路由/工具链。
    # 未选角色（req.role_id 为空）保持原有行为：走离线/无模型链路。
    if role_runtime is not None and not (role_runtime.get("model_id") or "").strip():
        reply = "暂未给角色配置模型"
        turn_id = uuid.uuid4().hex
        conversation_id, user_msg, assistant_msg = conversations_service.save_exchange(
            prepared["id"],
            req.message,
            reply,
            used_llm=False,
            route="simple",
            turn_id=turn_id,
            tokens=0,
            duration_ms=0,
            tool_trace=[],
            route_reason="角色未配置模型",
            tool_plan=None,
        )
        insight = conversations_service.workspace_insight(conversation_id)
        return {
            "reply": reply,
            "from": "agents",
            "difficulty": "simple",
            "rewritten": None,
            "route": "simple",
            "route_reason": "角色未配置模型",
            "tool_plan_reason": None,
            "selected_tools": [],
            "tool_trace": [],
            "used_llm": False,
            "turn_id": turn_id,
            "tokens": 0,
            "duration_ms": 0,
            "conversation_id": conversation_id,
            "user_message": user_msg,
            "assistant_message": assistant_msg,
            "workspace": insight,
        }
    memory_limit = 24
    if role_runtime and role_runtime.get("memory") is not None:
        try:
            memory_limit = max(0, min(60, int(role_runtime["memory"]) * 2))
        except (TypeError, ValueError):
            memory_limit = 24
    history = conversations_service.short_term_memory(
        prepared["workspace_dir"],
        conversation_id=prepared["id"],
        limit=memory_limit,
    )
    # --- 技能接线（目录注入 + load_skill 按需加载）---
    # 完整链路：前端勾选 slug → PUT /api/conversations/{id}/skills 持久化到会话
    #   → /api/chat 读取会话技能 → skill_prompt_blocks 生成技能目录
    #   （name + description + slug，不注入正文）→ 追加进 role_runtime["prompt"]
    #   → run_chat → agents/graphs/pipeline.py 组装 system prompt（# Role 段，
    #   prompts.py build_agent_system）→ create_agent(system_prompt=...) →
    #   agents/llm.py get_chat_model 按 role.model_id 发出模型请求。
    #   模型需要时调用 load_skill(slug) 工具（mcps/tools/skills.py）把 SKILL.md
    #   完整正文按需拉进上下文，避免几千米的长技能挤爆上下文。
    #   相关文件：skills/service.py → skills/local_store.py → mcps/tools/skills.py
    #   → agents/graphs/medium.py & hard.py（react_node 无条件附加 load_skill）。
    # 常驻技能（角色级 resident_skills）与会话级技能（conversations.skills）去重合并：
    #  * 常驻技能：每次会话都会自动带上，来自角色配置；Composer 面板中不重复勾选
    #  * 会话级技能：Composer 勾选后持久化到当前会话，本会话内持续生效
    # 使用 dict.fromkeys 保序去重，保证 role prompt 里的技能顺序稳定
    resident_slugs = [str(s) for s in (role_runtime.get("resident_skills") or [])] if role_runtime else []
    session_slugs = conversations_service.get_conversation_skills(prepared["id"])
    merged_slugs = list(dict.fromkeys(resident_slugs + session_slugs))
    # 1) skill_prompt_blocks 生成技能目录文本（未安装的 slug 会被过滤）
    # 2) _skill_slugs 随 role 下传标记"本会话已启用技能"（load_skill 为常驻工具，
    #    已由 graphs/common.ALWAYS_ON_TOOLS 无条件挂进 medium/hard 工具列表）
    # 3) 有角色：把技能目录追加到角色 prompt 之后，模型先看角色再看技能
    # 4) 无角色：把技能目录直接当 role_runtime.prompt，工具面默认放开
    skill_block = skill_prompt_blocks(merged_slugs if merged_slugs else None)
    skill_ctx = {"_skill_slugs": merged_slugs} if merged_slugs else {}
    if skill_block and role_runtime is not None:
        role_runtime = {
            **role_runtime,
            "prompt": f"{(role_runtime.get('prompt') or '').strip()}\n\n{skill_block}".strip(),
            **skill_ctx,
        }
    elif skill_block:
        # 无角色时只注入技能目录；tools 省略表示不限制
        role_runtime = {"prompt": skill_block, **skill_ctx}
    turn_id = uuid.uuid4().hex
    db_path = session_db_path(
        conversations_service.workspace_root_for(prepared["workspace_dir"])
    )
    started = time.perf_counter()
    with trace_service.recording(
        req.message,
        db_path=db_path,
        turn_id=turn_id,
        role=role_runtime,
    ):
        with use_conversation_sandbox(prepared["workspace_dir"]):
            if _usage_callback is not None:
                with _usage_callback() as usage_cb:
                    result = run_chat(req.message, history=history, role=role_runtime)
                tokens = _collect_tokens(usage_cb)
            else:
                result = run_chat(req.message, history=history, role=role_runtime)
                tokens = 0
    duration_ms = int((time.perf_counter() - started) * 1000)
    reply = str(result.get("reply") or "")
    route = str(result.get("difficulty") or result.get("route") or "simple")
    tool_trace = list(result.get("tool_trace") or [])
    conversation_id, user_msg, assistant_msg = conversations_service.save_exchange(
        prepared["id"],
        req.message,
        reply,
        used_llm=bool(result.get("used_llm", False)),
        route=route,
        turn_id=turn_id,
        tokens=tokens,
        duration_ms=duration_ms,
        tool_trace=tool_trace,
        route_reason=result.get("route_reason"),
        tool_plan=result.get("tool_plan_reason"),
    )
    insight = conversations_service.workspace_insight(conversation_id)
    return {
        "reply": reply,
        "from": "agents",
        "difficulty": route,
        "rewritten": result.get("rewritten"),
        "route": route,
        "route_reason": result.get("route_reason"),
        "tool_plan_reason": result.get("tool_plan_reason"),
        "selected_tools": list(result.get("selected_tools") or []),
        "tool_trace": tool_trace,
        "used_llm": bool(result.get("used_llm", False)),
        "turn_id": turn_id,
        "tokens": tokens,
        "duration_ms": duration_ms,
        "conversation_id": conversation_id,
        "user_message": user_msg,
        "assistant_message": assistant_msg,
        "workspace": insight,
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


# --- 用户文件上传：把输入框拖入/选择的本机文件落盘到「会话工作区」uploads/ -------
#     优先写入 conversation_id 对应的会话工作区（见 _resolve_upload_root），
#     无会话时回落主空间。返回相对会话根的路径，供 Agent 在会话沙箱内解析。
#     两层工作区模型详见 docs/workspace.md。

_UPLOAD_SUBDIR = "uploads"
_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
_UPLOAD_NAME_RE = re.compile(r"[^A-Za-z0-9._\-\u4e00-\u9fff]+")


class UploadItem(BaseModel):
    source_path: str | None = Field(default=None)
    content_base64: str | None = Field(default=None)
    name: str | None = Field(default=None)


class UploadRequest(BaseModel):
    files: list[UploadItem] = Field(min_length=1, max_length=20)
    conversation_id: str | None = Field(default=None, max_length=64)


def _resolve_upload_root(conversation_id: str | None) -> Path:
    """把上传落盘到会话工作区（优先）或主空间（无会话时回落）。"""
    cid = (conversation_id or "").strip()
    if cid:
        try:
            conv = conversations_service.get_conversation(cid)
        except Exception:  # noqa: BLE001
            conv = None
        if conv:
            ws = (conv.get("workspace_dir") or "").strip()
            if ws:
                try:
                    return conversations_service.workspace_root_for(ws)
                except Exception:  # noqa: BLE001
                    pass
    return workspace_root()


def _safe_upload_dest(root: Path, original: str) -> Path:
    original = (original or "file").strip() or "file"
    stem = Path(original).stem or "file"
    suffix = Path(original).suffix.lower()
    if len(suffix) > 12:
        suffix = suffix[:12]
    safe_stem = _UPLOAD_NAME_RE.sub("_", stem)[:60] or "file"
    uploads = root / _UPLOAD_SUBDIR
    uploads.mkdir(parents=True, exist_ok=True)
    for _ in range(8):
        token = secrets.token_hex(4)
        cand = uploads / f"{safe_stem}_{token}{suffix}"
        if not cand.exists():
            return cand
    return uploads / f"{safe_stem}_{secrets.token_hex(8)}{suffix}"


def _handle_upload_item(item: UploadItem, root: Path) -> dict[str, object]:
    try:
        if item.source_path:
            src = Path(item.source_path.strip())
            if not src.is_file():
                return {"error": f"文件不存在: {item.source_path}"}
            size = src.stat().st_size
            if size > _UPLOAD_MAX_BYTES:
                return {"error": f"文件过大（{size} 字节，上限 {_UPLOAD_MAX_BYTES}）"}
            dest = _safe_upload_dest(root, src.name)
            shutil.copy2(src, dest)
            return {"name": src.name, "path": dest.relative_to(root).as_posix()}
        if item.content_base64:
            raw = (item.content_base64 or "").strip()
            if "," in raw and raw.lower().startswith("data:"):
                raw = raw.split(",", 1)[1]
            data = base64.b64decode(raw, validate=False)
            if len(data) > _UPLOAD_MAX_BYTES:
                return {"error": "文件过大"}
            name = (item.name or "upload.bin").strip() or "upload.bin"
            dest = _safe_upload_dest(root, name)
            dest.write_bytes(data)
            return {"name": name, "path": dest.relative_to(root).as_posix()}
        return {"error": "需要 source_path 或 content_base64"}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"上传失败: {exc}"}


@app.post(
    "/api/uploads",
    tags=["workspace"],
    summary="把用户提供的文件落盘到主空间 uploads/，返回可解析的相对路径",
)
def upload_files(req: UploadRequest):
    """输入框拖入/选择的本机文件会被复制到会话工作区 ``uploads/``（无会话时回落主空间），
    返回相对路径，供 OCR / 文件工具按工作区内路径解析（沙箱外的绝对路径无法被 Agent 读取）。"""
    root = _resolve_upload_root(req.conversation_id)
    return {"files": [_handle_upload_item(item, root) for item in req.files]}


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
    parser.add_argument(  # pyright: ignore[reportUnusedCallResult]
        "--reload",
        action="store_true",
        default=os.environ.get("CHATVEIN_RELOAD", "").strip().lower()
        in {"1", "true", "yes"},
        help="开发热重载（改 .py 自动重启；也可设 CHATVEIN_RELOAD=1）",
    )
    args = parser.parse_args()
    host = cast(str, args.host)
    port = cast(int, args.port)
    reload = bool(args.reload)

    print(f"CHATVEIN_BACKEND_READY host={host} port={port}", flush=True)
    print(f"CHATVEIN_SWAGGER http://{host}:{port}/docs", flush=True)
    if reload:
        # reload 必须传 import 字符串，传 app 实例不会监视文件
        print("CHATVEIN_BACKEND_RELOAD=1", flush=True)
        uvicorn.run(
            "main:app",
            host=host,
            port=port,
            log_level="info",
            reload=True,
        )
    else:
        uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
