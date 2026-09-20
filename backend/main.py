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

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from graph import run_chat

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
    return {"python": sys.version, "fastapi": __import__("fastapi").__version__}


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
    parser.add_argument(
        "--host",
        default=os.environ.get("CHATVEIN_HOST", "127.0.0.1"),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("CHATVEIN_PORT", "8420")),
    )
    args = parser.parse_args()

    # Surface a ready marker on stdout so the Rust layer can observe startup.
    print(f"CHATVEIN_BACKEND_READY host={args.host} port={args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
