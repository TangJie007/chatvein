# 离线评测：跑 backend/eval/cases 下的用例，写 eval-report.json（退出码 0 = 全通过）。
#
# 用法：
#   .\tools\run_eval.ps1
#   .\tools\run_eval.ps1 -Cases backend\eval\cases\smoke.json -Judge
#   .\tools\run_eval.ps1 -Rest @("--dry-run")          # 只校验用例文件
#
# 说明：评测直接调 pipeline，不启动 HTTP 服务；每个用例用临时会话沙箱，跑完即删。
param(
    [string]$Cases = "backend/eval/cases/smoke.json",
    [switch]$Judge,
    [string]$Report = "eval-report.json",
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv/Scripts/python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

$argv = @(
    (Join-Path $root "backend/eval/runner.py"),
    "--cases", $Cases,
    "--report", $Report
)
if ($Judge) { $argv += "--judge" }
if ($Rest) { $argv += $Rest }

Push-Location $root
try {
    & $python @argv
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
