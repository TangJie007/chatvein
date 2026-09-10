$ErrorActionPreference = 'Continue'

$out = Join-Path $PSScriptRoot 'dev.out.log'
$err = Join-Path $PSScriptRoot 'dev.err.log'
Remove-Item $out, $err -ErrorAction SilentlyContinue

$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm dev' -PassThru `
  -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden

Start-Sleep -Seconds 30

$exited = $p.HasExited
if (-not $exited) {
  taskkill /F /T /PID $p.Id 2>$null | Out-Null
}
taskkill /F /IM electron.exe 2>$null | Out-Null

Write-Output ('hasExited=' + $exited)
if ($exited) { Write-Output ('exitCode=' + $p.ExitCode) }

Write-Output '--- STDOUT ---'
Get-Content $out -ErrorAction SilentlyContinue
Write-Output '--- STDERR ---'
Get-Content $err -ErrorAction SilentlyContinue
