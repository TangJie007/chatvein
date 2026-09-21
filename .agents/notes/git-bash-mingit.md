# Git Bash：本机优先 + MinGit 按需下载

## 策略

1. 探测本机 Git Bash（与原先一致）。
2. Windows 且未找到：下载钉死版本的 **MinGit**（含真实 `bash.exe`，非 BusyBox）到
   `CHATVEIN_DATA_DIR/git-bash/`，校验 SHA256 后解压。
3. 下载/解压失败：不注册 `mcp-bash`，设置页提示降级；Agent 继续用已有的
   `mcp-powershell`（Windows 上几乎总有）。

不把 MinGit 打进 Tauri/PyInstaller 包（约 37MB+ 压缩，解压更大），与 Chromium /
ip2region xdb 同属「数据目录按需拉取」。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `CHATVEIN_GIT_BASH` | 显式 bash 路径 |
| `CHATVEIN_SKIP_GIT_BASH_CHECK=1` | 显式路径无效时回落自动探测 |
| `CHATVEIN_SKIP_BASH_DOWNLOAD=1` | 禁止自动下载（测试默认开启） |
| `CHATVEIN_FORCE_BASH_DOWNLOAD=1` | 忽略 24h 失败冷却，强制重试 |

## 实现

- `mcps/bash_download.py`：下载 / 校验 / 解压
- `mcps/bash_runtime.py`：探测链路接入 `try_ensure_mingit_bash`
