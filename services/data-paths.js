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

/** 统计数据目录充实度，用于在 E/F 多盘时选对根路径 */
function scoreDataPresence(root) {
  let score = 0;
  const closingDir = path.join(root, 'data', 'closing-prices');
  if (fs.existsSync(closingDir)) {
    try {
      score +=
        fs.readdirSync(closingDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length * 10;
    } catch {
      // ignore
    }
  }
  const klineDir = path.join(root, 'data', 'history', 'klines');
  if (fs.existsSync(klineDir)) {
    try {
      score += Math.min(200, fs.readdirSync(klineDir).length);
    } catch {
      // ignore
    }
  }
  const userEnv = path.join(root, 'userData', '.env');
  if (fs.existsSync(userEnv)) score += 5;
  const focusDir = path.join(root, 'focus-analysis');
  if (fs.existsSync(focusDir)) {
    try {
      score += Math.min(120, fs.readdirSync(focusDir).length * 12);
      if (fs.existsSync(path.join(focusDir, 'impact-pins', 'global.json'))) score += 80;
    } catch {
      // ignore
    }
  }
  return score;
}

function listWritableRoots() {
  if (process.platform !== 'win32') return [];
  const roots = [];
  const preferred = (process.env.FANCHENG_DATA_DRIVE || 'F').replace(':', '').toUpperCase().slice(0, 1);
  const preferredRoot = path.join(`${preferred}:\\`, APP_FOLDER);
  if (isWritableDir(preferredRoot)) {
    roots.push({ root: preferredRoot, preferred: true });
  }
  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (letter === 'C') continue;
    const target = path.join(`${letter}:\\`, APP_FOLDER);
    if (!isWritableDir(target)) continue;
    if (roots.some((r) => r.root === target)) continue;
    roots.push({ root: target, preferred: false });
  }
  return roots;
}

/** 优先 F 盘（与 FANCHENG_APP_ROOT 对齐）；若他盘数据更充实则自动切换 */
function resolveExternalRoot() {
  if (process.platform !== 'win32') return null;

  const candidates = listWritableRoots();
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const scoreDiff = scoreDataPresence(b.root) - scoreDataPresence(a.root);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    const freeDiff = getDriveFreeBytes(b.root) - getDriveFreeBytes(a.root);
    return freeDiff;
  });

  return candidates[0].root;
}

function getExternalRoot() {
  const envData = process.env.FANCHENG_DATA_DIR;
  if (envData) {
    const resolved = path.resolve(envData);
    if (isWritableDir(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
      return resolved;
    }
  }

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
  const appRoot = process.env.FANCHENG_APP_ROOT;
  if (appRoot) {
    const dir = path.join(appRoot, 'app', 'win-unpacked');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
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

function getLogsDir() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  const dir = path.join(dataDir, 'logs');
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

function resolveFanchengDataDir() {
  const root = getExternalRoot();
  return root;
}

module.exports = {
  APP_FOLDER,
  getExternalRoot,
  resolveExternalRoot,
  resolveFanchengDataDir,
  getDataDir,
  getUserDataDir,
  getAppDir,
  getBackupsDir,
  getLogsDir,
  getDefaultRoamingDir,
  migrateUserDataFromRoaming,
  isWritableDir,
  scoreDataPresence,
  listWritableRoots,
};
