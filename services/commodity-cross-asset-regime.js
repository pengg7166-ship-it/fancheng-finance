/**
 * 跨资产因—贵金'× 原油 × 美股 动'regime（非固定负相关）
 * 数据：trading JSON (au/ag/sc/fu) + klines/index-sp500-day.json
 */
const fs = require('fs');
const path = require('path');
const diskCache = require('./disk-cache');
const { getDataDir } = require('./data-paths');

const CROSS_ASSET_VERSION = 'v1.32.4';

const TRADING_DIR = path.join(getDataDir() || 'E:\\FanchengFinance\\data', 'history', 'trading');
const HISTORY_DIR = path.join(getDataDir() || 'E:\\FanchengFinance\\data', 'history');
const TROY_OZ_GRAMS = 31.1034768;
const INTL_GOLD_FILE = 'fred-london-gold-daily.json';
const CNH_MIDRATE_FILE = 'cnh-midrate-daily.json';
const CNH_PROXY_FILE = 'fred-dexchus-daily.json';

/** 2026-01-28 FOMC 暂停降息后：油金不再遵循「油涨→通胀→金涨」固定链'*/
const MACRO_DECOUPLE_EPOCH = '2026-01-28';

const REGIME_IDS = [
  'risk_on_sync',
  'inflation_oil_drag',
  'safe_haven_sync',
  'dual_risk_off',
  'oil_gold_decouple',
  'macro_regime_shift',
];

const REGIME_LABELS = {
  risk_on_sync: '风险偏好同步（股金同涨）',
  inflation_oil_drag: '通胀油压（油涨金跌）',
  safe_haven_sync: '避险同步（股跌金涨）',
  dual_risk_off: '双杀流动性（股金同跌',
  oil_gold_decouple: '油金弱相·脱钩',
  macro_regime_shift: '宏观范式切换·2026油金分化',
};

const CORR_WINDOWS = [20, 60];
const DECOUPLE_CORR_THRESHOLD = 0.18;
/** 2026 分化窗口：弱相关判定放宽，避免误判为通胀油压 */
const DECOUPLE_POST_EPOCH_CORR = 0.38;
const MIN_BARS = 65;
const MIN_BARS_OIL_AU = 22;

/** 沪金溢价 overlay '回测默认跳过；实盘可展示 rationale */
const AU_OVERLAY_INTL_THRESHOLD = 0.35;
const AU_OVERLAY_PREMIUM_THRESHOLD = 0.4;
const AU_OVERLAY_MAX_DELTA = 0.04;
const AU_OVERLAY_SPOT_PROXY_SCALE = 0.28;
const AU_OVERLAY_CNH_CHG_THRESHOLD = 0.35;

let seriesCache = null;
let auOverlayCache = null;

