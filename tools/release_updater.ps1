# 生成更新清单 latest.json + 安装包签名，并打印上传到 COS 的提示。
#
# 用法（在仓库根目录，PowerShell）：
#   .\tools\release_updater.ps1 -Version 0.1.1 -Notes "修复 xxx"
#
# 前置：
#   1. 已用 `npx tauri signer generate -w $HOME/.tauri/chatvein.key --ci` 生成过密钥对；
#   2. 私钥文件路径可通过环境变量 TAURI_SIGNING_PRIVATE_KEY_PATH 覆盖；
#   3. 已用 `npm run tauri build` 产出 NSIS 安装包（构建时用 --config 注入真实 endpoint，
#      见 docs/release.md「每次发版流程」；仓库内 tauri.conf.json 的 endpoints 保持空数组）。
#
# 产出：
#   dist-updater/latest.json   ← 上传到 COS 桶的 updater/ 目录
#   dist-updater/<安装包>.sig  ← 签名文件，与安装包一起上传
#
# COS 上传结构：
#   updater/
#     latest.json
#     ChatVein_<ver>_x64-setup.exe
#
# endpoint 需与 tauri.conf.json 的 plugins.updater.endpoints 一致。
param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$Notes = "请填写本次更新说明",

  # COS 更新清单的公开访问 URL（与 tauri.conf.json 的 endpoints 一致）
  [string]$BaseUrl = "https://lingjin-app-1254228834.cos.ap-guangzhou.myqcloud.com/chatvein/updater"
)

$ErrorActionPreference = "Stop"

# 1. 定位 NSIS 安装包（优先 x64）
$bundle = "src-tauri/target/release/bundle"
$setup = Get-ChildItem -Path "$bundle/nsis" -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch "-updater" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setup) {
  Write-Error "未找到 NSIS 安装包，请先运行：npm run tauri build（targets 需包含 nsis）"
}

# 2. 签名（生成 base64 signature + .sig 文件）
$env:TAURI_SIGNING_PRIVATE_KEY_PATH ??= "$HOME/.tauri/chatvein.key"
if (-not (Test-Path $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
  Write-Error "私钥不存在：$($env:TAURI_SIGNING_PRIVATE_KEY_PATH)（先运行 npx tauri signer generate -w `$HOME/.tauri/chatvein.key --ci）"
}

$sigText = npx tauri signer sign -f $setup.FullName | Select-Object -Last 1 | Out-String
$sigText = $sigText.Trim()

# 3. 生成最新清单
$manifest = [ordered]@{
  version  = $Version
  notes    = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $sigText
      url       = "$BaseUrl/$($setup.Name)"
    }
  }
}

$outDir = "dist-updater"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path "$outDir/latest.json" -Encoding UTF8
$sigText | Set-Content -Path "$outDir/$($setup.Name).sig" -Encoding UTF8
Copy-Item $setup.FullName -Destination "$outDir/$($setup.Name)" -Force

Write-Host ""
Write-Host "=== 发版产物已生成：$outDir ===" -ForegroundColor Green
Get-ChildItem $outDir | ForEach-Object { Write-Host "  $($_.Name)  ($([math]::Round($_.Length/1MB,2)) MB)" }

Write-Host ""
Write-Host "=== 上传到 COS ===" -ForegroundColor Cyan
Write-Host "把 $outDir 下所有文件上传到 COS 桶的 chatvein/updater/ 目录（公有读或 CDN 可读）："
Write-Host "  $outDir/latest.json"
Write-Host "  $outDir/$($setup.Name)"
Write-Host ""
Write-Host "上传后请在 COS 控制台 / CDN 刷新 latest.json 缓存，否则客户端可能拿到旧清单。"
Write-Host "验证：浏览器打开 $BaseUrl/latest.json 应返回上述 JSON。"
