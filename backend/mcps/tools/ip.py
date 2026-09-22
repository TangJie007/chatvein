"""IP 归属地工具（实现细节见 ipwhois_runtime 降级链）。"""

from __future__ import annotations

import json

from langchain_core.tools import BaseTool, tool

from mcps.ipwhois_runtime import (  # pyright: ignore[reportImplicitRelativeImport]
    lookup_ip,
    lookup_my_location,
)


@tool
def get_my_location() -> str:
    """推断用户当前所在城市/地区（本机公网出口归属地）。

    适用：用户问天气、气温、空气质量、限行、本地新闻等，但**没有说出城市/地名**时，
    先调用本工具拿省市，再去搜索或回答。也可用于「我在哪」「我这边」类问题。
    返回国家 / 省 / 市 / ISP（内网环境下是 NAT 出口，不是精确住址）。
    """
    try:
        return json.dumps(lookup_my_location(), ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        return f"定位失败: {exc}"


@tool
def lookup_ip_region(ip: str) -> str:
    """查询**给定 IP 地址**的归属地（国家 / 省 / 市 / ISP）。

    仅在用户提供了具体 IPv4/IPv6 时使用。若要推断「用户自己在哪」请用 get_my_location。
    私有 / 回环 / 保留地址不会查网，会标明原因。
    """
    try:
        return json.dumps(lookup_ip(ip), ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        return f"查询失败: {exc}"


TOOLS: tuple[BaseTool, ...] = (get_my_location, lookup_ip_region)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    # 显式问位置，或「本地场景但未提城市」的常见问法
    if any(
        k in text
        for k in (
            "我在哪",
            "我所在",
            "我的位置",
            "我的地区",
            "本机位置",
            "我这边",
            "本地",
            "附近",
            "出口 ip",
            "公网 ip",
            "where am i",
            "my location",
            "my ip location",
            "天气",
            "气温",
            "下雨",
            "空气质量",
            "雾霾",
            "限行",
            "forecast",
            "weather",
        )
    ):
        names.append("get_my_location")
    if any(
        k in text
        for k in (
            "归属地",
            "ip 归属",
            "ip归属",
            "查 ip",
            "查ip",
            "ip 地址",
            "ip地址",
            "地理位置",
            "geoip",
            "ip location",
            "ip region",
            "whois ip",
        )
    ):
        names.append("lookup_ip_region")
    return names
