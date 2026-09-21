"""ip2region 运行时：xdb 按需下载缓存、离线归属地查询、公网 IP 探测。

xdb 不随安装包分发（体积约十余 MB），首次查询时下载到
``CHATVEIN_DATA_DIR/ip2region/``。可用 ``CHATVEIN_IP2REGION_V4`` /
``CHATVEIN_IP2REGION_V6`` 指向本地已有文件以跳过下载。
"""

from __future__ import annotations

import ipaddress
import os
import threading
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import ip2region.searcher as xdb
import ip2region.util as util

_DATA_DIR_ENV = "CHATVEIN_DATA_DIR"
_V4_ENV = "CHATVEIN_IP2REGION_V4"
_V6_ENV = "CHATVEIN_IP2REGION_V6"

# jsDelivr 对 GitHub raw 更稳；失败再回落官方 raw。
_V4_URLS = (
    "https://cdn.jsdelivr.net/gh/lionsoul2014/ip2region@master/data/ip2region_v4.xdb",
    "https://github.com/lionsoul2014/ip2region/raw/master/data/ip2region_v4.xdb",
)
_V6_URLS = (
    "https://cdn.jsdelivr.net/gh/lionsoul2014/ip2region@master/data/ip2region_v6.xdb",
    "https://github.com/lionsoul2014/ip2region/raw/master/data/ip2region_v6.xdb",
)

_PUBLIC_IP_URLS = (
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
)

_lock = threading.Lock()
_buffers: dict[str, Any] = {}
_searchers: dict[str, Any] = {}


def _data_dir() -> Path:
    raw = (os.environ.get(_DATA_DIR_ENV) or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path(__file__).resolve().parents[1] / "data"


def cache_dir() -> Path:
    path = _data_dir() / "ip2region"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _download(urls: tuple[str, ...], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    last_err: Exception | None = None
    for url in urls:
        try:
            req = Request(url, headers={"User-Agent": "chatvein-ip2region/1.0"})
            with urlopen(req, timeout=60) as resp:  # noqa: S310 — 固定官方 URL
                data = resp.read()
            if len(data) < 1024:
                raise RuntimeError(f"下载内容过小: {url} ({len(data)} bytes)")
            tmp.write_bytes(data)
            tmp.replace(dest)
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise RuntimeError(f"无法下载 ip2region 数据库: {last_err}")


def ensure_xdb(version: Any) -> Path:
    """返回可用 xdb 路径；缺失时下载。``version`` 为 ``util.IPv4`` / ``util.IPv6``。"""
    if version is util.IPv4:
        override = (os.environ.get(_V4_ENV) or "").strip()
        if override:
            path = Path(override).expanduser()
            if not path.is_file():
                raise FileNotFoundError(f"CHATVEIN_IP2REGION_V4 不存在: {path}")
            return path
        path = cache_dir() / "ip2region_v4.xdb"
        urls = _V4_URLS
    elif version is util.IPv6:
        override = (os.environ.get(_V6_ENV) or "").strip()
        if override:
            path = Path(override).expanduser()
            if not path.is_file():
                raise FileNotFoundError(f"CHATVEIN_IP2REGION_V6 不存在: {path}")
            return path
        path = cache_dir() / "ip2region_v6.xdb"
        urls = _V6_URLS
    else:
        raise ValueError(f"未知 IP 版本: {version}")

    if path.is_file() and path.stat().st_size > 1024:
        return path
    with _lock:
        if path.is_file() and path.stat().st_size > 1024:
            return path
        _download(urls, path)
    return path


def _searcher(version: Any) -> Any:
    key = "v4" if version is util.IPv4 else "v6"
    with _lock:
        cached = _searchers.get(key)
        if cached is not None:
            return cached
        path = ensure_xdb(version)
        # 整库入内存：可跨线程安全复用，适合桌面低频查询。
        buf = util.load_content_from_file(str(path))
        searcher = xdb.new_with_buffer(version, buf)
        _buffers[key] = buf
        _searchers[key] = searcher
        return searcher


def clear_runtime_cache() -> None:
    """测试用：清空内存中的 searcher / buffer。"""
    with _lock:
        for s in _searchers.values():
            try:
                s.close()
            except Exception:  # noqa: BLE001
                pass
        _searchers.clear()
        _buffers.clear()


def parse_region(raw: str) -> dict[str, str]:
    """解析 ``国家|省份|城市|ISP|ISO``（缺段补空）。"""
    parts = (raw or "").split("|")
    while len(parts) < 5:
        parts.append("")
    country, province, city, isp, iso = (p.strip() for p in parts[:5])
    return {
        "country": country,
        "province": province,
        "city": city,
        "isp": isp if isp not in {"0", "内网IP", "本机地址"} else ("" if isp == "0" else isp),
        "country_code": iso,
        "raw": raw or "",
    }


def classify_ip(ip: str) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, Any]:
    addr = ipaddress.ip_address((ip or "").strip())
    version = util.IPv4 if addr.version == 4 else util.IPv6
    return addr, version


def lookup_ip(ip: str) -> dict[str, Any]:
    """查询单个 IP 的归属地。私有/回环地址不查库。"""
    text = (ip or "").strip()
    if not text:
        raise ValueError("ip 不能为空")
    try:
        addr, version = classify_ip(text)
    except ValueError as exc:
        raise ValueError(f"无效 IP: {ip}") from exc

    if addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_reserved:
        return {
            "ip": str(addr),
            "version": addr.version,
            "private": True,
            "region": {
                "country": "",
                "province": "",
                "city": "",
                "isp": "内网/保留地址",
                "country_code": "",
                "raw": "",
            },
            "note": "私有、回环或保留地址无法映射到公网地理位置",
        }

    searcher = _searcher(version)
    raw = searcher.search(str(addr)) or ""
    return {
        "ip": str(addr),
        "version": addr.version,
        "private": False,
        "region": parse_region(raw),
    }


def detect_public_ip() -> str:
    """通过公网 echo 服务探测本机出口 IP。"""
    last_err: Exception | None = None
    for url in _PUBLIC_IP_URLS:
        try:
            req = Request(url, headers={"User-Agent": "chatvein-ip2region/1.0"})
            with urlopen(req, timeout=8) as resp:  # noqa: S310 — 固定 echo URL
                text = resp.read().decode("utf-8", errors="replace").strip()
            # 去掉可能的换行 / 多余空白
            candidate = text.split()[0] if text else ""
            ipaddress.ip_address(candidate)
            return candidate
        except Exception as exc:  # noqa: BLE001
            last_err = exc
    raise RuntimeError(f"无法探测公网 IP: {last_err}")


def lookup_my_location() -> dict[str, Any]:
    public_ip = detect_public_ip()
    result = lookup_ip(public_ip)
    result["source"] = "public_egress"
    return result


__all__ = [
    "cache_dir",
    "clear_runtime_cache",
    "detect_public_ip",
    "ensure_xdb",
    "lookup_ip",
    "lookup_my_location",
    "parse_region",
]
