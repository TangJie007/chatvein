"""ChatVein Python backend.

Rust/Tauri 侧车进程：启动后把真实 base URL 推给前端，前端直连本服务。
模型管理等业务路由在 lifespan 中挂载；OpenAPI / Swagger UI 默认开启。
"""
import argparse
import asyncio
import base64
import json
import os
import re
import secrets
import shutil
import sys
import time
import traceback
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import db  # pyright: ignore[reportImplicitRelativeImport]
from agents.cancellation import (  # pyright: ignore[reportImplicitRelativeImport]
    TurnCancelled,
    bind_turn,
    cancel_turn,
    clear_turn,
)
from agents.checkpoint import (  # pyright: ignore[reportImplicitRelativeImport]
    checkpoint_enabled,
    discard_turn,
    latest_state,
    list_resumable,
    thread_id_for,
)
from agents.context import use_summary_cache  # pyright: ignore[reportImplicitRelativeImport]
from agents.streaming import (  # pyright: ignore[reportImplicitRelativeImport]
    StreamSink,
    bind_stream_sink,
    stream_enabled,
)
from agents.llm import model_error_hint  # pyright: ignore[reportImplicitRelativeImport]
from agents.graphs.pipeline import run_pipeline  # pyright: ignore[reportImplicitRelativeImport]
from conversations.entity.dto import ConversationRecord  # pyright: ignore[reportImplicitRelativeImport]
from chats.module import (  # pyright: ignore[reportImplicitRelativeImport]
    chats_router,
    chats_service,
)
from conversations.module import (  # pyright: ignore[reportImplicitRelativeImport]
    conversations_router,
    conversations_service,
)
from mcps.registry import (  # pyright: ignore[reportImplicitRelativeImport]
    shell_runtime,
    tool_catalog,
    tool_groups,
)
from mcps.bash_approval import decide, list_pending  # pyright: ignore[reportImplicitRelativeImport]
from mcps.resilience import tool_scope  # pyright: ignore[reportImplicitRelativeImport]
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
from knowledge.module import knowledge_router  # pyright: ignore[reportImplicitRelativeImport]
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

# CORS：仅允许本机来源（Tauri webview / 本机开发页面），拒绝其它站点读取本机 API。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-ChatVein-Token"],
)

# 访问令牌：Rust 启动后端时通过 CHATVEIN_TOKEN 注入，前端每次请求带
# X-ChatVein-Token header，这里逐请求校验，不匹配直接 401。
# 未设置该变量（手动 `python backend/main.py` 调试 / 单测）时不强制校验。
_token = os.environ.get("CHATVEIN_TOKEN", "").strip()

if _token:
    from fastapi.responses import JSONResponse

    @app.middleware("http")
    async def _token_guard(request: Request, call_next):
        # CORS 预检与 OpenAPI 文档页无需令牌
        if request.method == "OPTIONS":
            return await call_next(request)
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        if request.headers.get("X-ChatVein-Token") != _token:
            return JSONResponse(status_code=401, content={"detail": "无效的访问令牌"})
        return await call_next(request)

app.include_router(models_router)
app.include_router(roles_router)
app.include_router(embeddings_router)
app.include_router(knowledge_router)
app.include_router(chats_router)
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
    # 前端预先生成的本轮 id：追踪每完成一步就落库，UI 可用它轮询「思考流」进度。
    # 缺省时后端自行生成，行为与之前一致。
    turn_id: str | None = Field(default=None, max_length=64)
    # 群里 @ 多人时前端按成员依次发起一轮：只有第一轮需要落用户消息，
    # 后续轮次置 False，避免同一句提问在会话里重复出现 N 份。
    append_user_message: bool = Field(default=True)
    # 群组成员（角色 id 列表）：随消息透传，注册 / 补注册到 chats.chat_groups（合并去重）。
    # 团队模式 / 群组 @ 时前端把当前选中成员带上，后端持久化到独立群组表。
    group_members: list[str] | None = Field(default=None, max_length=50)


