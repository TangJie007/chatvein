"""公网 IP 归属地：免费源降级链。

顺序：ipinfo.io → ipwhois.io（ipwhois-python）→ ip-api.com。
全部不带 API Key；任一成功即返回；全部失败则抛出汇总原因。
"""

from __future__ import annotations

import ipaddress
from typing import Any, Callable

import httpx
from ipwhois import IPWhois

_TIMEOUT = httpx.Timeout(connect=3.0, read=6.0, write=6.0, pool=6.0)
_HEADERS = {"User-Agent": "ChatVein/0.1 (+ip-geo)", "Accept": "application/json"}

ProviderFn = Callable[[str | None], dict[str, Any]]


def _result(
    *,
    ip: str,
    country: str = "",
    province: str = "",
    city: str = "",
    isp: str = "",
    country_code: str = "",
    latitude: Any = None,
    longitude: Any = None,
    timezone: str | None = None,
    provider: str,
    source: str,
) -> dict[str, Any]:
    text = (ip or "").strip()
    if not text:
        raise RuntimeError(f"{provider}: 未返回 IP")
    try:
        version = ipaddress.ip_address(text).version
    except ValueError:
        version = 6 if ":" in text else 4
    return {
        "ip": text,
        "version": version,
        "private": False,
        "source": source,
        "provider": provider,
        "region": {
            "country": (country or "").strip(),
            "province": (province or "").strip(),
            "city": (city or "").strip(),
            "isp": (isp or "").strip(),
            "country_code": (country_code or "").strip(),
        },
        "latitude": latitude,
        "longitude": longitude,
        "timezone": timezone,
    }


def _lookup_ipinfo(ip: str | None) -> dict[str, Any]:
    url = "https://ipinfo.io/json" if not ip else f"https://ipinfo.io/{ip}/json"
    with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = client.get(url, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("ipinfo: 非 JSON 对象")
    err = data.get("error")
    if err:
        raise RuntimeError(f"ipinfo: {err}")
    loc = str(data.get("loc") or "")
    lat = lon = None
    if "," in loc:
        a, b = loc.split(",", 1)
        try:
            lat, lon = float(a), float(b)
        except ValueError:
            lat = lon = None
    return _result(
        ip=str(data.get("ip") or ip or ""),
        country=str(data.get("country") or ""),
        province=str(data.get("region") or ""),
        city=str(data.get("city") or ""),
        isp=str(data.get("org") or ""),
        country_code=str(data.get("country") or ""),
        latitude=lat,
        longitude=lon,
        timezone=str(data.get("timezone") or "") or None,
        provider="ipinfo",
        source="public_egress" if not ip else "lookup",
    )


def _lookup_ipwhois(ip: str | None) -> dict[str, Any]:
    client = (
        IPWhois()
        .set_language("zh-CN")
        .set_timeout(6.0)
        .set_connect_timeout(3.0)
    )
    payload = client.lookup() if not ip else client.lookup(ip)
    if not payload.get("success"):
        raise RuntimeError(f"ipwhois: {payload.get('message') or '查询失败'}")
    conn = payload.get("connection") if isinstance(payload.get("connection"), dict) else {}
    tz = payload.get("timezone") if isinstance(payload.get("timezone"), dict) else {}
    return _result(
        ip=str(payload.get("ip") or ip or ""),
        country=str(payload.get("country") or ""),
        province=str(payload.get("region") or ""),
        city=str(payload.get("city") or ""),
        isp=str(conn.get("isp") or conn.get("org") or ""),
        country_code=str(payload.get("country_code") or ""),
        latitude=payload.get("latitude"),
        longitude=payload.get("longitude"),
        timezone=str(tz.get("id") or "") or None,
        provider="ipwhois",
        source="public_egress" if not ip else "lookup",
    )


def _lookup_ip_api(ip: str | None) -> dict[str, Any]:
    # 免费档仅 HTTP；HTTPS 需付费。
    base = "http://ip-api.com/json/"
    path = "" if not ip else ip
    url = (
        f"{base}{path}?lang=zh-CN"
        "&fields=status,message,country,countryCode,regionName,city,isp,org,"
        "query,lat,lon,timezone"
    )
    with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = client.get(url, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise RuntimeError("ip-api: 非 JSON 对象")
    if str(data.get("status") or "").lower() != "success":
        raise RuntimeError(f"ip-api: {data.get('message') or '查询失败'}")
    return _result(
        ip=str(data.get("query") or ip or ""),
        country=str(data.get("country") or ""),
        province=str(data.get("regionName") or ""),
        city=str(data.get("city") or ""),
        isp=str(data.get("isp") or data.get("org") or ""),
        country_code=str(data.get("countryCode") or ""),
        latitude=data.get("lat"),
        longitude=data.get("lon"),
        timezone=str(data.get("timezone") or "") or None,
        provider="ip-api",
        source="public_egress" if not ip else "lookup",
    )


def _providers() -> list[tuple[str, ProviderFn]]:
    return [
        ("ipinfo", _lookup_ipinfo),
        ("ipwhois", _lookup_ipwhois),
        ("ip-api", _lookup_ip_api),
    ]


def _lookup_chain(ip: str | None) -> dict[str, Any]:
    errors: list[str] = []
    for name, fn in _providers():
        try:
            return fn(ip)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}: {exc}")
    detail = "；".join(errors) if errors else "无可用数据源"
    raise RuntimeError(f"全部免费源均失败（{detail}）")


def lookup_ip(ip: str) -> dict[str, Any]:
    """查询给定 IP 的归属地。私有/回环地址不请求网络。"""
    text = (ip or "").strip()
    if not text:
        raise ValueError("ip 不能为空")
    try:
        addr = ipaddress.ip_address(text)
    except ValueError as exc:
        raise ValueError(f"无效 IP: {ip}") from exc

    if addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_reserved:
        return {
            "ip": str(addr),
            "version": addr.version,
            "private": True,
            "source": "lookup",
            "provider": "local",
            "region": {
                "country": "",
                "province": "",
                "city": "",
                "isp": "内网/保留地址",
                "country_code": "",
            },
            "note": "私有、回环或保留地址无法映射到公网地理位置",
        }

    return _lookup_chain(str(addr))


def lookup_my_location() -> dict[str, Any]:
    """查询本机公网出口 IP 及其归属地（降级链）。"""
    return _lookup_chain(None)


__all__ = [
    "lookup_ip",
    "lookup_my_location",
]
