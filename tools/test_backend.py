"""Smoke test for the Python backend running on port 18794."""
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


if __name__ == "__main__":
    print("health:", get("/api/health"))
    print("chat:", post("/api/chat", {"message": "hi"}))
    print("echo:", post("/api/echo", {"message": "abc"}))
