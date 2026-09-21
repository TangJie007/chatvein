"""结构化输出不走 json_schema，避免兼容接口 400。"""

from langchain_core.messages import HumanMessage

from agents.llm import invoke_structured
from agents.router import UnderstandDecision


class _Runner:
    def __init__(self, method: str, fail_function: bool) -> None:
        self.method = method
        self.fail_function = fail_function

    def invoke(self, messages: list) -> UnderstandDecision:
        if self.method == "function_calling" and self.fail_function:
            raise RuntimeError(
                "Error code: 400 - {'error': {'message': "
                "'This response_format type is unavailable now'}}"
            )
        if self.method == "json_mode":
            joined = " ".join(str(getattr(m, "content", "")) for m in messages)
            assert "json" in joined.lower()
        return UnderstandDecision(rewritten="你好", difficulty="simple", reason="寒暄")


class _Model:
    def __init__(self, fail_function: bool = False) -> None:
        self.methods: list[str] = []
        self.fail_function = fail_function

    def with_structured_output(self, schema: type, *, method: str = "json_schema"):
        self.methods.append(method)
        return _Runner(method, self.fail_function)


def test_structured_uses_function_calling() -> None:
    model = _Model()
    out = invoke_structured(model, UnderstandDecision, [HumanMessage(content="你好")])
    assert model.methods == ["function_calling"]
    assert out.difficulty == "simple"


def test_structured_falls_back_from_rejected_response_format() -> None:
    model = _Model(fail_function=True)
    out = invoke_structured(model, UnderstandDecision, [HumanMessage(content="你好")])
    assert model.methods == ["function_calling", "json_mode"]
    assert out.rewritten == "你好"


def test_structured_does_not_retry_other_errors() -> None:
    class Boom:
        def with_structured_output(self, schema: type, *, method: str = "json_schema"):
            raise RuntimeError("connection reset")

    try:
        invoke_structured(Boom(), UnderstandDecision, [HumanMessage(content="你好")])
    except RuntimeError as exc:
        assert "connection reset" in str(exc)
    else:
        raise AssertionError("expected raise")