class CancelChatRequest(BaseModel):
    """前端点「停止 / 撤回 / 编辑」时上报：只 abort HTTP 不会让后端停手。"""

    turn_id: str = Field(min_length=1, max_length=64)


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
async def chat(req: ChatRequest, request: Request):
    """对话主入口。

    async 路由：耗时的 LangGraph 调用通过 ``asyncio.to_thread`` 卸载到工作线程，
    事件循环不被长任务占住，多会话并发不再挤占同步路由的线程池。
    客户端断开（前端停止 / 关闭）时跳过落库，避免「前端停止后记录仍稍后写入」，
    前端因此不再需要 cleanupInFlight 轮询兜底。
    对话过程中抛出的异常一律转成可读的 HTTP detail，避免前端只拿到裸
    ``Internal Server Error`` 而无从提示用户。
    """
    try:
        if await request.is_disconnected():
            # 请求到达时客户端已离开：什么都不做，避免白占线程。
            return _aborted_payload()
        return await _chat_turn(req, request)
    except HTTPException:
        raise
    except TurnCancelled:
        # 用户主动取消：不是故障，返回占位响应，别打成 500。
        return _aborted_payload()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        # 限流 / 鉴权 / 供应商 5xx：直说人话，别让用户对着 HTTP 429 猜
        detail = model_error_hint(exc) or f"对话失败：{exc}"
        raise HTTPException(status_code=500, detail=detail) from exc


@app.post("/api/chat/cancel", tags=["chat"], summary="取消在途的一轮生成")
def cancel_chat(req: CancelChatRequest) -> dict[str, object]:
    """标记 ``turn_id`` 这一轮为已取消。

    标记后 ReAct 在下一次模型 / 工具调用前抛 ``TurnCancelled``：本轮立刻收尾
    （追踪写 ``cancelled``），不再让用户离开后后端继续空跑到自然结束。
    轮次早已结束 / turn_id 未知时只是记一条无人认领的标记，30 分钟后自动过期。
    """
    return {"turn_id": req.turn_id, "accepted": cancel_turn(req.turn_id)}


class ResumeTurnRequest(BaseModel):
    turn_id: str = Field(min_length=1)
    action: str = Field(default="continue", pattern="^(continue|discard)$")


def _conversation_and_db(conversation_id: str) -> tuple[Any, Path]:
    conversation = conversations_service.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    root = conversations_service.workspace_root_for(conversation["workspace_dir"])
    return conversation, session_db_path(root)


@app.get(
    "/api/conversations/{conversation_id}/resumable",
    tags=["chat"],
    summary="列出可恢复的轮次",
)
def resumable_turns(conversation_id: str) -> dict[str, object]:
    """停止 / 崩溃后仍留有 checkpoint 的轮次；已产出答复的不列出。"""
    if not checkpoint_enabled():
        return {"turns": []}
    _conversation, db_path = _conversation_and_db(conversation_id)
    prefix = f"{conversation_id}:"
    turns = [
        {
            "turn_id": item["thread_id"][len(prefix) :],
            "created_at": item["created_at"],
        }
        for item in list_resumable(db_path)
        if item["thread_id"].startswith(prefix)
    ]
    return {"turns": turns}


