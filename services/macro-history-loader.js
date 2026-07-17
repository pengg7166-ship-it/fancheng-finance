/**
 * 宏观月频历史 'PMI 等，'data/history/macro-*.json 加载
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const fredHistory = require('./fred-history-fetcher');

const PMI_FILE = 'macro-pmi-monthly.json';
const REAL10Y_MONTHLY_FILE = 'fred-real10y-monthly.json';

let pmiCache = null;

function getHistoryDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'history');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function historyFilePath(filename) {
  return path.join(getHistoryDir(), filename);
}

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function monthFromDate(date) {
  return normDate(date).slice(0, 7);
}

function loadJsonFile(filename) {
  const p = historyFilePath(filename);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return null;
}

function seriesToLookup(rows, { keyField = 'month', valueField = 'value' } = {}) {
  const map = new Map();
  for (const row of rows || []) {
    const k = row[keyField] || row.date?.slice(0, 7);
    if (k && row[valueField] != null && row.status !== 'rejected') {
      map.set(k, row[valueField]);
    }
  }
  return map;
}

function loadPmiMonthly() {
  if (pmiCache) return pmiCache;
  const raw = loadJsonFile(PMI_FILE);
  if (!raw?.series) {
    pmiCache = { cn: new Map(), us: new Map(), ez: new Map(), loaded: false };
    return pmiCache;
  }
  pmiCache = {
    cn: seriesToLookup(raw.series.cn),
    us: seriesToLookup(raw.series.us),
    ez: seriesToLookup(raw.series.ez),
    meta: raw,
    loaded: true,
  };
  return pmiCache;
}

function lookupPmi(region, date) {
  const pmi = loadPmiMonthly();
  const mk = monthFromDate(date);
  const map = pmi[region];
  if (!map?.size) return null;
  const months = [...map.keys()].sort();
  let last = null;
  for (const m of months) {
    if (m <= mk) last = map.get(m);
    else break;
  }
  return last;
}

function getCnPmiAtDate(date) {
  return lookupPmi('cn', date);
}

function getUsPmiAtDate(date) {
  return lookupPmi('us', date);
}

function getEzPmiAtDate(date) {
  return lookupPmi('ez', date);
}

function getPmiIndicatorsAtDate(date) {
  const d = normDate(date);
  const out = [];
  const defs = [
    { region: 'cn', id: 'CN_PMI_MFG', name: '中国制造业 PMI' },
    { region: 'us', id: 'US_ISM_PMI', name: '美国 ISM 制造业 PMI' },
    { region: 'ez', id: 'EZ_HCOB_PMI', name: '欧元区·HCOB 制造业 PMI' },
  ];
  for (const def of defs) {
    const val = lookupPmi(def.region, d);
    if (val != null) {
      out.push({ id: def.id, name: def.name, value: String(val), date: d, category: 'sentiment' });
    }
  }
  return out;
}

function loadReal10yMonthly() {
  return loadJsonFile(REAL10Y_MONTHLY_FILE);
}

module.exports = {
  PMI_FILE,
  REAL10Y_MONTHLY_FILE,
  getHistoryDir,
  loadPmiMonthly,
  lookupPmi,
  getCnPmiAtDate,
  getUsPmiAtDate,
  getEzPmiAtDate,
  getPmiIndicatorsAtDate,
  loadReal10yMonthly,
  lookupSeriesByDate: fredHistory.lookupSeriesByDate,
};
