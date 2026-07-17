/**
 * Create Windows shortcuts with correct Chinese text (UTF-8 BOM PowerShell script file).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { getAppDir } = require('../services/data-paths');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version;
const CORRECT_PRODUCT = '\u68b5\u6f84\u91d1\u878d';

function normalizeProductName(name) {
  if (!name || /[\u59d0\u57ab\u7164\u95c1\u622e\u6efe]/.test(name)) return CORRECT_PRODUCT;
  return name;
}

const productName = normalizeProductName(pkg.productName);

function findExe() {
  const exeNames = ['FanchengFinance.exe', `${CORRECT_PRODUCT}.exe`];

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
    'dist-build\\win-unpacked',
    'dist-out\\win-unpacked',
    'dist-new\\win-unpacked',
  ];
  for (const sub of candidates) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of exeNames) {
      const exe = path.join(dir, name);
      if (fs.existsSync(exe)) return { dir, exe };
    }
  }
  throw new Error('No packaged EXE found. Run update batch first.');
}

function findLauncher() {
  const appDir = getAppDir();
  const appRoot = process.env.FANCHENG_APP_ROOT
    || (appDir ? path.dirname(path.dirname(appDir)) : null)
    || path.join('F:\\', 'FanchengFinance');
  const bat = path.join(appRoot, '启动梵澄金融.bat');
  if (fs.existsSync(bat)) {
    return { target: bat, workDir: appRoot, iconExe: findExe().exe };
  }
  const { dir, exe } = findExe();
  return { target: exe, workDir: dir, iconExe: exe };
}

function ensureAppIconIco(appDir) {
  const src = path.join(root, 'build', 'icon.ico');
  if (!fs.existsSync(src)) return null;
  const dest = path.join(appDir, 'icon.ico');
  try {
    fs.copyFileSync(src, dest);
  } catch (_) {
    return null;
  }
  return fs.existsSync(dest) ? dest : null;
}

function findIcon(exePath, appDir) {
  const deployed = ensureAppIconIco(appDir);
  if (deployed) return `${deployed},0`;
  const candidates = [
    path.join(root, 'build', 'icon.ico'),
    path.join(root, 'resources', 'icon.ico'),
    path.join(appDir, 'resources', 'icon.ico'),
  ];
  for (const ico of candidates) {
    if (fs.existsSync(ico)) return `${ico},0`;
  }
  return `${exePath},0`;
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
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

function shortcutDirs() {
  const publicRoot = process.env.PUBLIC || 'C:\\Users\\Public';
  return [
    path.join(os.homedir(), 'Desktop'),
    path.join(publicRoot, 'Desktop'),
    path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  ];
}

function removeOldShortcuts() {
  const dirs = shortcutDirs().filter((d) => fs.existsSync(d));
  const script = dirs
    .map((dir) => {
      const q = psQuote(dir);
      return `
$dir = '${q}'
Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
  $remove = $false
  try {
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName)
    $t = $s.TargetPath
    if ($t -like '*fancheng-finance*' -or $t -like '*FanchengFinance.exe*' -or $t -like '*\\FanchengFinance\\*') {
      $remove = $true
    }
  } catch {}
  if (-not $remove -and $_.BaseName -like '姊垫*') { $remove = $true }
  if (-not $remove -and $_.BaseName -eq 'FanchengFinance') { $remove = $true }
  if (-not $remove -and $_.BaseName -eq '梵澄金融') { $remove = $true }
  if ($remove) {
    Remove-Item -LiteralPath $_.FullName -Force
    Write-Host ('Removed: ' + $_.FullName)
  }
}`;
    })
    .join('\n');
  runPs(script);
}

function createShortcut(lnkPath) {
  const { target, workDir, iconExe } = findLauncher();
  const description = `${productName} v${version}`;
  const icon = findIcon(iconExe, path.dirname(iconExe));
  const script = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${psQuote(lnkPath)}')
$Shortcut.TargetPath = '${psQuote(target)}'
$Shortcut.WorkingDirectory = '${psQuote(workDir)}'
$Shortcut.IconLocation = '${psQuote(icon)}'
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

console.log(`Shortcuts updated -> ${findLauncher().target}`);
console.log(`Description: ${productName} v${version}`);