"""本地向量模型管理（FastEmbed + ONNX Runtime）。

三条硬约束决定了这里的实现方式：

1. **权重不打包**：打包后的资源目录是只读的，模型必须落在可写的
   ``CHATVEIN_DATA_DIR``（由 Rust 消息层注入），首次使用时按需下载。
2. **国内网络**：huggingface.co 在国内长期不稳定，统一通过 ``HF_ENDPOINT``
   指向镜像站。该环境变量必须在 ``huggingface_hub`` 发起下载前设置好，
   因此 fastembed 一律采用「函数内延迟导入」，never 顶层导入。
3. **绝不在启动时同步下载**：Rust 侧 ``wait_for_backend`` 只有 20 秒超时，
   下载上百 MB 必然超时并被前端误判为“后端未就绪”。下载走后台线程，
   由前端显式触发并轮询状态。
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Sequence

from .entity import EmbeddingStatusDto

# 国内镜像站；可用 CHATVEIN_HF_ENDPOINT 覆盖。
# 若用户已显式设置过 HF_ENDPOINT（自建代理等），则不再覆盖。
DEFAULT_HF_ENDPOINT = "https://hf-mirror.com"

# 384 维、94 语言含中文。注意它不在 fastembed 内置列表里，需要显式注册。
DEFAULT_MODEL = "intfloat/multilingual-e5-small"

# 内置列表之外的模型：model_file 必须是仓库里真实存在的路径。
# multilingual-e5-small 仓库的 ONNX 产物是 onnx/model_O4.onnx，不是 onnx/model.onnx。
_CUSTOM_MODELS: dict[str, dict[str, Any]] = {
    "intfloat/multilingual-e5-small": {
        "dim": 384,
        "model_file": "onnx/model_O4.onnx",
    },
}

_DATA_DIR_ENV = "CHATVEIN_DATA_DIR"
_registered: set[str] = set()


def data_dir() -> Path:
    """可写的数据目录。

    Tauri 运行时由 Rust 注入 app_data_dir；直接跑 ``python backend/main.py``
    时回落到 ``backend/data``。
    """
    base = os.environ.get(_DATA_DIR_ENV)
    if base:
        return Path(base)
    return Path(__file__).resolve().parents[1] / "data"


def cache_dir() -> Path:
    """模型缓存目录。"""
    return data_dir() / "embeddings"


def hf_endpoint() -> str:
    """实际生效的镜像端点。"""
    return os.environ.get("CHATVEIN_HF_ENDPOINT") or DEFAULT_HF_ENDPOINT


def _apply_endpoint() -> str:
    """把镜像端点写入 HF_ENDPOINT（不覆盖用户已显式设置的值）。"""
    endpoint = hf_endpoint()
    os.environ.setdefault("HF_ENDPOINT", endpoint)
    return os.environ["HF_ENDPOINT"]


def _register_custom(model_name: str) -> None:
    """注册内置列表之外的模型（幂等）。"""
    if model_name not in _CUSTOM_MODELS or model_name in _registered:
        return
    spec = _CUSTOM_MODELS[model_name]

    # 延迟导入：确保 HF_ENDPOINT 已生效
    from fastembed import TextEmbedding
    from fastembed.common.model_description import ModelSource, PoolingType

    TextEmbedding.add_custom_model(
        model=model_name,
        pooling=PoolingType.MEAN,
        normalization=True,
        sources=ModelSource(hf=model_name),
        dim=spec["dim"],
        model_file=spec["model_file"],
    )
    _registered.add(model_name)


class EmbeddingService:
    """向量模型的安装与推理。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._downloading = False
        self._error: str | None = None
        self._model: Any = None

    @property
    def model_name(self) -> str:
        return os.environ.get("CHATVEIN_EMBED_MODEL") or DEFAULT_MODEL

    @property
    def dimension(self) -> int:
        """向量维度。建 sqlite-vec 表时需要它。"""
        spec = _CUSTOM_MODELS.get(self.model_name)
        if spec:
            return int(spec["dim"])
        return 384

    def _marker(self) -> Path:
        """下载完成标记。

        用自建标记而不是探测 fastembed 的缓存目录结构，后者属于内部实现细节。
        """
        return cache_dir() / f".ready-{self.model_name.replace('/', '__')}"

    def is_installed(self) -> bool:
        return self._marker().exists()

    def status(self) -> EmbeddingStatusDto:
        return EmbeddingStatusDto(
            model=self.model_name,
            installed=self.is_installed(),
            cache_dir=str(cache_dir()),
            endpoint=hf_endpoint(),
            downloading=self._downloading,
            error=self._error,
        )

    def prepare(self, force: bool = False) -> EmbeddingStatusDto:
        """确保模型就绪：已安装则立即返回，否则后台下载（不阻塞调用方）。"""
        with self._lock:
            if self._downloading:
                return self.status()
            if self.is_installed() and not force:
                return self.status()
            self._downloading = True
            self._error = None
        threading.Thread(target=self._download, args=(force,), daemon=True).start()
        return self.status()

    def _download(self, force: bool) -> None:
        try:
            endpoint = _apply_endpoint()
            cache = cache_dir()
            cache.mkdir(parents=True, exist_ok=True)
            if force:
                self._marker().unlink(missing_ok=True)

            _register_custom(self.model_name)
            from fastembed import TextEmbedding

            model = TextEmbedding(model_name=self.model_name, cache_dir=str(cache))
            # 真实推理一次，确认权重与 tokenizer 都可用（构造成功不代表能跑）
            next(iter(model.embed(["warmup"])))

            self._model = model
            self._marker().write_text(endpoint, encoding="utf-8")
            self._error = None
        except Exception as exc:  # noqa: BLE001 — 下载失败要如实反馈给前端
            self._error = f"{type(exc).__name__}: {exc}"
        finally:
            self._downloading = False

    def _ensure_model(self) -> Any:
        if self._model is None:
            if not self.is_installed():
                raise RuntimeError("向量模型未下载，请先调用 POST /api/embeddings/prepare")
            _register_custom(self.model_name)
            from fastembed import TextEmbedding

            self._model = TextEmbedding(
                model_name=self.model_name, cache_dir=str(cache_dir())
            )
        return self._model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """计算句向量。模型未就绪时抛 RuntimeError。"""
        model = self._ensure_model()
        return [[float(x) for x in vec] for vec in model.embed(list(texts))]

    def embed_query(self, text: str) -> list[float]:
        """查询侧向量。

        e5 系列是非对称模型：query 必须带 ``query: `` 前缀，
        被索引的文档必须带 ``passage: `` 前缀，否则效果断崖式下跌。
        """
        return self.embed([f"query: {text}"])[0]

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        """文档侧向量，自动补 ``passage: `` 前缀。"""
        return self.embed([f"passage: {t}" for t in texts])


_service: EmbeddingService | None = None
_service_lock = threading.Lock()


def get_service() -> EmbeddingService:
    """进程内单例。

    controller 与 module 必须共享同一份下载状态，否则后台线程的状态
    前端永远轮询不到。
    """
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = EmbeddingService()
    return _service
