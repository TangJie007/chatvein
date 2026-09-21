"""mcp-ip：ip2region 解析与工具注册（不强制联网下载 xdb）。"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from mcps.ip2region_runtime import lookup_ip, parse_region
from mcps.registry import tool_groups
from mcps.tools.ip import get_my_location, heuristic, lookup_ip_region


def test_parse_region_splits_pipe_fields() -> None:
    data = parse_region("中国|广东省|深圳市|电信|CN")
    assert data["country"] == "中国"
    assert data["province"] == "广东省"
    assert data["city"] == "深圳市"
    assert data["isp"] == "电信"
    assert data["country_code"] == "CN"


def test_lookup_private_ip_skips_db() -> None:
    result = lookup_ip("127.0.0.1")
    assert result["private"] is True
    assert result["region"]["isp"] == "内网/保留地址"

    lan = lookup_ip("192.168.1.1")
    assert lan["private"] is True


def test_lookup_ip_region_tool_rejects_bad_ip() -> None:
    out = lookup_ip_region.invoke({"ip": "not-an-ip"})
    assert out.startswith("查询失败")


def test_lookup_ip_region_tool_uses_runtime() -> None:
    fake = {
        "ip": "1.2.3.4",
        "version": 4,
        "private": False,
        "region": {
            "country": "Australia",
            "province": "Queensland",
            "city": "Brisbane",
            "isp": "",
            "country_code": "AU",
            "raw": "Australia|Queensland|Brisbane|0|AU",
        },
    }
    with patch("mcps.tools.ip.lookup_ip", return_value=fake):
        raw = lookup_ip_region.invoke({"ip": "1.2.3.4"})
    data = json.loads(raw)
    assert data["region"]["city"] == "Brisbane"


def test_get_my_location_tool_uses_runtime() -> None:
    fake = {
        "ip": "8.8.8.8",
        "version": 4,
        "private": False,
        "source": "public_egress",
        "region": {
            "country": "United States",
            "province": "",
            "city": "",
            "isp": "Google",
            "country_code": "US",
            "raw": "United States|||Google|US",
        },
    }
    with patch("mcps.tools.ip.lookup_my_location", return_value=fake):
        data = json.loads(get_my_location.invoke({}))
    assert data["ip"] == "8.8.8.8"
    assert data["source"] == "public_egress"


def test_mcp_ip_group_registered() -> None:
    groups = tool_groups()
    assert "mcp-ip" in groups
    assert set(groups["mcp-ip"]) == {"get_my_location", "lookup_ip_region"}


def test_heuristic_hits_location_keywords() -> None:
    assert "get_my_location" in heuristic("我在哪里")
    assert "lookup_ip_region" in heuristic("查一下这个 IP 归属地")


def test_ensure_xdb_respects_env_override(tmp_path: Path, monkeypatch) -> None:
    from mcps import ip2region_runtime as rt
    import ip2region.util as util

    fake = tmp_path / "custom_v4.xdb"
    fake.write_bytes(b"x" * 2048)
    monkeypatch.setenv("CHATVEIN_IP2REGION_V4", str(fake))
    rt.clear_runtime_cache()
    assert rt.ensure_xdb(util.IPv4) == fake
