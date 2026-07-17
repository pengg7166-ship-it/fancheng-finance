# 将未处理 zip 复制到 D: SSD 缓存（保留目录结构，不删 E: 源文件）
param(
  [string]$SourceBase = 'E:\BaiduNetdiskDownload',
  [string]$DestBase = 'D:\FanchengFinance\data\tick-zip-cache',
  [string]$ProgressFile = 'E:\FanchengFinance\data\history\trading\tick-convert-progress.json',
  [long]$MinFreeGB = 12
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $DestBase | Out-Null

$prog = Get-Content $ProgressFile -Raw -Encoding UTF8 | ConvertFrom-Json
$done = @{}
foreach ($p in $prog.processedZips) {
  $norm = $p -replace '\\', '/' -replace '.*(\d{4}/future_price\d{6}(?:/future_price\d{8})?/future_price\d{8}\.zip)$', '$1'
  $done[$norm.ToLower()] = $true
}

$remaining = Get-ChildItem $SourceBase -Recurse -Filter 'future_price*.zip' | Where-Object {
  $norm = $_.FullName -replace '\\', '/' -replace '.*(\d{4}/future_price\d{6}(?:/future_price\d{8})?/future_price\d{8}\.zip)$', '$1'
  -not $done[$norm.ToLower()]
} | Sort-Object FullName

$totalGB = [math]::Round(($remaining | Measure-Object Length -Sum).Sum / 1GB, 1)
$freeGB = [math]::Round((Get-PSDrive D).Free / 1GB, 1)
Write-Host ("Remaining zips: {0} total {1:N1} GB | D: free {2:N1} GB" -f $remaining.Count, $totalGB, $freeGB)

$copied = 0
$copiedGB = 0.0
$t0 = Get-Date
foreach ($zip in $remaining) {
  $rel = $zip.FullName.Substring($SourceBase.Length).TrimStart('\')
  $dest = Join-Path $DestBase $rel
  if (Test-Path $dest) { continue }
  $needGB = $zip.Length / 1GB
  $curFree = (Get-PSDrive D).Free / 1GB
  if ($curFree -lt ($MinFreeGB + $needGB)) {
    Write-Host ("D: low space, copied {0} ({1:N1} GB), stopping" -f $copied, $copiedGB)
    break
  }
  $destDir = Split-Path $dest -Parent
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  Copy-Item -LiteralPath $zip.FullName -Destination $dest -Force
  $copied++
  $copiedGB += $needGB
  if ($copied % 25 -eq 0) {
    $elapsed = ((Get-Date) - $t0).TotalMinutes
    $rate = if ($elapsed -gt 0) { [math]::Round($copiedGB / $elapsed, 2) } else { 0 }
    Write-Host ("  copied {0} / {1} ({2:N1} GB) rate={3:N2} GB/min" -f $copied, $remaining.Count, $copiedGB, $rate)
  }
}

$elapsedMin = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
Write-Host ("Done: copied {0} files ({1:N1} GB) in {2} min | D: free {3:N1} GB" -f $copied, $copiedGB, $elapsedMin, ((Get-PSDrive D).Free/1GB))
