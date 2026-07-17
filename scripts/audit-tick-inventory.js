#!/usr/bin/env node
/** One-off audit: tick zip sources + trading/klines ranges for P0 instruments */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
const { getDataDir, getUserDataDir } = require('../services/data-paths');
const diskCache = require('../services/disk-cache');

const P0 = ['au', 'ag', 'rb', 'cu'];
const ZIP_BASES = [
  'E:\\BaiduNetdiskDownload',
  'D:\\FanchengFinance\\data\\tick-zip-cache',
  'E:\\FanchengFinance\\data\\tick-zip-cache',
];

function countZips(base) {
  if (!fs.existsSync(base)) return null;
  let count = 0;
  const months = new Set();
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/future_price\d{8}\.zip$/i.test(name)) {
        count += 1;
        const m = name.match(/future_price(\d{6})/);
        if (m) months.add(m[1]);
      }
    }
  };
  walk(base);
  return { count, months: [...months].sort() };
}

function loadTradingSeries(id) {
  const dataDir = getDataDir() || 'E:\\FanchengFinance\\data';
  const f = path.join(dataDir, 'history', 'trading', `${id}.json`);
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const series = Array.isArray(raw) ? raw : raw.series || [];
  if (!series.length) return { bars: 0 };
  const prices = series.map((r) => r.close ?? r.price).filter(Number.isFinite);
  return {
    bars: series.length,
    from: series[0].date,
    to: series[series.length - 1].date,
    closeMin: Math.min(...prices),
    closeMax: Math.max(...prices),
    lastClose: prices[prices.length - 1],
  };
}

function loadKlineSummary(id, tf) {
  const dataDir = getDataDir() || 'E:\\FanchengFinance\\data';
  diskCache.init(getUserDataDir() || dataDir);
  const key = `klines/commodity-${id}-${tf}.json`;
  const stored = diskCache.readStale(key);
  const kl = stored?.data?.klines || [];
  const summary = stored?.data?.summary;
  const prices = kl.map((b) => b.close).filter(Number.isFinite);
  return {
    key,
    bars: kl.length,
    source: stored?.data?.source || summary?.source || null,
    from: kl[0]?.date || summary?.startDate || null,
    to: kl[kl.length - 1]?.date || summary?.endDate || null,
    closeMin: prices.length ? Math.min(...prices) : null,
    closeMax: prices.length ? Math.max(...prices) : null,
    lastClose: prices.length ? prices[prices.length - 1] : null,
  };
}

function loadProgress() {
  const dataDir = getDataDir() || 'E:\\FanchengFinance\\data';
  const p = path.join(dataDir, 'history', 'trading', 'tick-convert-progress.json');
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    processed: (j.processedZips || []).length,
    stats: j.stats || {},
  };
}

const out = {
  dataDir: getDataDir(),
  zipBases: {},
  progress: loadProgress(),
  instruments: {},
};

for (const base of ZIP_BASES) out.zipBases[base] = countZips(base);

for (const id of P0) {
  out.instruments[id] = {
    trading: loadTradingSeries(id),
    day: loadKlineSummary(id, 'day'),
    hour: loadKlineSummary(id, 'hour'),
    m15: loadKlineSummary(id, '15m'),
    m5: loadKlineSummary(id, '5m'),
  };
}

console.log(JSON.stringify(out, null, 2));
