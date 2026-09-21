"""追踪记录：回调、span 树、调用参数与用量。不负责落库。"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Callable, Iterator
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage

_recorder: ContextVar[TraceRecorder | None] = ContextVar("chatvein_trace", default=None)

_MAX_TEXT = 80_000
_PARAM_KEYS = (
    "temperature",
    "max_tokens",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
    "n",
    "stop",
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clip(text: str) -> str:
    if len(text) <= _MAX_TEXT:
        return text
    return text[:_MAX_TEXT] + "\n…(截断)"


def _clip_value(value: Any) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, default=str)
    except TypeError:
        return _clip(str(value))
    if len(encoded) <= _MAX_TEXT:
        return value
    return _clip(encoded)


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
    dumped: dict[str, Any] = {
        "role": str(getattr(msg, "type", None) or "unknown"),
        "content": _clip(_content_text(getattr(msg, "content", ""))),
    }
    calls = _tool_calls(getattr(msg, "tool_calls", None))
    if calls:
        dumped["tool_calls"] = calls
    name = getattr(msg, "name", None)
    if name:
        dumped["name"] = str(name)
    return dumped


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _usage_dict(
    *,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    cached_tokens: int = 0,
    reasoning_tokens: int = 0,
) -> dict[str, int] | None:
    total = total_tokens or (input_tokens + output_tokens)
    if not (input_tokens or output_tokens or total or cached_tokens or reasoning_tokens):
        return None
    usage = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total,
    }
    if cached_tokens:
        usage["cached_tokens"] = cached_tokens
    if reasoning_tokens:
        usage["reasoning_tokens"] = reasoning_tokens
    return usage


def _usage_from_message(msg: Any) -> dict[str, int] | None:
    meta = getattr(msg, "usage_metadata", None)
    if isinstance(meta, dict) and meta:
        details_in = meta.get("input_token_details") or {}
        details_out = meta.get("output_token_details") or {}
        if not isinstance(details_in, dict):
            details_in = {}
        if not isinstance(details_out, dict):
            details_out = {}
        usage = _usage_dict(
            input_tokens=_int(meta.get("input_tokens")),
            output_tokens=_int(meta.get("output_tokens")),
            total_tokens=_int(meta.get("total_tokens")),
            cached_tokens=_int(details_in.get("cache_read") or details_in.get("cached_tokens")),
            reasoning_tokens=_int(details_out.get("reasoning") or details_out.get("reasoning_tokens")),
        )
        if usage:
            return usage
    resp = getattr(msg, "response_metadata", None) or {}
    if isinstance(resp, dict):
        return _usage_from_token_usage(resp.get("token_usage") or resp.get("usage"))
    return None


def _usage_from_token_usage(token_usage: Any) -> dict[str, int] | None:
    if not isinstance(token_usage, dict) or not token_usage:
        return None
    prompt_details = token_usage.get("prompt_tokens_details") or {}
    completion_details = token_usage.get("completion_tokens_details") or {}
    if not isinstance(prompt_details, dict):
        prompt_details = {}
    if not isinstance(completion_details, dict):
        completion_details = {}
    return _usage_dict(
        input_tokens=_int(token_usage.get("prompt_tokens") or token_usage.get("input_tokens")),
        output_tokens=_int(
            token_usage.get("completion_tokens") or token_usage.get("output_tokens")
        ),
        total_tokens=_int(token_usage.get("total_tokens")),
        cached_tokens=_int(prompt_details.get("cached_tokens")),
        reasoning_tokens=_int(completion_details.get("reasoning_tokens")),
    )


def _usage_from_llm_output(llm_output: Any) -> dict[str, int] | None:
    if not isinstance(llm_output, dict):
        return None
    return _usage_from_token_usage(llm_output.get("token_usage") or llm_output.get("usage"))


def _bound_tools(raw: Any) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return tools
    for tool in raw:
        if not isinstance(tool, dict):
            name = str(getattr(tool, "name", "") or "")
            if name:
                tools.append({"name": name})
            continue
        function = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        if not isinstance(function, dict):
            continue
        name = str(function.get("name") or "")
        if not name:
            continue
        item: dict[str, Any] = {"name": name}
        description = str(function.get("description") or "")
        if description:
            item["description"] = description[:500]
        if function.get("parameters") is not None:
            item["parameters"] = function.get("parameters")
        tools.append(item)
    return tools


def _invocation(params: dict[str, Any], serialized: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in _PARAM_KEYS:
        if params.get(key) is not None:
            out[key] = params.get(key)
    response_format = params.get("response_format")
    if isinstance(response_format, dict):
        out["response_format"] = str(response_format.get("type") or "json")
    elif response_format is not None:
        out["response_format"] = type(response_format).__name__
    tools = _bound_tools(params.get("tools"))
    if tools:
        out["tools"] = _clip_value(tools)
    kwargs = serialized.get("kwargs") if isinstance(serialized.get("kwargs"), dict) else {}
    if isinstance(kwargs, dict) and kwargs.get("max_retries") is not None:
        out["max_retries"] = kwargs.get("max_retries")
    return out


def _error_info(error: BaseException) -> dict[str, Any]:
    info: dict[str, Any] = {"message": str(error)}
    status = getattr(error, "status_code", None)
    response = getattr(error, "response", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    if status is not None:
        info["status_code"] = _int(status)
    request_id = getattr(error, "request_id", None)
    body = getattr(error, "body", None)
    if request_id is None and isinstance(body, dict):
        request_id = body.get("request_id")
    headers = getattr(response, "headers", None) if response is not None else None
    if request_id is None and headers is not None:
        getter = getattr(headers, "get", None)
        if callable(getter):
            request_id = getter("x-request-id") or getter("x-openai-request-id")
    if request_id:
        info["request_id"] = str(request_id)
    return info


def _path(difficulty: str) -> list[dict[str, Any]]:
    level = difficulty if difficulty in ("simple", "medium", "hard") else "simple"
    branched = level in ("medium", "hard")
    is_hard = level == "hard"
    react = "ReAct · 复杂" if is_hard else "ReAct"
    return [
        {"id": "understand", "label": "理解", "taken": True},
        {"id": "route", "label": "路由", "taken": True},
        {"id": "simple", "label": "直答", "taken": level == "simple"},
        {"id": "plan", "label": "规划", "taken": is_hard},
        {"id": "select_tools", "label": "筛选工具", "taken": branched},
        {"id": "react", "label": react, "taken": branched},
        {"id": "verify", "label": "核对", "taken": is_hard},
    ]


class TraceRecorder:
    """一轮里的 span 树。``on_change`` 在每次步骤变化时拿到当前快照。"""

    def __init__(
        self,
        message: str,
        *,
        meta: dict[str, Any] | None = None,
        on_change: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.input = message
        self.started = time.perf_counter()
        self.started_at = _iso_now()
        self.finished_at = self.started_at
        self.status = "running"
        self.meta = dict(meta or {})
        self.on_change = on_change
        self.difficulty = ""
        self.rewritten = message
        self.route_reason = ""
        self.selected_tools: list[str] = []
        self.candidate_tools: list[str] = []
        self.tool_plan_reason = ""
        self.reply = ""
        self.steps: list[dict[str, Any]] = []
        self._seq = 0
        self._parents: list[str] = []
        self._run_steps: dict[str, str] = {}
        self.handler: TraceHandler | None = None

    def current_parent(self) -> str | None:
        return self._parents[-1] if self._parents else None

    def parent_for(self, parent_run_id: UUID | None) -> str | None:
        if parent_run_id is not None:
            found = self._run_steps.get(str(parent_run_id))
            if found:
                return found
        return self.current_parent()

    def bind_run(self, run_id: UUID, step_id: str) -> None:
        self._run_steps[str(run_id)] = step_id

    def add(self, step: dict[str, Any]) -> dict[str, Any]:
        self._seq += 1
        step.setdefault("id", str(self._seq))
        step.setdefault("parent_id", self.current_parent())
        step.setdefault("start_ms", self._offset_ms())
        self._absorb(step)
        self.steps.append(step)
        self.flush()
        return step

    def _absorb(self, step: dict[str, Any]) -> None:
        """路由和工具筛选的结论提前写到本轮上，进行中的快照就能画出路径。"""
        detail = step.get("detail") if isinstance(step.get("detail"), dict) else {}
        if step.get("kind") == "route":
            difficulty = str(detail.get("difficulty") or "")
            if difficulty:
                self.difficulty = difficulty
            if detail.get("reason"):
                self.route_reason = str(detail.get("reason"))
            if detail.get("rewritten"):
                self.rewritten = str(detail.get("rewritten"))
        elif step.get("kind") == "tools":
            if isinstance(detail.get("selected_tools"), list):
                self.selected_tools = [str(name) for name in detail["selected_tools"]]
            if isinstance(detail.get("candidate_tools"), list):
                self.candidate_tools = [str(name) for name in detail["candidate_tools"]]
            if detail.get("reason"):
                self.tool_plan_reason = str(detail.get("reason"))

    def open_span(self, name: str) -> dict[str, Any]:
        step = self.add(
            {
                "kind": "span",
                "name": name,
                "status": "running",
                "parent_id": self.current_parent(),
            }
        )
        self._parents.append(str(step["id"]))
        return step

    def close_span(self, step_id: str, *, status: str = "ok") -> None:
        if self._parents and self._parents[-1] == step_id:
            self._parents.pop()
        for step in self.steps:
            if step.get("id") != step_id:
                continue
            step["status"] = status
            step["elapsed_ms"] = max(0, self._offset_ms() - _int(step.get("start_ms")))
            break
        self.flush()

    def tools_since(self, mark: int) -> int:
        return sum(1 for step in self.steps[mark:] if step.get("kind") == "tool")

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

    def finish(self) -> dict[str, Any]:
        self.status = "done"
        return self.flush()

    def snapshot(self) -> dict[str, Any]:
        self.finished_at = _iso_now()
        elapsed_ms = self._offset_ms()
        input_tokens = 0
        output_tokens = 0
        cached_tokens = 0
        reasoning_tokens = 0
        llm_calls = 0
        tool_calls = 0
        llm_ms = 0
        tool_ms = 0
        window = _int(self.meta.get("context_window"))
        for step in self.steps:
            kind = step.get("kind")
            if kind == "llm" and step.get("status") != "offline":
                llm_calls += 1
                llm_ms += _int(step.get("elapsed_ms"))
                usage = step.get("usage") or {}
                if isinstance(usage, dict):
                    input_tokens += _int(usage.get("input_tokens"))
                    output_tokens += _int(usage.get("output_tokens"))
                    cached_tokens += _int(usage.get("cached_tokens"))
                    reasoning_tokens += _int(usage.get("reasoning_tokens"))
                    if window and usage.get("input_tokens") is not None:
                        usage["context_pct"] = round(_int(usage.get("input_tokens")) / window * 100, 1)
            elif kind == "tool":
                tool_calls += 1
                tool_ms += _int(step.get("elapsed_ms"))
        totals: dict[str, int | float] = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "llm_calls": llm_calls,
            "tool_calls": tool_calls,
            "llm_ms": llm_ms,
            "tool_ms": tool_ms,
        }
        if cached_tokens:
            totals["cached_tokens"] = cached_tokens
        if reasoning_tokens:
            totals["reasoning_tokens"] = reasoning_tokens
        return {
            "status": self.status,
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
            "role_id": self.meta.get("role_id"),
            "role_name": self.meta.get("role_name"),
            "model_config_id": self.meta.get("model_config_id"),
            "model_name": self.meta.get("model_name"),
            "config_name": self.meta.get("config_name"),
            "context_window": window or None,
            "path": _path(self.difficulty),
            "steps": self.steps,
            "totals": totals,
        }

    def flush(self) -> dict[str, Any]:
        payload = self.snapshot()
        if self.on_change is not None:
            try:
                self.on_change(payload)
            except Exception:
                return payload
        return payload

    def _offset_ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)


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
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> Any:
        key = str(run_id)
        if key in self._seen:
            return
        self._seen.add(key)
        params = kwargs.get("invocation_params") or {}
        if not isinstance(params, dict):
            params = {}
        model = str(params.get("model") or params.get("model_name") or "")
        batch = messages[0] if messages else []
        span_name = self._span_name()
        same = sum(
            1
            for step in self.recorder.steps
            if step.get("kind") == "llm"
            and str(step.get("name") or "").split("#", 1)[0] == span_name
        )
        name = span_name if same == 0 else f"{span_name}#{same + 1}"
        self._pending[key] = {
            "kind": "llm",
            "name": name,
            "status": "running",
            "model": model or None,
            "parent_id": self.recorder.parent_for(parent_run_id),
            "start_ms": self.recorder._offset_ms(),
            "started": time.perf_counter(),
            "invocation": _invocation(params, serialized),
            "request": {"messages": [_dump_message(msg) for msg in batch]},
            "response": None,
            "usage": None,
            "error": None,
            "error_detail": None,
        }

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> Any:
        step = self._take(run_id)
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
        saved = self.recorder.add(step)
        self.recorder.bind_run(run_id, str(saved["id"]))

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> Any:
        detail = _error_info(error)
        step = self._take(run_id)
        if step is None:
            self.recorder.add(
                {
                    "kind": "llm",
                    "name": self._span_name(),
                    "status": "error",
                    "model": None,
                    "elapsed_ms": None,
                    "request": None,
                    "response": None,
                    "usage": None,
                    "error": detail["message"],
                    "error_detail": detail,
                }
            )
            return
        step["status"] = "error"
        step["error"] = detail["message"]
        step["error_detail"] = detail
        step["elapsed_ms"] = int((time.perf_counter() - float(step.pop("started", time.perf_counter()))) * 1000)
        self.recorder.add(step)

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        key = str(run_id)
        if key in self._seen:
            return
        self._seen.add(key)
        name = str(serialized.get("name") or kwargs.get("name") or "tool")
        self._pending[key] = {
            "kind": "tool",
            "name": name,
            "status": "running",
            "parent_id": self.recorder.parent_for(parent_run_id),
            "start_ms": self.recorder._offset_ms(),
            "started": time.perf_counter(),
            "arguments": _clip_value(inputs if inputs is not None else {"input": input_str}),
            "result": None,
            "error": None,
            "error_detail": None,
        }

    def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> Any:
        step = self._take(run_id)
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
        step = self._take(run_id)
        if step is None:
            return
        detail = _error_info(error)
        step["status"] = "error"
        step["error"] = detail["message"]
        step["error_detail"] = detail
        step["elapsed_ms"] = int((time.perf_counter() - float(step.pop("started", time.perf_counter()))) * 1000)
        self.recorder.add(step)

    def _take(self, run_id: UUID) -> dict[str, Any] | None:
        return self._pending.pop(str(run_id), None)

    def _span_name(self) -> str:
        parent = self.recorder.current_parent()
        if parent is None:
            return "llm"
        for step in reversed(self.recorder.steps):
            if step.get("id") == parent and step.get("kind") == "span":
                return str(step.get("name") or "llm")
        return "llm"


def active_callbacks() -> list[TraceHandler]:
    recorder = _recorder.get()
    if recorder is None or recorder.handler is None:
        return []
    return [recorder.handler]


def runnable_config(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """把当前追踪回调并进 LangGraph / Agent 的 config。"""
    config = dict(extra or {})
    callbacks = [*list(config.get("callbacks") or []), *active_callbacks()]
    if callbacks:
        config["callbacks"] = callbacks
    return config


def note(kind: str, *, name: str, status: str = "ok", **fields: Any) -> None:
    """记一条非回调步骤。没有进行中的追踪时无操作。"""
    recorder = _recorder.get()
    if recorder is None:
        return
    step: dict[str, Any] = {"kind": kind, "name": name, "status": status}
    step.update(fields)
    recorder.add(step)


def trace_checkpoint() -> int:
    recorder = _recorder.get()
    if recorder is None:
        return -1
    return len(recorder.steps)


def record_tools_if_absent(mark: int, items: list[dict[str, Any]]) -> None:
    """回调没记下工具时，用消息里抽出的轨迹补上。"""
    recorder = _recorder.get()
    if recorder is None or mark < 0 or recorder.tools_since(mark):
        return
    for item in items:
        note(
            "tool",
            name=str(item.get("tool_name") or "unknown"),
            status=str(item.get("status") or "ok"),
            arguments=item.get("arguments"),
            result=str(item.get("result_text") or ""),
        )


def complete(
    *,
    difficulty: str,
    rewritten: str,
    route_reason: str,
    selected_tools: list[str],
    candidate_tools: list[str],
    tool_plan_reason: str,
    reply: str,
) -> dict[str, Any] | None:
    """写上本轮结论并结束追踪。没有进行中的追踪时返回 ``None``。"""
    recorder = _recorder.get()
    if recorder is None:
        return None
    recorder.apply_outcome(
        difficulty=difficulty,
        rewritten=rewritten,
        route_reason=route_reason,
        selected_tools=selected_tools,
        candidate_tools=candidate_tools,
        tool_plan_reason=tool_plan_reason,
        reply=reply,
    )
    return recorder.finish()


@contextmanager
def span(name: str) -> Iterator[None]:
    recorder = _recorder.get()
    if recorder is None:
        yield
        return
    step = recorder.open_span(name)
    try:
        yield
    except Exception:
        recorder.close_span(str(step["id"]), status="error")
        raise
    else:
        recorder.close_span(str(step["id"]), status="ok")


@contextmanager
def tracing(
    message: str,
    *,
    meta: dict[str, Any] | None = None,
    on_change: Callable[[dict[str, Any]], None] | None = None,
) -> Iterator[TraceRecorder]:
    """开始一轮追踪。已经在追踪中时复用当前记录，避免嵌套各写一份。"""
    current = _recorder.get()
    if current is not None:
        if meta:
            current.meta.update({key: value for key, value in meta.items() if value is not None})
        if on_change is not None and current.on_change is None:
            current.on_change = on_change
        yield current
        return
    recorder = TraceRecorder(message, meta=meta, on_change=on_change)
    recorder.handler = TraceHandler(recorder)
    token = _recorder.set(recorder)
    try:
        recorder.flush()
        yield recorder
    except Exception:
        if recorder.status == "running":
            recorder.status = "error"
        raise
    finally:
        if recorder.status == "running":
            recorder.status = "done"
        recorder.flush()
        _recorder.reset(token)
