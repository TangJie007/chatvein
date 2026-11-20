"""主模型失败时降级到备用模型（batch4 · 4.7）。

不用真网关：用一个「抛 429 / 抛 401」的假模型，验证切换条件与「整轮只切一次」。
"""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.messages import HumanMessage

from agents import llm
from agents.router import UnderstandDecision
from trace.recording import tracing


class _HttpError(Exception):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status_code = status


class _Runner:
    def __init__(self, runs: list[str], error: BaseException | None) -> None:
        self._runs = runs
        self._error = error

    def invoke(self, messages: list[Any]) -> Any:
        self._runs.append("invoke")
        if self._error is not None:
            raise self._error
        return UnderstandDecision(rewritten="你好", difficulty="simple", reason="寒暄")


class _Model:
    """假模型：``config_id`` 对应 ``llm_models`` 的一行。"""

    def __init__(
        self,
        config_id: str | None = None,
        *,
        error: BaseException | None = None,
    ) -> None:
        self._chatvein_config_id = config_id
        self.runs: list[str] = []
        self._error = error

    def with_structured_output(self, schema: type, *, method: str = "json_schema"):
        return _Runner(self.runs, self._error)


class _Cfg:
    def __init__(self, config_id: str, fallback: str | None = None) -> None:
        self.id = config_id
        self.fallback_config_id = fallback
        self.enabled = True
        self.api_key = "sk-test"


class _Service:
    def __init__(self, cfgs: dict[str, _Cfg]) -> None:
        self._cfgs = cfgs

    def get_entity(self, config_id: str) -> _Cfg | None:
        return self._cfgs.get(config_id)


@pytest.fixture(autouse=True)
def _fresh_turn() -> None:
    """每轮开始都会复位降级标记（见 ``graphs/pipeline.py``），这里手动复位。"""
    llm.reset_fallback_used()


def _wire(
    monkeypatch: pytest.MonkeyPatch,
    *,
    primary: str = "main",
    fallback: str | None = "backup",
) -> dict[str, _Model]:
    cfgs = {"main": _Cfg("main", fallback), "backup": _Cfg("backup")}
    monkeypatch.setattr(llm, "ModelsService", lambda: _Service(cfgs))
    backup = _Model("backup")
    monkeypatch.setattr(
        llm, "get_chat_model", lambda **kwargs: backup
    )
    return {"backup": backup}


def test_switches_to_fallback_on_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    models = _wire(monkeypatch)
    primary = _Model("main", error=_HttpError("rate limit 429", 429))

    with tracing("测试") as recorder:
        out = llm.invoke_structured(
            primary, UnderstandDecision, [HumanMessage(content="你好")]
        )
        assert out.difficulty == "simple"
        assert models["backup"].runs == ["invoke"]
        # 快照上必须能看出「这一轮的结论来自备用模型」
        assert recorder.meta["model_fallback"]["to_config"] == "backup"
        assert recorder.meta["model_fallback"]["code"] == "MODEL_RATE_LIMIT"
        assert recorder.snapshot()["model_fallback"]["to_config"] == "backup"


def test_auth_error_is_not_a_reason_to_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    """鉴权失败多半是 Key 填错：换模型只会掩盖真因。"""
    _wire(monkeypatch)
    primary = _Model("main", error=_HttpError("unauthorized 401", 401))

    with pytest.raises(_HttpError):
        llm.invoke_structured(primary, UnderstandDecision, [HumanMessage(content="你好")])


def test_switch_happens_at_most_once_per_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _wire(monkeypatch)
    first = _Model("main", error=_HttpError("timeout", 408))
    llm.invoke_structured(first, UnderstandDecision, [HumanMessage(content="你好")])

    # 本轮已降级过：第二次失败不再换模型，直接抛给上层（避免主备来回弹）
    second = _Model("main", error=_HttpError("timeout", 408))
    with pytest.raises(_HttpError):
        llm.invoke_structured(second, UnderstandDecision, [HumanMessage(content="你好")])


def test_no_fallback_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    _wire(monkeypatch, fallback=None)
    primary = _Model("main", error=_HttpError("rate limit 429", 429))
    with pytest.raises(_HttpError):
        llm.invoke_structured(primary, UnderstandDecision, [HumanMessage(content="你好")])


def test_models_without_config_tag_ignore_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """老单测里手搓的假模型（没有配置标记）行为必须和以前一样。"""
    _wire(monkeypatch)
    primary = _Model(None, error=_HttpError("rate limit 429", 429))
    with pytest.raises(_HttpError):
        llm.invoke_structured(primary, UnderstandDecision, [HumanMessage(content="你好")])


def test_fallback_switch_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CHATVEIN_MODEL_FALLBACK", "0")
    _wire(monkeypatch)
    primary = _Model("main", error=_HttpError("rate limit 429", 429))
    with pytest.raises(_HttpError):
        llm.invoke_structured(primary, UnderstandDecision, [HumanMessage(content="你好")])
