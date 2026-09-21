"""Windows 按需下载 MinGit（含 bash），不随安装包分发。

探测不到本机 Git Bash 时，下载到 ``CHATVEIN_DATA_DIR/git-bash/``。
``CHATVEIN_SKIP_BASH_DOWNLOAD=1`` 关闭自动下载；失败则由上层降级到 PowerShell。
"""

from __future__ import annotations

import hashlib
import os
import platform
import shutil
import threading
import time
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

# 钉死版本 + SHA256，避免 always-latest 被劫持。来源：git-for-windows releases。
_MINGIT_AMD64 = {
    "tag": "v2.55.0.windows.5",
    "name": "MinGit-2.55.0.5-64-bit.zip",
    "sha256": "56d7b226b7693196cfc71fef26568f536c4a021ab6c37ff2db4287bed908e96e",
}
_MINGIT_ARM64 = {
    "tag": "v2.55.0.windows.5",
    "name": "MinGit-2.55.0.5-arm64.zip",
    "sha256": "05843f9d6e60306c3ab886799e2c67200caab921571f10512df3493049179ddb",
}

_UA = "chatvein-mingit/1.0"
_lock = threading.Lock()
_FAIL_COOLDOWN_S = 24 * 3600


def _data_dir() -> Path:
    raw = (os.environ.get("CHATVEIN_DATA_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path(__file__).resolve().parents[1] / "data"


def install_dir() -> Path:
    path = _data_dir() / "git-bash"
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def skip_download() -> bool:
    return (os.environ.get("CHATVEIN_SKIP_BASH_DOWNLOAD") or "").strip() == "1"


def force_download() -> bool:
    return (os.environ.get("CHATVEIN_FORCE_BASH_DOWNLOAD") or "").strip() == "1"


def _asset() -> dict[str, str] | None:
    if os.name != "nt":
        return None
    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return dict(_MINGIT_ARM64)
    return dict(_MINGIT_AMD64)


def _urls(asset: dict[str, str]) -> tuple[str, ...]:
    tag = asset["tag"]
    name = asset["name"]
    return (
        f"https://github.com/git-for-windows/git/releases/download/{tag}/{name}",
        f"https://ghproxy.net/https://github.com/git-for-windows/git/releases/download/{tag}/{name}",
    )


def find_installed_bash() -> Path | None:
    """已解压的 MinGit 中的 bash.exe。"""
    root = install_dir()
    for rel in (
        Path("usr") / "bin" / "bash.exe",
        Path("bin") / "bash.exe",
        Path("mingw64") / "bin" / "bash.exe",
    ):
        candidate = root / rel
        if candidate.is_file():
            return candidate.resolve()
    # 兼容多一层目录（部分 zip 带顶层文件夹）
    for child in root.iterdir() if root.is_dir() else []:
        if not child.is_dir():
            continue
        for rel in (Path("usr") / "bin" / "bash.exe", Path("bin") / "bash.exe"):
            candidate = child / rel
            if candidate.is_file():
                return candidate.resolve()
    return None


def _fail_marker() -> Path:
    return install_dir() / "download-failed.txt"


def _recent_failure() -> str | None:
    if force_download():
        return None
    marker = _fail_marker()
    if not marker.is_file():
        return None
    try:
        text = marker.read_text(encoding="utf-8", errors="replace")
        mtime = marker.stat().st_mtime
    except OSError:
        return None
    if time.time() - mtime < _FAIL_COOLDOWN_S:
        return text.strip() or "上次 MinGit 下载失败"
    return None


def _mark_failure(message: str) -> None:
    try:
        _fail_marker().write_text(message[:2000], encoding="utf-8")
    except OSError:
        pass


def _clear_failure() -> None:
    try:
        _fail_marker().unlink(missing_ok=True)
    except OSError:
        pass


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _download_zip(urls: tuple[str, ...], dest: Path, *, expect_sha: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    last_err: Exception | None = None
    for url in urls:
        try:
            req = Request(url, headers={"User-Agent": _UA})
            with urlopen(req, timeout=120) as resp:  # noqa: S310 — 固定发布 URL
                with tmp.open("wb") as out:
                    shutil.copyfileobj(resp, out)
            size = tmp.stat().st_size
            if size < 1_000_000:
                raise RuntimeError(f"下载内容过小: {url} ({size} bytes)")
            if expect_sha:
                digest = _sha256_file(tmp)
                if digest.lower() != expect_sha.lower():
                    raise RuntimeError(
                        f"SHA256 不匹配: got {digest}, want {expect_sha}"
                    )
            tmp.replace(dest)
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
    raise RuntimeError(f"无法下载 MinGit: {last_err}")


def _extract_zip(archive: Path, dest: Path) -> None:
    # 清空旧内容（保留失败标记由调用方处理）
    for child in list(dest.iterdir()) if dest.is_dir() else []:
        if child.name in {"download-failed.txt", archive.name}:
            continue
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            try:
                child.unlink()
            except OSError:
                pass
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(dest)


def ensure_mingit_bash() -> Path:
    """返回 MinGit 内 bash 路径；缺失则下载。非 Windows 或跳过下载时抛错。"""
    if os.name != "nt":
        raise RuntimeError("仅 Windows 支持按需下载 MinGit")
    if skip_download():
        raise RuntimeError("已用 CHATVEIN_SKIP_BASH_DOWNLOAD=1 关闭 MinGit 下载")

    existing = find_installed_bash()
    if existing is not None:
        return existing

    recent = _recent_failure()
    if recent:
        raise RuntimeError(recent)

    asset = _asset()
    if asset is None:
        raise RuntimeError("当前平台不支持 MinGit 自动下载")

    with _lock:
        existing = find_installed_bash()
        if existing is not None:
            return existing
        recent = _recent_failure()
        if recent:
            raise RuntimeError(recent)

        root = install_dir()
        zip_path = root / asset["name"]
        try:
            if not zip_path.is_file() or zip_path.stat().st_size < 1_000_000:
                print(f"正在下载 MinGit（{asset['name']}）…", flush=True)
                _download_zip(_urls(asset), zip_path, expect_sha=asset.get("sha256") or "")
            print("正在解压 MinGit…", flush=True)
            _extract_zip(zip_path, root)
            bash = find_installed_bash()
            if bash is None:
                raise RuntimeError("MinGit 解压后未找到 bash.exe")
            _clear_failure()
            # 可选：删掉 zip 省空间
            try:
                zip_path.unlink(missing_ok=True)
            except OSError:
                pass
            return bash
        except Exception as exc:  # noqa: BLE001
            _mark_failure(str(exc))
            raise


def try_ensure_mingit_bash() -> tuple[Path | None, str | None]:
    """``(path, None)`` 成功；``(None, reason)`` 失败（调用方降级 PowerShell）。"""
    try:
        return ensure_mingit_bash(), None
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


__all__ = [
    "ensure_mingit_bash",
    "find_installed_bash",
    "install_dir",
    "skip_download",
    "try_ensure_mingit_bash",
]
