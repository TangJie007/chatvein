"""沙箱加固（批次 3 §3.1，不做容器）：环境变量清洗 + 资源限额 + 网络软隔离 + pip 源白名单。

三层边界，强度依次递减（文档与 UI 必须如实标注「软隔离」）：

1. **环境变量**：子进程只拿到清洗后的环境，``*_KEY / *_TOKEN / *_SECRET / PASSWORD``
   以及全部 ``CHATVEIN_*`` 一律丢弃（需要透传时用 ``CHATVEIN_SANDBOX_ENV_PASSTHROUGH``）。
   这是**硬**的：密钥根本不出现在子进程的 ``os.environ`` 里。
2. **资源限额**：POSIX 走 ``resource.setrlimit``（CPU / 地址空间 / 文件大小），
   Windows 走 Job Object（进程内存 + CPU 时间 + 关句柄即杀进程）；超时仍是最后兜底。
   这是**硬**的（除非进程主动 ``SetProcessAffinity`` 之类绕过，普通脚本做不到）。
3. **网络**：只有两层软隔离——``sitecustomize`` 在脚本里 patch ``socket.connect``，
   bash / powershell 注入黑洞代理。用户脚本显式重绑 ``socket`` 就能绕过，
   所以定位是「防误用、防模型乱联网」，**不是**防对抗。真硬边界需要 OS 防火墙/容器，
   本批明确不做。

开关（任一关闭即回到旧行为，可独立回滚）：

- ``CHATVEIN_SANDBOX_GUARD=0``：整体关闭（env + 限额 + 网络全部恢复旧行为）
- ``CHATVEIN_SANDBOX_LIMITS=0``：只关资源限额
- ``CHATVEIN_SANDBOX_NETWORK=1``：只放开网络（默认禁用）
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

#: 敏感键：命中即从子进程环境里删掉。``API`` 单独列出是因为不少 SDK 用 ``XXX_API``。
_SENSITIVE = re.compile(
    r"(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|API)",
    re.IGNORECASE,
)

#: 显式透传名单（逗号分隔的键名），给「某个工具确实需要自定义变量」留的口子。
_PASSTHROUGH_ENV = "CHATVEIN_SANDBOX_ENV_PASSTHROUGH"

#: 黑洞代理：只影响「尊重代理设置」的 HTTP 客户端，其实只是软约束。
_BLACKHOLE = "http://127.0.0.1:9"
_PROXY_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")

_SITE_MARKER = "# chatvein-sandbox-guard"

_SITE_TEMPLATE = '''{marker}
"""沙箱网络软隔离（由 mcps/sandbox_guard.py 生成，勿手改）。

