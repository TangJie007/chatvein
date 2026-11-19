"""团队模式并行 fan-out：``parallel_delegate`` 工具（批次 2 §2.4）。

为什么不靠模型连发多次 ``delegate_to_agent``：

- LangGraph 会把同一条消息里的多个 tool_call **串行**执行，模型连发并不会并行；
- 「并行」只能由工具内部自己开线程池，模型侧只表达「一次派发 N 个子任务」；
- 一次调用也更容易保证不遗漏成员，并天然得到一次汇总点。

设计要点：

- 复用 ``delegation.run_member_task``：串行与并行走同一条执行路径（护栏 / 记忆 / 步数一致）；
- 线程隔离：每个任务 ``copy_context()`` 后提交，成员的 ContextVar（turn / sandbox / sink /
  团队花名册）独立，互不可见；
- trace 隔离：成员在 ``child_span`` 里跑，``_span_parent`` 随 ContextVar 复制，spans 不串台；
- 取消：等待期间每 0.2s 检查 ``raise_if_cancelled``，命中即取消未开始任务并抛 ``TurnCancelled``
  （与串行派发语义一致，外层收尾为 ``cancelled``）；
- 聚合：成功 ≥2 时用主模型做一次结构化汇总；汇总失败退化为按成员拼接，不丢内容。
"""

from __future__ import annotations

import os
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from contextvars import copy_context
from typing import Any, Callable

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from agents.cancellation import (  # pyright: ignore[reportImplicitRelativeImport]
    TurnCancelled,
    current_turn_id,
    raise_if_cancelled,
)
from agents.delegation import (  # pyright: ignore[reportImplicitRelativeImport]
    MemberOutcome,
    get_team_context,
    run_member_task,
)
from agents.llm import get_chat_model  # pyright: ignore[reportImplicitRelativeImport]
from conversations import session_store  # pyright: ignore[reportImplicitRelativeImport]
from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    current_sandbox,
    session_db_path,
)
from trace.recording import child_span  # pyright: ignore[reportImplicitRelativeImport]

_MAX_TASKS = 8
_POLL_S = 0.2
_AGG_TIMEOUT = 90.0


def max_parallel() -> int:
    """并行度：``CHATVEIN_DELEGATE_MAX_PARALLEL``（默认 4，范围 1..8）。"""
    raw = os.getenv("CHATVEIN_DELEGATE_MAX_PARALLEL", "")
    try:
        value = int(raw) if raw.strip() else 4
    except ValueError:
        value = 4
    return max(1, min(value, _MAX_TASKS))


def parallel_enabled() -> bool:
    """总开关：关掉后团队模式回退串行 ``delegate_to_agent``（见 graphs/medium.py）。"""
    if os.getenv("CHATVEIN_PARALLEL_DELEGATE", "").strip() == "0":
        return False
    return max_parallel() > 1


def batch_timeout() -> float:
    """整批上限：成员各自 300s，批量放宽到 420s，避免 4 个成员把一轮拖到 20 分钟。"""
    raw = os.getenv("CHATVEIN_DELEGATE_BATCH_TIMEOUT", "")
    try:
        return max(60.0, float(raw)) if raw.strip() else 420.0
    except ValueError:
        return 420.0


class DelegateTask(BaseModel):
    role_id: str = Field(description="目标团队成员的角色 id（必须是花名册里的成员）")
    task: str = Field(description="交给该成员独立完成的子任务，尽量具体、可验收")
    instruction: str | None = Field(
        default=None,
        description="可选：该子任务的额外约束 / 期望输出格式",
    )


class ParallelDelegateInput(BaseModel):
    tasks: list[DelegateTask] = Field(
        description="要并行派发的子任务（1-8 条）；同一成员也可以有多条不同子任务"
    )


def _normalize_tasks(raw: Any) -> list[DelegateTask]:
    """``@tool`` 传进来的是 dict（HTTP/模型侧）或已校验的模型实例，两种都接。"""
    out: list[DelegateTask] = []
    for item in raw or []:
        if isinstance(item, DelegateTask):
            out.append(item)
        elif isinstance(item, dict):
            role_id = str(item.get("role_id") or "").strip()
            task = str(item.get("task") or "").strip()
            if not role_id or not task:
                continue
            instruction = item.get("instruction")
            out.append(
                DelegateTask(
                    role_id=role_id,
                    task=task,
                    instruction=str(instruction).strip() if instruction else None,
                )
            )
    return out


_AGG_SYSTEM = """你是团队的主控 Agent，负责把成员并行完成的子任务结果汇总成最终答复。
要求：
1. 直接给结论 / 成品，不要逐条复述成员原话，也不要写「以下是汇总」这类过场话；
2. 保留成员结果之间互补或冲突的关键信息；若有冲突，简要指出分歧点；
3. 失败或未完成的部分用一句话说明「未完成 + 原因」，绝不编造内容补空；
4. 不要出现「成员」「派发」「子任务」这类内部流程词，读起来像一个人在回答用户。
"""


