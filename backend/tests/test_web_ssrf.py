"""web_fetch SSRF 防护。"""

from __future__ import annotations

import socket

from mcps.tools.web import _ssrf_blocked


def _fake_dns(ip: str):
    def fake_getaddrinfo(host, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80))]

    return fake_getaddrinfo


def test_blocks_loopback(monkeypatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _fake_dns("127.0.0.1"))
    for url in (
        "http://127.0.0.1:8420/api/health",
        "http://127.0.0.2/x",
        "http://localhost:8000/x",
    ):
        assert _ssrf_blocked(url), f"应拦截: {url}"


def test_blocks_private_ranges() -> None:
    for url in (
        "http://10.0.0.5/",
        "http://172.16.1.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://0.0.0.0/",
    ):
        assert _ssrf_blocked(url), f"应拦截: {url}"


def test_blocks_cloud_metadata_domain() -> None:
    assert _ssrf_blocked("http://metadata.google.internal/")
    assert _ssrf_blocked("http://localhost.localdomain/")


def test_blocks_private_resolving_domain(monkeypatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _fake_dns("192.168.0.9"))
    assert _ssrf_blocked("http://internal.example.com/")


def test_allows_public(monkeypatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _fake_dns("93.184.216.34"))
    assert _ssrf_blocked("https://example.com/") is None
    assert _ssrf_blocked("https://openai.com/v1") is None


def test_bad_url() -> None:
    assert _ssrf_blocked("") is not None
    # 无主机名的 URL 一律拒绝（如 file:/// 形式）
    assert _ssrf_blocked("file:///etc/passwd") is not None
