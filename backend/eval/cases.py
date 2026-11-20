"""评测用例：读取、校验、规则断言。

规则断言是**必跑**的硬门槛（工具用没用、回复里有没有关键事实），不依赖模型；
LLM 评分（``judge.py``）是可选的补充，只回答「好不好」。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_CASES = Path(__file__).with_name("cases") / "smoke.json"

#: 列表型字段：写成字符串视为单元素列表（手写用例时少一层括号）。
#: ``runner`` 的 ``--dry-run`` 也读它来打印规则摘要，新增规则字段只改这一处。
RULE_FIELDS = ("expect_tools", "forbid_tools", "expect_substring", "forbid_substring")


class CaseError(ValueError):
    """用例文件不合法。"""


def _as_list(raw: Any, field: str, case_id: str) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raise CaseError(f"用例 {case_id}: {field} 必须是字符串数组")
    items: list[str] = []
    for item in raw:
        text = str(item or "").strip()
        if text:
            items.append(text)
    return items


def normalize_case(raw: Any, index: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise CaseError(f"第 {index + 1} 条用例必须是对象")
    case_id = str(raw.get("id") or "").strip()
    if not case_id:
        raise CaseError(f"第 {index + 1} 条用例缺少 id")
    message = str(raw.get("message") or "").strip()
    if not message:
        raise CaseError(f"用例 {case_id}: 缺少 message")
    case: dict[str, Any] = {
        "id": case_id,
        "message": message,
        "rubric": str(raw.get("rubric") or "").strip(),
    }
    for field in RULE_FIELDS:
        case[field] = _as_list(raw.get(field), field, case_id)
    return case


def load_cases(path: Path | str) -> tuple[str, list[dict[str, Any]]]:
    """读用例文件。支持 ``{"suite": ..., "cases": [...]}`` 或裸数组。"""
    target = Path(path)
    if not target.is_file():
        raise CaseError(f"用例文件不存在: {target}")
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CaseError(f"用例文件不是合法 JSON: {exc}") from exc
    if isinstance(data, list):
        suite = target.stem
        rows = data
    elif isinstance(data, dict):
        suite = str(data.get("suite") or target.stem).strip() or target.stem
        rows = data.get("cases")
    else:
        raise CaseError("用例文件顶层必须是对象或数组")
    if not isinstance(rows, list) or not rows:
        raise CaseError("cases 不能为空")
    cases = [normalize_case(row, index) for index, row in enumerate(rows)]
    seen: set[str] = set()
    for case in cases:
        if case["id"] in seen:
            raise CaseError(f"用例 id 重复: {case['id']}")
        seen.add(case["id"])
    return suite, cases


def _tool_names(tool_trace: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for item in tool_trace or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("tool_name") or item.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def _check(name: str, ok: bool, detail: str = "") -> dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": detail}


def _detail(prefix: str, items: list[str]) -> str:
    """失败明细：``未调用: a, b``；没有 items 就返回空串（``_check`` 用它表示「通过」）。"""
    return f"{prefix}: {', '.join(items)}" if items else ""


def check_rules(case: dict[str, Any], result: dict[str, Any]) -> list[dict[str, Any]]:
    """返回逐条断言结果；调用方把所有 ``ok`` 取与即为是否通过。

    只做「可机器判定」的事：工具是否被调用、回复里是否出现关键/禁用的片段。
    语义正确性交给 judge，避免规则层写成一堆正则黑魔法。
    """
    reply = str(result.get("reply") or "")
    names = _tool_names(result.get("tool_trace") or [])
    checks: list[dict[str, Any]] = [
        _check("reply_non_empty", bool(reply.strip()), "" if reply.strip() else "回复为空"),
    ]
    expected = case.get("expect_tools") or []
    if expected:
        missing = [name for name in expected if name not in names]
        checks.append(_check("expect_tools", not missing, _detail("未调用", missing)))
    forbidden = case.get("forbid_tools") or []
    if forbidden:
        hit = [name for name in forbidden if name in names]
        checks.append(_check("forbid_tools", not hit, _detail("不该调用", hit)))
    wanted = case.get("expect_substring") or []
    if wanted:
        missing = [frag for frag in wanted if frag not in reply]
        checks.append(_check("expect_substring", not missing, _detail("回复缺少", missing)))
    banned = case.get("forbid_substring") or []
    if banned:
        hit = [frag for frag in banned if frag in reply]
        checks.append(_check("forbid_substring", not hit, _detail("回复出现禁用片段", hit)))
    return checks
