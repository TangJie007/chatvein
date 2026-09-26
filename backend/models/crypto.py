"""本地凭据加密（Fernet）。

``llm_models.api_key`` 不再明文落库：写入前经 ``encrypt_secret`` 加密（带 ``enc:``
前缀），读取时用 ``decrypt_secret`` 还原。主密钥保存在 ``$CHATVEIN_DATA_DIR/secret.key``，
首次使用时自动生成（非 Windows 下收紧为 0600）。

即使 Agent 通过 sqlite 工具读走密文，没有密钥文件也无法还原明文——把
「SQLite 明文泄露」降级为「密钥文件泄露」才可解。

兼容旧库：无 ``enc:`` 前缀的值按历史明文处理，原样返回且不回写。
"""

from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

_PREFIX = "enc:"


def _key_path() -> Path:
    # 延迟导入，避免与 db 模块形成导入环
    from db import resolve_db_path  # pyright: ignore[reportImplicitRelativeImport]

    return resolve_db_path().parent / "secret.key"


def _load_or_create_key() -> bytes:
    path = _key_path()
    try:
        return path.read_bytes()
    except FileNotFoundError:
        pass
    key = Fernet.generate_key()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(key)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass  # Windows 无 POSIX 权限位，交给文件系统 ACL
    except OSError:
        pass  # 写入失败也允许本进程内使用
    return key


def encrypt_secret(plain: str | None) -> str | None:
    """加密待落库的明文凭据；空值原样透传。"""
    if not plain:
        return plain
    token = Fernet(_load_or_create_key()).encrypt(plain.encode("utf-8"))
    return _PREFIX + token.decode("ascii")


def decrypt_secret(stored: str | None) -> str | None:
    """解密库内密文；兼容无前缀的历史明文；解密失败返回 None 而非抛错。"""
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        return stored
    try:
        token = stored[len(_PREFIX):].encode("ascii")
        return Fernet(_load_or_create_key()).decrypt(token).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        return None
