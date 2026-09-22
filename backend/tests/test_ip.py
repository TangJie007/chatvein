"""mcp-ip：免费归属地降级链与工具注册。"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from mcps.ipwhois_runtime import lookup_ip
from mcps.registry import tool_groups
from mcps.tools.ip import get_my_location, heuristic, lookup_ip_region


def test_lookup_private_ip_skips_api() -> None:
    result = lookup_ip("127.0.0.1")
    assert result["private"] is True
    assert result["provider"] == "local"
    assert result["region"]["isp"] == "内网/保留地址"


def test_lookup_ip_region_tool_rejects_bad_ip() -> None:
    out = lookup_ip_region.invoke({"ip": "not-an-ip"})
    assert out.startswith("查询失败")


def test_lookup_ip_region_tool_uses_runtime() -> None:
    fake = {
        "ip": "1.2.3.4",
        "version": 4,
        "private": False,
        "source": "lookup",
        "provider": "ipinfo",
        "region": {
            "country": "澳大利亚",
            "province": "昆士兰州",
            "city": "布里斯班",
            "isp": "",
            "country_code": "AU",
        },
    }
    with patch("mcps.tools.ip.lookup_ip", return_value=fake):
        raw = lookup_ip_region.invoke({"ip": "1.2.3.4"})
    data = json.loads(raw)
    assert data["region"]["city"] == "布里斯班"


def test_get_my_location_tool_uses_runtime() -> None:
    fake = {
        "ip": "8.8.8.8",
        "version": 4,
        "private": False,
        "source": "public_egress",
        "provider": "ipwhois",
        "region": {
            "country": "美国",
            "province": "",
            "city": "",
            "isp": "Google",
            "country_code": "US",
        },
    }
    with patch("mcps.tools.ip.lookup_my_location", return_value=fake):
        data = json.loads(get_my_location.invoke({}))
    assert data["ip"] == "8.8.8.8"
    assert data["provider"] == "ipwhois"


def test_chain_falls_through_then_succeeds(monkeypatch) -> None:
    from mcps import ipwhois_runtime as rt

    calls: list[str] = []

    def fail_ipinfo(ip):  # noqa: ANN001
        calls.append("ipinfo")
        raise TimeoutError("timeout")

    def fail_whois(ip):  # noqa: ANN001
        calls.append("ipwhois")
        raise RuntimeError("rate limit")

    def ok_api(ip):  # noqa: ANN001
        calls.append("ip-api")
        return rt._result(
            ip=ip or "9.9.9.9",
            country="中国",
            province="广东省",
            city="深圳市",
            isp="电信",
            country_code="CN",
            provider="ip-api",
            source="lookup" if ip else "public_egress",
        )

    monkeypatch.setattr(rt, "_lookup_ipinfo", fail_ipinfo)
    monkeypatch.setattr(rt, "_lookup_ipwhois", fail_whois)
    monkeypatch.setattr(rt, "_lookup_ip_api", ok_api)

    out = rt.lookup_ip("1.1.1.1")
    assert out["provider"] == "ip-api"
    assert calls == ["ipinfo", "ipwhois", "ip-api"]


def test_chain_all_fail_raises_with_reasons(monkeypatch) -> None:
    from mcps import ipwhois_runtime as rt

    monkeypatch.setattr(rt, "_lookup_ipinfo", lambda _ip: (_ for _ in ()).throw(TimeoutError("t")))
    monkeypatch.setattr(rt, "_lookup_ipwhois", lambda _ip: (_ for _ in ()).throw(RuntimeError("w")))
    monkeypatch.setattr(rt, "_lookup_ip_api", lambda _ip: (_ for _ in ()).throw(RuntimeError("a")))

    with pytest.raises(RuntimeError, match="全部免费源均失败"):
        rt.lookup_my_location()


def test_mcp_ip_group_registered() -> None:
    groups = tool_groups()
    assert "mcp-ip" in groups
    assert set(groups["mcp-ip"]) == {"get_my_location", "lookup_ip_region"}


def test_heuristic_hits_location_keywords() -> None:
    assert "get_my_location" in heuristic("我在哪里")
    assert "get_my_location" in heuristic("今天天气怎么样")
    assert "lookup_ip_region" in heuristic("查一下这个 IP 归属地")
