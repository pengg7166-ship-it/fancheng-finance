# Register Windows scheduled tasks for forward sim outbox export (3 session slots)
# Usage (PowerShell, user logged in):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\install-forward-export-task.ps1
# Remove:
#   .\scripts\install-forward-export-task.ps1 -Remove

param(
  [string]$TaskPrefix = 'FanchengFinance-ForwardExport',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$NodeScript = Join-Path $RepoRoot 'scripts\forward-export-pipeline.js'

if (-not (Test-Path $NodeScript)) {
  throw "Missing $NodeScript"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCmd) { $nodeCmd.Source } else { $null }
if (-not $node) {
  throw 'node.exe not found in PATH'
}

$PipelineEnv = @{
  FANCHENG_DATA_DRIVE = 'E'
  QUANT_MODE = 'fundamental_chan'
  PHILOSOPHY_FILTER_V2 = '1'
  MODEL_C_LIVE_TIER = 'high_hit'
  MODEL_C_SIM_TIER = 'sim_relaxed'
  OUTBOX_FINANCE_LITE_BARS = '120'
}
$envParts = foreach ($pair in $PipelineEnv.GetEnumerator()) {
  "set $($pair.Key)=$($pair.Value)"
}
$envSet = ($envParts -join '&& ')

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$slots = @(
  @{ Name = "$TaskPrefix-Night"; Time = '20:58'; Slot = 'night_prep'; Label = '夜盘前 20:58' },
  @{ Name = "$TaskPrefix-Day"; Time = '08:58'; Slot = 'day_prep'; Label = '日盘前 08:58' },
  @{ Name = "$TaskPrefix-Early"; Time = '01:28'; Slot = 'early_morning'; Label = '凌晨 01:28' }
)

if ($Remove) {
  foreach ($s in $slots) {
    Unregister-ScheduledTask -TaskName $s.Name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed task: $($s.Name)"
  }
  exit 0
}

foreach ($s in $slots) {
  $action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c $envSet&& ""$node"" ""$NodeScript"" --slot $($s.Slot)" `
    -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $s.Time
  Register-ScheduledTask `
    -TaskName $s.Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null
  Write-Host "Registered: $($s.Name) @ daily $($s.Time) ($($s.Label))"
}

Write-Host ""
Write-Host "Repo: $RepoRoot"
Write-Host "Outbox: E:\FanchengFinance\data\outbox\signals"
Write-Host "Logs: E:\FanchengFinance\data\logs\forward-export.jsonl"
Write-Host "Manual dry-run:"
Write-Host "  FANCHENG_DATA_DRIVE=E node scripts/forward-export-pipeline.js --dry-run --slot night_prep"
Write-Host "Remove all:"
Write-Host "  .\scripts\install-forward-export-task.ps1 -Remove"
Write-Host ""
Write-Host "InfiniTrader: reload DemoFanchengOutbox in GUI; tasks only write outbox JSONL."
