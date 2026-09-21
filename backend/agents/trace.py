"""一轮对话的调试追踪：图步骤、每次 LLM 的请求/响应、工具与 token。

挂在 ``contextvars`` 上。``get_chat_model`` 会把回调装进模型，因此嵌套的
structured / ReAct 调用也会记下来。追踪失败不能打断对话。
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage

_recorder: ContextVar[TraceRecorder | None] = ContextVar("chatvein_trace", default=None)
_span: ContextVar[str] = ContextVar("chatvein_trace_span", default="llm")

_MAX_TEXT = 80_000


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clip(text: str) -> str:
    if len(text) <= _MAX_TEXT:
        return text
    return text[:_MAX_TEXT] + "\n…(截断)"


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            else:
                parts.append(json.dumps(block, ensure_ascii=False, default=str))
        return "\n".join(parts)
    return json.dumps(content, ensure_ascii=False, default=str)


def _tool_calls(raw: Any) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for call in raw or []:
        if isinstance(call, dict):
            calls.append(
                {
                    "id": call.get("id"),
                    "name": str(call.get("name") or ""),
                    "args": call.get("args"),
                }
            )
        else:
            calls.append(
                {
                    "id": getattr(call, "id", None),
                    "name": str(getattr(call, "name", "") or ""),
                    "args": getattr(call, "args", None),
                }
            )
    return calls


def _dump_message(msg: BaseMessage) -> dict[str, Any]:
    role = str(getattr(msg, "type", None) or "unknown")
    dumped: dict[str, Any] = {
        "role": role,
        "content": _clip(_content_text(getattr(msg, "content", ""))),
    }
    calls = _tool_calls(getattr(msg, "tool_calls", None))
    if calls:
        dumped["tool_calls"] = calls
    name = getattr(msg, "name", None)
    if name:
        dumped["name"] = str(name)
    return dumped


def _clip_value(value: Any) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        return _clip(str(value))
    if len(encoded) <= _MAX_TEXT:
        return value
    return _clip(encoded)


def _usage_from_message(msg: Any) -> dict[str, int] | None:
    meta = getattr(msg, "usage_metadata", None)
    if isinstance(meta, dict):
        inp = int(meta.get("input_tokens") or 0)
        out = int(meta.get("output_tokens") or 0)
        total = int(meta.get("total_tokens") or (inp + out))
        if inp or out or total:
            return {"input_tokens": inp, "output_tokens": out, "total_tokens": total}
    resp = getattr(msg, "response_metadata", None) or {}
    if isinstance(resp, dict):
        token_usage = resp.get("token_usage") or resp.get("usage") or {}
        if isinstance(token_usage, dict) and token_usage:
            inp = int(token_usage.get("prompt_tokens") or token_usage.get("input_tokens") or 0)
            out = int(
                token_usage.get("completion_tokens") or token_usage.get("output_tokens") or 0
            )
            total = int(token_usage.get("total_tokens") or (inp + out))
            if inp or out or total:
                return {"input_tokens": inp, "output_tokens": out, "total_tokens": total}
    return None


def _usage_from_llm_output(llm_output: Any) -> dict[str, int] | None:
    if not isinstance(llm_output, dict):
        return None
    token_usage = llm_output.get("token_usage") or llm_output.get("usage") or {}
    if not isinstance(token_usage, dict) or not token_usage:
        return None
    inp = int(token_usage.get("prompt_tokens") or token_usage.get("input_tokens") or 0)
    out = int(token_usage.get("completion_tokens") or token_usage.get("output_tokens") or 0)
    total = int(token_usage.get("total_tokens") or (inp + out))
    if not (inp or out or total):
        return None
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": total}


def _path(difficulty: str) -> list[dict[str, Any]]:
    level = difficulty if difficulty in ("simple", "medium", "hard") else "simple"
    branched = level in ("medium", "hard")
    react = "ReAct · 复杂" if level == "hard" else "ReAct"
    return [
        {"id": "understand", "label": "理解", "taken": True},
        {"id": "route", "label": "路由", "taken": True},
        {"id": "simple", "label": "直答", "taken": level == "simple"},
        {"id": "select_tools", "label": "筛选工具", "taken": branched},
        {"id": "react", "label": react, "taken": branched},
    ]


class TraceRecorder:
    """一轮里按发生顺序追加的步骤。"""

    def __init__(self, message: str) -> None:
        self.input = message
        self.started = time.perf_counter()
        self.started_at = _iso_now()
        self.finished_at = self.started_at
        self.difficulty = ""
        self.rewritten = message
        self.route_reason = ""
        self.selected_tools: list[str] = []
        self.candidate_tools: list[str] = []
        self.tool_plan_reason = ""
        self.reply = ""
        self.steps: list[dict[str, Any]] = []
        self._seq = 0
        self.handler: Any = None

    def add(self, step: dict[str, Any]) -> dict[str, Any]:
        self._seq += 1
        step.setdefault("id", str(self._seq))
        self.steps.append(step)
        return step

    def count_kind(self, kind: str) -> int:
        return sum(1 for step in self.steps if step.get("kind") == kind)

    def apply_outcome(
        self,
        *,
        difficulty: str,
        rewritten: str,
        route_reason: str,
        selected_tools: list[str],
        candidate_tools: list[str],
        tool_plan_reason: str,
        reply: str,
    ) -> None:
        self.difficulty = difficulty
        self.rewritten = rewritten
        self.route_reason = route_reason
        self.selected_tools = list(selected_tools)
        self.candidate_tools = list(candidate_tools)
        self.tool_plan_reason = tool_plan_reason
        self.reply = reply

    def snapshot(self) -> dict[str, Any]:
        elapsed_ms = int((time.perf_counter() - self.started) * 1000)
        self.finished_at = _iso_now()
        input_tokens = 0
        output_tokens = 0
        llm_calls = 0
        tool_calls = 0
        for step in self.steps:
            if step.get("kind") == "llm" and step.get("status") != "offline":
                llm_calls += 1
                usage = step.get("usage") or {}
                input_tokens += int(usage.get("input_tokens") or 0)
                output_tokens += int(usage.get("output_tokens") or 0)
            elif step.get("kind") == "tool":
                tool_calls += 1
        return {
            "input": self.input,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed_ms": elapsed_ms,
            "difficulty": self.difficulty,
            "rewritten": self.rewritten,
            "route_reason": self.route_reason,
            "selected_tools": list(self.selected_tools),
            "candidate_tools": list(self.candidate_tools),
            "tool_plan_reason": self.tool_plan_reason,
            "reply": self.reply,
            "path": _path(self.difficulty),
            "steps": self.steps,
            "totals": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "llm_calls": llm_calls,
                "tool_calls": tool_calls,
            },
        }


class TraceHandler(BaseCallbackHandler):
    """记录 chat model 与 tool 事件。同一 ``run_id`` 只记一次。"""

    raise_error = False

    def __init__(self, recorder: TraceRecorder) -> None:
        super().__init__()
        self.recorder = recorder
        self._pending: dict[str, dict[str, Any]] = {}
        self._seen: set[str] = set()

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> Any:
        key = str(run_id)
        if key in self._seen or key in self._pending:
            return
        self._seen.add(key)
        params = kwargs.get("invocation_params") or {}
        model = str(params.get("model") or params.get("model_name") or serialized.get("name") or "")
        batch = messages[0] if messages else []
        span_name = _span.get()
        same = sum(
            1
            for step in self.recorder.steps
            if step.get("kind") == "llm" and str(step.get("name") or "").split("#", 1)[0] == span_name
        )
        name = span_name if same == 0 else f"{span_name}#{same + 1}"
        self._pending[key] = {
            "kind": "llm",
            "name": name,
            "status": "running",
            "model": model or None,
            "started": time.perf_counter(),
            "request": {"messages": [_dump_message(msg) for msg in batch]},
            "response": None,
            "usage": None,
            "error": None,
        }

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> Any:
        key = str(run_id)
        step = self._pending.pop(key, None)
        if step is None:
            return
        message = None
        text = ""
        try:
            gen = response.generations[0][0]
            message = getattr(gen, "message", None)
            text = str(getattr(gen, "text", "") or "")
        except (AttributeError, IndexError, TypeError):
            message = None
        content = text
        calls: list[dict[str, Any]] = []
        usage = _usage_from_llm_output(getattr(response, "llm_output", None))
        if message is not None:
            content = _content_text(getattr(message, "content", "")) or text
            calls = _tool_calls(getattr(message, "tool_calls", None))
            usage = _usage_from_message(message) or usage
        step["status"] = "ok"
        step["elapsed_ms"] = int((time.perf_counter() - float(step.pop("started"))) * 1000)
        step["response"] = {"content": _clip(content), "tool_calls": calls}
        step["usage"] = usage
        self.recorder.add(step)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> Any:
        key = str(run_id)
        step = self._pending.pop(key, None)
        if step is None:
            self.recorder.add(
                {
                    "kind": "llm",
                    "name": _span.get(),
                    "status": "error",
                    "model": None,
                    "elapsed_ms": None,
                    "request": None,
                    "response": None,
                    "usage": None,
                    "error": str(error),
                }
            )
            return
        step["status"] = "error"
        step["error"] = str(error)
        step["elapsed_ms"] = int((time.perf_counter() - float(step.pop("started"))) * 1000)
        self.recorder.add(step)

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        key = str(run_id)
        if key in self._seen or key in self._pending:
            return
        self._seen.add(key)
        name = str(serialized.get("name") or kwargs.get("name") or "tool")
        self._pending[key] = {
            "kind": "tool",
            "name": name,
            "status": "running",
            "started": time.perf_counter(),
            "arguments": _clip_value(inputs if inputs is not None else {"input": input_str}),
            "result": None,
            "error": None,
        }

    def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> Any:
        key = str(run_id)
        step = self._pending.pop(key, None)
        if step is None:
            return
        if hasattr(output, "content"):
            text = _content_text(getattr(output, "content", ""))
        else:
            text = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False, default=str)
        step["status"] = "ok"
        step["elapsed_ms"] = int((time.perf_counter() - float(step.pop("started"))) * 1000)
        step["result"] = _clip(text)
        self.recorder.add(step)

    def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> Any:
        key = str(run_id)
        step = self._pending.pop(key, None)
        if step is None:
            return
        step["status"] = "error"
        step["error"] = str(error)
        step["elapsed_ms"] = int((time.perf_counter() - float(step.pop("started"))) * 1000)
        self.recorder.add(step)


def kind_count(kind: str) -> int:
    recorder = _recorder.get()
    if recorder is None:
        return 0
    return recorder.count_kind(kind)


def active_callbacks() -> list[TraceHandler]:
    recorder = _recorder.get()
    if recorder is None:
        return []
    handler = getattr(recorder, "handler", None)
    return [handler] if isinstance(handler, TraceHandler) else []


def runnable_config(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """把当前追踪回调并进 LangGraph / Agent 的 config，以便记下工具事件。"""
    config = dict(extra or {})
    callbacks = [*list(config.get("callbacks") or []), *active_callbacks()]
    if callbacks:
        config["callbacks"] = callbacks
    return config


@contextmanager
def span(name: str) -> Iterator[None]:
    token = _span.set(name)
    try:
        yield
    finally:
        _span.reset(token)


def note(kind: str, *, name: str, status: str = "ok", **fields: Any) -> None:
    """记一条非回调步骤（路由结论、筛选结果、离线回落）。不在追踪里时无操作。"""
    recorder = _recorder.get()
    if recorder is None:
        return
    step: dict[str, Any] = {"kind": kind, "name": name, "status": status}
    step.update(fields)
    recorder.add(step)


@contextmanager
def tracing(message: str) -> Iterator[TraceRecorder]:
    recorder = TraceRecorder(message)
    recorder.handler = TraceHandler(recorder)
    token = _recorder.set(recorder)
    try:
        yield recorder
    finally:
        _recorder.reset(token)
