$src = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$dest = 'E:\FanchengFinance\backups'
$stamp = Get-Date -Format 'yyyy-MM-dd'
$zip = Join-Path $dest "fancheng-finance-v1.8.5-$stamp.zip"

New-Item -ItemType Directory -Force -Path $dest | Out-Null

$temp = Join-Path $env:TEMP "fc-backup-$stamp"
if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $temp | Out-Null

$items = @(
  'electron', 'services', 'src', 'scripts',
  'package.json', 'package-lock.json', 'index.html', 'README.md', 'CHANGELOG.md',
  '.gitignore', '.npmrc', '.env.example',
  '启动梵澄金融.bat', '更新梵澄金融.bat', '一键更新并启动.bat', '固定到电脑.bat', '运行已打包版本.bat', 'update-shortcuts.ps1'
)

foreach ($i in $items) {
  $p = Join-Path $src $i
  if (Test-Path $p) { Copy-Item $p (Join-Path $temp $i) -Recurse -Force }
}

$buildSrc = Join-Path $src 'dist-v185\win-unpacked'
if (Test-Path $buildSrc) {
  Copy-Item $buildSrc (Join-Path $temp 'dist-v185\win-unpacked') -Recurse -Force
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $temp -Recurse -Force

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Backup saved: $zip ($mb MB)"
