"""访问令牌（X-ChatVein-Token）中间件行为测试。

Rust 层在启动 Python 后端时通过 CHATVEIN_TOKEN 注入令牌，前端每次请求
携带同名 header；后端逐请求校验，不匹配即 401。
"""

from __future__ import annotations

import importlib
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import main as main_module


@pytest.fixture()
def token_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """设置 CHATVEIN_TOKEN 后重载 main，得到启用校验的应用实例。"""
    monkeypatch.setenv("CHATVEIN_TOKEN", "test-token-123")
    importlib.reload(main_module)
    yield TestClient(main_module.app)
    monkeypatch.delenv("CHATVEIN_TOKEN", raising=False)
    importlib.reload(main_module)


def test_missing_header_rejected(token_client: TestClient) -> None:
    resp = token_client.get("/api/health")
    assert resp.status_code == 401


def test_wrong_token_rejected(token_client: TestClient) -> None:
    resp = token_client.get("/api/health", headers={"X-ChatVein-Token": "nope"})
    assert resp.status_code == 401


def test_correct_token_allowed(token_client: TestClient) -> None:
    resp = token_client.get(
        "/api/health", headers={"X-ChatVein-Token": "test-token-123"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_openapi_docs_exempt(token_client: TestClient) -> None:
    """OpenAPI 文档页不要求令牌，便于浏览器查看 Swagger UI。"""
    assert token_client.get("/openapi.json").status_code == 200
    assert token_client.get("/docs").status_code == 200


def test_no_token_env_no_guard() -> None:
    """未设置 CHATVEIN_TOKEN（手动调试 / 原有单测）时不启用校验。"""
    client = TestClient(main_module.app)
    assert client.get("/api/health").status_code == 200
