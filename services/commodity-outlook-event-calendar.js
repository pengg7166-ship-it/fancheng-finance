/**
 * 大宗走势研判 — 历史宏观事件日历与权重乘数（2019+ walk-forward）
 */
const MULTIPLIER_KEYS = ['philosophy', 'macroFed', 'macroGeo', 'macroChina', 'oilSpillover', 'capitalSentiment'];

/** walk-forward 回测时代分段（与 UI epoch 表一致） */
const BACKTEST_ERAS = [
  { id: '2019', label: '2019 贸易战/疫前', from: '2019-01-01', to: '2019-12-31' },
  { id: '2020_covid', label: '2020 COVID', from: '2020-01-01', to: '2020-12-31' },
  { id: '2021', label: '2021 复苏', from: '2021-01-01', to: '2021-12-31' },
  { id: '2022_hike_ru', label: '2022 加息+俄乌', from: '2022-01-01', to: '2022-12-31' },
  { id: '2023_2024', label: '2023-2024 高利率/BOJ', from: '2023-01-01', to: '2024-12-31' },
  { id: '2025_2026', label: '2025-2026 反内卷/地缘', from: '2025-01-01', to: '2099-12-31' },
];

const DEFAULT_MULTIPLIERS = {
  philosophy: 1,
  macroFed: 1,
  macroGeo: 1,
  macroChina: 1,
  oilSpillover: 1,
  capitalSentiment: 1,
};

