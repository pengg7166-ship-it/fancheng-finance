const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const dirs = [
  path.join(os.homedir(), 'Desktop'),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  path.join(__dirname, '..'),
];

const ps = `
$sh = New-Object -ComObject WScript.Shell
$dirs = @(${dirs.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ')})
foreach ($dir in $dirs) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $s = $sh.CreateShortcut($_.FullName)
      if ($s.TargetPath -match 'fancheng|梵澄|electron' -or $s.Arguments -match 'fancheng|梵澄|electron|BrowserWindow') {
        Write-Output ('---')
        Write-Output ('FILE: ' + $_.FullName)
        Write-Output ('TARGET: ' + $s.TargetPath)
        Write-Output ('ARGS: ' + $s.Arguments)
        Write-Output ('WORKDIR: ' + $s.WorkingDirectory)
        Write-Output ('DESC: ' + $s.Description)
      }
    } catch {}
  }
}
`;

const tmp = path.join(os.tmpdir(), 'dump-shortcuts.ps1');
fs.writeFileSync(tmp, '\uFEFF' + ps, 'utf8');
try {
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, { encoding: 'utf8' });
} finally {
  fs.unlinkSync(tmp);
}
