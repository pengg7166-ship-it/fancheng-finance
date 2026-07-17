# 监控 tick 转换直至完成，然后 sync / 回测 / 写报告
param([int]$TotalZips = 1951)
$ErrorActionPreference = 'Continue'
$Repo = 'E:\FanchengFinance\source\fancheng-finance'
$ProgE = 'E:\FanchengFinance\data\history\trading\tick-convert-progress.json'
$TradingD = 'D:\FanchengFinance\data\history\trading'
$TradingE = 'E:\FanchengFinance\data\history\trading'
$Log = Join-Path $Repo '_agent-tick-monitor.log'
$ConvertLog = Join-Path $Repo '_tick-convert-log.txt'
$CompleteMd = Join-Path $TradingE 'TICK_CONVERT_COMPLETE.md'

function WLog($m) { $l="[$(Get-Date -Format o)] $m"; Add-Content $Log $l; Write-Host $l }

function Get-Rate {
  if (-not (Test-Path $ConvertLog)) { return $null }
  $m = Select-String -Path $ConvertLog -Pattern 'rate=([\d.]+)\s+zip/min' | Select-Object -Last 1
  if ($m) { return [double]$m.Matches[0].Groups[1].Value }
  return $null
}

function ConvRunning {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'convert-tick-zips-to-daily' }).Count -gt 0
}

function Ensure-Convert {
  if (ConvRunning) { return }
  WLog 'Convert not running — starting'
  & (Join-Path $Repo 'scripts\run-maxspeed-convert.ps1')
}

function Ensure-KeepAwake {
  $ka = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match '_keep-awake-executionstate' }
  if (-not $ka) {
    Start-Process powershell -ArgumentList '-NoProfile','-WindowStyle','Hidden','-File',(Join-Path $Repo '_keep-awake-executionstate.ps1') | Out-Null
    WLog 'Started keep-awake'
  }
}

$t0 = Get-Date
$restartMark = (Get-Content $ConvertLog -ErrorAction SilentlyContinue | Select-String 'MAX-SPEED RUN' | Select-Object -Last 1).Line
WLog "Monitor start total=$TotalZips"

while ($true) {
  Ensure-KeepAwake
  Ensure-Convert
  $prog = Get-Content $ProgE -Raw -Encoding UTF8 | ConvertFrom-Json
  $done = @($prog.processedZips).Count
  $failed = [int]$prog.stats.zipsFailed
  $rate = Get-Rate
  $rem = [Math]::Max(0, $TotalZips - $done)
  WLog "done=$done rem=$rem fail=$failed rate=$rate conv=$(ConvRunning)"
  if ($done -ge $TotalZips -and -not (ConvRunning)) { WLog 'All zips processed'; break }
  if ($done -ge ($TotalZips - $failed) -and -not (ConvRunning) -and $rem -le $failed) { WLog 'Done with failures'; break }
  Start-Sleep -Seconds 300
}

WLog 'Running --sync-klines'
Set-Location $Repo
$env:FANCHENG_DATA_DRIVE = ''
& node scripts/convert-tick-zips-to-daily.js --sync-klines --output $TradingD --progress-dir (Split-Path $ProgE -Parent) 2>&1 | Tee-Object -FilePath (Join-Path $Repo '_agent-sync-klines.log')

$prog2 = Get-Content $ProgE -Raw | ConvertFrom-Json
if (($prog2.stats.errors | Measure-Object).Count -gt 0 -or $prog2.stats.zipsFailed -gt 0) {
  WLog 'Retrying failures'
  & node scripts/convert-tick-zips-to-daily.js --workers 12 --staging D:\FanchengFinance\data\history\tick-staging --output $TradingD --progress-dir (Split-Path $ProgE -Parent) --progress-every 100 --flush-every 200 --base D:\FanchengFinance\data\tick-zip-cache --fallback-base E:\BaiduNetdiskDownload 2>&1 | Out-Null
}

WLog 'Robocopy trading D->E'
robocopy $TradingD $TradingE *.json /XO /MT:8 /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null

WLog 'Running tune-sector-weights-longrun'
$hit = 'n/a'
$backtestLog = Join-Path $Repo '_agent-backtest.log'
try {
  $env:FANCHENG_DATA_DRIVE = 'E'
  $out = & node scripts/tune-sector-weights-longrun.js 2>&1 | Out-String
  Set-Content $backtestLog $out -Encoding UTF8
  if ($out -match 'overall\s+(\d+)%') { $hit = $matches[1] + '%' }
} catch { WLog "Backtest error: $_" }

$inst = (Get-ChildItem $TradingE -Filter '*.json' | Where-Object { $_.Name -ne 'tick-convert-progress.json' }).Count
$final = Get-Content $ProgE -Raw | ConvertFrom-Json
$finalDone = @($final.processedZips).Count
$hrs = [math]::Round(((Get-Date) - $t0).TotalHours, 2)
$rateAfter = Get-Rate
$zh = @"
# Tick 转换完成报告

- **完成**: $finalDone / $TotalZips zip
- **失败**: $($final.stats.zipsFailed)
- **品种文件**: $inst
- **最后 zip**: $($final.stats.lastZip)
- **重启后速率**: $rateAfter zip/min
- **回测 overall**: $hit
- **耗时(监控)**: ${hrs}h

## 数据路径
- 交易 JSON (SSD): ``$TradingD``
- 交易 JSON (E: 同步): ``$TradingE``
- 进度文件: ``$ProgE``
- zip 缓存 (D:): ``D:\FanchengFinance\data\tick-zip-cache``
- zip 源 (E:): ``E:\BaiduNetdiskDownload``

## 优化项
- workers=12, flush-every=200, progress-every=100
- 输出写 D: SSD, 读 zip 优先 D: 缓存 + E: 回退
- 按品种并行 merge 队列
"@
Set-Content $CompleteMd $zh -Encoding UTF8
WLog "COMPLETE $finalDone/$TotalZips hit=$hit"
