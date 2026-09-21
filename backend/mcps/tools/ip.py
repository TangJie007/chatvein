"""IP 归属地：ip2region 离线查询（本机出口 / 给定 IP）。"""

from __future__ import annotations

import json

from langchain_core.tools import BaseTool, tool

from mcps.ip2region_runtime import (  # pyright: ignore[reportImplicitRelativeImport]
    lookup_ip,
    lookup_my_location,
)


@tool
def get_my_location() -> str:
    """获取本机公网出口 IP 及其归属地（国家 / 省 / 市 / ISP）。

    先探测出口公网 IP，再用本地 ip2region 库离线解析。
    内网环境下返回的是 NAT 出口位置，不是局域网地址。
    首次使用会按需下载 xdb 数据库到数据目录。
    """
    try:
        return json.dumps(lookup_my_location(), ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        return f"定位失败: {exc}"


@tool
def lookup_ip_region(ip: str) -> str:
    """查询给定 IP 的归属地（国家 / 省 / 市 / ISP）。

    支持 IPv4 与 IPv6。私有、回环、保留地址不会查库，会标明原因。
    首次使用会按需下载对应版本的 xdb 数据库。
    """
    try:
        return json.dumps(lookup_ip(ip), ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        return f"查询失败: {exc}"


TOOLS: tuple[BaseTool, ...] = (get_my_location, lookup_ip_region)


def heuristic(text: str) -> list[str]:
    names: list[str] = []
    if any(
        k in text
        for k in (
            "我在哪",
            "我所在",
            "我的位置",
            "我的地区",
            "本机位置",
            "出口 ip",
            "公网 ip",
            "where am i",
            "my location",
            "my ip location",
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