@app.post(
    "/api/conversations/{conversation_id}/resume",
    tags=["chat"],
    summary="恢复某轮生成（continue）或放弃现场（discard）",
)
async def resume_turn(
    conversation_id: str, req: ResumeTurnRequest
) -> dict[str, object]:
    """``continue``：从最近 checkpoint 继续，只补写助手消息（用户消息已落库）。"""
    conversation, db_path = _conversation_and_db(conversation_id)
    thread = thread_id_for(conversation_id, req.turn_id)
    if req.action == "discard":
        discard_turn(db_path, thread)
        return {"turn_id": req.turn_id, "discarded": True}
    if not checkpoint_enabled():
        raise HTTPException(
            status_code=409, detail="断点续跑已关闭（CHATVEIN_CHECKPOINT=0）"
        )
    state = latest_state(db_path, thread)
    if state is None:
        raise HTTPException(
            status_code=404, detail="没有可恢复的现场（可能已被放弃，或该轮从未开始）"
        )
    existing = str(state.get("reply") or "").strip()
    if existing:
        # 已经跑完的轮次不该出现在恢复入口；顺手清掉现场，返回既有答复。
        discard_turn(db_path, thread)
        return {"turn_id": req.turn_id, "reply": existing, "already_done": True}
    if not str(state.get("message") or "").strip():
        raise HTTPException(status_code=409, detail="现场缺少本轮用户消息，无法恢复")
    heavy = await asyncio.to_thread(
        _resume_turn_heavy, conversation, db_path, thread, req.turn_id, state
    )
    result = heavy["result"]
    reply = str(result.get("reply") or "").strip()
    if not reply:
        raise HTTPException(
            status_code=409, detail="恢复后仍未产出答复，请重试或放弃该轮"
        )
    role = state.get("role") or {}
    route = str(result.get("difficulty") or "simple")
    cid, _user_msg, assistant_msg = conversations_service.save_exchange(
        conversation_id,
        str(state.get("message") or ""),
        reply,
        used_llm=bool(result.get("used_llm", False)),
        route=route,
        turn_id=req.turn_id,
        tokens=int(heavy["tokens"]),
        duration_ms=int(heavy["duration_ms"]),
        tool_trace=list(result.get("tool_trace") or []),
        route_reason=result.get("route_reason"),
        tool_plan=result.get("tool_plan_reason"),
        actor_id=(role or {}).get("id"),
        append_user=False,
    )
    discard_turn(db_path, thread)
    return {
        "reply": reply,
        "turn_id": req.turn_id,
        "route": route,
        "resumed": True,
        "tokens": int(heavy["tokens"]),
        "duration_ms": int(heavy["duration_ms"]),
        "assistant_message": assistant_msg,
        "workspace": conversations_service.workspace_insight(cid),
    }


def _resume_turn_heavy(
    conversation: dict[str, Any],
    db_path: Path,
    thread_id: str,
    turn_id: str,
    state: dict[str, Any],
) -> dict[str, Any]:
    """在会话沙箱里从 checkpoint 继续一轮（与 ``_run_chat_heavy`` 同线程约束）。"""
    started = time.perf_counter()
    result: dict[str, Any] = {}
    tokens = 0
    message = str(state.get("message") or "")
    bind_turn(turn_id)
    try:
        with trace_service.recording(
            message,
            db_path=db_path,
            turn_id=turn_id,
            role=state.get("role"),
        ):
            with (
                use_conversation_sandbox(conversation["workspace_dir"]),
                use_summary_cache(db_path),
                tool_scope(turn_id),
            ):
                if _usage_callback is not None:
                    with _usage_callback() as usage_cb:
                        result = run_pipeline(
                            message, thread_id=thread_id, resume=True
                        )
                    tokens = _collect_tokens(usage_cb)
                else:
                    result = run_pipeline(message, thread_id=thread_id, resume=True)
    finally:
        clear_turn(turn_id)
        bind_turn(None)
    return {
        "result": result,
        "tokens": tokens,
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }


