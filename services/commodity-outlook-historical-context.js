/**
 * 大宗走势研判 — 2019+ 历史宏观环境与 walk-forward 回测上下文
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { fetchFredSeriesHistoryCsv } = require('./fred-client');
const eventCalendar = require('./commodity-outlook-event-calendar');

const MACRO_TIMELINE = eventCalendar.HISTORICAL_EVENTS.map((e) => ({
  id: e.id,
  label: e.label,
  from: e.start,
  to: e.end || '2099-12-31',
  weight: e.weightMultipliers?.philosophy ?? 1,
}));

const BACKTEST_ERAS = eventCalendar.BACKTEST_ERAS;

/** DFF 分段备用（FRED 不可达时） */
const DFF_PIECEWISE = [
  { from: '2019-01-01', to: '2020-02-29', value: 2.4 },
  { from: '2020-03-01', to: '2022-02-28', value: 0.08 },
  { from: '2022-03-01', to: '2022-12-31', value: 3.5 },
  { from: '2023-01-01', to: '2023-06-30', value: 5.0 },
  { from: '2023-07-01', to: '2024-08-31', value: 5.33 },
  { from: '2024-09-01', to: '2099-12-31', value: 4.5 },
];

const VIX_PIECEWISE = [
  { from: '2019-01-01', to: '2020-01-31', value: 15 },
  { from: '2020-02-01', to: '2020-06-30', value: 45 },
  { from: '2020-07-01', to: '2021-12-31', value: 18 },
  { from: '2022-01-01', to: '2022-12-31', value: 28 },
  { from: '2023-01-01', to: '2024-12-31', value: 16 },
  { from: '2025-01-01', to: '2099-12-31', value: 18 },
];

const BOJ_RATE_PIECEWISE = [
  { from: '2019-01-01', to: '2024-02-29', value: -0.1 },
  { from: '2024-03-01', to: '2024-06-30', value: 0.1 },
  { from: '2024-07-01', to: '2099-12-31', value: 0.5 },
];

let dffCache = null;
let vixCache = null;
let dffCacheLoaded = false;

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function dateInRange(date, from, to) {
  const d = normDate(date);
  return d >= from && d <= to;
}

function activeTimelineEvents(date) {
  return eventCalendar.getActiveEvents(date).map((e) => ({
    id: e.id,
    label: e.label,
    from: e.start,
    to: e.end || '2099-12-31',
    weight: e.weightMultipliers?.philosophy ?? 1,
  }));
}

function lookupPiecewise(schedule, date) {
  const d = normDate(date);
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    if (d >= schedule[i].from) return schedule[i].value;
  }
  return schedule[0]?.value ?? 0;
}

function getSeriesCachePath(name) {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, name);
}

function loadLocalSeriesCache(filename) {
  const p = getSeriesCachePath(filename);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // ignore
  }
  return null;
}

function saveLocalSeriesCache(filename, payload) {
  const p = getSeriesCachePath(filename);
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
}

function lookupSeriesByDate(series, date) {
  if (!series?.length) return null;
  const d = normDate(date);
  let last = null;
  for (const row of series) {
    if (row.date <= d) last = row;
    else break;
  }
  return last?.value ?? null;
}

function lookupSeriesPrev(series, date) {
  if (!series?.length) return null;
  const d = normDate(date);
  let prev = null;
  let last = null;
  for (const row of series) {
    if (row.date <= d) {
      prev = last;
      last = row;
    } else break;
  }
  return prev?.value ?? null;
}

