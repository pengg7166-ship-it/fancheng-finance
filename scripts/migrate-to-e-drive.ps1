# Fancheng Finance - migrate large data to E: drive
$ErrorActionPreference = 'Stop'
$ERoot = 'E:\FanchengFinance'
$EApp = Join-Path $ERoot 'app\win-unpacked'
$EData = Join-Path $ERoot 'data'
$EUser = Join-Path $ERoot 'userData'
$EBackup = Join-Path $ERoot 'backups'
$Project = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

Write-Host '=== Fancheng Finance E: migration ===' -ForegroundColor Cyan

if (-not (Test-Path 'E:\')) {
  Write-Host 'E: drive not found.' -ForegroundColor Red
  exit 1
}

Write-Host 'Stopping FanchengFinance.exe...'
Get-Process FanchengFinance -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

foreach ($d in @($ERoot, $EApp, $EData, $EUser, $EBackup)) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

function Invoke-RobocopyMove($src, $dest) {
  if (-not (Test-Path $src)) { return $false }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Write-Host "MOVE $src -> $dest"
  & robocopy $src $dest /E /MOVE /R:2 /W:3 /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $src" }
  if (Test-Path $src) { Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue }
  return $true
}

function Copy-IfMissing($src, $dest) {
  if (-not (Test-Path $src)) { return }
  if (-not (Test-Path $dest)) {
    Write-Host "COPY $src -> $dest"
    Copy-Item $src $dest -Recurse -Force
  }
}

$pkg = Get-Content (Join-Path $Project 'package.json') -Raw | ConvertFrom-Json
$verTag = $pkg.version -replace '\.', ''
$latestDist = Join-Path $Project "dist-v$verTag\win-unpacked"

if ((Test-Path $latestDist) -and -not (Test-Path (Join-Path $EApp 'FanchengFinance.exe'))) {
  Invoke-RobocopyMove $latestDist $EApp | Out-Null
  $parentDist = Split-Path $latestDist -Parent
  if (Test-Path $parentDist) { Remove-Item $parentDist -Recurse -Force -ErrorAction SilentlyContinue }
} elseif (Test-Path (Join-Path $EApp 'FanchengFinance.exe')) {
  Write-Host "App already on E:, skip dist-v$verTag"
}

$roaming = Join-Path $env:APPDATA 'fancheng-finance'
Copy-IfMissing $roaming $EUser
Copy-IfMissing (Join-Path $roaming 'cache') $EData

$cBackup = Join-Path (Split-Path -Parent $Project) 'fancheng-finance-backups'
if (Test-Path $cBackup) {
  Get-ChildItem $cBackup -Filter '*.zip' -ErrorAction SilentlyContinue | ForEach-Object {
    $dest = Join-Path $EBackup $_.Name
    if (-not (Test-Path $dest)) {
      Write-Host "MOVE backup $($_.Name)"
      Move-Item $_.FullName $dest -Force
    }
  }
}

Write-Host 'Cleaning old dist folders on C:...'
Get-ChildItem $Project -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $n = $_.Name
  if ($n -match '^dist-v\d+$' -or $n -in @('dist-out', 'dist-build', 'dist-new', 'dist')) {
    $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    if ($size -gt 0) {
      Write-Host ("  DELETE {0} ({1:N0} MB)" -f $n, ($size / 1MB))
      Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
Get-ChildItem $Project -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^_(v|asar|check|pkg)' } | ForEach-Object {
  Write-Host ("  DELETE {0}" -f $_.Name)
  Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Updating shortcuts...'
Set-Location $Project
node scripts/create-shortcuts.js

Write-Host ''
Write-Host '=== Done ===' -ForegroundColor Green
Write-Host "App:    $EApp\FanchengFinance.exe"
Write-Host "Data:   $EData"
Write-Host "Config: $EUser"
Write-Host "Backup: $EBackup"