def _prepare_chat_turn(req: ChatRequest) -> dict[str, Any]:
    """前置编排（会话 / 角色 / 技能 / 团队 / 历史），流式与非流式共用。"""
    prepared = conversations_service.open_for_chat(req.conversation_id, req.message)
    # 群组注册：req.group_members 非空时随消息透传补注册（合并去重）。
    # 角色 id 列表持久化到 chats.chat_groups 独立表，团队模式 / 群组 @ 依赖它。
    if req.group_members:
        chats_service.register_group_members(
            prepared["id"], [str(m) for m in req.group_members]
        )
    # 会话级技能：req.skills 非 None 时覆盖会话技能集合并持久化。前端 Composer
    # 勾选 / 移除时已通过 PUT /api/conversations/{id}/skills 即时保存，发送时再兜底
    # 同步一次（空数组 = 清空会话技能）。技能在本会话内持续生效，不随单条消息消失。
    if req.skills is not None:
        conversations_service.set_conversation_skills(
            prepared["id"], [str(s) for s in req.skills]
        )
    from roles.service import RolesService  # pyright: ignore[reportImplicitRelativeImport]
    from skills.service import skill_prompt_blocks  # pyright: ignore[reportImplicitRelativeImport]

    # 会话绑定角色：请求未显式带 role_id 时，回退到会话创建 / 切换时绑定的角色
    # （两者都为空则 resolve_for_chat 走默认主角色，行为与之前一致）。
    effective_role_id = req.role_id or prepared.get("role_id")
    role_runtime = RolesService().resolve_for_chat(effective_role_id)
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
            actor_id=role_runtime.get("id"),
            append_user=req.append_user_message,
        )
        insight = conversations_service.workspace_insight(conversation_id)
        early = {
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
        return {"early": early}
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
    # --- 技能接线：目录注入 + load_skill 按需加载 ---
    # 链路：Composer 勾选 slug → PUT /api/conversations/{id}/skills 持久化 →
    #   /api/chat 用 skill_prompt_blocks 生成「目录」（name + description + slug，不含正文）
    #   追加进 role prompt → pipeline 组装 system prompt → 模型按需 load_skill 拉 SKILL.md 全文
    #   （正文读取：skills/local_store.py → mcps/tools/skills.py），避免长技能挤爆上下文。
    # 常驻技能（角色 resident_skills，每轮自动带上）与会话级技能（Composer 勾选、本会话生效）
    # 用 dict.fromkeys 保序去重，保证 prompt 里技能顺序稳定。
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
    # --- 团队模式：主 agent 花名册注入 + delegate_to_agent 工具（chats 模块）---
    # chats_service.assemble_team 是团队装配的唯一入口：req.group_members 非空时把
    # 成员（名字 + 描述 + role id）注入主 agent 的 role prompt（告知可派发对象），打
    # _team_mode 标记（medium/hard 据此挂 delegate_to_agent 工具），并把团队上下文
    # 写入 ContextVar；未开启团队模式时原样返回 role_runtime。
    role_runtime = chats_service.assemble_team(
        role_runtime,
        req.group_members,
        workspace_dir=prepared["workspace_dir"],
    )
    # 优先用前端带来的 turn_id（UI 边生成边轮询追踪）；缺失 / 非法时退回后端生成。
    turn_id = (req.turn_id or "").strip() or uuid.uuid4().hex
    db_path = session_db_path(
        conversations_service.workspace_root_for(prepared["workspace_dir"])
    )
    return {
        "early": None,
        "req": req,
        "prepared": prepared,
        "role_runtime": role_runtime,
        "turn_id": turn_id,
        "db_path": db_path,
        "history": history,
        "thread_id": thread_id_for(prepared["id"], turn_id),
    }


def _persist_turn(
    req: ChatRequest, prep: dict[str, Any], heavy: dict[str, Any]
) -> dict[str, object]:
    """把本轮结果落库并组装完整响应体（流式 done 事件 / 非流式响应共用）。"""
    prepared = prep["prepared"]
    role_runtime = prep["role_runtime"]
    turn_id = prep["turn_id"]
    result = heavy["result"]
    tokens = heavy["tokens"]
    duration_ms = heavy["duration_ms"]
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
        actor_id=(role_runtime or {}).get("id"),
        append_user=req.append_user_message,
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


async def _chat_turn(req: ChatRequest, request: Request) -> dict[str, object]:
    """非流式总编排：前置编排 → 工作线程跑图 → 落库（断开则不落库）。"""
    prep = _prepare_chat_turn(req)
    if prep.get("early"):
        return prep["early"]
    # 长耗时链路（追踪 + 会话沙箱 + LangGraph 对话 + token 统计）整体进工作线程：
    # trace / 沙箱靠线程内 ContextVar 传递，run_pipeline 与它必须同线程；异步路由因此
    # 不再占住事件循环，也不挤占同步路由的线程池。
    heavy = await asyncio.to_thread(
        _run_chat_heavy,
        prep["req"],
        prep["prepared"],
        prep["role_runtime"],
        prep["turn_id"],
        prep["db_path"],
        prep["history"],
        prep["thread_id"],
        None,
    )
    # 客户端已断开（前端停止 / 关闭）：跳过落库，否则记录会在前端停止后
    # 稍后写入，留下「幽灵消息」要前端轮询清理。
    if await request.is_disconnected():
        result = heavy["result"]
        return _aborted_payload(
            result=result,
            tokens=heavy["tokens"],
            duration_ms=heavy["duration_ms"],
            turn_id=prep["turn_id"],
            route=str(result.get("difficulty") or "simple"),
            tool_trace=list(result.get("tool_trace") or []),
        )
    return _persist_turn(prep["req"], prep, heavy)


def _sse_frame(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


_STREAM_END: dict[str, Any] = {"event": "", "data": {}}


async def _stream_events(req: ChatRequest, request: Request):
    """SSE 生成器：工作线程推事件，这里只负责切帧与心跳。"""
    prep = _prepare_chat_turn(req)
    if prep.get("early"):
        yield _sse_frame("done", dict(prep["early"]))
        return
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    sink = StreamSink(queue, loop)
    turn_id = prep["turn_id"]
    finished = {"done": False}

    async def producer() -> None:
        try:
            heavy = await asyncio.to_thread(
                _run_chat_heavy,
                prep["req"],
                prep["prepared"],
                prep["role_runtime"],
                prep["turn_id"],
                prep["db_path"],
                prep["history"],
                prep["thread_id"],
                sink,
            )
            if await request.is_disconnected():
                # 前端已断开：不落库，按取消收尾（现场保留，见 1.3）。
                await queue.put(
                    {"event": "cancelled", "data": {"turn_id": turn_id, "resumable": True}}
                )
                return
            payload = await asyncio.to_thread(_persist_turn, prep["req"], prep, heavy)
            finished["done"] = True
            await queue.put({"event": "done", "data": dict(payload)})
        except TurnCancelled:
            await queue.put(
                {"event": "cancelled", "data": {"turn_id": turn_id, "resumable": True}}
            )
        except Exception as exc:  # noqa: BLE001
            await queue.put(
                {
                    "event": "error",
                    "data": {
                        "code": "chat_failed",
                        "message": model_error_hint(exc),
                        "retryable": True,
                        "turn_id": turn_id,
                    },
                }
            )
        finally:
            await queue.put(_STREAM_END)

    task = asyncio.create_task(producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                # 长模型调用期间保住连接，避免代理层按空闲超时掐断。
                yield ": ping\n\n"
                continue
            if item is _STREAM_END:
                break
            yield _sse_frame(str(item["event"]), dict(item["data"]))
    finally:
        if not task.done():
            # 前端中途关闭流：让后端尽快停手，保留现场供 1.3 恢复。
            cancel_turn(turn_id)
            task.cancel()
        if not finished["done"]:
            cancel_turn(turn_id)


@app.post(
    "/api/chat/stream",
    tags=["chat"],
    summary="对话主入口（SSE token 流式）",
)
async def chat_stream(req: ChatRequest, request: Request):
    """与 ``POST /api/chat`` 同语义，只是把增量 token / 工具进度实时推给前端。

    ``CHATVEIN_STREAM=0`` 时直接 409：调用方应回落到旧接口，而不是拿到半成品。
    """
    if not stream_enabled():
        raise HTTPException(
            status_code=409, detail="流式已关闭（CHATVEIN_STREAM=0），请使用 /api/chat"
        )
    return StreamingResponse(
        _stream_events(req, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _run_chat_heavy(
    req: ChatRequest,
    prepared: ConversationRecord,
    role_runtime: dict[str, Any] | None,
    turn_id: str,
    db_path: Path,
    history: list[dict[str, Any]] | None,
    thread_id: str | None = None,
    sink: StreamSink | None = None,
) -> dict[str, Any]:
    """长耗时部分：追踪 + 会话沙箱 + LangGraph 对话 + token 统计。

    整体在一个工作线程里执行：trace 回调 / 沙箱工具靠线程内 ContextVar 传递，
    与 ``run_pipeline`` 必须同线程；SQLite 连接在 ``check_same_thread=False`` 下
    可跨线程使用，但这里仍保持「谁跑 run_pipeline 谁写库」的单线程语义。
    """
    started = time.perf_counter()
    result: dict[str, Any] = {}
    tokens = 0
    # 绑定本轮：ReAct / 工具的取消检查点靠这个 ContextVar 找到自己的 turn_id。
    bind_turn(turn_id)
    try:
        with trace_service.recording(
            req.message,
            db_path=db_path,
            turn_id=turn_id,
            role=role_runtime,
        ):
            with (
                use_conversation_sandbox(prepared["workspace_dir"]),
                use_summary_cache(db_path),
                tool_scope(turn_id),
                bind_stream_sink(sink),
            ):
                if _usage_callback is not None:
                    with _usage_callback() as usage_cb:
                        result = run_pipeline(
                            req.message,
                            history=history,
                            role=role_runtime,
                            thread_id=thread_id,
                        )
                    tokens = _collect_tokens(usage_cb)
                else:
                    result = run_pipeline(
                        req.message,
                        history=history,
                        role=role_runtime,
                        thread_id=thread_id,
                    )
                    tokens = 0
    finally:
        clear_turn(turn_id)
        bind_turn(None)
    duration_ms = int((time.perf_counter() - started) * 1000)
    return {"result": result, "tokens": tokens, "duration_ms": duration_ms}


def _aborted_payload(
    *,
    result: dict[str, Any] | None = None,
    tokens: int = 0,
    duration_ms: int = 0,
    turn_id: str = "",
    route: str = "simple",
    tool_trace: list[dict[str, Any]] | None = None,
) -> dict[str, object]:
    """客户端已断开时的占位响应：本轮不落库，只回放运行结果。

    ``result`` 为空（请求刚到就被放弃）时返回全空占位；调用方已跑完对话时
    带上结果，便于需要时复用（连接已断，正常不会有人读到）。
    """
    empty = result is None
    return {
        "reply": "" if empty else str(result.get("reply") or ""),
        "from": "agents",
        "difficulty": route,
        "rewritten": None if empty else result.get("rewritten"),
        "route": route,
        "route_reason": None if empty else result.get("route_reason"),
        "tool_plan_reason": None if empty else result.get("tool_plan_reason"),
        "selected_tools": [] if empty else list(result.get("selected_tools") or []),
        "tool_trace": [] if empty else list(tool_trace or []),
        "used_llm": False if empty else bool(result.get("used_llm", False)),
        "turn_id": turn_id,
        "tokens": tokens,
        "duration_ms": duration_ms,
        "conversation_id": None,
        "user_message": None,
        "assistant_message": None,
        "workspace": None,
        "discarded": True,
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


@app.get("/api/db/tables", tags=["db"], summary="列出所有表 / 视图")
def db_tables():
    """设置页 SQLite 分区：库中的业务表 / 视图与行数。"""
    try:
        return {"tables": db.tables()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get(
    "/api/db/tables/{name}",
    tags=["db"],
    summary="查看一张表 / 视图的字段与数据",
)
def db_table_detail(name: str, limit: int = 50, offset: int = 0):
    """字段定义（PRAGMA table_info）+ 前 N 行数据；limit 上限 500。"""
    try:
        return db.table_detail(name, limit=limit, offset=offset)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
