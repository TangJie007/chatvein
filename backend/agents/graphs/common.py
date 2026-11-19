"""图节点共用：抽文本、角色白名单、ReAct 工厂、轨迹合并。"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    ModelRetryMiddleware,
    ToolCallLimitMiddleware,
    before_model,
    wrap_tool_call,
)
from langchain_core.messages import ToolMessage

from agents.cancellation import TurnCancelled, raise_if_cancelled  # pyright: ignore[reportImplicitRelativeImport]
from mcps.approval import bind_tool_call  # pyright: ignore[reportImplicitRelativeImport]
from agents.streaming import (  # pyright: ignore[reportImplicitRelativeImport]
    emit_token,
    emit_tool,
    message_text,
    stream_enabled,
)
from mcps.resilience import (  # pyright: ignore[reportImplicitRelativeImport]
    execute_tool_call,
    recent_failed_tools,
    tool_retry_enabled,
)
from agents.llm import (  # pyright: ignore[reportImplicitRelativeImport]
    is_rate_limit_error,
    model_error_hint,
    rate_limit_retries,
    rate_limit_wait,
)
from trace.recording import note


def last_text(messages: list[Any] | None) -> str | None:
    """从 Agent / 图输出的 messages 里取最后一条非空文本。"""
    for msg in reversed(messages or []):
        content = getattr(msg, "content", None)
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts = [
                str(block.get("text", ""))
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            joined = "".join(parts).strip()
            if joined:
                return joined
    return None


def session_workspace_block() -> str:
    """兼容别名：动态 Environment 段（见 ``graphs.prompts``）。"""
    from .prompts import environment_section

    return environment_section()


def with_session_context(system_prompt: str) -> str:
    """兼容旧调用：若传入的已是完整宪法，仍把 Environment 插到 Identity 之后。

    新代码请直接用 ``prompts.build_agent_system``。
    """
    from .prompts import build_agent_system, environment_section

    base = (system_prompt or "").strip()
    if not base:
        return build_agent_system(tier="medium")
    # 已含 Environment 则不再重复
    if "# Environment" in base:
        return base
    env = environment_section()
    if base.startswith("# Identity"):
        # Identity 段落后插入 Environment
        parts = base.split("\n\n", 1)
        if len(parts) == 2:
            return f"{parts[0]}\n\n{env}\n\n{parts[1]}"
    return f"{base}\n\n{env}"


def allowed_from_role(role: dict[str, Any] | None) -> list[str] | None:
    """角色勾选的工具/分组；空列表表示不限制。

    以 ``!`` / ``-`` 开头的条目是「显式拒绝」（见 ``always_on_tools``），
    不参与白名单，否则 ``expand_allowlist`` 会把它们当未知名字吞掉。
    """
    if not role:
        return None
    tools = role.get("tools")
    if not isinstance(tools, list) or not tools:
        return None
    picked = [
        str(t).strip()
        for t in tools
        if str(t).strip() and not str(t).strip().startswith(_DENY_MARKERS)
    ]
    return picked or None


#: 常驻工具：不参与 ``select_tools`` 选型，也不受角色工具白名单过滤，
#: react 阶段无条件挂进本轮工具列表（模型仍按需调用）。
#: - load_skill：加载已启用技能正文（目录已注入 role prompt，模型按需拉全文）
#: - sandbox_run_python（UI 亦称 runcode）：代码沙箱执行 Python
#: - get_current_time：当前时间 / 时区。时间类问题极常见且必须准确，
#:   不能依赖选型命中或角色勾选，故常驻（时区换算仍走 convert_time，由选型带上）
ALWAYS_ON_TOOLS: tuple[str, ...] = ("load_skill", "sandbox_run_python", "get_current_time")

#: 角色显式拒绝常驻工具的标记前缀（``!`` 或 ``-``）。
#: 只有显式拒绝才移除：``tools`` 为空表示「不限制」，若按「没勾选」推断拒绝，
#: 没配工具的角色会连时间/沙箱一起失去。
_DENY_MARKERS: tuple[str, ...] = ("!", "-")


def denied_tools(role: dict[str, Any] | None) -> set[str]:
    """角色显式拒绝的工具名：``tools`` 里的 ``!name`` / ``-name``，或 ``deny_tools`` 列表。"""
    if not role:
        return set()
    denied: set[str] = set()
    for item in role.get("deny_tools") or []:
        text = str(item).strip()
        if text:
            denied.add(text)
    for item in role.get("tools") or []:
        text = str(item).strip()
        if len(text) > 1 and text.startswith(_DENY_MARKERS):
            denied.add(text[1:].strip())
    return denied


def always_on_tools(role: dict[str, Any] | None = None) -> tuple[str, ...]:
    """本轮真正常驻的工具：默认全集，角色显式拒绝的剔除。"""
    denied = denied_tools(role)
    if not denied:
        return ALWAYS_ON_TOOLS
    return tuple(name for name in ALWAYS_ON_TOOLS if name not in denied)


def tool_call_fingerprint(name: str, args: Any) -> str:
    """同工具 + 同参的稳定指纹（用于去重）。"""
    try:
        payload = json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)
    except TypeError:
        payload = repr(args)
    return f"{name}\0{payload}"


def _tool_call_fields(tool_call: Any) -> tuple[str, Any, str]:
    if isinstance(tool_call, dict):
        return (
            str(tool_call.get("name") or ""),
            tool_call.get("args") if "args" in tool_call else {},
            str(tool_call.get("id") or ""),
        )
    return (
        str(getattr(tool_call, "name", "") or ""),
        getattr(tool_call, "args", {}) or {},
        str(getattr(tool_call, "id", "") or ""),
    )


def same_arg_tool_guard():
    """本轮 ReAct 内：同一工具 + 相同参数只允许执行一次（质量护栏，非砍轮次）。"""
    seen: set[str] = set()

    @wrap_tool_call(name="SameArgToolGuard")
    def _guard(request: Any, handler: Any) -> Any:
        name, args, call_id = _tool_call_fields(request.tool_call)
        key = tool_call_fingerprint(name, args)
        if key in seen:
            return ToolMessage(
                content=(
                    f"已拒绝重复调用：工具 `{name}` 曾以相同参数执行过。"
                    "请基于已有工具结果直接作答，或更换参数 / 换用其他工具。"
                ),
                tool_call_id=call_id,
                status="error",
            )
        seen.add(key)
        return handler(request)

    return _guard


def resilient_tool_middleware() -> list[Any]:
    """工具韧性：transient 退避重试 + 本轮熔断 + 幂等去重 + 结构化结果。

    必须排在 ``same_arg_tool_guard`` 之后、取消守卫之前（外层到内层）：
    同参去重要先判，取消检查要在每次重试时都能命中。
    ``CHATVEIN_TOOL_RETRY=0`` 时返回空列表，整体回落到旧行为。
    """

    if not tool_retry_enabled():
        return []

    @wrap_tool_call(name="ResilientTool")
    def _resilient(request: Any, handler: Any) -> Any:
        name, _args, call_id = _tool_call_fields(request.tool_call)
        emit_tool(name, "running", tool_call_id=call_id)
        # 审批用 turn_id + tool_call_id 生成确定性 id：恢复一轮时能复用旧决定。
        with bind_tool_call(call_id):
            result = execute_tool_call(
                tool_name=name,
                call_id=call_id,
                invoke=lambda: handler(request),
            )
        emit_tool(
            name,
            "ok" if result.ok else "error",
            tool_call_id=call_id,
            detail="" if result.ok else (result.error_kind or result.code),
        )
        return ToolMessage(
            content=result.content,
            tool_call_id=call_id,
            status="success" if result.ok else "error",
            additional_kwargs={"tool_result": result.to_dict()},
        )

    return [_resilient]


# create_agent 里**每个 middleware 钩子都单独占一个图步**，不是「模型+工具各 1 步」。
# 实测一轮（一次模型调用 + 一次工具执行）= 8 步：
#   3 × before_model（取消守卫 / 限流复位 / 模型次数上限）
#   + model + 3 × after_model（模型次数 / 工具次数 / web_search 次数）+ tools
# 所以步数上限必须是「轮次 × 8」，否则图会**先于**模型次数上限撞墙：
# 旧公式 2×12+10=34 只够跑 4 轮就抛 Recursion limit of 34 reached。
STEPS_PER_REACT_ITERATION = 8
RECURSION_LIMIT_MARGIN = 16


def react_recursion_limit(
    max_model_calls: int,
    *,
    margin: int = RECURSION_LIMIT_MARGIN,
) -> int:
    """图 ``recursion_limit``：``max_model_calls × STEPS_PER_REACT_ITERATION + margin``。

    只是安全网：正常收束交给 Tool / Model call limit（语义上限）。
    步数不够会让本轮在第 4 轮左右被硬切，且异常文案是框架内部措辞。
    """
    calls = max(1, int(max_model_calls))
    pad = max(0, int(margin))
    return calls * STEPS_PER_REACT_ITERATION + pad


class StepLimitReached(RuntimeError):
    """撞到图步上限（``recursion_limit``）：带上中止前最后一份状态，供上层收束。"""

    def __init__(self, message: str, partial: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.partial = partial or {}


def step_limit_reply(partial: dict[str, Any], fallback: str = "") -> str:
    """步数触顶时的收束回复：把已收集到的结果交给用户，而不是整轮报错。"""
    messages = list((partial or {}).get("messages") or [])
    done = sum(1 for msg in messages if isinstance(msg, ToolMessage))
    head = f"本轮达到步骤上限（已完成 {done} 次工具调用），以下是已收集到的结果："
    body = last_text(messages) or fallback or "（工具已执行，但模型还没来得及给出结论）"
    return f"{head}\n\n{body}"


def cancellation_guards() -> list[Any]:
    """每步检查「本轮是否已被用户取消」。

    一次模型调用可达 1~2 分钟、一次工具执行可达 2 分钟；没有这两个检查点，
    前端点停止后后端仍会把剩余步骤全部跑完（追踪也一直停在 running）。
    命中就抛 ``TurnCancelled``：``before_model`` 抛在图节点里，不会被
    ToolNode 的错误兜底吞成一条工具错误消息，能直接冲出 ``agent.invoke``。
    """

    @wrap_tool_call(name="CancellationGuardTool")
    def _before_tool(request: Any, handler: Any) -> Any:
        raise_if_cancelled()
        return handler(request)

    @before_model(name="CancellationGuardModel")
    def _before_model(state: Any, runtime: Any) -> None:
        raise_if_cancelled()

    return [_before_tool, _before_model]


def rate_limit_retry_middleware():
    """供应商限流（429 / TPM·RPM 超限）时退避重试，其余错误照常抛出。

    等待由我们自己承担（``initial_delay=0``，中间件不再额外 sleep）：配额恢复
    要几十秒，退避窗口必须能被「用户已取消」打断，否则点了停止还得干等。
    重试次数用尽后原样抛出（``on_failure="error"``），由 react 兜底翻成人话。
    """
    retries = max(0, rate_limit_retries())
    state = {"attempt": 0}

    def policy(exc: BaseException) -> bool:
        if not is_rate_limit_error(exc):
            return False
        attempt = state["attempt"]
        state["attempt"] += 1
        # 最后一次机会已经用完：中间件只会 _handle_failure，再等也没意义。
        if attempt >= retries:
            return True
        # 退避在判断「是否重试」时一并完成：中间件自己的延迟已置 0。
        rate_limit_wait(attempt)
        return True

    @before_model(name="RateLimitRetryReset")
    def _reset(_state: Any, _runtime: Any) -> None:
        # 每次新的模型调用前复位计数：连续失敗才指数增长。
        state["attempt"] = 0

    retry = ModelRetryMiddleware(
        max_retries=retries,
        retry_on=policy,
        backoff_factor=0.0,
        initial_delay=0.0,
        jitter=False,
        on_failure="error",
    )
    return [retry, _reset]


def _failed_tool_names(verbose: str) -> list[str]:
    """从工具输出里挑出带「失败 / 离线模式 / error」的行，取工具名去重。

    形如 ``[sandbox_create_venv] 离线模式无法自动填参`` 的行会命中，用于把失败
    工具名汇总进聊天气泡的简洁提示。
    """
    names: list[str] = []
    for line in (verbose or "").splitlines():
        m = re.match(r"\s*\[([^\]]+)\]", line)
        if not m:
            continue
        name = m.group(1).strip()
        if name in names:
            continue
        low = line.lower()
        if "失败" in line or "离线模式" in line or "error" in low or "exception" in low:
            names.append(name)
    return names


def concise_failure(exc: BaseException, verbose: str = "") -> str:
    """react 异常兜底的一句话回复：详细工具输出另存追踪，不进聊天气泡。

    气泡只给一句人话；限流 / 鉴权 / 超时等模型侧原因翻成可读提示，其余回落到
    「工具调用失败，请重新再试」。具体原因（verbose 工具输出）由调用方写入追踪。
    """
    hint = model_error_hint(exc)
    if hint:
        return hint
    failed = _failed_tool_names(verbose)
    # 结构化失败记录优先于字符串匹配：工具抛异常后被上层兜底时，
    # verbose 里可能没有 `[name]` 行，但韧性层已经记下了失败工具名。
    for name in recent_failed_tools():
        if name not in failed:
            failed.append(name)
    if failed:
        return (
            f"工具调用失败，请重新再试（{', '.join(failed)}）。"
            "具体原因见右侧「追踪」。"
        )
    if isinstance(exc, TimeoutError):
        return "对话执行超时（已超 300 秒），可能卡在模型或联网，请重试或简化问题。"
    return "工具调用失败，请重新再试。"


def build_react_graph(
    model: Any,
    tools: list[Any],
    *,
    system_prompt: str,
    name: str,
    max_model_calls: int | None = 12,
    max_tool_calls: int | None = 10,
    max_web_search: int | None = 3,
):
    """用 ``create_agent`` 得到 ReAct 编译图。

    护栏：
    - 同工具同参只执行一次
    - 工具次数对齐 LangChain 文档示例：``web_search`` run_limit=3、全体=10
    - 模型调用上限（触顶 end）；默认略高于工具上限以免先卡死
    - 用户取消：每次模型 / 工具调用前检查，命中即中断本轮
    - 供应商限流：退避重试若干次，仍失败由上层翻成可读提示
    """
    middleware: list[Any] = [
        same_arg_tool_guard(),
        *resilient_tool_middleware(),
        *cancellation_guards(),
        *rate_limit_retry_middleware(),
    ]
    if max_web_search is not None and max_web_search > 0:
        middleware.append(
            ToolCallLimitMiddleware(
                tool_name="web_search",
                run_limit=max_web_search,
                exit_behavior="continue",
            )
        )
    if max_tool_calls is not None and max_tool_calls > 0:
        middleware.append(
            ToolCallLimitMiddleware(
                run_limit=max_tool_calls,
                exit_behavior="continue",
            )
        )
    if max_model_calls is not None and max_model_calls > 0:
        middleware.append(
            ModelCallLimitMiddleware(
                run_limit=max_model_calls,
                exit_behavior="end",
            )
        )
    return create_agent(
        model,
        tools,
        system_prompt=system_prompt,
        name=name,
        middleware=middleware,
    )


def _react_stream_chunk(chunk: Any) -> None:
    """``stream_mode="messages"`` 的原始 chunk → token 事件。

    只推「纯文本增量」：带 ``tool_call_chunks`` / ``tool_calls`` 的块是模型在
    组织工具参数，推给用户就是噪点；真正答复的块不带工具调用。
    """
    message = chunk[0] if isinstance(chunk, tuple) and chunk else chunk
    if getattr(message, "tool_call_chunks", None):
        return
    if getattr(message, "tool_calls", None):
        return
    emit_token(message_text(message))


def invoke_react(
    agent: Any,
    payload: dict[str, Any],
    *,
    recursion_limit: int,
    deadline_s: float | None = None,
    config_extra: dict[str, Any] | None = None,
) -> Any:
    """跑 ReAct；可选墙钟超时（仅防死挂，默认不压质量）。

    超时跑在线程池时须 ``copy_context().run``，否则丢失
    ``use_conversation_sandbox`` 的 ContextVar，文件/沙箱工具会报「没有会话工作区」。

    用 ``stream`` 而非 ``invoke``：图步上限触顶时仍能拿到最后一份状态，
    上层据此用已收集到的结果收束（``StepLimitReached.partial``）。
    """
    import contextvars

    from langgraph.errors import GraphRecursionError

    from trace.recording import runnable_config

    cfg = runnable_config({"recursion_limit": recursion_limit, **(config_extra or {})})

    def _run() -> Any:
        last: dict[str, Any] | None = None
        try:
            if stream_enabled():
                # 同时要 values（最终状态）与 messages（token 增量）。
                for mode, chunk in agent.stream(
                    payload, config=cfg, stream_mode=["values", "messages"]
                ):
                    if mode == "values" and isinstance(chunk, dict):
                        last = chunk
                    elif mode == "messages":
                        _react_stream_chunk(chunk)
            else:
                for chunk in agent.stream(payload, config=cfg, stream_mode="values"):
                    if isinstance(chunk, dict):
                        last = chunk
        except GraphRecursionError as exc:
            raise StepLimitReached(
                f"ReAct 达到图步上限（recursion_limit={recursion_limit}）",
                partial=last,
            ) from exc
        return last or {}

    if deadline_s is None or deadline_s <= 0:
        return _run()

    ctx = contextvars.copy_context()
    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(ctx.run, _run)
        try:
            return fut.result(timeout=deadline_s)
        except FuturesTimeout as exc:
            raise TimeoutError(
                f"ReAct 超过 {int(deadline_s)}s 仍未结束（可能卡在模型或联网）"
            ) from exc


def merge_tool_traces(
    prior: list[dict[str, Any]] | None,
    new: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """hard 核对回环时追加工具轨迹，不覆盖上一轮。"""
    out: list[dict[str, Any]] = []
    for row in list(prior or []) + list(new or []):
        if isinstance(row, dict):
            out.append(row)
    return out
