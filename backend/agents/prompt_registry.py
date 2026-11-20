"""提示词注册表（batch4 · 4.4）：给每处提示词一个稳定版本号。

为什么读源码 AST 而不 import：注册表要在 ``eval --dry-run`` 和 CI 里跑，那些环境
可能没装 OpenTelemetry / 向量模型 / 外部 MCP，一旦 import 就整条链路炸；AST 只读文件。

版本 = 参与该提示词的原文常量 sha256 前 8 位。改一个字版本就变，于是「同样的输入
这次答得不一样」可以先排除提示词漂移，再去看模型 / 采样 / 工具。

登记新提示词：在 ``PROMPTS`` 里加一条 ``PromptSpec``，``sources`` 写清「哪个文件的
哪几个常量拼出了这段提示词」。**不要**登记整个文件（无关常量一改版本就乱跳）。
"""

from __future__ import annotations

import ast
import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

#: 注册表口径版本：形状变了（比如从 dict 改成 list）才动。
PROMPT_SCHEMA_VERSION = 1

_ROOT = Path(__file__).resolve().parents[1]
_PROMPTS = "agents/graphs/prompts.py"


def _in_prompts(*symbols: str) -> tuple[tuple[str, str], ...]:
    """``prompts.py`` 里的若干常量。宪法由 Identity/Workspace/Tooling/Stopping/Response 拼成。"""
    return tuple((_PROMPTS, symbol) for symbol in symbols)


#: 组装顺序见 ``agents/graphs/prompts.py::build_agent_system``。
_FRAMEWORK = _in_prompts("_IDENTITY", "_WORKSPACE", "_TOOLING", "_STOPPING", "_RESPONSE")


@dataclass(frozen=True)
class PromptSpec:
    """一条提示词：``id`` 给人看 / 给报告用，``sources`` 决定它的版本。"""

    id: str
    sources: tuple[tuple[str, str], ...]


#: 全部提示词出处。新增子图 / 新工具提示词时在这里追加一条。
PROMPTS: tuple[PromptSpec, ...] = (
    PromptSpec("prompt.framework", _FRAMEWORK),
    PromptSpec("agent.medium", _FRAMEWORK + _in_prompts("_TIER_MEDIUM")),
    PromptSpec("agent.hard", _FRAMEWORK + _in_prompts("_TIER_HARD")),
    PromptSpec("route.understand", (("agents/router.py", "_SYSTEM"),)),
    PromptSpec("tools.select", (("agents/tool_selector.py", "_SYSTEM"),)),
    PromptSpec("team.aggregate", (("agents/orchestration.py", "_AGG_SYSTEM"),)),
    PromptSpec("eval.judge", (("eval/judge.py", "_SYSTEM"),)),
)


@lru_cache(maxsize=None)
def _string_constants(relative_path: str) -> dict[str, str]:
    """模块顶层的「名字 → 字符串常量」。缓存住：一次进程里只解析一次。"""
    source = (_ROOT / relative_path).read_text(encoding="utf-8")
    found: dict[str, str] = {}
    for node in ast.parse(source).body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name) or not isinstance(node.value, ast.Constant):
            continue
        if isinstance(node.value.value, str):
            found[target.id] = node.value.value
    return found


def _version(spec: PromptSpec) -> str:
    blob = "\n".join(
        _string_constants(path).get(symbol, f"<missing:{path}:{symbol}>")
        for path, symbol in spec.sources
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:8]


def prompt_versions() -> dict[str, str]:
    """``{id: 8 位版本}``。写进 trace payload 与 eval 报告，两处能对着比。"""
    return {spec.id: _version(spec) for spec in PROMPTS}


def verify(*, require_unique: bool = True) -> list[str]:
    """自检：源文件/常量是否还在、id 是否唯一、版本是否为空。

    返回人话错误列表（空表示通过）。``--dry-run`` 与 CI 用它拦住「改了常量名忘了
    改注册表」这种静默失配。
    """
    problems: list[str] = []
    unknown = sorted({path for spec in PROMPTS for path, _ in spec.sources
                      if not (_ROOT / path).is_file()})
    problems.extend(f"源文件不存在：{path}" for path in unknown)
    if require_unique:
        ids = [spec.id for spec in PROMPTS]
        problems.extend(
            f"提示词 id 重复：{item}" for item in sorted({i for i in ids if ids.count(i) > 1})
        )
    for spec in PROMPTS:
        if any(path in unknown for path, _ in spec.sources):
            continue
        missing = [
            f"{path}::{symbol}"
            for path, symbol in spec.sources
            if not _string_constants(path).get(symbol, "").strip()
        ]
        if missing:
            problems.append(f"{spec.id} 的原文常量缺失或为空：{'、'.join(missing)}")
    return problems


def report(specs: Iterable[PromptSpec] | None = None) -> dict[str, object]:
    """给 trace / 报告的完整视图（含出处），不只是版本号。"""
    return {
        "schema_version": PROMPT_SCHEMA_VERSION,
        "prompts": {
            spec.id: {
                "version": _version(spec),
                "sources": [f"{path}::{symbol}" for path, symbol in spec.sources],
            }
            for spec in (specs or PROMPTS)
        },
    }
