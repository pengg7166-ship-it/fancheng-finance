# 注册 Windows 任务计划：每日 07:30 自动跑 daily-data-sync（应用未启动时兜底）
# 用法（管理员 PowerShell）:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\install-daily-sync-task.ps1
# 卸载:
#   .\scripts\install-daily-sync-task.ps1 -Remove

param(
  [string]$TaskName = 'FanchengFinance-DailyDataSync',
  [string]$Time = '07:30',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$NodeScript = Join-Path $RepoRoot 'scripts\daily-data-sync.js'

if (-not (Test-Path $NodeScript)) {
  throw "未找到 $NodeScript"
}

$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $node) {
  throw '未找到 node.exe，请先安装 Node.js 并加入 PATH'
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$NodeScript`"" -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$envBlock = @"
FANCHENG_DATA_DRIVE=E
"@

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "已移除任务: $TaskName"
  exit 0
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "已注册任务: $TaskName @ 每日 $Time"
Write-Host "工作目录: $RepoRoot"
Write-Host "命令: node scripts/daily-data-sync.js"
Write-Host "环境: FANCHENG_DATA_DRIVE=E（请在系统/用户环境变量中设置，或修改任务操作附加环境）"
Write-Host "禁用: Unregister-ScheduledTask -TaskName $TaskName"
Write-Host "手动: FANCHENG_DATA_DRIVE=E node scripts/daily-data-sync.js --dry-run"