async function ensureFredDailyCache() {
  if (dffCacheLoaded) return { dff: dffCache, vix: vixCache };
  dffCacheLoaded = true;

  const localDff = loadLocalSeriesCache('fred-dff-daily.json');
  const localVix = loadLocalSeriesCache('fred-vixcls-daily.json');
  if (localDff?.series?.length >= 100) dffCache = localDff.series;
  if (localVix?.series?.length >= 100) vixCache = localVix.series;

  if (!dffCache?.length) {
    try {
      const rows = await fetchFredSeriesHistoryCsv('DFF');
      if (rows.length >= 50) {
        dffCache = rows;
        saveLocalSeriesCache('fred-dff-daily.json', {
          seriesId: 'DFF',
          source: 'fred-csv',
          fetchedAt: new Date().toISOString(),
          series: rows,
        });
      }
    } catch {
      dffCache = null;
    }
  }

  if (!vixCache?.length) {
    try {
      const rows = await fetchFredSeriesHistoryCsv('VIXCLS');
      if (rows.length >= 50) {
        vixCache = rows;
        saveLocalSeriesCache('fred-vixcls-daily.json', {
          seriesId: 'VIXCLS',
          source: 'fred-csv',
          fetchedAt: new Date().toISOString(),
          series: rows,
        });
      }
    } catch {
      vixCache = null;
    }
  }

  return { dff: dffCache, vix: vixCache };
}

function getDffAtDate(date) {
  const fromCache = lookupSeriesByDate(dffCache, date);
  if (fromCache != null) return fromCache;
  return lookupPiecewise(DFF_PIECEWISE, date);
}

function getVixAtDate(date) {
  const fromCache = lookupSeriesByDate(vixCache, date);
  if (fromCache != null) return fromCache;
  return lookupPiecewise(VIX_PIECEWISE, date);
}

function getBojRateAtDate(date) {
  return lookupPiecewise(BOJ_RATE_PIECEWISE, date);
}

/**
 * loose / tight / neutral — 与哲学层 assessFinancialEnvironment 阈值对齐
 */
function getHistoricalFinanceEnvironment(date) {
  const dff = getDffAtDate(date);
  const prevDff = lookupSeriesPrev(dffCache, date) ?? dff;
  const dffTrend = dff < prevDff - 0.05 ? 0.08 : dff > prevDff + 0.05 ? -0.08 : 0;
  const vix = getVixAtDate(date);
  const bojRate = getBojRateAtDate(date);

  let score = 0;
  if (dff <= 1.5) score += 0.35;
  else if (dff <= 2.5) score += 0.12;
  else if (dff >= 5) score -= 0.38;
  else if (dff >= 4) score -= 0.22;
  score += dffTrend;
  if (vix > 26) score -= 0.18;
  else if (vix < 18) score += 0.08;
  if (bojRate <= 0) score += 0.12;
  else if (bojRate >= 0.75) score -= 0.06;

  const events = activeTimelineEvents(date);
  const merged = eventCalendar.getActiveEventsMerged(date);
  if (merged.regimes.finance === 'loose_extreme' || merged.regimes.finance === 'loose') score += 0.1;
  if (merged.regimes.finance === 'tight') score -= 0.12;
  if (merged.regimes.finance === 'easing') score += 0.08;
  if (merged.eventIds.includes('covid_crash_fed_zero')) score += 0.15;
  if (merged.eventIds.includes('fed_hike_aggressive')) score -= 0.12;
  if (merged.regimes.geo === 'supply_shock' || merged.regimes.geo === 'energy_precious_shock') score -= 0.06;

  score = Math.max(-1, Math.min(1, score));
  let regime = 'neutral';
  if (score >= 0.22) regime = 'loose';
  else if (score <= -0.22) regime = 'tight';

  return {
    regime,
    score: +score.toFixed(4),
    dff,
    vix,
    bojRate,
    source: dffCache?.length ? 'fred-dff-cache' : 'piecewise-schedule',
  };
}

function getHistoricalRegime(date) {
  const merged = eventCalendar.getActiveEventsMerged(date);
  const ids = new Set(merged.eventIds);
  const fin = getHistoricalFinanceEnvironment(date);

  if (ids.has('covid_crash_fed_zero') && fin.vix > 30) return 'covidPanic';
  if (ids.has('covid_crash_fed_zero') || ids.has('covid_recovery_rally')) {
    if (merged.regimes.finance === 'loose_extreme' || merged.regimes.finance === 'loose') return 'liquidityFlood';
  }
  if (ids.has('fed_hike_aggressive') && fin.dff >= 4) return 'inflationFight';
  if (ids.has('ru_ukraine_supply') || ids.has('us_iran_israel_2026')) return 'geoSupplyShock';
  if (ids.has('boj_nirp_exit')) return 'bojNormalization';
  if (ids.has('china_anti_involution')) return 'chinaSupplyDiscipline';
  if (ids.has('china_supply_side_ref')) return 'chinaReformEra';
  if (fin.regime === 'loose') return 'riskOn';
  if (fin.regime === 'tight') return 'riskOff';
  return 'neutral';
}