def _fallback_summary(specs: list[DelegateTask], outcomes: list[MemberOutcome]) -> str:
    parts: list[str] = []
    for spec, outcome in zip(specs, outcomes):
        if outcome.ok and outcome.reply:
            parts.append(f"### {outcome.name}\n{outcome.reply.strip()}")
        else:
            parts.append(f"### {outcome.name}\n（未完成：{outcome.reply or '未知原因'}）")
    return "\n\n".join(parts)


def _aggregate(
    role: dict[str, Any] | None,
    specs: list[DelegateTask],
    outcomes: list[MemberOutcome],
) -> str:
    """成功 ≥2 时用主模型做一次汇总；模型不可用 / 失败则按成员拼接。"""
    succeeded = [o for o in outcomes if o.ok]
    if len(succeeded) <= 1:
        return _fallback_summary(specs, outcomes)

    model = get_chat_model(role=role, timeout=_AGG_TIMEOUT)
    if model is None:
        return _fallback_summary(specs, outcomes)

    blocks: list[str] = []
    for spec, outcome in zip(specs, outcomes):
        status = "完成" if outcome.ok else "失败"
        blocks.append(
            f"[{outcome.name}] {status}（子任务：{spec.task.strip()}）\n"
            f"{outcome.reply.strip() or '（无输出）'}"
        )
    try:
        resp = model.invoke(
            [
                SystemMessage(content=_AGG_SYSTEM),
                HumanMessage(content="\n\n".join(blocks)),
            ]
        )
        text = str(getattr(resp, "content", "") or "").strip()
        return text or _fallback_summary(specs, outcomes)
    except Exception as exc:  # noqa: BLE001 — 汇总失败要退化，不能让整批白跑
        print(f"CHATVEIN_PARALLEL aggregate failed: {exc}", flush=True)
        return _fallback_summary(specs, outcomes)


def _task_id(turn_id: str, index: int, role_id: str) -> str:
    return f"{turn_id or 'turn'}:{index}:{role_id}"


def _board_update(
    task_id: str, *, status: str, outcome: MemberOutcome | None = None
) -> None:
    """任务板落库（沙箱不可用时静默跳过，绝不因记账失败影响派发）。"""
    try:
        db_path = session_db_path(current_sandbox())
    except Exception:  # noqa: BLE001
        return
    try:
        session_store.update_agent_task(
            db_path,
            task_id,
            status=status,
            result=(outcome.reply if outcome else ""),
            error_code=(outcome.error_code if outcome else ""),
            duration_ms=(outcome.duration_ms if outcome else 0),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"CHATVEIN_PARALLEL board update failed: {exc}", flush=True)


def _member_label(ctx: dict[str, Any], role_id: str) -> str:
    """trace 里显示角色名而不是 id（面板给人看）。"""
    member = (ctx.get("roster") or {}).get(role_id) or {}
    return str(member.get("name") or role_id)


def _fan_out(
    specs: list[DelegateTask], parent_id: str | None
) -> tuple[list[MemberOutcome | None], bool]:
    """跑整批；返回（每条任务的结果，是否因取消/超时中断）。

    ``None`` 表示该条没有正常结束（取消 / 超时 / 异常）。
    """
    results: list[MemberOutcome | None] = [None] * len(specs)
    ctx = get_team_context() or {}

    def run_one(spec: DelegateTask) -> MemberOutcome:
        def body() -> MemberOutcome:
            with child_span(f"delegate:{_member_label(ctx, spec.role_id)}", parent_id):
                return run_member_task(spec.role_id, spec.task, spec.instruction)

        return body

    executor = ThreadPoolExecutor(
        max_workers=min(len(specs), max_parallel()),
        thread_name_prefix="chatvein-delegate",
    )
    # 每条任务提交前各自 copy_context：成员之间的 ContextVar 必须相互独立。
    futures: dict[Future[MemberOutcome], int] = {}
    for index, spec in enumerate(specs):
        # 每个成员各自 copy_context：turn / sandbox / sink / 团队上下文本线程独立。
        task_ctx = copy_context()
        futures[executor.submit(task_ctx.run, run_one(spec))] = index

    interrupted = False
    deadline = time.monotonic() + batch_timeout()
    pending: set[Future[MemberOutcome]] = set(futures)
    try:
        while pending:
            done, pending = wait(pending, timeout=_POLL_S, return_when=FIRST_COMPLETED)
            try:
                raise_if_cancelled()
            except TurnCancelled:
                interrupted = True
                for future in pending:
                    future.cancel()
                raise
            for future in done:
                index = futures[future]
                try:
                    results[index] = future.result()
                except TurnCancelled:
                    # 成员内部自己发现的取消：等同整轮取消。
                    interrupted = True
                    for left in pending:
                        left.cancel()
                    raise
                except Exception as exc:  # noqa: BLE001 — 单个成员炸了不影响其他人
                    results[index] = MemberOutcome(
                        specs[index].role_id,
                        specs[index].role_id,
                        False,
                        f"{type(exc).__name__}: {exc}",
                        "FAILED",
                    )
            if time.monotonic() > deadline and pending:
                interrupted = True
                for left in pending:
                    left.cancel()
                break
    finally:
        # wait=False：取消后不要再等仍在跑的成员（它们自己会检查取消位退出）。
        executor.shutdown(wait=False, cancel_futures=True)

    return results, interrupted


