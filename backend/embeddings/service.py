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

# 768 维、中文专项（C-MTEB 中文榜第一梯队），对称模型 —— query 与文档无需任何前缀。
# 注意它不在 fastembed 内置列表里，需要显式注册。
DEFAULT_MODEL = "BAAI/bge-base-zh-v1.5"

# 内置列表之外的模型：model_file 必须是仓库里真实存在的路径，hf_source 默认等于模型名。
# - intfloat/multilingual-e5-small：384 维、94 语言含中文；仓库 ONNX 产物是
#   onnx/model_O4.onnx（不是 onnx/model.onnx）；非对称，query/文档需加前缀；MEAN 池化。
# - BAAI/bge-base-zh-v1.5：官方仓库无 ONNX 产物，fastembed 内置列表也没有，这里指向
#   Xenova/bge-base-zh-v1.5（onnx/model.onnx，单文件 fp32）。bge v1.5 是对称模型，
#   无需前缀；池化用 CLS（取 [CLS] token 向量），与 e5 的 MEAN 不同。
_CUSTOM_MODELS: dict[str, dict[str, Any]] = {
    "intfloat/multilingual-e5-small": {
        "dim": 384,
        "model_file": "onnx/model_O4.onnx",
        "pooling": "mean",
        "symmetric": False,
    },
    "BAAI/bge-base-zh-v1.5": {
        "dim": 768,
        "model_file": "onnx/model.onnx",
        "hf_source": "Xenova/bge-base-zh-v1.5",
        "pooling": "cls",
        "symmetric": True,
    },
}

_DATA_DIR_ENV = "CHATVEIN_DATA_DIR"
_registered: set[str] = set()


def _is_writable(path: Path) -> bool:
    """探测目录是否真的可写。

    必须提前探测：打包后 Rust 若解析 app_data_dir 失败会回退到
    ``<backend>/data``，而该目录位于只读资源目录内。不探测的话要等下载完
    上百 MB 才在写盘时炸掉，用户只会看到一个莫名的下载失败。
    """
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".write-probe-{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError:
        return False
    return True


_data_dir_cache: Path | None = None


def data_dir() -> Path:
    """可写的数据目录，按优先级取第一个真正可写的候选。

    1. ``CHATVEIN_DATA_DIR``（Rust 注入的 app_data_dir，打包时走这条路）
    2. 项目根的 ``.chatvein``（dev 直跑时回落）

    ⚠️ 回落目录**必须**落在可写位置：发布包里的 PyInstaller 产物位于只读
    资源目录，模型缓存若落在旁边会写失败。dev 数据库 / 权重同理，勿放进
    会被误拷进安装树的目录。

    结果做进程内缓存：写探测有 I/O，且环境变量在运行期不会变。
    """
    global _data_dir_cache
    if _data_dir_cache is not None:
        return _data_dir_cache

    candidates: list[Path] = []
    base = os.environ.get(_DATA_DIR_ENV)
    if base:
        candidates.append(Path(base))
    candidates.append(Path(__file__).resolve().parents[2] / ".chatvein")

    for candidate in candidates:
        if _is_writable(candidate):
            _data_dir_cache = candidate
            return candidate

    # 全都不可写：仍返回最后一个候选，让后续操作抛出可定位的错误
    _data_dir_cache = candidates[-1]
    return candidates[-1]


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
    """注册内置列表之外的模型（幂等）。

    池化方式与 ONNX 源仓库按模型配置：bge 系列用 CLS 池化且源仓库
    与模型名不同（官方仓库无 ONNX 产物，需指向 Xenova 转换版）。
    """
    if model_name not in _CUSTOM_MODELS or model_name in _registered:
        return
    spec = _CUSTOM_MODELS[model_name]

    # 延迟导入：确保 HF_ENDPOINT 已生效
    from fastembed import TextEmbedding
    from fastembed.common.model_description import ModelSource, PoolingType

    pooling = (
        PoolingType.CLS if spec.get("pooling") == "cls" else PoolingType.MEAN
    )
    TextEmbedding.add_custom_model(
        model=model_name,
        pooling=pooling,
        normalization=True,
        sources=ModelSource(hf=spec.get("hf_source", model_name)),
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
        return 768

    def _is_symmetric(self) -> bool:
        """当前模型是否对称（query / 文档无需加前缀）。"""
        spec = _CUSTOM_MODELS.get(self.model_name)
        return bool(spec and spec.get("symmetric"))

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
            dim=self.dimension,
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

        前缀策略随模型而异（见 ``_CUSTOM_MODELS`` 的 ``symmetric`` 字段）：
        - e5 系列是非对称模型：query 必须带 ``query: `` 前缀，否则效果断崖式下跌。
        - bge v1.5 系列是对称模型：query 与文档同分布，无需任何前缀。
        """
        if self._is_symmetric():
            return self.embed([text])[0]
        return self.embed([f"query: {text}"])[0]

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        """文档侧向量；非对称模型自动补 ``passage: `` 前缀。"""
        if self._is_symmetric():
            return self.embed(list(texts))
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
