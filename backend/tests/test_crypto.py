"""models/crypto：凭据加密往返与旧库兼容。

数据目录来自 conftest 的 ``isolated_data`` fixture（autouse，独立 tmp 目录）。
"""

from __future__ import annotations

from models.crypto import decrypt_secret, encrypt_secret


def test_roundtrip(isolated_data) -> None:
    plain = "sk-test-abcdef-123456"
    stored = encrypt_secret(plain)
    assert stored.startswith("enc:")
    assert stored != plain
    assert decrypt_secret(stored) == plain


def test_empty_passthrough(isolated_data) -> None:
    assert encrypt_secret(None) is None
    assert encrypt_secret("") == ""
    assert decrypt_secret(None) is None
    assert decrypt_secret("") == ""


def test_legacy_plaintext_compat(isolated_data) -> None:
    # 旧库明文直接透传，不回写、不抛错
    assert decrypt_secret("sk-plain-old-value") == "sk-plain-old-value"


def test_tampered_token_returns_none(isolated_data) -> None:
    stored = encrypt_secret("secret")
    tampered = stored[:-2] + "xx"
    assert decrypt_secret(tampered) is None


def test_key_file_persisted(isolated_data) -> None:
    _ = encrypt_secret("k")
    key_file = isolated_data / "secret.key"
    assert key_file.exists()
    # 同一密钥文件可往返（模拟重启后解密）
    assert decrypt_secret(encrypt_secret("again")) == "again"
