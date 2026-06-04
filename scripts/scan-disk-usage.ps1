$paths = @(
  'C:\Users\Gao\Projects\fancheng-finance',
  'C:\Users\Gao\AppData\Roaming\fancheng-finance',
  'C:\Users\Gao\Projects\fancheng-finance-backups',
  'E:\FanchengFinance'
)
foreach ($p in $paths) {
  if (-not (Test-Path $p)) { Write-Host "missing`t$p"; continue }
  $size = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  $gb = [math]::Round($size / 1GB, 2)
  Write-Host "$gb GB`t$p"
}

Write-Host "`n--- Large subdirs in project ---"
$root = 'C:\Users\Gao\Projects\fancheng-finance'
Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $s = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($s -gt 50MB) { Write-Host ("{0,6:N0} MB  {1}" -f ($s/1MB), $_.Name) }
}
