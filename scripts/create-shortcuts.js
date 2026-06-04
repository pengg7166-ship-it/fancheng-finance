/**
 * Create Windows shortcuts with correct Chinese text (UTF-8 BOM + PowerShell).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getAppDir } = require('../services/data-paths');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version;
const productName = pkg.productName;

function findExe() {
  const exeNames = ['FanchengFinance.exe', '梵澄金融.exe'];

  const externalDir = getAppDir();
  if (externalDir && fs.existsSync(externalDir)) {
    for (const name of exeNames) {
      const exe = path.join(externalDir, name);
      if (fs.existsSync(exe)) return { dir: externalDir, exe };
    }
  }

  const verTag = version.replace(/\./g, '');
  const candidates = [
    `dist-v${verTag}\\win-unpacked`,
    `dist-build\\win-unpacked`,
    `dist-out\\win-unpacked`,
    `dist-new\\win-unpacked`,
  ];
  for (const sub of candidates) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of exeNames) {
      const exe = path.join(dir, name);
      if (fs.existsSync(exe)) return { dir, exe };
    }
  }
  throw new Error('No packaged EXE found. Run 更新梵澄金融.bat first.');
}

function psQuote(value) {
  return value.replace(/'/g, "''");
}

function runPs(scriptBody) {
  const tempPs = path.join(os.tmpdir(), `fancheng-shortcut-${Date.now()}.ps1`);
  fs.writeFileSync(tempPs, `\uFEFF${scriptBody}`, 'utf8');
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs}"`, {
      stdio: 'inherit',
      encoding: 'utf8',
    });
  } finally {
    try {
      fs.unlinkSync(tempPs);
    } catch (_) {}
  }
}

function removeOldShortcuts() {
  const dirs = [
    path.join(os.homedir(), 'Desktop'),
    path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  ];
  const script = dirs
    .filter((d) => fs.existsSync(d))
    .map((dir) => {
      const q = psQuote(dir);
      return `
$dir = '${q}'
Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName)
    $t = $s.TargetPath
    if ($t -like '*fancheng-finance*' -or $t -like '*FanchengFinance.exe*') {
      Remove-Item -LiteralPath $_.FullName -Force
      Write-Host ('Removed: ' + $_.FullName)
    }
  } catch {}
}`;
    })
    .join('\n');
  runPs(script);
}

function createShortcut(lnkPath) {
  const { dir, exe } = findExe();
  const description = `${productName} v${version}`;
  const script = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${psQuote(lnkPath)}')
$Shortcut.TargetPath = '${psQuote(exe)}'
$Shortcut.WorkingDirectory = '${psQuote(dir)}'
$Shortcut.IconLocation = '${psQuote(exe)},0'
$Shortcut.Description = '${psQuote(description)}'
$Shortcut.Save()
Write-Host ('Created: ' + '${psQuote(lnkPath)}')
`;
  runPs(script);
}

removeOldShortcuts();

const targets = [
  path.join(os.homedir(), 'Desktop', `${productName}.lnk`),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${productName}.lnk`),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${productName}.lnk`),
];

for (const lnk of targets) {
  createShortcut(lnk);
}

console.log(`Shortcuts updated -> ${findExe().exe}`);
console.log(`Description: ${productName} v${version}`);
