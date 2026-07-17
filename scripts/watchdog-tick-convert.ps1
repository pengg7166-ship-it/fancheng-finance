# watchdog-tick-convert.ps1 — 每 5 分钟巡检 tick 转换与 keep-awake，更新状态快照
$ErrorActionPreference = 'SilentlyContinue'
$RepoRoot = 'E:\FanchengFinance\source\fancheng-finance'
$TradingDirE = 'E:\FanchengFinance\data\history\trading'
$TradingDirD = 'E:\FanchengFinance\data\history\trading'
$ProgressFile = Join-Path $TradingDirE 'tick-convert-progress.json'
$StatusFile = Join-Path $TradingDirE 'TICK_CONVERT_STATUS.md'
$WatchdogLog = Join-Path $RepoRoot '_tick-convert-watchdog.log'
$ConvertLog = Join-Path $RepoRoot '_tick-convert-log.txt'
$KeepAwakeScript = Join-Path $RepoRoot '_keep-awake-executionstate.ps1'
$StagingRoot = 'E:\FanchengFinance\data\history\tick-staging'
$ZipCacheBase = ''
$ZipSourceBase = 'E:\BaiduNetdiskDownload'
$ConvertWorkers = 10
$TotalZips = 1951
$IntervalSec = 300
$StallMinutes = 45

function Write-WdLog([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Add-Content -Path $WatchdogLog -Value $line -Encoding UTF8
}

function Get-ConvertProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -match 'convert-tick-zips-to-daily'
  }
}

function Get-KeepAwakeProcesses {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -match '_keep-awake-executionstate\.ps1'
  }
}

function Start-ConvertHidden {
  if (Get-ConvertProcesses) {
    Write-WdLog 'Skip start convert: already running'
    return $null
  }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'node' }
  Remove-Item Env:FANCHENG_DATA_DRIVE -ErrorAction SilentlyContinue
  $args = @(
    'scripts/convert-tick-zips-to-daily.js',
    '--workers', "$ConvertWorkers",
    '--staging', $StagingRoot,
    '--output', $TradingDirD,
    '--progress-dir', $TradingDirE,
    '--progress-every', '100',
    '--flush-every', '200'
  )
  if ($ZipCacheBase -and (Test-Path $ZipCacheBase)) {
    $args += @('--base', $ZipCacheBase, '--fallback-base', $ZipSourceBase)
  } else {
    $args += @('--base', $ZipSourceBase)
  }
  $argStr = ($args | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
  $cmd = "cd /d `"$RepoRoot`" && set FANCHENG_DATA_DRIVE= && `"$node`" $argStr >> `"$ConvertLog`" 2>&1"
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) -WindowStyle Hidden -PassThru
  Write-WdLog "Started convert via cmd PID $($p.Id) args=$argStr"
  return $p.Id
}

function Start-KeepAwakeHidden {
  if (-not (Test-Path $KeepAwakeScript)) {
    Write-WdLog "Keep-awake script missing: $KeepAwakeScript"
    return $null
  }
  if (Get-KeepAwakeProcesses) {
    Write-WdLog 'Skip start keep-awake: already running'
    return (Get-KeepAwakeProcesses | Select-Object -First 1).ProcessId
  }
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-File', $KeepAwakeScript
  ) -PassThru
  Write-WdLog "Started keep-awake PID $($p.Id)"
  return $p.Id
}

function Clear-FailedStaging([array]$errors) {
  if (-not $errors -or $errors.Count -eq 0) { return }
  foreach ($err in $errors) {
    $zip = if ($err.zip) { $err.zip } else { $null }
    if (-not $zip) { continue }
    $base = [System.IO.Path]::GetFileNameWithoutExtension($zip)
    foreach ($w in @('w0','w1','w2','w3','w4','w5','w6','w7','w8','w9','w10','w11')) {
      $dir = Join-Path (Join-Path $StagingRoot $w) $base
      if (Test-Path $dir) {
        try {
          Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
          Write-WdLog "Cleared staging for failed zip: $dir"
        } catch {
          Write-WdLog "Staging clear failed: $dir — $($_.Exception.Message)"
        }
      }
    }
  }
}

function Get-RateFromLog {
  if (-not (Test-Path $ConvertLog)) { return $null }
  $m = Select-String -Path $ConvertLog -Pattern 'rate=([\d.]+)\s+zip/min' | Select-Object -Last 1
  if ($m) { return [double]$m.Matches[0].Groups[1].Value }
  return $null
}

