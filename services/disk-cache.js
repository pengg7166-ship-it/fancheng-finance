const fs = require('fs');
const path = require('path');
const { getDataDir, getExternalRoot, isWritableDir } = require('./data-paths');

const APP_FOLDER = 'FanchengFinance';
const CACHE_FOLDER = 'data';

let cacheRoot = null;

function getDriveFreeBytes(root) {
  try {
    if (process.platform !== 'win32') return 0;
    const { execSync } = require('child_process');
    const drive = root.slice(0, 2);
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

/** 自动选择最优磁盘：优先 E 盘 FanchengFinance/data，跳过 C 盘 */
function detectBestCacheRoot() {
  const pinned = getDataDir();
  if (pinned) return pinned;

  if (process.platform !== 'win32') return null;

  let best = null;
  let bestFree = -1;

  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (letter === 'C') continue;
    const driveRoot = `${letter}:\\`;
    try {
      if (!fs.existsSync(driveRoot)) continue;
      const target = path.join(driveRoot, APP_FOLDER, CACHE_FOLDER);
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

function init(userDataPath) {
  cacheRoot = detectBestCacheRoot() || path.join(userDataPath, 'cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  return cacheRoot;
}

function getRoot() {
  return cacheRoot;
}

function resolveFile(key) {
  if (!cacheRoot) throw new Error('磁盘缓存未初始化');
  const safe = String(key).replace(/[/\\]+/g, path.sep);
  return path.join(cacheRoot, safe);
}

function readStale(key) {
  if (!cacheRoot) return null;
  const file = resolveFile(key);
  if (!fs.existsSync(file)) return null;
  try {
    const stat = fs.statSync(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...data, _mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

function read(key, maxAgeMs = null) {
  const data = readStale(key);
  if (!data) return null;
  if (maxAgeMs != null && Date.now() - (data.savedAt || data._mtime || 0) > maxAgeMs) {
    return null;
  }
  return data;
}

function write(key, data) {
  if (!cacheRoot) return false;
  const file = resolveFile(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { ...data, savedAt: data.savedAt || Date.now() };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

function remove(key) {
  if (!cacheRoot) return;
  const file = resolveFile(key);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function has(key) {
  if (!cacheRoot) return false;
  return fs.existsSync(resolveFile(key));
}

module.exports = {
  init,
  getRoot,
  read,
  readStale,
  write,
  remove,
  has,
};
