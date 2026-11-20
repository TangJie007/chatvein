"""批次 3 §3.3：离线评测（用例 / 规则断言 / 可选评分 / 报告）+ 追踪指标 + OTel 桥。"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import eval.judge as judge_mod
import eval.runner as runner_mod
import main as main_module
from conversations.service import ConversationsService
from eval.cases import CaseError, check_rules, load_cases
from eval.judge import JudgeScores, judge_case
from mcps.sandbox import session_db_path
from trace import otel
from trace.metrics import compute_metrics, count_tool_failures, merge_tool_stats
from trace.store import iter_turn_payloads, save_turn_trace


def _now() -> datetime:
    return datetime(2026, 11, 20, 12, 0, 0, tzinfo=timezone.utc)


def _summary(
    turn_id: str,
    *,
    status: str = "done",
    difficulty: str = "simple",
    tokens: int = 100,
    elapsed: int = 1000,
    days_ago: int = 0,
    tools: int = 1,
) -> dict[str, Any]:
    created = (_now() - timedelta(days=days_ago)).replace(microsecond=0).isoformat()
    return {
        "turn_id": turn_id,
        "created_at": created,
        "status": status,
        "input": "hi",
        "difficulty": difficulty,
        "elapsed_ms": elapsed,
        "totals": {"total_tokens": tokens, "llm_calls": 1, "tool_calls": tools},
    }


# --------------------------------------------------------------------------- #
# 用例文件
# --------------------------------------------------------------------------- #


def _write_cases(tmp_path: Path, payload: Any) -> Path:
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_load_cases_normalizes_and_defaults(tmp_path: Path) -> None:
    path = _write_cases(
        tmp_path,
        {
            "suite": "demo",
            "cases": [
                {"id": "a", "message": "hello", "expect_tools": "calculator", "rubric": "短"},
            ],
        },
    )
    suite, cases = load_cases(path)
    assert suite == "demo"
    assert cases[0]["expect_tools"] == ["calculator"]
    assert cases[0]["forbid_substring"] == []
    assert cases[0]["rubric"] == "短"


def test_load_cases_rejects_bad_input(tmp_path: Path) -> None:
    with pytest.raises(CaseError, match="message"):
        load_cases(_write_cases(tmp_path, {"cases": [{"id": "a"}]}))
    with pytest.raises(CaseError, match="重复"):
        load_cases(
            _write_cases(
                tmp_path,
                {"cases": [{"id": "a", "message": "x"}, {"id": "a", "message": "y"}]},
            )
        )
    with pytest.raises(CaseError, match="不存在"):
        load_cases(tmp_path / "missing.json")


def test_load_cases_accepts_bare_array(tmp_path: Path) -> None:
    path = _write_cases(tmp_path, [{"id": "one", "message": "hi"}])
    suite, cases = load_cases(path)
    assert suite == path.stem
    assert cases[0]["id"] == "one"


# --------------------------------------------------------------------------- #
# 规则断言
# --------------------------------------------------------------------------- #


def test_check_rules_pass_and_fail_details() -> None:
    result = {
        "reply": "现在是 12:30，404 表示资源不存在。",
        "tool_trace": [{"tool_name": "get_current_time", "status": "ok"}],
    }
    case = {
        "id": "c",
        "expect_tools": ["get_current_time"],
        "forbid_tools": ["calculator"],
        "expect_substring": ["404"],
        "forbid_substring": ["无法回答"],
    }
    checks = check_rules(case, result)
    assert all(item["ok"] for item in checks)

    bad = check_rules(
        {**case, "expect_tools": ["calculator"], "forbid_substring": ["资源不存在"]},
        result,
    )
    details = {item["name"]: item for item in bad}
    assert details["expect_tools"]["ok"] is False
    assert "calculator" in details["expect_tools"]["detail"]
    assert details["forbid_substring"]["ok"] is False


def test_check_rules_empty_reply_fails() -> None:
    checks = check_rules({"id": "c"}, {"reply": "  ", "tool_trace": []})
    assert [item for item in checks if item["name"] == "reply_non_empty"][0]["ok"] is False


# --------------------------------------------------------------------------- #
# runner：判定、报告
# --------------------------------------------------------------------------- #


def test_run_one_passes_without_judge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        runner_mod,
        "run_case",
        lambda case, role=None: {
            "reply": "404 是资源不存在",
            "difficulty": "simple",
            "tool_trace": [{"tool_name": "calculator", "status": "ok"}],
            "selected_tools": ["calculator"],
        },
    )
    record = runner_mod.run_one(
        {"id": "c", "expect_substring": ["404"], "forbid_tools": []}, role=None
    )
    assert record["status"] == "pass"
    assert record["judge"] is None
    assert record["tools"] == [{"name": "calculator", "status": "ok"}]


def test_run_one_marks_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(case: dict[str, Any], role: dict[str, Any] | None = None) -> dict[str, Any]:
        raise RuntimeError("模型没配")

    monkeypatch.setattr(runner_mod, "run_case", boom)
    record = runner_mod.run_one({"id": "c"}, role=None)
    assert record["status"] == "error"
    assert "模型没配" in record["error"]


def test_run_one_judge_below_threshold_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        runner_mod,
        "run_case",
        lambda case, role=None: {"reply": "答", "tool_trace": []},
    )
    monkeypatch.setattr(runner_mod, "judge_case", lambda case, result, model: {"score": 2.0})
    record = runner_mod.run_one({"id": "c"}, role=None, judge_model=object(), threshold=3.5)
    assert record["status"] == "fail"
    assert record["judge"]["score"] == 2.0


def test_build_report_totals_and_judge_mean() -> None:
    results = [
        {"id": "a", "status": "pass", "judge": {"score": 4.0}},
        {"id": "b", "status": "fail", "judge": {"score": 3.0}},
        {"id": "c", "status": "error", "judge": None},
    ]
    report = runner_mod.build_report(
        suite="s",
        cases_path="x.json",
        role={"id": "r1", "name": "默认", "model_id": "m1"},
        judge_enabled=True,
        judge_model_id="m1",
        threshold=3.5,
        results=results,
        skipped=1,
        elapsed_ms=1234,
    )
    totals = report["totals"]
    assert totals["cases"] == 4
    assert totals["executed"] == 3
    assert totals["passed"] == 1 and totals["failed"] == 1 and totals["errors"] == 1
    assert totals["skipped"] == 1
    assert report["judge_mean"] == 3.5
    assert report["role"]["model_id"] == "m1"


def test_main_dry_run(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = _write_cases(tmp_path, {"cases": [{"id": "a", "message": "hi"}]})
    assert runner_mod.main(["--cases", str(path), "--dry-run"]) == 0
    assert "用例文件 OK" in capsys.readouterr().out


def test_main_rejects_bad_cases(tmp_path: Path) -> None:
    path = _write_cases(tmp_path, {"cases": []})
    assert runner_mod.main(["--cases", str(path)]) == 2


# --------------------------------------------------------------------------- #
# judge：结构化评分（用假模型，不走网络）
# --------------------------------------------------------------------------- #


class _Structured:
    def __init__(self, value: Any) -> None:
        self.value = value
        self.calls: list[Any] = []

    def invoke(self, messages: Any) -> Any:
        self.calls.append(messages)
        return self.value


class _FakeModel:
    def __init__(self, value: Any) -> None:
        self.structured = _Structured(value)
        self.schema: Any = None

    def with_structured_output(self, schema: Any, **kwargs: Any) -> _Structured:
        self.schema = schema
        return self.structured


def test_judge_case_scores_and_prompt() -> None:
    model = _FakeModel(
        JudgeScores(relevance=5, correctness=4, tool_use=3, format=5, reason="工具用对了")
    )
    out = judge_case(
        {"id": "c", "message": "算 37*19+128", "rubric": "必须 831"},
        {"reply": "831", "tool_trace": [{"tool_name": "calculator", "status": "ok"}]},
        model=model,
    )
    assert out["score"] == 4.25
    assert out["reason"] == "工具用对了"
    prompt = "\n".join(str(getattr(message, "content", "")) for message in model.structured.calls[0])
    assert "37*19+128" in prompt and "831" in prompt and "calculator" in prompt


def test_judge_unavailable_model() -> None:
    with pytest.raises(judge_mod.JudgeUnavailable):
        judge_mod.resolve_model(None)


# --------------------------------------------------------------------------- #
# 指标
# --------------------------------------------------------------------------- #


def _payload(*, tool_status: str = "ok") -> dict[str, Any]:
    return {
        "status": "done",
        "steps": [
            {"id": "s1", "kind": "llm", "name": "understand", "status": "ok"},
            {"id": "s2", "kind": "tool", "name": "calculator", "status": tool_status},
        ],
        "totals": {"total_tokens": 10},
    }


def test_count_and_merge_tool_failures() -> None:
    stats = count_tool_failures(_payload(tool_status="error"))
    assert stats["calls"] == 1 and stats["failures"] == 1
    merged = merge_tool_stats([_payload(), _payload(tool_status="denied")])
    assert merged["calls"] == 2 and merged["failures"] == 1
    assert merged["by_tool"][0]["tool"] == "calculator"


def test_compute_metrics_rates_and_p95() -> None:
    rows = [
        _summary("t1", tokens=100, elapsed=100),
        _summary("t2", tokens=300, elapsed=900),
        _summary("t3", status="error", tokens=200),
        _summary("t4", status="cancelled", days_ago=2),
        _summary("t5", status="error", days_ago=30),  # 窗口外
    ]
    out = compute_metrics(rows, days=14, now=_now())
    overall = out["overall"]
    assert overall["turns"] == 4
    assert overall["done"] == 2
    assert overall["cancelled"] == 1
    assert overall["error"] == 1
    assert overall["success_rate"] == 0.5
    assert overall["p95_tokens"] == 300
    assert len(out["by_day"]) == 15
    assert out["by_difficulty"][0]["difficulty"] == "simple"


def test_compute_metrics_alerts_need_enough_turns() -> None:
    rows = [_summary(f"t{i}", status="error") for i in range(5)]
    out = compute_metrics(rows, days=14, now=_now())
    assert [alert["code"] for alert in out["alerts"]][0] == "error_rate"
    assert out["alerts"][0]["level"] == "critical"

    few = compute_metrics(rows[:2], days=14, now=_now())
    assert few["alerts"] == []


def test_compute_metrics_tool_failure_rate() -> None:
    out = compute_metrics(
        [_summary("t1")],
        days=14,
        now=_now(),
        tool_stats={"calls": 4, "failures": 2, "by_tool": []},
    )
    assert out["overall"]["tool_failure_rate"] == 0.5
    assert out["overall"]["tool_failures"] == 2


def test_iter_turn_payloads_limits(tmp_path: Path) -> None:
    path = tmp_path / "logs" / "session.sqlite"
    for index in range(3):
        save_turn_trace(path, f"t{index}", {**_payload(), "input": str(index)})
    payloads = iter_turn_payloads(path, limit=2)
    assert len(payloads) == 2
    assert payloads[0]["input"] == "2"


def test_metrics_route() -> None:
    conversations = ConversationsService()
    conversation_id, _, _ = conversations.save_exchange(None, "hi", "hello", turn_id="t1")
    stored = conversations.get_conversation(conversation_id)
    assert stored is not None
    db_path = session_db_path(conversations.workspace_root_for(stored["workspace_dir"]))
    save_turn_trace(db_path, "t1", {**_payload(), "elapsed_ms": 30})

    client = TestClient(main_module.app)
    body = client.get(f"/api/conversations/{conversation_id}/metrics").json()
    assert body["overall"]["turns"] == 1
    # 工具失败率来自最近 N 轮 payload 的扫描，与摘要里的 totals.tool_calls 不是一个口径。
    assert body["overall"]["tool_failure_rate"] == 0.0
    assert body["schema_version"] == 1

    assert client.get("/api/conversations/missing/metrics").status_code == 404


# --------------------------------------------------------------------------- #
# OTel 桥（默认关闭；用手搓 tracer 验证映射）
# --------------------------------------------------------------------------- #


class _FakeSpan:
    def __init__(self, name: str, parent: Any, start_time: int | None) -> None:
        self.name = name
        self.parent = parent
        self.start_time = start_time
        self.attributes: dict[str, Any] = {}
        self.ended: int | None = None
        self.status: Any = None

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def set_status(self, status: Any) -> None:
        self.status = status

    def end(self, end_time: int | None = None) -> None:
        self.ended = end_time


class _FakeTracer:
    def __init__(self) -> None:
        self.spans: list[_FakeSpan] = []

    def start_span(
        self,
        name: str,
        *,
        parent: Any = None,
        context: Any = None,
        start_time: int | None = None,
    ) -> _FakeSpan:
        # 真实 SDK 只认 context（set_span_in_context 的结果），假 tracer 里 context 就是父 span
        span = _FakeSpan(name, parent if parent is not None else context, start_time)
        self.spans.append(span)
        return span


def test_otel_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATVEIN_OTEL", raising=False)
    assert otel.enabled() is False
    assert otel.export_turn(_payload()) is False


def test_otel_maps_span_tree() -> None:
    tracer = _FakeTracer()
    body = {
        **_payload(),
        "elapsed_ms": 200,
        "difficulty": "medium",
        "totals": {"total_tokens": 120, "llm_calls": 1, "tool_calls": 1},
        "steps": [
            {"id": "s1", "parent_id": None, "kind": "llm", "name": "understand", "status": "ok", "start_ms": 0, "elapsed_ms": 80},
            {"id": "s2", "parent_id": "s1", "kind": "tool", "name": "calculator", "status": "ok", "start_ms": 80, "elapsed_ms": 20, "arguments": {"expr": "1+1"}},
        ],
    }
    otel._export(tracer, body, turn_id="t1")  # noqa: SLF001 - 只测映射逻辑
    assert [span.name for span in tracer.spans] == [
        "chatvein.turn",
        "chatvein.llm.understand",
        "chatvein.tool.calculator",
    ]
    root, llm_span, tool_span = tracer.spans
    assert tool_span.parent is llm_span
    assert root.attributes["chatvein.turn.id"] == "t1"
    assert tool_span.attributes["chatvein.tool.arguments"] == '{"expr": "1+1"}'
    assert tool_span.ended is not None and tool_span.ended > (tool_span.start_time or 0)
    # 根 span 覆盖整轮：父 span 的结束时间必须晚于所有子 span（否则瀑布图倒挂）
    assert root.ended == (root.start_time or 0) + 200 * 1_000_000
    assert root.ended > max(llm_span.ended or 0, tool_span.ended or 0)