默认只放行本机回环地址；脚本重绑 socket / 绕到 ctypes 可突破，
这里的目标是「防误用」，不是安全硬边界。
"""

import socket

_LOCAL_HOSTS = {{"127.0.0.1", "::1", "localhost", "0.0.0.0", ""}}
_ALLOWED_FAMILIES = {{socket.AF_INET, socket.AF_INET6}}
if hasattr(socket, "AF_UNIX"):
    _ALLOWED_FAMILIES.add(socket.AF_UNIX)


def _host_of(address):
    if isinstance(address, (str, bytes)):
        return ""
    if isinstance(address, (tuple, list)) and address:
        return str(address[0])
    return ""


def _is_local(address):
    host = _host_of(address)
    if not host:
        return True
    return host.split(":")[0] in _LOCAL_HOSTS


def _deny(host):
    raise OSError(
        "沙箱网络已禁用（sandbox network disabled）：拒绝连接 {{}}。"
        "需要联网请让用户把 CHATVEIN_SANDBOX_NETWORK 设为 1，"
        "或改用 web_search / web_fetch。".format(host or "外部地址")
    )


def _install():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def connect(self, address):
        if self.family in _ALLOWED_FAMILIES and not _is_local(address):
            _deny(_host_of(address))
        return original_connect(self, address)

    def connect_ex(self, address):
        # connect_ex 的约定是不抛异常，用 ECONNREFUSED 语义的 111 表示被拒。
        if self.family in _ALLOWED_FAMILIES and not _is_local(address):
            return 111
        return original_connect_ex(self, address)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex

    original_create_connection = socket.create_connection

    def create_connection(address, *args, **kwargs):
        if not _is_local(address):
            _deny(_host_of(address))
        return original_create_connection(address, *args, **kwargs)

    socket.create_connection = create_connection


_install()
'''


def _flag(name: str, default: str = "1") -> bool:
    return (os.environ.get(name, default) or default).strip() != "0"


def guard_enabled() -> bool:
    return _flag("CHATVEIN_SANDBOX_GUARD", "1")


def limits_enabled() -> bool:
    return guard_enabled() and _flag("CHATVEIN_SANDBOX_LIMITS", "1")


def network_enabled() -> bool:
    """``CHATVEIN_SANDBOX_NETWORK=1`` 才允许出网；默认禁用。"""
    if not guard_enabled():
        return True
    return (os.environ.get("CHATVEIN_SANDBOX_NETWORK", "0") or "0").strip() == "1"


def network_notice() -> str:
    """给模型看的一句话（工具返回值 / 审计里复用同一措辞）。"""
    if network_enabled():
        return "network=enabled（沙箱联网已放开）"
    return (
        "network=disabled（软隔离）：脚本内 socket 只能连本机回环；"
        "需要联网请用 web_search / web_fetch"
    )


def _passthrough() -> set[str]:
    raw = (os.environ.get(_PASSTHROUGH_ENV) or "").strip()
    if not raw:
        return set()
    return {part.strip() for part in raw.split(",") if part.strip()}


def is_sensitive_key(key: str) -> bool:
    """键名是否属于「绝不透传」的敏感类别（只判键名，不看值）。"""
    return bool(_SENSITIVE.search(key or "")) or (key or "").upper().startswith("CHATVEIN_")


def dropped_env_keys(base: dict[str, str] | None = None) -> list[str]:
    """返回会被清洗掉的键名（只返回键名，绝不返回值）。"""
    source = os.environ if base is None else base
    allow = _passthrough()
    return sorted(key for key in source if key not in allow and is_sensitive_key(key))


def sanitize_env(base: dict[str, str] | None = None) -> dict[str, str]:
    """子进程环境：去掉敏感键与 ``CHATVEIN_*``，其余原样保留。

    不采用纯白名单：``JAVA_HOME`` / ``GOPATH`` / 自定义 ``NPM_CONFIG_*`` 这类
    非敏感变量一旦被砍，用户脚本会莫名其妙跑不起来；按敏感类别做黑名单更稳。
    """
    source = dict(os.environ if base is None else base)
    if not guard_enabled():
        return source
    allow = _passthrough()
    for key in [k for k in source if k not in allow and is_sensitive_key(k)]:
        source.pop(key, None)
    return source


def apply_network_env(env: dict[str, str]) -> dict[str, str]:
    """网络禁用时注入黑洞代理（软约束）。已显式配置代理的环境不覆盖。"""
    if network_enabled():
        return env
    for key in _PROXY_KEYS:
        env.setdefault(key, _BLACKHOLE)
    env["NO_PROXY"] = env.get("NO_PROXY") or "127.0.0.1,localhost"
    env["no_proxy"] = env.get("no_proxy") or "127.0.0.1,localhost"
    return env


def _as_int(name: str, default: int, *, low: int = 1) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return max(low, int(raw)) if raw else default
    except ValueError:
        return default


def limits() -> dict[str, int]:
    """当前生效的限额（MB 便于人读，内部换算成字节）。"""
    return {
        "cpu_seconds": _as_int("CHATVEIN_SANDBOX_CPU_SECONDS", 120),
        "memory_mb": _as_int("CHATVEIN_SANDBOX_MEMORY_MB", 1024),
        "file_mb": _as_int("CHATVEIN_SANDBOX_FILE_MB", 100),
    }


def limits_notice() -> str:
    if not limits_enabled():
        return "limits=off"
    cfg = limits()
    return f"limits=cpu {cfg['cpu_seconds']}s / mem {cfg['memory_mb']}MB / file {cfg['file_mb']}MB"


# --------------------------------------------------------------------------- #
# 网络层 1：sitecustomize
# --------------------------------------------------------------------------- #


_HOOK_DIR = ".chatvein-guard"


def guard_hook_dir(python: Path) -> Path:
    """钩子目录：``<会话>/runs/.chatvein-guard``（venv 同级，不进 site-packages）。

    不放 site-packages 的原因：``sitecustomize`` 是按 ``sys.path`` 顺序导入的，
    只要宿主（IDE / 启动脚本）设了 ``PYTHONPATH``，site-packages 里那份就轮不到；
    而把钩子目录**前置**到子进程 ``PYTHONPATH`` 能稳定抢到导入。
    """
    return python.parent.parent.parent / _HOOK_DIR


def ensure_network_guard(python: Path) -> tuple[str | None, str]:
    """写会话级 ``sitecustomize.py``：脚本进程默认连不上外网。

    返回 ``(写入路径或 None, 人话状态)``。调用方必须把 :func:`guard_pythonpath`
    的结果前置进子进程 ``PYTHONPATH``，否则钩子不会被导入。
    """
    if network_enabled():
        return None, "network=enabled，未注入 sitecustomize"
    target_dir = guard_hook_dir(python)
    target = target_dir / "sitecustomize.py"
    content = _SITE_TEMPLATE.format(marker=_SITE_MARKER)
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.read_text(encoding="utf-8", errors="replace") == content:
            return str(target), "network=disabled（sitecustomize 已就绪）"
        target.write_text(content, encoding="utf-8", newline="\n")
    except OSError as exc:
        return None, f"写入 sitecustomize 失败（网络限制仅剩黑洞代理）: {exc}"
    return str(target), "network=disabled（sitecustomize 已注入）"


def guard_pythonpath(python: Path) -> str | None:
    """钩子目录（供前置 ``PYTHONPATH``）；未注入时返回 ``None``。"""
    target = guard_hook_dir(python) / "sitecustomize.py"
    return str(target.parent) if target.is_file() else None


def with_guard_pythonpath(env: dict[str, str], python: Path) -> dict[str, str]:
    """把钩子目录前置到 ``PYTHONPATH``，保证 ``sitecustomize`` 被导入。"""
    hook = guard_pythonpath(python)
    if hook:
        existing = env.get("PYTHONPATH") or ""
        env["PYTHONPATH"] = hook + (os.pathsep + existing if existing else "")
    return env


# --------------------------------------------------------------------------- #
# 资源限额
# --------------------------------------------------------------------------- #


def _posix_preexec() -> Any:
    cfg = limits()

    def limit() -> None:  # pragma: no cover - 仅 POSIX
        try:
            import resource
        except ImportError:
            return
        mem = cfg["memory_mb"] * 1024 * 1024
        file_bytes = cfg["file_mb"] * 1024 * 1024
        for name, value in (
            ("RLIMIT_CPU", cfg["cpu_seconds"]),
            ("RLIMIT_AS", mem),
            ("RLIMIT_FSIZE", file_bytes),
        ):
            limit_type = getattr(resource, name, None)
            if limit_type is None:
                continue
            try:
                soft, hard = resource.getrlimit(limit_type)
                ceiling = value if hard in (-1, None) else min(value, hard)
                resource.setrlimit(limit_type, (ceiling, hard))
            except (ValueError, OSError):
                continue

    return limit


def _win_job(pid: int) -> Any:
    """Windows Job Object：内存 + CPU 时间上限，关句柄即杀整个进程树。

    失败（权限不足 / 已在受限 job 里）时返回 ``None``，只降级为「超时兜底」。
    """
    try:  # pragma: no cover - 仅 Windows
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        cfg = limits()

        class _BasicLimits(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class _IoCounters(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class _ExtendedLimits(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", _BasicLimits),
                ("IoInfo", _IoCounters),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        # JOB_OBJECT_LIMIT_PROCESS_TIME=0x2 / PROCESS_MEMORY=0x100 /
        # JOB_MEMORY=0x200 / KILL_ON_JOB_CLOSE=0x2000
        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            return None
        info = _ExtendedLimits()
        info.BasicLimitInformation.LimitFlags = 0x2 | 0x100 | 0x200 | 0x2000
        info.BasicLimitInformation.PerProcessUserTimeLimit = cfg["cpu_seconds"] * 10_000_000
        info.BasicLimitInformation.PerJobUserTimeLimit = cfg["cpu_seconds"] * 10_000_000
        info.ProcessMemoryLimit = cfg["memory_mb"] * 1024 * 1024
        info.JobMemoryLimit = cfg["memory_mb"] * 1024 * 1024
        if not kernel32.SetInformationJobObject(
            job, 9, ctypes.byref(info), ctypes.sizeof(info)
        ):
            kernel32.CloseHandle(job)
            return None
        # PROCESS_SET_QUOTA(0x100) | PROCESS_TERMINATE(0x1)
        handle = kernel32.OpenProcess(0x100 | 0x1, False, int(pid))
        if not handle:
            kernel32.CloseHandle(job)
            return None
        assigned = kernel32.AssignProcessToJobObject(job, handle)
        kernel32.CloseHandle(handle)
        if not assigned:
            kernel32.CloseHandle(job)
            return None
        return job
    except Exception:  # noqa: BLE001 - 加固失败不该让工具报错
        return None


def _close_job(job: Any) -> None:
    try:  # pragma: no cover - 仅 Windows
        import ctypes

        ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(job)
    except Exception:  # noqa: BLE001
        pass


# --------------------------------------------------------------------------- #
# 执行
# --------------------------------------------------------------------------- #


@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False
    #: 限额是否可能命中（超时 / 被信号杀 / 非零退出且内存限额打开）
    limit_suspect: bool = False


def guard_note() -> str:
    """工具返回值里给模型看的加固状态（一行）。"""
    return f"{limits_notice()}；{network_notice()}"


def run_limited(
    cmd: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
    apply_limits: bool = True,
) -> RunResult:
    """带资源限额的子进程执行（替代裸 ``subprocess.run``）。

    失败语义与 ``subprocess.run(check=False)`` 一致：不抛非零退出，只抛
    ``OSError``（命令本身不存在 / 无执行权限）。
    """
    child_env = sanitize_env() if env is None else env
    preexec = _posix_preexec() if (apply_limits and limits_enabled()) else None
    popen_kwargs: dict[str, Any] = {}
    if preexec is not None and os.name != "nt":
        popen_kwargs["preexec_fn"] = preexec
    process = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
        **popen_kwargs,
    )
    job = _win_job(process.pid) if (apply_limits and limits_enabled() and os.name == "nt") else None
    timed_out = False
    try:
        try:
            out, err = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            process.kill()
            out, err = process.communicate()
    finally:
        if job is not None:
            _close_job(job)
    code = process.returncode if process.returncode is not None else -1
    suspect = bool(limits_enabled() and apply_limits and (timed_out or code < 0))
    return RunResult(
        returncode=code,
        stdout=out or "",
        stderr=err or "",
        timed_out=timed_out,
        limit_suspect=suspect,
    )


# --------------------------------------------------------------------------- #
# pip
# --------------------------------------------------------------------------- #

_PIP_INDEX = "CHATVEIN_PIP_INDEX_URL"


def pip_index_url() -> str | None:
    """``CHATVEIN_PIP_INDEX_URL``：只接受 http/https，杜绝 ``file://`` 与本地路径。

    未配置时返回 ``None``（沿用 pip 默认源），不阻断离线/内网镜像场景。
    """
    raw = (os.environ.get(_PIP_INDEX) or "").strip()
    if not raw:
        return None
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"pip 源必须是 http(s) 地址，当前: {parsed.scheme or raw}")
    if not parsed.netloc:
        raise ValueError("pip 源缺少主机名")
    return raw


def pip_base_args() -> list[str]:
    """pip 公共参数：固定源（若配置）+ 关掉交互与版本检查（否则 CI 里会卡住）。"""
    args = ["--disable-pip-version-check", "--no-input"]
    index = pip_index_url()
    if index:
        args.extend(["--index-url", index])
    return args
