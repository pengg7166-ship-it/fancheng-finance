/**
 * AG 工业需求代—CU 动量 / 期限结构（无新抓取，复用 trading + term-structure'
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { readCachedKlines } = require('./commodity-technical-analyzer');
const { getTermStructureAtDate } = require('./term-structure-fetcher');

let _cuBars = null;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadCuBars() {
  if (_cuBars) return _cuBars;
  const klines = readCachedKlines('cu');
  if (klines.length >= 60) {
    _cuBars = klines;
    return _cuBars;
  }
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', 'cu.json');
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    _cuBars = Array.isArray(raw) ? raw : raw.series || [];
  } catch {
    _cuBars = [];
  }
  return _cuBars;
}

/** CU 5 日收盘动'% */
function getCuMomentum5dAtDate(barDate) {
  const bars = loadCuBars();
  if (!bars.length) return null;
  const d = String(barDate).slice(0, 10);
  const idx = bars.findIndex((b) => normBarDate(b) === d);
  if (idx < 5) return null;
  const end = bars[idx];
  const start = bars[idx - 5];
  if (!start?.close || !end?.close) return null;
  return +(((Number(end.close) - Number(start.close)) / Number(start.close)) * 100).toFixed(4);
}

function getCuIndustrialProxyAtDate(barDate) {
  const cuTerm = getTermStructureAtDate('cu', barDate);
  return {
    cu_momentum_5d: getCuMomentum5dAtDate(barDate),
    cu_term_spread_pct: cuTerm?.spreadPct ?? null,
    cu_term_z_score: cuTerm?.zScore ?? null,
  };
}

module.exports = {
  loadCuBars,
  getCuMomentum5dAtDate,
  getCuIndustrialProxyAtDate,
};
