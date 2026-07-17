/**
 * 金银'(GSR) 代理 'AU/AG 收盘价比及其 z-score（无新抓取）
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { readCachedKlines } = require('./commodity-technical-analyzer');

const GSR_LOOKBACK = 60;

let _auBars = null;
let _agBars = null;
let _gsrByDate = null;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadBars(id) {
  const klines = readCachedKlines(id);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', `${id}.json`);
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(raw) ? raw : raw.series || [];
  } catch {
    return [];
  }
}

function buildGsrSeries() {
  if (_gsrByDate) return _gsrByDate;
  _auBars = loadBars('au');
  _agBars = loadBars('ag');
  const agByDate = new Map();
  for (const b of _agBars) {
    const d = normBarDate(b);
    if (d && b.close != null) agByDate.set(d, Number(b.close));
  }
  const series = [];
  for (const b of _auBars) {
    const d = normBarDate(b);
    const auClose = Number(b.close);
    const agClose = agByDate.get(d);
    if (!d || !auClose || !agClose) continue;
    series.push({ date: d, ratio: auClose / agClose });
  }
  _gsrByDate = series;
  return _gsrByDate;
}

function getGsrZScoreAtDate(barDate) {
  const series = buildGsrSeries();
  if (!series.length) return null;
  const d = String(barDate).slice(0, 10);
  const idx = series.findIndex((s) => s.date === d);
  if (idx < GSR_LOOKBACK) return null;
  const window = series.slice(idx - GSR_LOOKBACK + 1, idx + 1);
  const vals = window.map((s) => s.ratio);
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance);
  if (!std) return 0;
  return +((series[idx].ratio - mean) / std).toFixed(4);
}

module.exports = {
  GSR_LOOKBACK,
  buildGsrSeries,
  getGsrZScoreAtDate,
};
