/**
 * 季节性窗口提—顺季'W / 逆季 cap
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');

const SEASONALITY_VERSION = 'v1.44.0-discipline';

let cachedCalendar = null;

function loadCalendar() {
  if (cachedCalendar) return cachedCalendar;
  const fp = path.join(__dirname, '..', 'data', 'seasonality-calendar.json');
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    cachedCalendar = raw.windows || [];
  } catch {
    cachedCalendar = [];
  }
  return cachedCalendar;
}

function nowIso() {
  return new Date().toISOString();
}

function getSeasonalityWindow(symbol) {
  const id = normalizeCommodityId(symbol);
  return loadCalendar().find((w) => normalizeCommodityId(w.symbol) === id) || null;
}

/**
 * @returns {{ inSeason: boolean|null, seasonPhase: 'peak'|'trough'|'neutral'|'unknown', watchBoost: boolean, inverseCap: boolean, evidence: string[], dataSource: string }}
 */
function computeSeasonalityHint(symbol, context = {}) {
  const asOf = nowIso();
  const month = context.month ?? new Date().getMonth() + 1;
  const win = getSeasonalityWindow(symbol);

  if (!win) {
    return {
      inSeason: null,
      seasonPhase: 'unknown',
      watchBoost: false,
      inverseCap: false,
      evidence: ['无季节性日历条'],
      dataSource: 'seasonality-hints',
      method: 'calendar-lookup',
      version: SEASONALITY_VERSION,
      asOf,
    };
  }

  const peak = (win.peakMonths || []).includes(month);
  const trough = (win.troughMonths || []).includes(month);
  let seasonPhase = 'neutral';
  if (peak) seasonPhase = 'peak';
  else if (trough) seasonPhase = 'trough';

  return {
    inSeason: peak ? true : trough ? false : null,
    seasonPhase,
    watchBoost: peak,
    inverseCap: trough,
    label: win.label,
    note: win.note,
    evidence: [
      win.label,
      peak ? `M${month} 顺季高峰` : trough ? `M${month} 逆季低谷 · cap inverse-season` : `M${month} 中性`,
      win.note || '',
    ].filter(Boolean),
    dataSource: 'seasonality-calendar.json',
    method: 'month-window',
    version: SEASONALITY_VERSION,
    asOf,
  };
}

module.exports = {
  SEASONALITY_VERSION,
  loadCalendar,
  getSeasonalityWindow,
  computeSeasonalityHint,
};
