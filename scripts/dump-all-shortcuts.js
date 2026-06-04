const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const dirs = [
  path.join(os.homedir(), 'Desktop'),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
];

const ps = `
$sh = New-Object -ComObject WScript.Shell
$dirs = @(${dirs.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ')})
foreach ($dir in $dirs) {
  if (-not (Test-Path -LiteralPath $dir)) { continue }
  Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $s = $sh.CreateShortcut($_.FullName)
      Write-Output ('---')
      Write-Output ('FILE: ' + $_.FullName)
      Write-Output ('TARGET: ' + $s.TargetPath)
      Write-Output ('ARGS: ' + $s.Arguments)
      Write-Output ('WORKDIR: ' + $s.WorkingDirectory)
      Write-Output ('DESC: ' + $s.Description)
    } catch {}
  }
}
`;

const tmp = path.join(os.tmpdir(), 'dump-all-shortcuts.ps1');
fs.writeFileSync(tmp, '\uFEFF' + ps, 'utf8');
try {
  const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, { encoding: 'utf8' });
  console.log(out || '(no shortcuts)');
} finally {
  fs.unlinkSync(tmp);
}