function buildSyntheticPolicyItems(date) {
  const items = [];
  const ids = new Set(eventCalendar.getActiveEvents(date).map((e) => e.id));
  if (ids.has('china_supply_side_ref')) {
    items.push({
      title: '供给侧改革产能淘汰',
      summary: '供给侧 供给侧改革 产能淘汰',
      stars: 4,
      direction: 'bullish',
      date,
    });
  }
  if (ids.has('china_anti_involution')) {
    items.push({
      title: '反内卷减产自律',
      summary: '反内卷 减产自律 去产能',
      stars: 4,
      direction: 'bullish',
      date,
    });
  }
  return items;
}

function buildSyntheticGeoItems(date) {
  const items = [];
  const ids = new Set(eventCalendar.getActiveEvents(date).map((e) => e.id));
  if (ids.has('ru_ukraine_supply')) {
    items.push({
      title: '俄乌冲突黑海供应链扰动',
      summary: '俄乌 乌克兰 黑海 能源粮食',
      stars: 5,
      direction: 'bullish',
      date,
    });
  }
  if (ids.has('us_iran_israel_2026')) {
    items.push({
      title: '中东地缘霍尔木兹风险',
      summary: '伊朗 霍尔木兹 中东 OPEC 红海',
      stars: 5,
      direction: 'bullish',
      date,
    });
  }
  if (ids.has('covid_crash_fed_zero')) {
    items.push({
      title: '疫情全球供应链中断',
      summary: '疫情 停产 物流中断',
      stars: 4,
      direction: 'bearish',
      date,
    });
  }
  return items;
}

function buildHistoricalSources(date) {
  const d = normDate(date);
  const dff = getDffAtDate(d);
  const prevDff = lookupSeriesPrev(dffCache, d) ?? dff;
  const vix = getVixAtDate(d);
  const bojRate = getBojRateAtDate(d);
  const dffChange = prevDff != null ? +(dff - prevDff).toFixed(4) : null;

  return {
    fed: {
      indicators: [
        { id: 'DFF', name: '联邦基金利率', value: String(dff), change: dffChange != null ? String(dffChange) : null, date: d },
        { id: 'VIXCLS', name: 'VIX', value: String(vix), date: d },
        { id: 'T10Y2Y', name: '10年-2年利差', value: dff >= 4 ? '-0.3' : '0.2', date: d },
      ],
    },
    boj: {
      indicators: [{ id: 'BOJ_RATE', name: '日本政策利率', value: String(bojRate), date: d }],
    },
    forex: {
      pairs: [{ id: 'dxy', name: '美元指数', changePct: dff >= 4 ? 0.3 : dff <= 1 ? -0.2 : 0 }],
    },
    indices: {
      regions: [
        {
          id: 'us',
          indices: [{ id: 'sp500', name: '标普500', changePct: vix > 25 ? -0.8 : 0.2 }],
        },
      ],
    },
    policy: { items: buildSyntheticPolicyItems(d) },
    geopolitics: { items: buildSyntheticGeoItems(d) },
    climate: { items: [] },
    commodities: { exchanges: [{ id: 'shfe', items: [{ id: 'sc', changePct: 0 }] }] },
    macro: { items: [] },
  };
}

function classifyEra(date) {
  return eventCalendar.classifyEpoch(date);
}

function getEraLabel(eraId) {
  return eventCalendar.getEpochLabel(eraId);
}

module.exports = {
  MACRO_TIMELINE,
  BACKTEST_ERAS,
  LONG_RUN_START: '2019-01-01',
  ensureFredDailyCache,
  getHistoricalFinanceEnvironment,
  getHistoricalRegime,
  buildHistoricalSources,
  activeTimelineEvents,
  classifyEra,
  getEraLabel,
  getDffAtDate,
  getVixAtDate,
};
