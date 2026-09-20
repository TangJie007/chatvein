"""ChatVein Python backend.

This process is launched by the Rust/Tauri layer as a sidecar and exposes a
small HTTP API on loopback. At startup Rust pushes the real base URL to the
frontend, which then talks to Python *directly* via fetch. Rust is the
process / URL provider and event bridge, not a per-request proxy.

The /api/chat endpoint is backed by a LangGraph workflow (see graph.py).
"""
import argparse
import os
import sys
from importlib.metadata import PackageNotFoundError, version as pkg_version
from typing import cast

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from graph import run_chat  # pyright: ignore[reportImplicitRelativeImport]

app = FastAPI(title="ChatVein Backend")

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


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "chatvein-python",
        "python": sys.version.split()[0],
    }


@app.post("/api/echo")
def echo(msg: Message):
    return {"echo": msg.message, "length": len(msg.message)}


@app.post("/api/chat")
def chat(msg: Message):
    """Chat handler backed by a LangGraph workflow.

    The graph routes questions to an LLM node (or a deterministic offline
    fallback when no API key is configured) and non-questions to an echo node.
    """
    result = run_chat(msg.message)
    return {"reply": result["reply"], "from": "langgraph"}


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
