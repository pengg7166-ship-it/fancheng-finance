# 鍚姩鏈€澶ч€熷害 tick 杞崲锛堝崟杩涚▼锛?
$RepoRoot = 'E:\FanchengFinance\source\fancheng-finance'
$Log = Join-Path $RepoRoot '_tick-convert-log.txt'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'node' }
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'convert-tick-zips-to-daily' }
if ($existing) { Write-Host "Already running PID $($existing.ProcessId)"; exit 0 }
Add-Content $Log "`n=== MAX-SPEED RUN $(Get-Date -Format o) ===`n"
$args = @(
  'scripts/convert-tick-zips-to-daily.js',
  '--workers','12',
  '--staging','E:\FanchengFinance\data\history\tick-staging',
  '--output','E:\FanchengFinance\data\history\trading',
  '--progress-dir','E:\FanchengFinance\data\history\trading',
  '--progress-every','100',
  '--flush-every','200',
  '--base','E:\BaiduNetdiskDownload'
)
$argStr = ($args | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
$cmd = "cd /d `"$RepoRoot`" && set FANCHENG_DATA_DRIVE= && `"$node`" $argStr >> `"$Log`" 2>&1"
$p = Start-Process cmd -ArgumentList @('/c', $cmd) -WindowStyle Hidden -PassThru
Write-Host "Started convert PID $($p.Id)"
