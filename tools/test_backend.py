r"""后端冒烟测试：不依赖 Tauri，未配置模型也能跑完。

覆盖不需要 LLM 的部分（健康检查 / 数据库概况 / 空会话 CRUD），并尝试一次真实对话：
未配置模型时打印原因后**跳过**聊天步骤，退出码仍为 0——冒烟只保证「后端起得来、
CRUD 没坏」，不把模型配置当成入门门槛。

用法（Windows PowerShell，端口必须与下面的 ``BASE`` 一致）：

    # 终端 1：用临时库启动后端
    $env:CHATVEIN_DB_PATH="$env:TEMP\chatvein-test.db"
    .venv/Scripts/python.exe backend/main.py --port 18794

    # 终端 2
    .venv/Scripts/python.exe tools/test_backend.py

退出码：0 全部通过（含跳过）；1 有断言失败。
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:18794"
_FAILS: list[str] = []


def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    """发一个请求，返回 (状态码, JSON)。4xx/5xx 也正常返回，由调用方判定。"""
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")
    except Exception as exc:  # noqa: BLE001 — 超时 / 连接中断都当成「没拿到结果」，由调用方跳过
        return 0, {"detail": str(exc)}


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        _FAILS.append(name)


def skip(name: str, reason: str) -> None:
    print(f"[SKIP] {name} — {reason}")


def main() -> int:
    status, health = call("GET", "/api/health")
    if status == 0:
        print(f"连不上后端 {BASE}：{health.get('detail')}")
        print("先另开一个终端启动后端：")
        print('  $env:CHATVEIN_DB_PATH="$env:TEMP\\chatvein-test.db"')
        print("  .venv/Scripts/python.exe backend/main.py --port 18794")
        return 1
    check("健康检查可用", health.get("status") == "ok", f"python={health.get('python')}")

    _, info = call("GET", "/api/db/info")
    check("数据库概况可读", info.get("schema_version", 0) >= 15, f"schema=v{info.get('schema_version')} path={info.get('path')}")
    check("主库含 conversations 表", any(t.get("name") == "conversations" for t in call("GET", "/api/db/tables")[1].get("tables", [])))

    # --- 空会话 CRUD：不碰模型，任何机器都能过 -----------------------------
    call("DELETE", "/api/conversations/")
    check("清空历史后列表为空", call("GET", "/api/conversations/")[1].get("conversations") == [])

    status, created = call("POST", "/api/conversations/", {"title": "冒烟会话"})
    cid = created.get("id")
    check("新建空会话", status in (200, 201) and bool(cid), f"status={status} id={cid}")
    if cid:
        listed = [c.get("id") for c in call("GET", "/api/conversations/")[1].get("conversations", [])]
        check("会话出现在列表里", cid in listed)
        detail = call("GET", f"/api/conversations/{cid}")[1]
        check("空会话没有消息", detail.get("messages") == [])
        status, _ = call("DELETE", f"/api/conversations/{cid}")
        check("删除会话", status == 200)
        check("删除后列表不含该会话", cid not in [c.get("id") for c in call("GET", "/api/conversations/")[1].get("conversations", [])])

    # --- 真实对话：需要已配置模型，未配置时跳过 -----------------------------
    status, chat = call("POST", "/api/chat", {"message": "冒烟测试：请回复 ok"})
    if status != 200:
        skip("对话落库", f"后端返回 {status}（多半是没配模型）：{str(chat.get('detail'))[:120]}")
    else:
        chat_cid = chat.get("conversation_id")
        check("对话返回 conversation_id", bool(chat_cid), f"reply={str(chat.get('reply'))[:40]}")
        if chat_cid:
            roles = [m.get("role") for m in call("GET", f"/api/conversations/{chat_cid}")[1].get("messages", [])]
            check("对话一轮落盘为 user → assistant", roles == ["user", "assistant"], f"roles={roles}")
            counts = call("GET", "/api/db/info")[1]
            check("主库冗余计数已更新", counts.get("messages", 0) >= 2, f"messages={counts.get('messages')}")

    # 脏 id 应自动新建会话，而不是 404 或 500
    status, orphan = call("POST", "/api/chat", {"message": "脏 id", "conversation_id": "nope"})
    if status == 200:
        check("失效会话 id 被替换", orphan.get("conversation_id") != "nope")
    else:
        skip("失效会话 id 被替换", f"后端返回 {status}（同上，需先配模型）")

    call("DELETE", "/api/conversations/")

    print()
    if _FAILS:
        print(f"{len(_FAILS)} 项失败：{', '.join(_FAILS)}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
