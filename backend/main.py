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

import db  # pyright: ignore[reportImplicitRelativeImport]
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


@app.get("/api/health", tags=["health"], summary="健康检查")
def health():
    return {
        "status": "ok",
        "service": "chatvein-python",
        "python": sys.version.split()[0],
        "db": db.stats(),
    }


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
