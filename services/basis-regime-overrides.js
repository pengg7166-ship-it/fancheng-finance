/**
 * Per-session basis regime overrides 'from ag-basis-label-review / merge --basis-overrides
 * Used by market-regime-classifier to block OI-proxy basis on confirmed miss days.
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const OVERRIDE_FILENAME = 'basis-regime-overrides.csv';

let _cache = null;
let _cacheMtime = 0;
let _skipOiProxyKeys = null;

function getOverridesPath() {
  const dataDir = getDataDir();
  if (!dataDir) return null;
  return path.join(dataDir, 'history', 'labels', OVERRIDE_FILENAME);
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function loadOverrides(force = false) {
  const fp = getOverridesPath();
  if (!fp || !fs.existsSync(fp)) {
    _cache = [];
    _skipOiProxyKeys = new Set();
    return _cache;
  }
  try {
    const stat = fs.statSync(fp);
    if (!force && _cache && stat.mtimeMs === _cacheMtime) return _cache;
    const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      _cache = [];
      _skipOiProxyKeys = new Set();
      _cacheMtime = stat.mtimeMs;
      return _cache;
    }
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const idx = {
      sessionDate: header.indexOf('sessionDate'),
      instrumentId: header.indexOf('instrumentId'),
      overrideRegime: header.indexOf('overrideRegime'),
      user_confirm: header.indexOf('user_confirm'),
    };
    const rows = [];
    const skipKeys = new Set();
    for (let i = 1; i < lines.length; i += 1) {
      const cols = parseCsvLine(lines[i]);
      const sessionDate = String(cols[idx.sessionDate] || '').slice(0, 10);
      const instrumentId = String(cols[idx.instrumentId] || '').toLowerCase();
      const overrideRegime = String(cols[idx.overrideRegime] || '').trim();
      const userConfirm = String(cols[idx.user_confirm] || '').trim().toLowerCase();
      if (!sessionDate || !instrumentId) continue;
      rows.push({ sessionDate, instrumentId, overrideRegime, userConfirm });
      if (overrideRegime === 'skip_oi_proxy' && (!userConfirm || userConfirm === 'yes')) {
        skipKeys.add(`${instrumentId}|${sessionDate}`);
      }
    }
    _cache = rows;
    _skipOiProxyKeys = skipKeys;
    _cacheMtime = stat.mtimeMs;
    return _cache;
  } catch {
    _cache = [];
    _skipOiProxyKeys = new Set();
    return _cache;
  }
}

function shouldSkipOiProxy(instrumentId, barDate) {
  loadOverrides();
  const id = String(instrumentId || '').toLowerCase();
  const d = String(barDate || '').slice(0, 10);
  if (!id || !d || !_skipOiProxyKeys) return false;
  return _skipOiProxyKeys.has(`${id}|${d}`);
}

function skipOiProxyCount() {
  loadOverrides();
  return _skipOiProxyKeys?.size ?? 0;
}

module.exports = {
  OVERRIDE_FILENAME,
  getOverridesPath,
  loadOverrides,
  shouldSkipOiProxy,
  skipOiProxyCount,
};
