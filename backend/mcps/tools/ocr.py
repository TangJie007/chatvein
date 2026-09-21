"""OCR：先 OCR.space（公共 key），失败再落到会话代码沙箱写脚本跑 RapidOCR。"""

from __future__ import annotations

import base64
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

import httpx
from langchain_core.tools import BaseTool, tool

from mcps.sandbox import (  # pyright: ignore[reportImplicitRelativeImport]
    current_sandbox,
    resolve_in_sandbox,
)
from mcps.workspace import resolve_in_workspace  # pyright: ignore[reportImplicitRelativeImport]

_ENDPOINT = "https://api.ocr.space/parse/image"
_PUBLIC_KEY = "helloworld"
_TIMEOUT = 60.0
_MAX_BYTES = 5 * 1024 * 1024
_LANGS = {
    "auto",
    "chs",
    "cht",
    "eng",
    "jpn",
    "kor",
    "fre",
    "ger",
    "spa",
    "rus",
}


def _api_key() -> str:
    return (os.environ.get("CHATVEIN_OCR_SPACE_KEY") or "").strip() or _PUBLIC_KEY


def _is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _resolve_local(path: str) -> Path | None:
    text = (path or "").strip()
    if not text:
        return None
    try:
        return resolve_in_sandbox(text)
    except ValueError:
        pass
    try:
        return resolve_in_workspace(text)
    except ValueError:
        return None


def _ocr_space(*, url: str | None, file_path: Path | None, language: str) -> tuple[str | None, str]:
    """成功返回 ``(text, "")``；失败返回 ``(None, reason)``。"""
    data = {
        "language": language if language != "auto" else "auto",
        "OCREngine": "2",
        "isOverlayRequired": "false",
        "scale": "true",
    }
    headers = {"apikey": _api_key()}
    try:
        if url:
            data["url"] = url
            response = httpx.post(
                _ENDPOINT, headers=headers, data=data, timeout=_TIMEOUT
            )
        elif file_path is not None:
            size = file_path.stat().st_size
            if size > _MAX_BYTES:
                return None, f"文件过大（{size} 字节，上限 {_MAX_BYTES}）"
            with file_path.open("rb") as handle:
                response = httpx.post(
                    _ENDPOINT,
                    headers=headers,
                    data=data,
                    files={"file": (file_path.name, handle)},
                    timeout=_TIMEOUT,
                )
        else:
            return None, "没有可识别的图片"
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        return None, f"OCR.space 请求失败: {exc}"

    if payload.get("IsErroredOnProcessing"):
        messages = payload.get("ErrorMessage") or payload.get("ErrorDetails") or "未知错误"
        if isinstance(messages, list):
            messages = "; ".join(str(part) for part in messages)
        return None, f"OCR.space 返回错误: {messages}"

    parts: list[str] = []
    for item in payload.get("ParsedResults") or []:
        text = str(item.get("ParsedText") or "").strip()
        if text:
            parts.append(text)
    if not parts:
        return None, "OCR.space 未识别出文字"
    return "\n".join(parts), ""


def _ensure_sandbox_image(
    *, url: str | None, file_path: Path | None
) -> tuple[str, None] | tuple[None, str]:
    """把图片落到会话目录，返回相对路径。"""
    try:
        root = current_sandbox()
    except ValueError as exc:
        return None, str(exc)

    inbox = root / "ocr_input"
    inbox.mkdir(parents=True, exist_ok=True)

    if file_path is not None:
        if not file_path.is_file():
            return None, f"文件不存在: {file_path}"
        try:
            file_path.relative_to(root)
            return file_path.relative_to(root).as_posix(), None
        except ValueError:
            dest = inbox / file_path.name
            shutil.copy2(file_path, dest)
            return dest.relative_to(root).as_posix(), None

    if not url:
        return None, "没有可识别的图片"
    try:
        response = httpx.get(url, timeout=_TIMEOUT, follow_redirects=True)
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        return None, f"下载图片失败: {exc}"
    content = response.content
    if len(content) > _MAX_BYTES:
        return None, f"下载内容过大（{len(content)} 字节）"
    suffix = Path(urlparse(url).path).suffix.lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
        suffix = ".png"
    dest = inbox / f"remote{suffix}"
    dest.write_bytes(content)
    return dest.relative_to(root).as_posix(), None


_SCRIPT_TEMPLATE = '''
from pathlib import Path

path = Path({img_path!r})
if not path.is_file():
    print("OCR_ERROR=file not found", flush=True)
    raise SystemExit(1)

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError as exc:
    print(f"OCR_ERROR=missing rapidocr: {{exc}}", flush=True)
    raise SystemExit(2)

engine = RapidOCR()
result, _elapse = engine(str(path))
lines = []
if result:
    for item in result:
        if len(item) >= 2 and item[1]:
            lines.append(str(item[1]).strip())
text = "\\n".join(line for line in lines if line)
print("OCR_TEXT_BEGIN")
print(text)
print("OCR_TEXT_END")
'''