/** @type {Array<object>} */
const HISTORICAL_EVENTS = [
  {
    id: 'pre_covid_neutral',
    start: '2019-01-01',
    end: '2020-02-29',
    label: '2019贸易战/疫前中性',
    regimes: { finance: 'neutral', geo: 'neutral', supply: 'balanced', demand: 'balanced', chinaPolicy: 'neutral' },
    weightMultipliers: { philosophy: 1, macroFed: 1, macroGeo: 1.05, macroChina: 1, oilSpillover: 1, capitalSentiment: 1 },
    affectedSectors: [],
    affectedIds: [],
  },
  {
    id: 'covid_crash_fed_zero',
    start: '2020-03-01',
    end: '2020-06-30',
    label: 'COVID冲击+Fed零利率',
    regimes: { finance: 'loose_extreme', geo: 'demand_shock', supply: 'disrupted', demand: 'collapsed', chinaPolicy: 'stimulus' },
    weightMultipliers: { philosophy: 1.15, macroFed: 1.35, macroGeo: 0.95, macroChina: 1.1, oilSpillover: 1.25, capitalSentiment: 1.3 },
    affectedSectors: ['energy', 'metals', 'agriculture', 'precious'],
    affectedIds: ['sc', 'au', 'cu', 'rb', 'FG'],
  },
  {
    id: 'covid_recovery_rally',
    start: '2020-07-01',
    end: '2021-12-31',
    label: '2020-2021疫后复苏',
    regimes: { finance: 'loose', geo: 'neutral', supply: 'catch_up', demand: 'recovery', chinaPolicy: 'stimulus' },
    weightMultipliers: { philosophy: 1.08, macroFed: 1.2, macroGeo: 0.95, macroChina: 1.12, oilSpillover: 1.15, capitalSentiment: 1.18 },
    affectedSectors: ['energy', 'metals', 'black', 'chemical'],
    affectedIds: ['sc', 'cu', 'rb', 'i', 'jm'],
  },
  {
    id: 'fed_hike_aggressive',
    start: '2022-03-01',
    end: '2023-12-31',
    label: 'Fed激进加息',
    regimes: { finance: 'tight', geo: 'neutral', supply: 'balanced', demand: 'cooling', chinaPolicy: 'neutral' },
    weightMultipliers: { philosophy: 1.05, macroFed: 1.3, macroGeo: 1, macroChina: 0.95, oilSpillover: 0.92, capitalSentiment: 1.1 },
    affectedSectors: ['precious', 'metals', 'energy'],
    affectedIds: ['au', 'ag', 'cu'],
  },
  {
    id: 'ru_ukraine_supply',
    start: '2022-02-24',
    end: null,
    label: '俄乌冲突能源/粮食',
    regimes: { finance: 'neutral', geo: 'supply_shock', supply: 'tight', demand: 'mixed', chinaPolicy: 'neutral' },
    weightMultipliers: { philosophy: 1.1, macroFed: 1, macroGeo: 1.35, macroChina: 0.98, oilSpillover: 1.4, capitalSentiment: 1.08 },
    affectedSectors: ['energy', 'agriculture', 'black'],
    affectedIds: ['sc', 'fu', 'WH', 'c', 'm', 'jm', 'FG'],
  },
  {
    id: 'boj_nirp_exit',
    start: '2024-03-01',
    end: '2025-12-31',
    label: 'BOJ退出负利率',
    regimes: { finance: 'normalizing', geo: 'neutral', supply: 'balanced', demand: 'balanced', chinaPolicy: 'neutral' },
    weightMultipliers: { philosophy: 1.02, macroFed: 1.05, macroGeo: 1, macroChina: 1, oilSpillover: 1, capitalSentiment: 1.06 },
    affectedSectors: ['precious', 'metals'],
    affectedIds: ['au', 'ag', 'cu', 'ni'],
  },
  {
    id: 'china_anti_involution',
    start: '2025-01-01',
    end: null,
    label: '2025反内卷',
    regimes: { finance: 'neutral', geo: 'neutral', supply: 'discipline', demand: 'stable', chinaPolicy: 'anti_involution' },
    weightMultipliers: { philosophy: 1.12, macroFed: 1, macroGeo: 1, macroChina: 1.35, oilSpillover: 0.95, capitalSentiment: 1.05 },
    affectedSectors: ['chemical', 'metals', 'black'],
    affectedIds: ['FG', 'ps', 'jm', 'lc'],
  },
  {
    id: 'us_iran_israel_2026',
    start: '2026-01-01',
    end: null,
    label: '2026美以伊地缘',
    regimes: { finance: 'neutral', geo: 'energy_precious_shock', supply: 'tight', demand: 'risk_off', chinaPolicy: 'neutral' },
    weightMultipliers: { philosophy: 1.1, macroFed: 1.02, macroGeo: 1.4, macroChina: 0.98, oilSpillover: 1.45, capitalSentiment: 1.15 },
    affectedSectors: ['energy', 'precious', 'agriculture'],
    affectedIds: ['sc', 'fu', 'au', 'ag', 'lu'],
  },
  {
    id: 'fed_ease_restart',
    start: '2024-09-01',
    end: null,
    label: 'Fed再宽松/降息',
    regimes: { finance: 'easing', geo: 'neutral', supply: 'balanced', demand: 'recovery', chinaPolicy: 'neutral' },
    weightMultipliers: { philosophy: 1.04, macroFed: 1.18, macroGeo: 1, macroChina: 1.05, oilSpillover: 1.05, capitalSentiment: 1.08 },
    affectedSectors: ['precious', 'metals', 'energy'],
    affectedIds: ['au', 'cu', 'sc'],
  },
  {
    id: 'china_supply_side_ref',
    start: '2016-01-01',
    end: '2017-12-31',
    label: '2016供给侧改革(参考)',
    regimes: { finance: 'neutral', geo: 'neutral', supply: 'reform', demand: 'mixed', chinaPolicy: 'supply_side' },
    weightMultipliers: { philosophy: 0.85, macroFed: 1, macroGeo: 1, macroChina: 1.2, oilSpillover: 1, capitalSentiment: 0.95 },
    affectedSectors: ['black', 'energy', 'chemical'],
    affectedIds: ['ZC', 'jm', 'sc', 'fu'],
  },
];

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function dateInRange(date, from, to) {
  const d = normDate(date);
  const end = to || '2099-12-31';
  return d >= from && d <= end;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getActiveEvents(date) {
  return HISTORICAL_EVENTS.filter((e) => dateInRange(date, e.start, e.end));
}

function mergeMultipliers(events) {
  const out = { ...DEFAULT_MULTIPLIERS };
  for (const ev of events) {
    for (const key of MULTIPLIER_KEYS) {
      const m = ev.weightMultipliers?.[key];
      if (m != null && Number.isFinite(m)) out[key] *= m;
    }
  }
  for (const key of MULTIPLIER_KEYS) {
    out[key] = +clamp(out[key], 0.55, 2).toFixed(4);
  }
  return out;
}

function mergeRegimes(events) {
  const out = { finance: 'neutral', geo: 'neutral', supply: 'balanced', demand: 'balanced', chinaPolicy: 'neutral' };
  for (const ev of events) {
    for (const [k, v] of Object.entries(ev.regimes || {})) {
      if (v) out[k] = v;
    }
  }
  return out;
}

function getActiveEventsMerged(date, { instrumentId = null, sector = null } = {}) {
  const events = getActiveEvents(date);
  let weightMultipliers = mergeMultipliers(events);
  const regimes = mergeRegimes(events);
  const affectedSectors = new Set();
  const affectedIds = new Set();
  for (const ev of events) {
    for (const s of ev.affectedSectors || []) affectedSectors.add(s);
    for (const id of ev.affectedIds || []) affectedIds.add(String(id).toLowerCase());
  }

  if (instrumentId && affectedIds.size) {
    const norm = String(instrumentId).toLowerCase();
    const sectorHit = sector && affectedSectors.has(sector);
    const idHit = affectedIds.has(norm);
    if (!idHit && !sectorHit) {
      weightMultipliers = {
        ...weightMultipliers,
        macroGeo: +(weightMultipliers.macroGeo * 0.88).toFixed(4),
        macroChina: +(weightMultipliers.macroChina * 0.9).toFixed(4),
        oilSpillover: +(weightMultipliers.oilSpillover * 0.92).toFixed(4),
      };
    } else if (idHit) {
      weightMultipliers = {
        ...weightMultipliers,
        philosophy: +(weightMultipliers.philosophy * 1.04).toFixed(4),
      };
    }
  }

  return {
    date: normDate(date),
    events: events.map((e) => ({ id: e.id, label: e.label })),
    eventIds: events.map((e) => e.id),
    weightMultipliers,
    regimes,
    affectedSectors: [...affectedSectors],
    affectedIds: [...affectedIds],
  };
}

function classifyEpoch(date) {
  const d = normDate(date);
  for (const era of BACKTEST_ERAS) {
    if (d >= era.from && d <= era.to) return era.id;
  }
  return 'unknown';
}

function getEpochLabel(epochId) {
  return BACKTEST_ERAS.find((e) => e.id === epochId)?.label || epochId;
}

module.exports = {
  HISTORICAL_EVENTS,
  BACKTEST_ERAS,
  MULTIPLIER_KEYS,
  DEFAULT_MULTIPLIERS,
  getActiveEvents,
  getActiveEventsMerged,
  mergeMultipliers,
  classifyEpoch,
  getEpochLabel,
};
