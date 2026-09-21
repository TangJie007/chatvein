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


class _DetailFakeClient:
    def __init__(
        self,
        payload: dict[str, Any],
        *,
        skill_md: str = "# Hello\n\nbody",
        status_code: int = 200,
    ) -> None:
        self._payload = payload
        self._skill_md = skill_md
        self._status_code = status_code
        self.urls: list[str] = []

    def __enter__(self) -> _DetailFakeClient:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def get(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        self.urls.append(url)
        if url.endswith("/file"):
            return _FakeTextResponse(self._skill_md)
        return _FakeResponse(self._payload, self._status_code)


class _FakeTextResponse:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error",
                request=httpx.Request("GET", "https://api.skillhub.cn/api/v1/skills/x"),
                response=httpx.Response(self.status_code),
            )


def test_get_skill_normalizes(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "slug": "tencent-docs",
        "latestVersion": {
            "version": "2.0.0",
            "changelog": "bugfix",
            "createdAt": 2,
        },
        "owner": {"displayName": "腾讯文档团队", "handle": "tencent-adm"},
        "namespace": {
            "handle": "tencent-adm",
            "displayName": "tencent-adm",
        },
        "securityReports": {
            "keen": {
                "status": "benign",
                "statusText": "安全且无风险",
                "reportUrl": "https://example.com/report",
            }
        },
        "skill": {
            "slug": "tencent-docs",
            "displayName": "腾讯文档",
            "summary": "EN",
            "summary_zh": "中文简介",
            "overviewMd": "## 概览",
            "category": "office-efficiency",
            "iconUrl": "https://example.com/icon.png",
            "source": "enterprise",
            "verified": True,
            "updatedAt": 99,
            "stats": {
                "downloads": 10,
                "installs": 2,
                "stars": 1,
                "versions": 4,
            },
            "subCategories": [{"key": "office-doc", "name": "文档协作"}],
            "tags": {"latest": "2.0.0"},
        },
    }
    fake = _DetailFakeClient(payload, skill_md="# SKILL\n\n内容")
    monkeypatch.setattr(
        skills_service.httpx,
        "Client",
        lambda **_kwargs: fake,
    )

    result = skills_service.get_skill("tencent-docs")
    assert result["slug"] == "tencent-docs"
    assert result["name"] == "腾讯文档"
    assert result["description"] == "中文简介"
    assert result["overview_md"] == "## 概览"
    assert result["skill_md"] == "# SKILL\n\n内容"
    assert result["version"] == "2.0.0"
    assert result["changelog"] == "bugfix"
    assert result["publisher"] == "腾讯文档团队"
    assert result["homepage"] == "https://skillhub.cn/skills/tencent-docs"
    assert result["security_reports"][0]["status"] == "benign"
    assert any(u.endswith("/api/v1/skills/tencent-docs") for u in fake.urls)


def test_get_skill_rejects_bad_slug() -> None:
    with pytest.raises(ValueError, match="无效"):
        skills_service.get_skill("../etc/passwd")
