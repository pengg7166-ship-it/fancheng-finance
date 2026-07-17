/**
 * Mirror the latest packaged build into dist-out\win-unpacked (shortcut target).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getAppDir } = require('../services/data-paths');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const verTag = pkg.version.replace(/\./g, '');

function findSourceDir() {
  const candidates = [
    path.join(root, `dist-v${verTag}`, 'win-unpacked'),
    path.join(root, 'dist', 'win-unpacked'),
    path.join(root, 'dist-build', 'win-unpacked'),
    path.join(root, 'dist-new', 'win-unpacked'),
  ];
  for (const dir of candidates) {
    const exeNames = ['FanchengFinance.exe', '梵澄金融.exe'];
    if (exeNames.some((name) => fs.existsSync(path.join(dir, name)))) return dir;
  }
  throw new Error(`No build found for v${pkg.version}. Run 更新梵澄金融.bat first.`);
}

function ensureLaunchExeNames(dir) {
  const primary = path.join(dir, 'FanchengFinance.exe');
  const alt = path.join(dir, '梵澄金融.exe');
  if (fs.existsSync(primary) && !fs.existsSync(alt)) {
    fs.copyFileSync(primary, alt);
  } else if (fs.existsSync(alt) && !fs.existsSync(primary)) {
    fs.copyFileSync(alt, primary);
  }
}

function mirrorBuild(src, dest) {
  console.log(`Sync ${src} -> ${dest}`);
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  try {
    execSync(`robocopy "${src}" "${dest}" /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS`, {
      stdio: 'inherit',
      shell: true,
    });
  } catch (err) {
    const code = err.status ?? 1;
    if (code >= 8) throw new Error(`robocopy failed with exit code ${code}`);
  }
}

const src = findSourceDir();
ensureLaunchExeNames(src);
const dest = path.join(root, 'dist-out', 'win-unpacked');

try {
  execSync('taskkill /F /IM FanchengFinance.exe', { stdio: 'ignore', shell: true });
} catch (_) {}
try {
  execSync('taskkill /F /IM 梵澄金融.exe', { stdio: 'ignore', shell: true });
} catch (_) {}

mirrorBuild(src, dest);
ensureLaunchExeNames(dest);

const externalDir = getAppDir();
if (externalDir && path.resolve(externalDir) !== path.resolve(dest)) {
  mirrorBuild(src, externalDir);
  ensureLaunchExeNames(externalDir);
}

const asarPath = path.join(externalDir || dest, 'resources', 'app.asar');
try {
  execSync(`node "${path.join(root, 'scripts', 'verify-asar-health.js')}" "${asarPath}"`, {
    stdio: 'inherit',
    shell: true,
  });
} catch (err) {
  throw new Error(`asar health check failed for ${asarPath}`);
}

console.log(`dist-out updated to v${pkg.version}`);
if (externalDir) console.log(`E: install updated -> ${externalDir}`);
