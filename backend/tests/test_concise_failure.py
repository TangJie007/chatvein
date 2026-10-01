"""react 异常兜底：气泡只给一句话，详细工具输出另存追踪。"""

from __future__ import annotations

from agents.graphs.common import _failed_tool_names, concise_failure


def test_timeout_is_concise() -> None:
    msg = concise_failure(TimeoutError("ReAct 超过 300s 仍未结束"))
    assert "对话执行超时" in msg
    assert "workspace=" not in msg  # 详细路径绝不进气泡


def test_failed_tool_names_extracted() -> None:
    verbose = (
        "[sandbox_info] workspace=C:\\x\\output\n"
        "[sandbox_create_venv] 离线模式无法自动填参，请配置 LLM\n"
        "[sandbox_pip_install] 离线模式无法自动填参，请配置 LLM\n"
    )
    names = _failed_tool_names(verbose)
    assert "sandbox_create_venv" in names
    assert "sandbox_pip_install" in names
    assert "sandbox_info" not in names  # 成功行不计入


def test_reply_lists_failed_tools_and_points_to_trace() -> None:
    verbose = (
        "[sandbox_create_venv] 离线模式无法自动填参，请配置 LLM\n"
        "[sandbox_run_python] 失败: boom\n"
    )
    msg = concise_failure(RuntimeError("boom"), verbose)
    assert "sandbox_create_venv" in msg
    assert "sandbox_run_python" in msg
    assert "具体原因见右侧" in msg
    assert "离线模式无法自动填参" not in msg  # 详细原因不进气泡


def test_generic_error_is_short() -> None:
    msg = concise_failure(RuntimeError("boom"))
    assert msg == "工具调用失败，请重新再试。"
