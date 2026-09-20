"""ChatVein Python backend.

This process is launched by the Rust/Tauri layer as a sidecar and exposes a
small HTTP API on loopback. At startup Rust pushes the real base URL to the
frontend, which then talks to Python *directly* via fetch. Rust is the
process / URL provider and event bridge, not a per-request proxy.

The /api/chat endpoint is backed by a LangGraph workflow (see graph.py) and
every exchange is persisted to SQLite. The database directory is injected by
Rust via `CHATVEIN_DATA_DIR`.
"""
import argparse
import os
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version as pkg_version
from typing import cast

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db  # pyright: ignore[reportImplicitRelativeImport]
from conversations.module import (  # pyright: ignore[reportImplicitRelativeImport]
    conversations_router,
    conversations_service,
)
from graph import run_chat  # pyright: ignore[reportImplicitRelativeImport]
from models.module import (  # pyright: ignore[reportImplicitRelativeImport]
    models_router,
    on_module_init as models_on_module_init,
)
from models.service import ModelsService  # pyright: ignore[reportImplicitRelativeImport]

_models_service = ModelsService()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Open/create the SQLite database before serving traffic."""
    db_path = db.init_db()
    models_on_module_init()
    info = {
        **db.stats(),
        **conversations_service.counts(),
        "llm_models": _models_service.count(),
    }
    print(
        "CHATVEIN_DB "
        + " ".join(
            [
                f"path={db_path}",
                f"schema=v{info['schema_version']}",
                f"conversations={info['conversations']}",
                f"messages={info['messages']}",
                f"llm_models={info['llm_models']}",
            ]
        ),
        flush=True,
    )
    yield


app = FastAPI(title="ChatVein Backend", lifespan=lifespan)
app.include_router(models_router)
app.include_router(conversations_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class EchoMessage(BaseModel):
    message: str


class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None


def _db_overview() -> dict[str, object]:
    return {
        **db.stats(),
        **conversations_service.counts(),
        "llm_models": _models_service.count(),
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "chatvein-python",
        "python": sys.version.split()[0],
        "db": _db_overview(),
    }


@app.get("/api/db/info")
def db_info():
    return _db_overview()


@app.post("/api/echo")
def echo(msg: EchoMessage):
    return {"echo": msg.message, "length": len(msg.message)}


@app.post("/api/chat")
def chat(req: ChatRequest):
    result = run_chat(req.message)
    reply = cast(str, result["reply"])

    conversation_id, user_msg, assistant_msg = conversations_service.save_exchange(
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
    host = cast(str, args.host)
    port = cast(int, args.port)

    print(f"CHATVEIN_BACKEND_READY host={host} port={port}", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
