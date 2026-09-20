<#:
.SYNOPSIS
    Freeze the ChatVein FastAPI backend with PyInstaller (onedir).

.DESCRIPTION
    Installs backend deps + pyinstaller into the repo-root `.venv`, then runs
    `backend/backend.spec` to produce:

      dist-backend/backend.exe
      dist-backend/_internal/

    Tauri ships that folder as `bundle.resources` → `backend-runtime/`.
    Safe to re-run: `--noconfirm --clean` rebuilds from scratch.
#>
$ErrorActionPreference = "Stop"

$Root       = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$ReqFile    = Join-Path $Root "backend\requirements.txt"
$SpecFile   = Join-Path $Root "backend\backend.spec"
$DistDir    = Join-Path $Root "dist-backend"
$WorkDir    = Join-Path $Root "build\pyinstaller"
$ExePath    = Join-Path $DistDir "backend.exe"

if (-not (Test-Path $VenvPython)) {
    throw "[build_backend] missing $VenvPython — create the repo-root .venv (Python 3.13) first."
}

Write-Host "[build_backend] Ensuring backend deps + pyinstaller ..."
& $VenvPython -m pip install -r $ReqFile "pyinstaller>=6.0,<7.0"
if ($LASTEXITCODE -ne 0) { throw "[build_backend] pip install failed." }

Write-Host "[build_backend] Running PyInstaller ..."
& $VenvPython -m PyInstaller $SpecFile --noconfirm --clean --distpath $Root --workpath $WorkDir
if ($LASTEXITCODE -ne 0) { throw "[build_backend] PyInstaller failed." }

if (-not (Test-Path $ExePath)) {
    throw "[build_backend] expected exe not found: $ExePath"
}

Write-Host "[build_backend] Done. Output at $DistDir"
