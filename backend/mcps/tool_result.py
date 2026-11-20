"""工具调用的结构化结果。

工具失败原来只有一行 ``f"[{name}] 失败: {exc}"`` 字符串，上层只能靠字符串匹配
猜失败原因（见 ``graphs/common.py::_failed_tool_names``）。这里把「成功/失败、
错误类别、是否可重试、耗时」变成字段，字符串仍保留在 :attr:`ToolResult.content`
里，保证对 LangChain ``ToolMessage`` 与旧展示逻辑完全透明。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from errors import (  # pyright: ignore[reportImplicitRelativeImport]
    MCP_SERVER_DOWN,
    TOOL_CIRCUIT_OPEN,
    TOOL_DENIED,
    TOOL_FAILED,
    TOOL_OK,
    TOOL_SKIPPED,
    TOOL_TIMEOUT,
    TOOL_TRANSIENT_EXHAUSTED,
)

#: 码表定义在 ``errors.py``（REST / SSE / trace 共用一份）；这里 re-export 是为了
#: 保持 ``from mcps.tool_result import TOOL_DENIED`` 的旧导入路径不失效。
__all__ = [
    "ERROR_KINDS",
    "MCP_SERVER_DOWN",
    "TOOL_CIRCUIT_OPEN",
    "TOOL_DENIED",
    "TOOL_FAILED",
    "TOOL_OK",
    "TOOL_SKIPPED",
    "TOOL_TIMEOUT",
    "TOOL_TRANSIENT_EXHAUSTED",
    "ToolResult",
]

#: 错误类别：决定是否重试、如何给人话提示。
ERROR_KINDS = ("transient", "deterministic", "denied", "cancelled")


@dataclass
class ToolResult:
    """一次工具调用的结果（可序列化，便于写追踪 / 前端展示 code）。"""

    ok: bool
    content: str
    code: str = TOOL_OK
    retryable: bool = False
    duration_ms: int = 0
    error_kind: str | None = None
    tool: str = ""
    attempts: int = 1
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = {
            "ok": self.ok,
            "code": self.code,
            "retryable": self.retryable,
            "duration_ms": self.duration_ms,
            "attempts": self.attempts,
            "tool": self.tool,
        }
        if self.error_kind:
            data["error_kind"] = self.error_kind
        if self.extra:
            data["extra"] = dict(self.extra)
        return data

    @property
    def failed(self) -> bool:
        return not self.ok
