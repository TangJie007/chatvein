"""MCP 协议客户端：把异步 SDK 桥到 LangGraph 的同步工具执行线程。

为什么不是「每次调用开一次连接」：``stdio_client`` 会拉起子进程，SSE/HTTP 要
三次握手 + initialize，逐次连接会把一次对话拖慢到不可用。所以每条 server 一个
常驻协程，在**后台事件循环线程**里持有 session，工具线程通过队列投递请求。

为什么不用 ``run_coroutine_threadsafe`` 逐次调用：anyio 的取消作用域要求
「打开与关闭在同一任务」，跨任务 enter/exit 会在关闭时抛
``RuntimeError: Attempted to exit cancel scope in a different task``。
常驻协程同时解决了这两点：打开、使用、关闭都在同一个任务里。
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import threading
from contextlib import AsyncExitStack
from datetime import timedelta
from typing import Any

from .config import ServerConfig, split_command

#: 结构化错误码（前端 / trace 用它区分「连不上」与「工具报错」）。
MCP_SERVER_DOWN = "MCP_SERVER_DOWN"
MCP_TOOL_TIMEOUT = "MCP_TOOL_TIMEOUT"
MCP_TOOL_FAILED = "MCP_TOOL_FAILED"

_METADATA_HOSTS = {"metadata.google.internal", "169.254.169.254"}

_loop_lock = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None
_loop_thread: threading.Thread | None = None


class McpError(RuntimeError):
    """外部 MCP 调用失败：``code`` 供 trace / 前端展示。"""

    def __init__(self, message: str, *, code: str = MCP_SERVER_DOWN) -> None:
        super().__init__(message)
        self.code = code


def _get_loop() -> asyncio.AbstractEventLoop:
    """进程内唯一的 MCP 事件循环（daemon 线程，不阻塞进程退出）。"""
    global _loop, _loop_thread
    with _loop_lock:
        if _loop is not None and _loop.is_running():
            return _loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        thread = threading.Thread(target=loop.run_forever, name="chatvein-mcp", daemon=True)
        thread.start()
        _loop, _loop_thread = loop, thread
        return loop


def check_url(url: str) -> str | None:
    """远程 server 的 URL 体检；返回错误文案或 ``None``。

    显式放行 localhost / 内网：本地 SSE server 是最常见用法，用户是**手动配置**
    这条地址的，与「模型可从网页内容里读到内网 URL」的 SSRF 场景不同；
    只挡云元数据地址与非 http(s) 协议。
    """
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return f"无法解析 URL: {url}"
    if parsed.scheme not in {"http", "https"}:
        return "只支持 http / https 地址"
    host = (parsed.hostname or "").strip().lower().strip("[]")
    if not host:
        return "地址缺少主机名"
    if host in _METADATA_HOSTS:
        return "禁止访问云元数据地址"
    return None


def _tool_spec(tool: Any) -> dict[str, Any]:
    return {
        "name": str(getattr(tool, "name", "") or ""),
        "description": str(getattr(tool, "description", "") or ""),
        "input_schema": dict(getattr(tool, "inputSchema", None) or {}),
    }


def _format_result(result: Any) -> str:
    """``CallToolResult`` → 文本：文本块原样拼，非文本块给占位说明。"""
    chunks: list[str] = []
    for item in getattr(result, "content", None) or []:
        text = getattr(item, "text", None)
        if isinstance(text, str) and text:
            chunks.append(text)
            continue
        kind = str(getattr(item, "type", "") or type(item).__name__)
        chunks.append(f"[{kind} 内容已省略]")
    # structuredContent 是同一结果的机器可读副本：有文本块时再拼一遍会让模型
    # 收到两份一样的内容（还多占上下文），所以只在没有文本块时兜底。
    if not chunks:
        structured = getattr(result, "structuredContent", None)
        if structured:
            try:
                return json.dumps(structured, ensure_ascii=False)
            except (TypeError, ValueError):
                return str(structured)
        return "(外部工具没有返回内容)"
    return "\n".join(chunks)


class Connection:
    """一条外部 server 的连接（常驻协程 + 同步门面）。"""

    def __init__(self, config: ServerConfig) -> None:
        self.config = config
        self._ready = threading.Event()
        self._queue: asyncio.Queue[Any] | None = None
        self._serve_future: concurrent.futures.Future[None] | None = None
        self._connect_future: concurrent.futures.Future[None] | None = None
        self._tools: list[dict[str, Any]] = []
        self._error: str | None = None
        self._closed = False

    # ---- 状态 ---------------------------------------------------------

    @property
    def tools(self) -> list[dict[str, Any]]:
        return list(self._tools)

    @property
    def error(self) -> str | None:
        return self._error

    @property
    def connected(self) -> bool:
        return self._ready.is_set() and self._error is None and not self._closed

    @property
    def closed(self) -> bool:
        """常驻协程已退出（连接自然断开或主动关闭）——只能重建，不能复用。"""
        return self._closed

    def status(self) -> dict[str, Any]:
        if self._closed:
            state = "closed"
        elif self._error:
            state = "error"
        elif self._ready.is_set():
            state = "connected"
        else:
            state = "connecting"
        return {
            "state": state,
            "error": self._error,
            "tool_count": len(self._tools),
            "transport": self.config.transport,
        }

    # ---- 连接 ---------------------------------------------------------

    def connect(self, timeout: float | None = None) -> None:
        """建立连接并拉一次工具清单；重复调用直接复用已有连接。"""
        if self._closed:
            raise McpError("连接已关闭，请先重连", code=MCP_SERVER_DOWN)
        if self.connected:
            return
        wait_s = timeout if timeout is not None else self.config.timeout_s
        loop = _get_loop()
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._serve_future is None:
            self._serve_future = asyncio.run_coroutine_threadsafe(self._serve(), loop)
        if self._connect_future is None:
            self._connect_future = concurrent.futures.Future()
        try:
            self._connect_future.result(timeout=wait_s)
        except concurrent.futures.TimeoutError:
            self._error = f"连接超时（{int(wait_s)}s）"
            raise McpError(self._error, code=MCP_SERVER_DOWN) from None
        if self._error:
            raise McpError(self._error, code=MCP_SERVER_DOWN)

    async def _open(self, stack: AsyncExitStack) -> tuple[Any, Any]:
        """打开传输并建立 session（必须在本协程任务里做）。"""
        config = self.config
        if config.transport == "stdio":
            from mcp import StdioServerParameters
            from mcp.client.stdio import stdio_client

            tokens = split_command(config.command)
            if not tokens:
                raise McpError("未配置启动命令", code=MCP_SERVER_DOWN)
            env = {**os.environ, **config.env} if config.env else None
            entered = await stack.enter_async_context(
                stdio_client(StdioServerParameters(command=tokens[0], args=tokens[1:], env=env))
            )
        else:
            problem = check_url(config.url)
            if problem:
                raise McpError(problem, code=MCP_SERVER_DOWN)
            headers = dict(config.headers) or None
            if config.transport == "sse":
                from mcp.client.sse import sse_client

                entered = await stack.enter_async_context(sse_client(config.url, headers=headers))
            else:
                from mcp.client.streamable_http import streamablehttp_client

                entered = await stack.enter_async_context(
                    streamablehttp_client(config.url, headers=headers)
                )
        if len(entered) >= 3:  # Streamable HTTP 多返回一个 get_session_id
            read, write = entered[0], entered[1]
        else:
            read, write = entered
        return read, write

    async def _serve(self) -> None:
        from mcp import ClientSession

        stack = AsyncExitStack()
        try:
            read, write = await self._open(stack)
            session = await stack.enter_async_context(
                ClientSession(
                    read,
                    write,
                    read_timeout_seconds=timedelta(seconds=self.config.timeout_s),
                )
            )
            await session.initialize()
            listed = await session.list_tools()
            self._tools = [_tool_spec(t) for t in list(getattr(listed, "tools", None) or [])]
            self._ready.set()
            if self._connect_future is not None and not self._connect_future.done():
                self._connect_future.set_result(None)
            await self._pump(session)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - 连接失败要变成状态而不是崩线程
            self._error = _short_error(exc)
            self._ready.clear()
            if self._connect_future is not None and not self._connect_future.done():
                self._connect_future.set_result(None)
        finally:
            try:
                await stack.aclose()
            except Exception:  # noqa: BLE001 - 关闭阶段异常不再外抛
                pass
            self._closed = True

    async def _pump(self, session: Any) -> None:
        assert self._queue is not None
        while True:
            item = await self._queue.get()
            if item is None:
                return
            future, op, payload = item
            if future.done():  # 调用方已超时放弃
                continue
            try:
                if op == "list":
                    listed = await session.list_tools()
                    future.set_result(
                        [_tool_spec(t) for t in list(getattr(listed, "tools", None) or [])]
                    )
                else:
                    name, arguments = payload
                    result = await session.call_tool(name, arguments=arguments or {})
                    if getattr(result, "isError", False):
                        raise McpError(
                            _format_result(result) or "外部工具报告失败", code=MCP_TOOL_FAILED
                        )
                    future.set_result(_format_result(result))
            except concurrent.futures.CancelledError:
                continue
            except Exception as exc:  # noqa: BLE001 - 单次调用失败只影响这一次
                if not future.done():
                    if isinstance(exc, McpError):
                        future.set_exception(exc)
                    else:
                        future.set_exception(
                            McpError(_short_error(exc), code=MCP_TOOL_FAILED)
                        )

    # ---- 同步门面 -----------------------------------------------------

    def _submit(self, op: str, payload: Any, timeout: float | None = None) -> Any:
        if not self.connected:
            raise McpError(self._error or "外部 MCP 服务未连接", code=MCP_SERVER_DOWN)
        assert self._queue is not None
        future: concurrent.futures.Future[Any] = concurrent.futures.Future()
        loop = _get_loop()
        loop.call_soon_threadsafe(self._queue.put_nowait, (future, op, payload))
        wait_s = timeout if timeout is not None else self.config.timeout_s
        try:
            return future.result(timeout=wait_s)
        except concurrent.futures.TimeoutError:
            future.cancel()
            raise McpError(
                f"调用超时（{int(wait_s)}s）", code=MCP_TOOL_TIMEOUT
            ) from None
        except McpError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise McpError(_short_error(exc), code=MCP_TOOL_FAILED) from exc

    def list_tools(self) -> list[dict[str, Any]]:
        return self._submit("list", None)

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        return self._submit("call", (name, arguments or {}), timeout=self.config.timeout_s)

    def close(self) -> None:
        """停掉常驻协程并让 SDK 关闭传输（stdio 会带走子进程）。"""
        if self._closed:
            return
        queue = self._queue
        loop = _loop
        if queue is not None and loop is not None and loop.is_running():
            try:
                loop.call_soon_threadsafe(queue.put_nowait, None)
            except RuntimeError:
                pass
        future = self._serve_future
        if future is not None:
            try:
                future.result(timeout=5)
            except Exception:  # noqa: BLE001 - 关闭失败不影响调用方
                future.cancel()
        self._closed = True
        self._ready.clear()


def _short_error(exc: BaseException) -> str:
    text = str(exc).strip() or type(exc).__name__
    return text[:300]


__all__ = [
    "MCP_SERVER_DOWN",
    "MCP_TOOL_FAILED",
    "MCP_TOOL_TIMEOUT",
    "Connection",
    "McpError",
    "check_url",
]
