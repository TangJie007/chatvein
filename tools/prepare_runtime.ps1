<#:
.SYNOPSIS
    Prepare a self-contained Python runtime for bundling with the Tauri app.

.DESCRIPTION
    Downloads the official "python-build-standalone" distribution (a portable,
    redistributable Python that needs no system install), extracts it into
    `python-runtime/`, ensures pip is available, and installs the backend's
    dependencies. Tauri then ships this folder via `bundle.resources`, so the
    packaged app runs Python with zero external dependencies.

    Safe to re-run: if `python-runtime/python.exe` already exists the download
    is skipped.
#>
$ErrorActionPreference = "Stop"

$Root        = Split-Path -Parent $PSScriptRoot
$RuntimeDir  = Join-Path $Root "python-runtime"
$ReqFile     = Join-Path $Root "backend\requirements.txt"
$PythonExe   = Join-Path $RuntimeDir "python.exe"

# python-build-standalone (Windows x86_64, install_only). Bump the tag/version
# here to upgrade the bundled Python. CPython 3.10 is used for broad library
# compatibility; change to a newer tag if you need a different version.
$Release     = "20260901"
$Version     = "3.10.21"
$Url         = "https://github.com/astral-sh/python-build-standalone/releases/download/$Release/cpython-$Version+${Release}-x86_64-pc-windows-msvc-install_only.tar.gz"

if (Test-Path $PythonExe) {
    Write-Host "[prepare_runtime] python-runtime already present, skipping download."
} else {
    Write-Host "[prepare_runtime] Downloading standalone Python $Version ..."
    $tmp = Join-Path $env:TEMP "pbs-python.tar.gz"
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    # The tarball wraps everything in a top-level `python/` dir; strip it so
    # python.exe lands directly at python-runtime/python.exe.
    tar.exe -xzf $tmp -C $RuntimeDir --strip-components=1
    Remove-Item $tmp
    if (-not (Test-Path $PythonExe)) {
        throw "[prepare_runtime] python.exe not found after extraction; check the archive layout."
    }
}

# Ensure pip exists (install_only builds may omit it).
& $PythonExe -m pip --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[prepare_runtime] Bootstrapping pip ..."
    $gp = Join-Path $env:TEMP "get-pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $gp -UseBasicParsing
    & $PythonExe $gp
    if ($LASTEXITCODE -ne 0) { throw "[prepare_runtime] pip bootstrap failed." }
}

Write-Host "[prepare_runtime] Installing backend dependencies ..."
& $PythonExe -m pip install -r $ReqFile
if ($LASTEXITCODE -ne 0) { throw "[prepare_runtime] dependency install failed." }

Write-Host "[prepare_runtime] Done. Runtime at $RuntimeDir"
