r"""Smoke test for the Python backend running on port 18794.

Covers the HTTP API and the SQLite persistence layer (backend/db.py).

Usage:
    # 1) start the backend against a throwaway database
    #    (PowerShell)
    $env:CHATVEIN_DB_PATH="$env:TEMP\chatvein-test.db"
    backend/.venv/Scripts/python.exe backend/main.py --port 18794
    # 2) run this script
    python tools/test_backend.py
"""
import json
import urllib.request

BASE = "http://127.0.0.1:18794"


def get(path: str) -> str:
    return urllib.request.urlopen(BASE + path, timeout=5).read().decode()


def post(path: str, data: dict) -> str:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=5).read().decode()


def delete(path: str) -> str:
    req = urllib.request.Request(BASE + path, method="DELETE")
    return urllib.request.urlopen(req, timeout=5).read().decode()


def main() -> None:
    print("health:", get("/api/health"))
    print("echo:", post("/api/echo", {"message": "abc"}))

    # --- chat 落库 -------------------------------------------------------
    first = json.loads(post("/api/chat", {"message": "hi"}))
    assert first["conversation_id"], "chat 未返回 conversation_id"
    print("chat:", first["reply"], "| conversation:", first["conversation_id"])

    # 同一会话追加一条，应复用同一个 conversation_id
    second = json.loads(
        post("/api/chat", {"message": "再问一次？", "conversation_id": first["conversation_id"]})
    )
    assert second["conversation_id"] == first["conversation_id"], "会话 id 未复用"

    # 脏 id 应自动新建会话而不是报错
    orphan = json.loads(post("/api/chat", {"message": "孤儿", "conversation_id": "nope"}))
    assert orphan["conversation_id"] != "nope", "失效的会话 id 未被替换"

    # --- 读回 -----------------------------------------------------------
    conversations = json.loads(get("/api/conversations"))["conversations"]
    assert len(conversations) >= 2, "会话列表数量异常"
    print("conversations:", [(c["title"], c["message_count"]) for c in conversations])

    detail = json.loads(get(f"/api/conversations/{first['conversation_id']}"))
    roles = [m["role"] for m in detail["messages"]]
    assert roles == ["user", "assistant", "user", "assistant"], f"消息顺序异常: {roles}"
    print("messages of first conversation:", roles)

    info = json.loads(get("/api/db/info"))
    print("db info:", info)

    # --- 删除（消息必须级联删除，不能留孤儿行） --------------------------
    before = json.loads(get("/api/db/info"))["messages"]
    print("delete:", delete(f"/api/conversations/{orphan['conversation_id']}"))
    after = json.loads(get("/api/db/info"))["messages"]
    assert after == before - 2, f"级联删除失败: {before} -> {after}"

    print("clear:", delete("/api/conversations"))
    assert json.loads(get("/api/conversations"))["conversations"] == [], "清空失败"
    assert json.loads(get("/api/db/info"))["messages"] == 0, "清空后仍有残留消息"

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
