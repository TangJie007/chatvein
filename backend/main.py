"""ChatVein Python backend.

This process is launched by the Rust/Tauri layer as a sidecar and exposes a
small HTTP API on loopback. At startup Rust pushes the real base URL to the
frontend, which then talks to Python *directly* via fetch. Rust is the
process / URL provider and event bridge, not a per-request proxy.

The /api/chat endpoint is backed by a LangGraph workflow (see graph.py) and
every exchange is persisted to SQLite (see db.py). The database directory is
injected by Rust via `CHATVEIN_DATA_DIR`.
"""
import argparse
import os
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version as pkg_version
from typing import cast

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db  # pyright: ignore[reportImplicitRelativeImport]
from graph import run_chat  # pyright: ignore[reportImplicitRelativeImport]


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Open/create the SQLite database before serving traffic."""
    db_path = db.init_db()
    info = db.stats()
    print(
        "CHATVEIN_DB "
        + " ".join(
            [
                f"path={db_path}",
                f"schema=v{info['schema_version']}",
                f"conversations={info['conversations']}",
                f"messages={info['messages']}",
            ]
        ),
        flush=True,
    )
    yield


app = FastAPI(title="ChatVein Backend", lifespan=lifespan)

# The frontend reaches Python through Tauri's native HTTP plugin (request is
# executed in Rust, so browser CORS never applies). This middleware is just a
# safety net for anything else that might call the backend directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Message(BaseModel):
    message: str


class ChatRequest(BaseModel):
    message: str
    # 省略则自动新建会话；传入不存在的 id 也会自动新建，避免前端拿到脏 id 报错。
    conversation_id: str | None = None


class ConversationCreate(BaseModel):
    title: str = ""


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "chatvein-python",
        "python": sys.version.split()[0],
        "db": db.stats(),
    }


@app.get("/api/db/info")
def db_info():
    """SQLite 概况：文件位置、schema 版本、会话/消息条数。"""
    return db.stats()


@app.get("/api/conversations")
def list_conversations(limit: int = 50):
    return {"conversations": db.list_conversations(limit)}


@app.post("/api/conversations")
def create_conversation(payload: ConversationCreate):
    return db.create_conversation(payload.title)


@app.delete("/api/conversations")
def clear_conversations():
    """清空所有会话与消息（用于“清空历史”按钮）。"""
    return {"deleted": db.clear_conversations()}


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: str):
    conversation = db.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {
        "conversation": conversation,
        "messages": db.list_messages(conversation_id),
    }


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    if not db.delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"deleted": 1, "id": conversation_id}


@app.get("/api/conversations/{conversation_id}/messages")
def list_messages(conversation_id: str):
    return {"messages": db.list_messages(conversation_id)}


@app.post("/api/echo")
def echo(msg: Message):
    return {"echo": msg.message, "length": len(msg.message)}


@app.post("/api/chat")
def chat(req: ChatRequest):
    """Chat handler backed by a LangGraph workflow, persisted to SQLite.

    The graph routes questions to an LLM node (or a deterministic offline
    fallback when no API key is configured) and non-questions to an echo node.
    Both the user message and the reply are written to SQLite in one
    transaction; the conversation is created on the fly when needed.
    """
    result = run_chat(req.message)
    reply = cast(str, result["reply"])

    conversation_id, user_msg, assistant_msg = db.save_exchange(
        req.conversation_id,
        req.message,
        reply,
        used_llm=bool(result.get("used_llm", False)),
        route="langgraph",
    )
    return {
        "reply": reply,
        "from": "langgraph",
        "conversation_id": conversation_id,
        "user_message": user_msg,
        "assistant_message": assistant_msg,
    }


@app.get("/api/version")
def version():
    try:
        fastapi_version: str = pkg_version("fastapi")
    except PackageNotFoundError:
        fastapi_version = "unknown"
    return {"python": sys.version, "fastapi": fastapi_version}


@app.get("/api/hello")
def hello():
    """Hello World endpoint — returns a greeting from the Python backend."""
    return {
        "message": "你好，世界！",
        "from": "python-backend",
        "python": sys.version.split()[0],
    }


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
    # argparse.Namespace 的属性是 Any，显式收窄以消除 reportAny。
    host = cast(str, args.host)
    port = cast(int, args.port)

    # Surface a ready marker on stdout so the Rust layer can observe startup.
    print(f"CHATVEIN_BACKEND_READY host={host} port={port}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
