const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_FOLDER = 'FanchengFinance';

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '1', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function getDriveFreeBytes(driveRoot) {
  try {
    if (process.platform !== 'win32') return 0;
    const { execSync } = require('child_process');
    const drive = driveRoot.slice(0, 2);
    const out = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`, {
      encoding: 'utf8',
      windowsHide: true,
    });
    const m = out.match(/FreeSpace=(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

/** 优先 E 盘，否则选非 C 盘剩余空间最大的盘 */
function resolveExternalRoot() {
  if (process.platform !== 'win32') return null;

  const preferred = (process.env.FANCHENG_DATA_DRIVE || 'E').replace(':', '').toUpperCase().slice(0, 1);
  const preferredRoot = path.join(`${preferred}:\\`, APP_FOLDER);
  if (isWritableDir(preferredRoot)) return preferredRoot;

  let best = null;
  let bestFree = -1;
  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (letter === 'C') continue;
    const driveRoot = `${letter}:\\`;
    try {
      if (!fs.existsSync(driveRoot)) continue;
      const target = path.join(driveRoot, APP_FOLDER);
      if (!isWritableDir(target)) continue;
      const free = getDriveFreeBytes(driveRoot);
      if (free > bestFree) {
        bestFree = free;
        best = target;
      }
    } catch {
      // try next drive
    }
  }
  return best;
}

function getExternalRoot() {
  const root = resolveExternalRoot();
  if (!root) return null;
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getDataDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getUserDataDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAppDir() {
  const root = getExternalRoot();
  if (!root) return null;
  return path.join(root, 'app', 'win-unpacked');
}

function getBackupsDir() {
  const root = getExternalRoot();
  if (!root) return null;
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDefaultRoamingDir() {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'fancheng-finance');
}

function migrateUserDataFromRoaming(targetDir) {
  if (!targetDir) return false;
  const legacy = getDefaultRoamingDir();
  if (legacy === targetDir) return false;
  if (!fs.existsSync(legacy)) return false;

  let copied = false;
  for (const name of fs.readdirSync(legacy)) {
    const src = path.join(legacy, name);
    const dest = path.join(targetDir, name);
    if (fs.existsSync(dest)) continue;
    fs.cpSync(src, dest, { recursive: true, force: true });
    copied = true;
  }
  return copied;
}

module.exports = {
  APP_FOLDER,
  getExternalRoot,
  getDataDir,
  getUserDataDir,
  getAppDir,
  getBackupsDir,
  getDefaultRoamingDir,
  migrateUserDataFromRoaming,
  isWritableDir,
};
