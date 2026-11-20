#!/usr/bin/env python
"""离线评测入口：跑用例 → 规则断言（必跑）→ 可选 LLM 评分 → JSON 报告。

用法（仓库根目录）::

    .\\.venv\\Scripts\\python.exe backend\\eval\\runner.py --cases backend\\eval\\cases\\smoke.json
    .\\.venv\\Scripts\\python.exe backend\\eval\\runner.py --judge --report eval-report.json
    .\\.venv\\Scripts\\python.exe backend\\eval\\runner.py --dry-run   # 只校验用例文件

退出码：0 全部通过；1 有失败 / 错误 / 超预算跳过；2 用例或模型配置有问题。

为什么不走 HTTP：评测要能进 CI、也要能在没有界面的机器上跑；直接调
``pipeline.run_pipeline`` 复用同一张图，省掉前端与 SSE。代价是每个用例现开一个
临时会话沙箱（工具里的文件/命令落在里面），跑完即删。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import db  # noqa: E402  # pyright: ignore[reportImplicitRelativeImport]
from agents.cancellation import bind_turn, clear_turn  # noqa: E402
from agents.graphs.pipeline import run_pipeline  # noqa: E402
from eval.cases import DEFAULT_CASES, RULE_FIELDS, CaseError, check_rules, load_cases  # noqa: E402
from eval.judge import JudgeUnavailable, judge_case, resolve_model  # noqa: E402
from mcps.sandbox import (  # noqa: E402
    create_conversation_dir,
    remove_conversation_dir,
    use_conversation_sandbox,
)
from roles.service import RolesService  # noqa: E402

REPORT_SCHEMA_VERSION = 1
_REPLY_CLIP = 4000
#: judge 四维均分（0-5）的默认达标线；``--judge-threshold`` 与 ``run_one`` 共用这一处。
DEFAULT_JUDGE_THRESHOLD = 3.5


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ChatVein 离线评测")
    parser.add_argument("--cases", default=str(DEFAULT_CASES), help="用例文件（JSON）")
    parser.add_argument("--role", default=None, help="角色 id；缺省用主对话角色")
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 条（调试用）")
    parser.add_argument("--judge", action="store_true", help="启用 LLM 评分（默认关闭）")
    parser.add_argument("--judge-model", default=None, help="评分用的模型配置 id；缺省复用被测模型")
    parser.add_argument(
        "--judge-threshold",
        type=float,
        default=DEFAULT_JUDGE_THRESHOLD,
        help="评分达标线（0-5）",
    )
    parser.add_argument("--report", default="eval-report.json", help="报告路径；'-' 表示打到 stdout")
    parser.add_argument("--max-seconds", type=float, default=0.0, help="整批时间预算；超出后剩余用例跳过")
    parser.add_argument("--dry-run", action="store_true", help="只校验用例文件，不跑模型")
    parser.add_argument("--quiet", action="store_true", help="不打印逐条结果")
    return parser.parse_args(argv)


def run_case(case: dict[str, Any], *, role: dict[str, Any] | None) -> dict[str, Any]:
    """跑单条用例：临时沙箱 + 绑定轮次（工具里的取消检查点才安全）。"""
    turn_id = f"eval-{case['id']}-{int(time.time() * 1000)}"
    workspace = ""
    bind_turn(turn_id)
    try:
        workspace = create_conversation_dir()
        with use_conversation_sandbox(workspace):
            return run_pipeline(case["message"], role=role)
    finally:
        clear_turn(turn_id)
        if workspace:
            remove_conversation_dir(workspace)


def _tools_of(result: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for item in result.get("tool_trace") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "name": str(item.get("tool_name") or "unknown"),
                "status": str(item.get("status") or "ok"),
            }
        )
    return rows


def run_one(
    case: dict[str, Any],
    *,
    role: dict[str, Any] | None,
    judge_model: Any = None,
    threshold: float = DEFAULT_JUDGE_THRESHOLD,
) -> dict[str, Any]:
    """执行一条用例并给出判定。

    ``status`` 只有三种：``pass``（规则全过且 judge 达标）/ ``fail`` / ``error``（跑崩了，
    例如模型不可用）；异常一律不抛出，避免一条用例带走整批。
    """
    started = time.perf_counter()
    record: dict[str, Any] = {
        "id": case["id"],
        "status": "error",
        "elapsed_ms": 0,
        "difficulty": "",
        "reply": "",
        "tools": [],
        "checks": [],
        "judge": None,
        "error": None,
    }
    try:
        result = run_case(case, role=role)
    except Exception as exc:  # noqa: BLE001 - 单条用例崩溃不能带走整批
        record["elapsed_ms"] = int((time.perf_counter() - started) * 1000)
        record["error"] = f"{type(exc).__name__}: {exc}"
        return record

    checks = check_rules(case, result)
    reply = str(result.get("reply") or "")
    record.update(
        {
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "difficulty": str(result.get("difficulty") or ""),
            "reply": reply if len(reply) <= _REPLY_CLIP else f"{reply[:_REPLY_CLIP]}…",
            "tools": _tools_of(result),
            "selected_tools": [str(name) for name in result.get("selected_tools") or []],
            "checks": checks,
        }
    )
    judge: dict[str, Any] | None = None
    if judge_model is not None:
        try:
            judge = judge_case(case, result, model=judge_model)
        except Exception as exc:  # noqa: BLE001 - 评分失败按个案错误处理
            record["error"] = f"judge {type(exc).__name__}: {exc}"
            return record
    record["judge"] = judge
    rules_ok = all(item["ok"] for item in checks)
    judge_ok = judge is None or float(judge["score"]) >= threshold
    record["status"] = "pass" if rules_ok and judge_ok else "fail"
    return record


def build_report(
    *,
    suite: str,
    cases_path: str,
    role: dict[str, Any] | None,
    judge_enabled: bool,
    judge_model_id: str | None,
    threshold: float,
    results: list[dict[str, Any]],
    skipped: int,
    elapsed_ms: int,
) -> dict[str, Any]:
    executed = len(results)
    passed = sum(1 for item in results if item["status"] == "pass")
    failed = sum(1 for item in results if item["status"] == "fail")
    errors = sum(1 for item in results if item["status"] == "error")
    scored = [float(item["judge"]["score"]) for item in results if item.get("judge")]
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "suite": suite,
        "cases": cases_path,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "role": {
            "id": (role or {}).get("id"),
            "name": (role or {}).get("name"),
            "model_id": (role or {}).get("model_id"),
        },
        "judge": {
            "enabled": judge_enabled,
            "model_id": judge_model_id,
            "threshold": threshold,
        },
        "totals": {
            "cases": executed + skipped,
            "executed": executed,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
            "pass_rate": round(passed / executed, 4) if executed else 0.0,
            "elapsed_ms": elapsed_ms,
        },
        "judge_mean": round(sum(scored) / len(scored), 2) if scored else None,
        "results": results,
    }


def _print_summary(report: dict[str, Any], *, quiet: bool, stream: Any) -> None:
    totals = report["totals"]
    print(
        f"{report['suite']} · {totals['executed']} 条 · "
        f"通过 {totals['passed']} / 失败 {totals['failed']} / 错误 {totals['errors']}"
        + (f" / 跳过 {totals['skipped']}" if totals["skipped"] else "")
        + f" · {totals['elapsed_ms']}ms",
        file=stream,
    )
    if report["judge_mean"] is not None:
        print(f"judge 均分 {report['judge_mean']}（达标线 {report['judge']['threshold']}）", file=stream)
    if quiet:
        return
    for item in report["results"]:
        mark = {"pass": "✓", "fail": "✗"}.get(item["status"], "!")
        notes = [check["detail"] for check in item.get("checks") or [] if not check["ok"]]
        if item.get("error"):
            notes.append(item["error"])
        if item.get("judge") and float(item["judge"]["score"]) < report["judge"]["threshold"]:
            notes.append(f"judge {item['judge']['score']}")
        tail = f"  {'; '.join(notes)}" if notes else ""
        print(f"  {mark} {item['id']:<24} {item['elapsed_ms']}ms{tail}", file=stream)


def _write_report(report: dict[str, Any], target: str) -> None:
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if target == "-":
        print(text)
        return
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"报告已写入 {path}")


def _print_dry(suite: str, cases: list[dict[str, Any]]) -> None:
    print(f"用例文件 OK：{suite} · {len(cases)} 条")
    for case in cases:
        bits = []
        for field in RULE_FIELDS:
            if case.get(field):
                bits.append(f"{field}={len(case[field])}")
        if case.get("rubric"):
            bits.append("rubric")
        print(f"  - {case['id']}: {case['message'][:48]}{' · ' + ', '.join(bits) if bits else ''}")


def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    try:
        suite, cases = load_cases(args.cases)
    except CaseError as exc:
        print(f"用例文件有问题：{exc}", file=sys.stderr)
        return 2
    if args.limit > 0:
        cases = cases[: args.limit]
    if args.dry_run:
        _print_dry(suite, cases)
        return 0

    db.init_db()
    try:
        role = RolesService().resolve_for_chat(args.role)
    except Exception as exc:  # noqa: BLE001 - 配置问题直接给出人话
        print(f"读取角色失败：{exc}", file=sys.stderr)
        return 2
    if not role or not str(role.get("model_id") or "").strip():
        print("没有可用角色或角色未绑定模型：先在设置里配置模型，或用 --role 指定角色。", file=sys.stderr)
        return 2

    judge_model = None
    judge_model_id: str | None = None
    if args.judge:
        judge_model_id = args.judge_model or str(role.get("model_id") or "")
        try:
            judge_model = resolve_model(judge_model_id)
        except JudgeUnavailable as exc:
            print(f"{exc}。先配置模型，或用 --judge-model 指定。", file=sys.stderr)
            return 2

    started = time.perf_counter()
    results: list[dict[str, Any]] = []
    skipped = 0
    for case in cases:
        if args.max_seconds and time.perf_counter() - started >= args.max_seconds:
            skipped = len(cases) - len(results)
            print(f"时间预算用尽，剩余 {skipped} 条跳过。", file=sys.stderr)
            break
        results.append(
            run_one(case, role=role, judge_model=judge_model, threshold=args.judge_threshold)
        )

    report = build_report(
        suite=suite,
        cases_path=str(args.cases),
        role=role,
        judge_enabled=bool(args.judge),
        judge_model_id=judge_model_id,
        threshold=args.judge_threshold,
        results=results,
        skipped=skipped,
        elapsed_ms=int((time.perf_counter() - started) * 1000),
    )
    stream = sys.stderr if args.report == "-" else sys.stdout
    _print_summary(report, quiet=bool(args.quiet), stream=stream)
    _write_report(report, args.report)
    totals = report["totals"]
    if totals["failed"] or totals["errors"] or totals["skipped"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
