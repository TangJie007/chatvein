<#:
.SYNOPSIS
    Compatibility shim — backend packaging now uses PyInstaller.

.DESCRIPTION
    Delegates to tools/build_backend.ps1. Kept so existing
    `npm run prepare:runtime` invocations keep working.
#>
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "build_backend.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
