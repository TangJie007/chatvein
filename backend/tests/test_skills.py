"""SkillHub 浏览代理：用假响应测归一化。"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from skills import service as skills_service


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error",
                request=httpx.Request("GET", "https://api.skillhub.cn/api/skills"),
                response=httpx.Response(self.status_code),
            )

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeClient:
    def __init__(self, payload: dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self._status_code = status_code
        self.last_url: str | None = None
        self.last_params: dict[str, Any] | None = None

    def __enter__(self) -> _FakeClient:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def get(self, url: str, params: dict[str, Any] | None = None) -> _FakeResponse:
        self.last_url = url
        self.last_params = params
        return _FakeResponse(self._payload, self._status_code)


def test_list_skills_normalizes(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "code": 0,
        "message": "success",
        "data": {
            "total": 1,
            "skills": [
                {
                    "slug": "tencent-docs",
                    "name": "腾讯文档",
                    "description": "EN desc",
                    "description_zh": "中文说明：协作文档",
                    "category": "office-efficiency",
                    "downloads": 100,
                    "installs": 8,
                    "stars": 3,
                    "version": "1.0.0",
                    "iconUrl": "https://example.com/icon.png",
                    "homepage": "https://api.skillhub.cn/tencent-adm/tencent-docs",
                    "publisher": {"name": "腾讯文档团队", "verified": True},
                    "namespace": {
                        "handle": "tencent-adm",
                        "displayName": "tencent-adm",
                    },
                    "source": "enterprise",
                    "verified": False,
                    "subCategories": [{"key": "office-doc", "name": "文档协作"}],
                    "updated_at": 1,
                }
            ],
        },
    }
    fake = _FakeClient(payload)
    monkeypatch.setattr(
        skills_service.httpx,
        "Client",
        lambda **_kwargs: fake,
    )

    result = skills_service.list_skills(page=1, page_size=12, keyword="文档")
    assert fake.last_params is not None
    assert fake.last_params["keyword"] == "文档"
    assert fake.last_params["pageSize"] == 12
    assert result["source"] == "skillhub"
    assert result["total"] == 1
    skill = result["skills"][0]
    assert skill["slug"] == "tencent-docs"
    assert skill["description"] == "中文说明：协作文档"
    assert skill["category_label"] == "办公效率"
    assert skill["publisher"] == "腾讯文档团队"
    assert skill["homepage"] == "https://skillhub.cn/skills/tencent-docs"
    assert skill["sub_categories"] == ["文档协作"]
    assert any(c["id"] == "office-efficiency" for c in result["categories"])


def test_list_skills_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeClient({"code": 0, "data": {"skills": []}}, status_code=503)
    monkeypatch.setattr(skills_service.httpx, "Client", lambda **_kwargs: fake)
    with pytest.raises(RuntimeError, match="HTTP 503"):
        skills_service.list_skills()