function Update-StatusFile {
  param([int]$ConvertPid, [int]$KeepAwakePid, [string]$OneLineStatus)
  $processed = 0; $failed = 0; $lastZip = ''; $updatedAt = ''; $errors = @()
  if (Test-Path $ProgressFile) {
    try {
      $prog = Get-Content $ProgressFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($prog.processedZips) { $processed = @($prog.processedZips).Count }
      if ($prog.stats) {
        $failed = [int]$prog.stats.zipsFailed
        $lastZip = [string]$prog.stats.lastZip
        $updatedAt = [string]$prog.stats.updatedAt
        if ($prog.stats.errors) { $errors = @($prog.stats.errors) }
      }
    } catch { Write-WdLog "Progress parse error: $($_.Exception.Message)" }
  }
  Clear-FailedStaging $errors
  $remaining = [Math]::Max(0, $TotalZips - $processed)
  $pct = if ($TotalZips -gt 0) { [Math]::Round(100.0 * $processed / $TotalZips, 2) } else { 0 }
  $rate = Get-RateFromLog
  $etaHours = if ($rate -and $rate -gt 0 -and $remaining -gt 0) { [Math]::Round($remaining / $rate / 60.0, 1) } else { '—' }
  $failList = if ($errors.Count -gt 0) {
    ($errors | ForEach-Object { "- $($_.zip): $($_.error)" }) -join "`n"
  } else { '(none)' }
  $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'
  $rateStr = if ($null -ne $rate) { "$rate" } else { '—' }
  $md = @"
# Tick ZIP → Daily 转换状态

**状态**: **$OneLineStatus**

| 项目 | 值 |
|------|-----|
| 总 zip 数 | $TotalZips |
| 已完成 | $processed |
| 剩余 | $remaining |
| 进度 | ${pct}% |
| 失败数 (stats) | $failed |
| 速率 (zip/min) | $rateStr |
| 预计剩余 (小时) | $etaHours |
| progress updatedAt | $updatedAt |
| 转换进程 PID | $(if ($ConvertPid) { $ConvertPid } else { '—' }) |
| keep-awake PID | $(if ($KeepAwakePid) { $KeepAwakePid } else { '—' }) |
| workers / staging | $ConvertWorkers / $StagingRoot |
| 输出 (SSD) | $TradingDirD |
| zip 源 | $(if ($ZipCacheBase -and (Test-Path $ZipCacheBase)) { "$ZipCacheBase + $ZipSourceBase" } else { $ZipSourceBase }) |
| 优化模式 | tar -xOf 流式读 zip（无 800MB 落盘） |
| 本文件更新 | $now |

## 最后处理的 zip

$lastZip

## 失败列表

$failList

## 晚间自查

- 状态文件: $StatusFile
- 转换日志: $ConvertLog
- 看门狗日志: $WatchdogLog
"@
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($StatusFile, $md, $utf8NoBom)
}

function Invoke-WatchdogTick {
  param([ref]$LastProgressUpdatedAt)
  $convertProcs = @(Get-ConvertProcesses)
  $convertPid = if ($convertProcs.Count -gt 0) { [int]$convertProcs[0].ProcessId } else { 0 }
  if (-not $convertPid) {
    Write-WdLog 'Convert not running — restarting'
    $newPid = Start-ConvertHidden
    if ($newPid) { $convertPid = [int]$newPid }
    $status = 'NEEDS_RESTART'
  } else { $status = 'RUNNING' }
  $kaProcs = @(Get-KeepAwakeProcesses)
  $kaPid = if ($kaProcs.Count -gt 0) { [int]$kaProcs[0].ProcessId } else { 0 }
  if (-not $kaPid) {
    Write-WdLog 'Keep-awake not running — restarting'
    $np = Start-KeepAwakeHidden
    if ($np) { $kaPid = [int]$np }
  }
  $curUpdated = ''
  if (Test-Path $ProgressFile) {
    try {
      $prog = Get-Content $ProgressFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $curUpdated = [string]$prog.stats.updatedAt
    } catch {}
  }
  if ($convertPid -and $curUpdated -and $LastProgressUpdatedAt.Value) {
    if ($LastProgressUpdatedAt.Value -eq $curUpdated) {
      try {
        $lastDt = [DateTime]::Parse($LastProgressUpdatedAt.Value)
        $mins = ((Get-Date).ToUniversalTime() - $lastDt.ToUniversalTime()).TotalMinutes
        if ($mins -ge $StallMinutes) { $status = 'STALLED' }
      } catch {}
    }
  }
  if ($curUpdated) { $LastProgressUpdatedAt.Value = $curUpdated }
  Update-StatusFile -ConvertPid $convertPid -KeepAwakePid $kaPid -OneLineStatus $status
  Write-WdLog "Tick status=$status convertPid=$convertPid keepAwakePid=$kaPid updatedAt=$curUpdated"
}

Set-Location $RepoRoot
Write-WdLog 'Watchdog loop started (max-speed E: output)'
$lastUpdated = $null
while ($true) {
  try { Invoke-WatchdogTick ([ref]$lastUpdated) } catch { Write-WdLog "Watchdog error: $($_.Exception.Message)" }
  Start-Sleep -Seconds $IntervalSec
}

