const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const searchRoots = [
  path.join(os.homedir(), 'Desktop'),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu'),
  path.join(os.homedir(), 'AppData', 'Local'),
  path.join(__dirname, '..'),
];

const ps = `
$sh = New-Object -ComObject WScript.Shell
function Scan-Dir($dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return }
  Get-ChildItem -LiteralPath $dir -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $s = $sh.CreateShortcut($_.FullName)
      $blob = ($s.TargetPath + ' ' + $s.Arguments + ' ' + $s.WorkingDirectory)
      if ($blob -match 'fancheng|BrowserWindow|document\\.write|window\\.fancheng|electron') {
        Write-Output ('---')
        Write-Output ('FILE: ' + $_.FullName)
        Write-Output ('TARGET: ' + $s.TargetPath)
        Write-Output ('ARGS: ' + $s.Arguments)
        Write-Output ('WORKDIR: ' + $s.WorkingDirectory)
      }
    } catch {}
  }
}
${searchRoots.map((d) => `Scan-Dir '${d.replace(/'/g, "''")}'`).join('\n')}
`;

const tmp = path.join(os.tmpdir(), 'scan-shortcuts.ps1');
fs.writeFileSync(tmp, '\uFEFF' + ps, 'utf8');
try {
  console.log(execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, { encoding: 'utf8' }) || '(none)');
} finally {
  fs.unlinkSync(tmp);
}