def _recorder_or_none() -> Any:
    from trace.recording import _recorder  # pyright: ignore[reportImplicitRelativeImport]

    return _recorder.get()


@tool("parallel_delegate", args_schema=ParallelDelegateInput)
def parallel_delegate(tasks: list[DelegateTask]) -> str:
    """把多个子任务**并行**派发给花名册成员，等待全部完成后返回一份汇总答复。

    适用于可以同时开工的多路任务（例如：让研究员查资料、让分析师做表格、
    让写手起草文案，各自独立）。每条任务指定一个成员 role_id；
    同一成员可以派多条不同子任务。成员会用各自的模型、工具和独立记忆完成。
    任务必须彼此独立、无需中间结果；有先后依赖时请改用 delegate_to_agent 串行派发。
    任务量小、不需要分工时，直接自己完成，不要调用本工具。
    """
    ctx = get_team_context()
    if not ctx:
        return "团队上下文不可用：当前不是团队模式会话，无法并行派发子任务。"

    specs = _normalize_tasks(tasks)
    if not specs:
        return "没有可派发的子任务：请给每条任务都填 role_id 和非空 task。"
    dropped = 0
    if len(specs) > _MAX_TASKS:
        dropped = len(specs) - _MAX_TASKS
        specs = specs[: _MAX_TASKS]

    turn_id = current_turn_id() or ""
    db_path = None
    try:
        db_path = session_db_path(current_sandbox())
    except Exception:  # noqa: BLE001
        db_path = None

    # 先登记 running，前端 / 排查能看到「谁在跑」，也能看出卡在哪条。
    if db_path is not None:
        for index, spec in enumerate(specs):
            try:
                session_store.save_agent_task(
                    db_path,
                    task_id=_task_id(turn_id, index, spec.role_id),
                    turn_id=turn_id,
                    role_id=spec.role_id,
                    role_name=str(
                        ((ctx.get("roster") or {}).get(spec.role_id) or {}).get("name")
                        or spec.role_id
                    ),
                    task=spec.task,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"CHATVEIN_PARALLEL board save failed: {exc}", flush=True)

    # child_span 的父级必须在**主线程**取：线程里 ContextVar 已复制，但栈是共享的。
    recorder = _recorder_or_none()
    parent_id = recorder.parent_for(None) if recorder is not None else None
    results, interrupted = _fan_out(specs, parent_id)

    outcomes: list[MemberOutcome] = []
    for index, (spec, outcome) in enumerate(zip(specs, results)):
        if outcome is None:
            outcome = MemberOutcome(
                spec.role_id,
                spec.role_id,
                False,
                "（已取消或超时未完成）" if interrupted else "（未完成）",
                "CANCELLED" if interrupted else "FAILED",
            )
        outcomes.append(outcome)
        _board_update(
            _task_id(turn_id, index, spec.role_id),
            status="cancelled" if outcome.error_code == "CANCELLED" else (
                "done" if outcome.ok else "failed"
            ),
            outcome=outcome,
        )

    if dropped:
        outcomes.append(
            MemberOutcome("", "", False, f"另有 {dropped} 条超出上限未派发", "OVER_LIMIT")
        )

    if interrupted:
        # 先返回已完成的，外层再按取消收尾（不要让整批结果凭空消失）。
        done_part = _fallback_summary(specs, outcomes)
        return f"（本轮已取消，以下是已完成部分）\n{done_part}"

    with child_span("aggregate", parent_id):
        return _aggregate(ctx.get("role"), specs, outcomes)


TOOLS: tuple[BaseTool, ...] = (parallel_delegate,)
#: medium / hard 的 react_node 在团队模式且开关开启时挂载本工具。
PARALLEL_TOOL: BaseTool = parallel_delegate

__all__ = [
    "PARALLEL_TOOL",
    "TOOLS",
    "batch_timeout",
    "max_parallel",
    "parallel_delegate",
    "parallel_enabled",
]