function normDate(d) {
  return String(d || '').slice(0, 10);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function loadTradingSeries(instrumentId) {
  const fp = path.join(TRADING_DIR, `${String(instrumentId).toLowerCase()}.json`);
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const series = Array.isArray(raw) ? raw : raw.series || raw.klines || [];
    return series
      .map((r) => ({
        date: normDate(r.date || r.time),
        close: Number(r.close ?? r.price ?? 0),
      }))
      .filter((b) => b.close > 0 && b.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function loadKlineSeries(kind, id) {
  const key =
    kind === 'index'
      ? `klines/index-${String(id).toLowerCase()}-day.json`
      : `klines/commodity-${String(id).toLowerCase()}-day.json`;
  const stored = diskCache.readStale(key);
  const bars = stored?.data?.klines || [];
  return bars
    .map((r) => ({ date: normDate(r.date), close: Number(r.close ?? 0) }))
    .filter((b) => b.close > 0 && b.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function loadSeriesForId(id) {
  const fromTrading = loadTradingSeries(id);
  if (fromTrading.length >= MIN_BARS) return fromTrading;
  const fromKlines = loadKlineSeries('commodity', id);
  return fromKlines.length >= fromTrading.length ? fromKlines : fromTrading;
}

function ensureSeriesLoaded() {
  if (seriesCache) return seriesCache;
  const au = loadSeriesForId('au');
  const sc = loadSeriesForId('sc');
  const fu = loadSeriesForId('fu');
  const oil = sc.length >= 30 ? sc : fu.length >= 30 ? fu : sc;
  const sp500 = loadKlineSeries('index', 'sp500');
  seriesCache = { au, oil, sp500, oilId: sc.length >= 30 ? 'sc' : 'fu' };
  return seriesCache;
}

function buildDateIndex(bars) {
  const map = new Map();
  for (let i = 0; i < bars.length; i += 1) {
    map.set(bars[i].date, i);
  }
  return map;
}

function isPostMacroDecoupleEpoch(date) {
  return normDate(date) >= MACRO_DECOUPLE_EPOCH;
}

function alignSeries(au, oil, sp500) {
  const dates = [];
  const auIdx = buildDateIndex(au);
  const oilIdx = buildDateIndex(oil);
  const spIdx = buildDateIndex(sp500);
  const allDates = new Set([...auIdx.keys(), ...oilIdx.keys(), ...spIdx.keys()]);
  for (const d of [...allDates].sort()) {
    if (d < '2018-01-01') continue;
    const ai = auIdx.get(d);
    const oi = oilIdx.get(d);
    const si = spIdx.get(d);
    if (ai == null || oi == null || si == null) continue;
    if (ai < 1 || oi < 1 || si < 1) continue;
    dates.push({
      date: d,
      auRet: (au[ai].close - au[ai - 1].close) / au[ai - 1].close,
      oilRet: (oil[oi].close - oil[oi - 1].close) / oil[oi - 1].close,
      spRet: (sp500[si].close - sp500[si - 1].close) / sp500[si - 1].close,
    });
  }
  return dates;
}

/** SP500 缺失或滞后时，仅'AU×原油对齐'026 分化探针'*/
function alignOilAuOnly(au, oil) {
  const dates = [];
  const auIdx = buildDateIndex(au);
  const oilIdx = buildDateIndex(oil);
  const allDates = new Set([...auIdx.keys(), ...oilIdx.keys()]);
  for (const d of [...allDates].sort()) {
    if (d < '2018-01-01') continue;
    const ai = auIdx.get(d);
    const oi = oilIdx.get(d);
    if (ai == null || oi == null || ai < 1 || oi < 1) continue;
    dates.push({
      date: d,
      auRet: (au[ai].close - au[ai - 1].close) / au[ai - 1].close,
      oilRet: (oil[oi].close - oil[oi - 1].close) / oil[oi - 1].close,
      spRet: 0,
    });
  }
  return dates;
}

function pearsonCorr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0) return null;
  return num / den;
}

function rollingCorrelation(aligned, endIdx, window) {
  if (endIdx < window) return null;
  const slice = aligned.slice(endIdx - window + 1, endIdx + 1);
  const auR = slice.map((r) => r.auRet);
  const oilR = slice.map((r) => r.oilRet);
  const spR = slice.map((r) => r.spRet);
  return {
    auOil: pearsonCorr(auR, oilR),
    auSp: pearsonCorr(auR, spR),
  };
}

function cumulativeReturn(aligned, endIdx, days, field) {
  if (endIdx < days) return null;
  let prod = 1;
  for (let i = endIdx - days + 1; i <= endIdx; i += 1) {
    prod *= 1 + aligned[i][field];
  }
  return (prod - 1) * 100;
}

function findAlignedIndex(aligned, date) {
  const d = normDate(date);
  let lo = 0;
  let hi = aligned.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (aligned[mid].date <= d) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * @param {string} date
 * @param {object} [context]
 * @param {number} [context.auChangePct] '当日 AU 涨跌幅（可选，覆盖序列'
 * @param {number} [context.oilChangePct]
 * @param {number} [context.spChangePct]
 */
function classifyCrossAssetRegime(date, context = {}) {
  const { au, oil, sp500, oilId } = ensureSeriesLoaded();
  let aligned = alignSeries(au, oil, sp500);
  let idx = findAlignedIndex(aligned, date);
  let oilAuOnly = false;
  const postEpoch = isPostMacroDecoupleEpoch(date);

  if (idx < MIN_BARS) {
    aligned = alignOilAuOnly(au, oil);
    idx = findAlignedIndex(aligned, date);
    oilAuOnly = true;
  }

  const minBars = oilAuOnly ? MIN_BARS_OIL_AU : MIN_BARS;
  if (idx < minBars) {
    const fallbackId = postEpoch ? 'macro_regime_shift' : 'oil_gold_decouple';
    return {
      id: fallbackId,
      label: REGIME_LABELS[fallbackId],
      confidence: postEpoch ? 0.55 : 0.2,
      insufficient: true,
      postEpoch,
      oilAuOnly,
      corr: {},
      changes: {},
      oilId,
    };
  }

  const corr20 = rollingCorrelation(aligned, idx, 20);
  const corr60 = rollingCorrelation(aligned, idx, 60);
  const auChg5 = cumulativeReturn(aligned, idx, 5, 'auRet');
  const oilChg5 = cumulativeReturn(aligned, idx, 5, 'oilRet');
  const spChg5 = oilAuOnly ? null : cumulativeReturn(aligned, idx, 5, 'spRet');
  const auChg1 = (context.auChangePct ?? aligned[idx].auRet * 100);
  const oilChg1 = (context.oilChangePct ?? aligned[idx].oilRet * 100);
  const spChg1 = oilAuOnly ? (context.spChangePct ?? 0) : (context.spChangePct ?? aligned[idx].spRet * 100);

  const c20Oil = corr20?.auOil ?? 0;
  const c20Sp = corr20?.auSp ?? 0;
  const c60Oil = corr60?.auOil ?? 0;
  const c60Sp = corr60?.auSp ?? 0;
  const decoupleThreshold = postEpoch ? DECOUPLE_POST_EPOCH_CORR : DECOUPLE_CORR_THRESHOLD;
  const weakCorr =
    Math.abs(c20Oil) < decoupleThreshold &&
    Math.abs(c60Oil) < decoupleThreshold * 1.2;

  const oilUpGoldDown = oilChg5 > 0.5 && auChg5 < -0.15;
  const oilDownGoldUp = oilChg5 < -0.5 && auChg5 > 0.15;
  const macroShiftSignal = postEpoch && (oilUpGoldDown || oilDownGoldUp || weakCorr);

  let id = 'oil_gold_decouple';
  let confidence = 0.55;

  if (macroShiftSignal && (oilUpGoldDown || weakCorr)) {
    id = 'macro_regime_shift';
    confidence = clamp(0.62 + (oilUpGoldDown ? Math.min(oilChg5, Math.abs(auChg5)) / 15 : 0), 0.62, 0.88);
  } else if (weakCorr) {
    id = postEpoch ? 'macro_regime_shift' : 'oil_gold_decouple';
    confidence = postEpoch ? 0.68 : 0.65;
  } else if (!oilAuOnly && spChg5 > 0.8 && auChg5 > 0.4 && c20Sp > 0.1) {
    id = 'risk_on_sync';
    confidence = clamp(0.5 + Math.min(spChg5, auChg5) / 8 + c20Sp * 0.3, 0.5, 0.92);
  } else if (
    !postEpoch &&
    oilChg5 > 1.2 &&
    auChg5 < -0.3 &&
    c20Oil < 0
  ) {
    id = 'inflation_oil_drag';
    confidence = clamp(0.55 + oilChg5 / 12 + Math.abs(c20Oil) * 0.25, 0.55, 0.95);
  } else if (!oilAuOnly && spChg5 < -0.8 && auChg5 > 0.3) {
    id = 'safe_haven_sync';
    confidence = clamp(0.55 + Math.abs(spChg5) / 10 + auChg5 / 8, 0.55, 0.93);
  } else if (!oilAuOnly && spChg5 < -1.0 && auChg5 < -0.5) {
    id = 'dual_risk_off';
    confidence = clamp(0.6 + Math.abs(spChg5 + auChg5) / 12, 0.6, 0.95);
  } else if (
    !postEpoch &&
    c20Oil < -0.15 &&
    oilChg5 > 0.6 &&
    auChg5 < 0
  ) {
    id = 'inflation_oil_drag';
    confidence = 0.58;
  } else if (!oilAuOnly && c20Sp > 0.2 && spChg5 > 0 && auChg5 > 0) {
    id = 'risk_on_sync';
    confidence = 0.52;
  } else if (postEpoch && oilUpGoldDown) {
    id = 'macro_regime_shift';
    confidence = 0.7;
  } else if (oilChg5 > 0.4 && auChg5 > 0.2 && c20Oil > 0.15) {
    id = 'risk_on_sync';
    confidence = 0.5;
  } else {
    id = postEpoch ? 'macro_regime_shift' : 'oil_gold_decouple';
    confidence = postEpoch ? 0.52 : 0.45;
  }

  return {
    id,
    label: REGIME_LABELS[id],
    confidence: +confidence.toFixed(3),
    insufficient: false,
    postEpoch,
    oilAuOnly,
    oilId,
    corr: {
      auOil20: corr20?.auOil != null ? +corr20.auOil.toFixed(4) : null,
      auSp20: corr20?.auSp != null ? +corr20.auSp.toFixed(4) : null,
      auOil60: corr60?.auOil != null ? +corr60.auOil.toFixed(4) : null,
      auSp60: corr60?.auSp != null ? +corr60.auSp.toFixed(4) : null,
    },
    changes: {
      au1d: +auChg1.toFixed(3),
      oil1d: +oilChg1.toFixed(3),
      sp1d: +spChg1.toFixed(3),
      au5d: auChg5 != null ? +auChg5.toFixed(3) : null,
      oil5d: oilChg5 != null ? +oilChg5.toFixed(3) : null,
      sp5d: spChg5 != null ? +spChg5.toFixed(3) : null,
    },
    date: aligned[idx].date,
  };
}

/**
 * 贵金属方向微—仅在 AU/AG 板块生效
 */
function computePreciousCrossAssetAdjustment(regime, { compositeScore = 0, oilScore = 0 } = {}) {
  if (!regime || regime.insufficient) {
    return { delta: 0, rationale: null, weight: 0 };
  }

  let delta = 0;
  let rationale = null;
  let weight = 0.08;

  switch (regime.id) {
    case 'inflation_oil_drag': {
      const postEpoch = isPostMacroDecoupleEpoch(regime.date);
      let dragScale = postEpoch ? 0.3 : 1;
      try {
        const adaptiveScale = require('./outlook-adaptive-calibration').getOilGoldCouplingScale(regime.date);
        if (postEpoch && adaptiveScale != null) dragScale = adaptiveScale;
      } catch {
        // keep default
      }
      if (oilScore > 0.08) {
        delta -= clamp(oilScore * 0.22 * dragScale, 0.02, postEpoch ? 0.08 : 0.2);
        rationale = postEpoch ? '2026分化窗口·弱化油压' : '原油强势压制贵金';
      }
      if (compositeScore > 0.12 && oilScore > 0.12) {
        delta -= 0.06 * dragScale;
        rationale = rationale ? `${rationale}·信号冲突` : '油金信号冲突·偏观';
      }
      weight = postEpoch ? 0.06 : 0.12;
      break;
    }
    case 'risk_on_sync':
      if (regime.changes?.sp5d > 0 && regime.changes?.au5d > 0) {
        delta += clamp((regime.changes.sp5d + regime.changes.au5d) / 40, 0.03, 0.1);
        rationale = '美股贵金属同向·风险偏';
      }
      weight = 0.09;
      break;
    case 'safe_haven_sync':
      if (regime.changes?.sp5d < 0) {
        delta += compositeScore < 0 ? 0.05 : 0.08;
        rationale = '避险同步·股跌金涨';
      }
      weight = 0.11;
      break;
    case 'dual_risk_off':
      delta = -compositeScore * 0.14;
      rationale = '双杀流动性·收缩方向确信度';
      weight = 0.1;
      break;
    case 'macro_regime_shift':
    case 'oil_gold_decouple':
    default:
      delta = 0;
      rationale = regime.id === 'macro_regime_shift'
        ? '2026宏观切换·油金分轨定价'
        : '油金弱相关·不做固定符';
      weight = 0.04;
      break;
  }

  const conf = regime.confidence ?? 0.5;
  delta = delta * clamp(conf, 0.35, 1);
  return {
    delta: +clamp(delta, -0.22, 0.22).toFixed(4),
    rationale,
    weight: +weight.toFixed(3),
    regimeId: regime.id,
  };
}

function computeRegimeStats(fromDate = '2019-01-01', toDate = '2025-12-31') {
  const { au, oil, sp500 } = ensureSeriesLoaded();
  const aligned = alignSeries(au, oil, sp500);
  const counts = Object.fromEntries(REGIME_IDS.map((id) => [id, 0]));
  const corrByEra = {};
  const eras = [
    { id: '2019', from: '2019-01-01', to: '2019-12-31' },
    { id: '2020_covid', from: '2020-01-01', to: '2020-12-31' },
    { id: '2022_inflation', from: '2022-01-01', to: '2022-12-31' },
    { id: '2023_2024', from: '2023-01-01', to: '2024-12-31' },
    { id: '2025', from: '2025-01-01', to: '2025-12-31' },
    { id: '2026_decouple', from: MACRO_DECOUPLE_EPOCH, to: '2026-12-31' },
  ];

  for (const era of eras) {
    corrByEra[era.id] = { auOil20: [], auSp20: [], days: 0 };
  }

  let total = 0;
  for (let i = MIN_BARS; i < aligned.length; i += 1) {
    const d = aligned[i].date;
    if (d < fromDate || d > toDate) continue;
    const regime = classifyCrossAssetRegime(d);
    counts[regime.id] = (counts[regime.id] || 0) + 1;
    total += 1;

    for (const era of eras) {
      if (d >= era.from && d <= era.to) {
        const c20 = rollingCorrelation(aligned, i, 20);
        if (c20?.auOil != null) corrByEra[era.id].auOil20.push(c20.auOil);
        if (c20?.auSp != null) corrByEra[era.id].auSp20.push(c20.auSp);
        corrByEra[era.id].days += 1;
      }
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const eraStats = {};
  for (const era of eras) {
    const e = corrByEra[era.id];
    eraStats[era.id] = {
      days: e.days,
      avgCorrAuOil20: avg(e.auOil20) != null ? +avg(e.auOil20).toFixed(4) : null,
      avgCorrAuSp20: avg(e.auSp20) != null ? +avg(e.auSp20).toFixed(4) : null,
    };
  }

  const pct = {};
  for (const id of REGIME_IDS) {
    pct[id] = total ? +((counts[id] / total) * 100).toFixed(1) : 0;
  }

  return { total, counts, pct, eraStats, fromDate, toDate };
}

function loadHistoryFredBars(filename) {
  const fp = path.join(HISTORY_DIR, filename);
  if (!fs.existsSync(fp)) return { bars: [], source: null };
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const bars = (raw.series || [])
      .map((r) => ({
        date: normDate(r.date),
        close: Number(r.value ?? r.close ?? 0),
      }))
      .filter((b) => b.close > 0 && b.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      bars,
      source: raw.source || raw.seriesId || filename,
      label: raw.label || null,
      kind: raw.kind || null,
      proxy: Boolean(raw.proxy),
    };
  } catch {
    return { bars: [], source: null };
  }
}

function loadCnhMidrateSeries() {
  const cnh = loadHistoryFredBars(CNH_MIDRATE_FILE);
  if (cnh.bars.length >= 20) {
    const kind = cnh.kind || 'cnh_midrate';
    const isSpotClose = kind === 'cnh_spot_close';
    const isProxy =
      cnh.proxy ||
      isSpotClose ||
      kind === 'cny_midrate_proxy' ||
      kind === 'dexchus_proxy';
    return {
      ...cnh,
      kind: isSpotClose ? 'cnh_spot_close' : kind,
      proxy: isProxy,
    };
  }
  const onshore = loadHistoryFredBars(CNH_PROXY_FILE);
  if (onshore.bars.length >= 20) {
    return { ...onshore, kind: 'dexchus_proxy', proxy: true, label: '在岸USD/CNY(DEXCHUS)代理' };
  }
  return { bars: [], source: null, kind: 'missing', proxy: true };
}

function ensureAuOverlaySeriesLoaded() {
  if (auOverlayCache) return auOverlayCache;
  const { au } = ensureSeriesLoaded();
  const intlGold = loadHistoryFredBars(INTL_GOLD_FILE);
  const cnh = loadCnhMidrateSeries();
  auOverlayCache = {
    au,
    intlGold: intlGold.bars,
    intlGoldMeta: intlGold,
    cnh: cnh.bars,
    cnhMeta: cnh,
  };
  return auOverlayCache;
}

function lookupCloseOnOrBefore(bars, date) {
  const d = normDate(date);
  let last = null;
  for (const row of bars) {
    if (row.date <= d) last = row.close;
    else break;
  }
  return last;
}

function lookupDateOnOrBefore(bars, date) {
  const d = normDate(date);
  let last = null;
  for (const row of bars) {
    if (row.date <= d) last = row.date;
    else break;
  }
  return last;
}

function shiftDate(date, days) {
  const dt = new Date(normDate(date));
  dt.setDate(dt.getDate() - days);
  return normDate(dt);
}

function cumulativeCloseReturnPct(bars, endDate, days) {
  const end = lookupDateOnOrBefore(bars, endDate);
  const start = lookupDateOnOrBefore(bars, shiftDate(endDate, days));
  if (!end || !start || end === start) return null;
  const cEnd = lookupCloseOnOrBefore(bars, end);
  const cStart = lookupCloseOnOrBefore(bars, start);
  if (!cEnd || !cStart) return null;
  return ((cEnd - cStart) / cStart) * 100;
}

function computeShPremiumPct(auClose, londonClose, cnhRate) {
  if (!auClose || !londonClose || !cnhRate) return null;
  const impliedUsdOz = (auClose * TROY_OZ_GRAMS) / cnhRate;
  return ((impliedUsdOz / londonClose) - 1) * 100;
}

/**
 * 沪金实用交易哲学：国际现货黄金定方向 + 离岸人民币中间价判溢'
 * @param {string} date
 * @param {object} [context]
 * @param {number} [context.auChangePct]
 * @param {number} [context.cnhChangePct] '当日 USDCNH/USDCNY 涨跌幅（可选）
 * @param {number} [context.compositeScore]
 */
function intlGoldDirectionSign(intlChg5) {
  if (intlChg5 == null) return 0;
  if (intlChg5 >= AU_OVERLAY_INTL_THRESHOLD) return 1;
  if (intlChg5 <= -AU_OVERLAY_INTL_THRESHOLD) return -1;
  return 0;
}

function computeAuSpotCnhOverlay(date, context = {}) {
  const { au, intlGold, intlGoldMeta, cnh, cnhMeta } = ensureAuOverlaySeriesLoaded();
  const d = normDate(date);
  const intlSource = intlGold.length >= 20 ? 'london_gold' : 'au_correlation_proxy';
  const cnhSource =
    cnhMeta.kind === 'cnh_midrate' && !cnhMeta.proxy
      ? 'cnh_midrate'
      : cnhMeta.kind === 'cnh_spot_close'
        ? 'cnh_spot_close'
        : cnhMeta.kind === 'dexchus_proxy'
          ? 'dexchus_proxy'
          : cnh.length >= 20
            ? 'cnh_other'
            : 'missing';
  const hasLondonGold = intlGold.length >= 20;
  const hasCnh = cnh.length >= 20;
  const isSpotProxy = cnhMeta.kind === 'cnh_spot_close' || cnhMeta.proxy;

  if (!hasLondonGold || !hasCnh) {
    return {
      delta: 0,
      rationale: null,
      weight: 0,
      intlGoldChg5: null,
      premiumChg5: null,
      dataSources: { intl: intlSource, cnh: cnhSource },
      gated: true,
      gateReason: !hasLondonGold ? 'missing_london_gold' : 'missing_cnh',
      insufficient: true,
    };
  }

  const intlBars = intlGold;
  const intlChg5 = cumulativeCloseReturnPct(intlBars, d, 5);
  const auChg5 = cumulativeCloseReturnPct(au, d, 5);
  const cnhChg5 = cumulativeCloseReturnPct(cnh, d, 5);

  if (intlChg5 == null && auChg5 == null) {
    return {
      delta: 0,
      rationale: null,
      weight: 0,
      intlGoldChg5: null,
      premiumChg5: null,
      dataSources: { intl: intlSource, cnh: cnhSource },
      insufficient: true,
    };
  }

  let delta = 0;
  const rationaleParts = [];
  const intl = intlChg5 ?? 0;
  const intlDir = intlGoldDirectionSign(intlChg5);

  let premiumChg5 = null;
  const auClose = lookupCloseOnOrBefore(au, d);
  const londonClose = lookupCloseOnOrBefore(intlBars, d);
  const cnhRate = lookupCloseOnOrBefore(cnh, d);
  const auClose5 = lookupCloseOnOrBefore(au, shiftDate(d, 5));
  const londonClose5 = lookupCloseOnOrBefore(intlBars, shiftDate(d, 5));
  const cnhRate5 = lookupCloseOnOrBefore(cnh, shiftDate(d, 5));

  if (auClose && londonClose && cnhRate && auClose5 && londonClose5 && cnhRate5) {
    const premNow = computeShPremiumPct(auClose, londonClose, cnhRate);
    const prem5 = computeShPremiumPct(auClose5, londonClose5, cnhRate5);
    if (premNow != null && prem5 != null) premiumChg5 = premNow - prem5;
  } else if (auChg5 != null && intlChg5 != null) {
    premiumChg5 = auChg5 - intlChg5 - (cnhChg5 ?? 0);
  }

  const premiumThreshold =
    isSpotProxy ? AU_OVERLAY_PREMIUM_THRESHOLD * 1.35 : AU_OVERLAY_PREMIUM_THRESHOLD;
  const hasPremiumSignal =
    premiumChg5 != null && Math.abs(premiumChg5) >= premiumThreshold && intlDir !== 0;
  const hasCnhSignal =
    cnhChg5 != null &&
    Math.abs(cnhChg5) >= AU_OVERLAY_CNH_CHG_THRESHOLD &&
    intlDir !== 0;

  if (!hasPremiumSignal && !hasCnhSignal) {
    const srcLabel = intlSource === 'london_gold' ? '伦敦' : '沪金联动代理';
    const idleRationale =
      Math.abs(intl) >= AU_OVERLAY_INTL_THRESHOLD
        ? `${srcLabel}${intl >= 0 ? '+' : '-'}${intl.toFixed(2)}%·溢价/CNH未达门控`
        : isSpotProxy
          ? '国际金平盘·溢价中性（CNH收盘代理'
          : '国际金平盘·溢价中';
    return {
      delta: 0,
      rationale: idleRationale,
      weight: 0,
      intlGoldChg5: intlChg5 != null ? +intlChg5.toFixed(3) : null,
      premiumChg5: premiumChg5 != null ? +premiumChg5.toFixed(3) : null,
      cnhChg5: cnhChg5 != null ? +cnhChg5.toFixed(3) : null,
      dataSources: {
        intl: intlSource,
        intlFile: intlGoldMeta.source,
        cnh: cnhSource,
        cnhFile: cnhMeta.source,
        cnhProxy: isSpotProxy,
      },
      overlayScale: isSpotProxy ? AU_OVERLAY_SPOT_PROXY_SCALE : 1,
      gated: true,
      gateReason: 'premium_cnh_below_threshold',
      insufficient: false,
    };
  }

  if (hasPremiumSignal) {
    if (premiumChg5 > premiumThreshold && intlDir > 0) {
      delta += clamp(premiumChg5 / 90, 0.008, 0.022);
      rationaleParts.push('溢价走阔·沪金跟涨/补涨');
    } else if (premiumChg5 < -premiumThreshold && intlDir < 0) {
      delta -= clamp(Math.abs(premiumChg5) / 95, 0.008, 0.022);
      rationaleParts.push('溢价收窄·国际金走弱偏谨慎');
    } else if (premiumChg5 < -premiumThreshold * 1.5 && intlDir > 0) {
      delta -= 0.01;
      rationaleParts.push('溢价压缩·沪金相对偏弱');
    }
  }

  if (hasCnhSignal) {
    const cnhMod = clamp(-cnhChg5 / 110, -0.015, 0.015);
    if (intlDir > 0 && cnhChg5 > AU_OVERLAY_CNH_CHG_THRESHOLD) {
      delta += cnhMod;
      rationaleParts.push('离岸CNH走弱·溢价支撑');
    } else if (intlDir < 0 && cnhChg5 < -AU_OVERLAY_CNH_CHG_THRESHOLD) {
      delta += cnhMod;
      rationaleParts.push('离岸CNH走强·溢价承压');
    }
  }

  if (context.cnhChangePct != null && !Number.isNaN(Number(context.cnhChangePct))) {
    const liveCnh = Number(context.cnhChangePct);
    if (Math.abs(liveCnh) >= 0.1 && intlDir !== 0) {
      const liveMod = clamp(-liveCnh / 80, -0.02, 0.02);
      if (intlDir > 0 && liveCnh > 0.08) {
        delta += liveMod;
        rationaleParts.push('CNH走弱·溢价支撑');
      } else if (intlDir < 0 && liveCnh < -0.08) {
        delta += liveMod;
        rationaleParts.push('CNH走强·溢价承压');
      }
    }
  }

  const overlayScale = isSpotProxy ? AU_OVERLAY_SPOT_PROXY_SCALE : 1;
  const conf = intlSource === 'london_gold' ? 1 : 0.55;
  delta = delta * conf * overlayScale;
  delta = +clamp(delta, -AU_OVERLAY_MAX_DELTA, AU_OVERLAY_MAX_DELTA).toFixed(4);

  let rationale = rationaleParts.length ? rationaleParts.join('·') : null;
  if (isSpotProxy && rationale) {
    rationale += '（CNH为行情收盘代理·非CFETS中间价）';
  } else if (cnhSource === 'missing' && rationale) {
    rationale += '（CNH中间价待补）';
  } else if (cnhMeta.proxy && cnhMeta.kind !== 'cnh_spot_close' && rationale) {
    rationale += '（CNH用在岸代理）';
  }

  return {
    delta,
    rationale:
      delta !== 0
        ? rationale
        : rationale || (intlSource === 'london_gold' ? '国际金平盘·溢价中' : null),
    weight: isSpotProxy ? 0.04 : 0.07,
    intlGoldChg5: intlChg5 != null ? +intlChg5.toFixed(3) : null,
    premiumChg5: premiumChg5 != null ? +premiumChg5.toFixed(3) : null,
    cnhChg5: cnhChg5 != null ? +cnhChg5.toFixed(3) : null,
    dataSources: {
      intl: intlSource,
      intlFile: intlGoldMeta.source,
      cnh: cnhSource,
      cnhFile: cnhMeta.source,
      cnhProxy: isSpotProxy,
    },
    overlayScale: isSpotProxy ? AU_OVERLAY_SPOT_PROXY_SCALE : 1,
    insufficient: false,
  };
}

function resetSeriesCache() {
  seriesCache = null;
  auOverlayCache = null;
}

module.exports = {
  CROSS_ASSET_VERSION,
  MACRO_DECOUPLE_EPOCH,
  REGIME_IDS,
  REGIME_LABELS,
  CORR_WINDOWS,
  isPostMacroDecoupleEpoch,
  ensureSeriesLoaded,
  classifyCrossAssetRegime,
  computePreciousCrossAssetAdjustment,
  computeRegimeStats,
  rollingCorrelation,
  alignSeries,
  alignOilAuOnly,
  resetSeriesCache,
  computeAuSpotCnhOverlay,
  ensureAuOverlaySeriesLoaded,
  TROY_OZ_GRAMS,
  INTL_GOLD_FILE,
  CNH_MIDRATE_FILE,
};