def _ocr_via_sandbox(*, url: str | None, file_path: Path | None) -> tuple[str | None, str]:
    # 延迟导入，避免与 mcps.tools 包初始化形成环
    from mcps.tools import sandbox as sandbox_tools  # pyright: ignore[reportImplicitRelativeImport]

    rel, err = _ensure_sandbox_image(url=url, file_path=file_path)
    if err or not rel:
        return None, err or "无法准备图片"

    steps: list[str] = []
    created = sandbox_tools.sandbox_create_venv.invoke({})
    steps.append(f"venv: {created}")
    if "失败" in str(created) and "已存在" not in str(created):
        return None, "创建虚拟环境失败\n" + "\n".join(steps)

    installed = sandbox_tools.sandbox_pip_install.invoke(
        {"packages": "rapidocr-onnxruntime"}
    )
    steps.append(f"pip: {_clip(str(installed), 800)}")
    if "exit=" in str(installed) and "exit=0" not in str(installed):
        return None, "安装 rapidocr-onnxruntime 失败\n" + "\n".join(steps)

    script = _SCRIPT_TEMPLATE.format(img_path=rel)
    ran = sandbox_tools.sandbox_run_python.invoke(
        {"path": "ocr_run.py", "code": script, "timeout_seconds": 120}
    )
    steps.append(_clip(str(ran), 1200))
    text = _extract_ocr_text(str(ran))
    if text is None:
        return None, "本地 RapidOCR 未得到文字\n" + "\n".join(steps)
    return text, "\n".join(steps)


def _extract_ocr_text(output: str) -> str | None:
    match = re.search(r"OCR_TEXT_BEGIN\n(.*)\nOCR_TEXT_END", output, re.S)
    if not match:
        if "OCR_ERROR=" in output:
            return None
        return None
    text = match.group(1).strip()
    return text or None


def _clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


@tool
def ocr_image(source: str, language: str = "chs") -> str:
    """从图片识别文字。``source`` 可以是 http(s) URL，或工作区/当前会话目录内的相对路径。

    先用 OCR.space（默认公共 key ``helloworld``，可用 ``CHATVEIN_OCR_SPACE_KEY`` 覆盖）。
    失败时在当前会话代码沙箱里安装 RapidOCR、写脚本并执行作为降级。
    ``language``：``chs`` / ``cht`` / ``eng`` / ``jpn`` / ``auto`` 等。
    """
    text = (source or "").strip()
    if not text:
        return "source 不能为空"

    lang = (language or "chs").strip().lower() or "chs"
    if lang not in _LANGS:
        return f"不支持的 language: {language}（可用: {', '.join(sorted(_LANGS))}）"

    url: str | None = text if _is_url(text) else None
    file_path: Path | None = None if url else _resolve_local(text)
    if url is None and file_path is None:
        return f"找不到图片（请给 URL 或工作区/会话目录内路径）: {source}"
    if file_path is not None and not file_path.is_file():
        return f"不是文件或不存在: {source}"

    online, online_err = _ocr_space(url=url, file_path=file_path, language=lang)
    if online is not None:
        key_note = "public" if _api_key() == _PUBLIC_KEY else "custom"
        return f"source=ocr.space key={key_note}\n\n{online}"

    local, local_detail = _ocr_via_sandbox(url=url, file_path=file_path)
    if local is not None:
        return (
            f"source=sandbox-rapidocr\n"
            f"ocr.space_failed={online_err}\n\n"
            f"{local}"
        )
    return (
        f"OCR 失败。\n"
        f"OCR.space: {online_err}\n"
        f"本地脚本: {local_detail}"
    )


@tool
def ocr_image_base64(image_base64: str, language: str = "chs", filename: str = "image.png") -> str:
    """识别 Base64 编码的图片。先写到当前会话目录，再走与 ``ocr_image`` 相同的 OCR.space → 沙箱降级流程。"""
    raw = (image_base64 or "").strip()
    if not raw:
        return "image_base64 不能为空"
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception as exc:  # noqa: BLE001
        return f"Base64 解码失败: {exc}"
    if not data:
        return "图片数据为空"
    if len(data) > _MAX_BYTES:
        return f"图片过大（{len(data)} 字节）"
    try:
        root = current_sandbox()
    except ValueError as exc:
        return str(exc)
    name = Path(filename or "image.png").name
    if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")):
        name = "image.png"
    dest = root / "ocr_input"
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / name
    path.write_bytes(data)
    rel = path.relative_to(root).as_posix()
    return ocr_image.invoke({"source": rel, "language": language})


TOOLS: tuple[BaseTool, ...] = (ocr_image, ocr_image_base64)


def heuristic(text: str) -> list[str]:
    if any(
        k in text
        for k in (
            "ocr",
            "识别文字",
            "识别图片",
            "图片转文字",
            "提取文字",
            "读图",
            "扫描件",
            "文字识别",
        )
    ):
        return ["ocr_image"]
    return []
