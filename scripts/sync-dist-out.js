/**
 * Mirror the latest packaged build into dist-out\win-unpacked (shortcut target).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const verTag = pkg.version.replace(/\./g, '');

function findSourceDir() {
  const candidates = [
    path.join(root, `dist-v${verTag}`, 'win-unpacked'),
    path.join(root, 'dist-build', 'win-unpacked'),
    path.join(root, 'dist-new', 'win-unpacked'),
  ];
  for (const dir of candidates) {
    const exe = path.join(dir, 'FanchengFinance.exe');
    if (fs.existsSync(exe)) return dir;
  }
  throw new Error(`No build found for v${pkg.version}. Run 更新梵澄金融.bat first.`);
}

const src = findSourceDir();
const dest = path.join(root, 'dist-out', 'win-unpacked');

console.log(`Sync ${src} -> ${dest}`);

try {
  execSync('taskkill /F /IM FanchengFinance.exe', { stdio: 'ignore', shell: true });
} catch (_) {}
try {
  execSync('taskkill /F /IM 梵澄金融.exe', { stdio: 'ignore', shell: true });
} catch (_) {}

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

console.log(`dist-out updated to v${pkg.version}`);
