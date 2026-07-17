/**
 * 大宗走势研判权重校准 — 板块分权 + 回测调参 + 高级方向过滤
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const eventCalendar = require('./commodity-outlook-event-calendar');

const CALIBRATION_VERSION = 'v1.27.0';
const CALIBRATION_FILENAME = 'outlook-calibration.json';
const HIT_RATE_TARGET = null; // v1.49: 不再以 70% 为优化/门控目标

const SECTOR_IDS = ['energy', 'chemical', 'black', 'metals', 'precious', 'agriculture'];

const SECTOR_LABELS = {
  energy: '能源',
  chemical: '化工',
  black: '黑色',
  metals: '有色新能源',
  precious: '贵金属',
  agriculture: '农产品',
};

const DEFAULT_WEIGHTS = {
  philosophyWeight: 0.58,
  adaptiveWeight: 0.22,
  factorWeight: 0.2,
};

/** 板块先验权重 — 哲学乘数按板块特性手工设定，blend 由网格搜索覆盖 */
const DEFAULT_SECTOR_WEIGHTS = {
  energy: {
    philosophyWeight: 0.5,
    adaptiveWeight: 0.28,
    factorWeight: 0.22,
    priceFeedback: 0.92,
    capitalSentiment: 0.85,
    macroFed: 1.28,
    macroGeo: 1.32,
    macroChina: 0.95,
    oilSpillover: 1.42,
    directionBull: 0.1,
    directionBear: -0.1,
    strongBull: 0.2,
    strongBear: -0.2,
    strongMinSectorHitRate: 0.52,
  },
  chemical: {
    philosophyWeight: 0.54,
    adaptiveWeight: 0.24,
    factorWeight: 0.22,
    priceFeedback: 0.95,
    capitalSentiment: 0.9,
    macroChina: 1.32,
    macroPolicy: 1.18,
    oilSpillover: 1.28,
    inventory: 1.08,
    directionBull: 0.11,
    directionBear: -0.11,
    strongBull: 0.19,
    strongBear: -0.19,
    strongMinSectorHitRate: 0.5,
  },
  black: {
    philosophyWeight: 0.56,
    adaptiveWeight: 0.22,
    factorWeight: 0.22,
    priceFeedback: 0.94,
    capitalSentiment: 0.88,
    macroChina: 1.38,
    macroPolicy: 1.22,
    inventory: 1.28,
    directionBull: 0.11,
    directionBear: -0.11,
    strongBull: 0.2,
    strongBear: -0.2,
    strongMinSectorHitRate: 0.5,
  },
  metals: {
    philosophyWeight: 0.55,
    adaptiveWeight: 0.23,
    factorWeight: 0.22,
    priceFeedback: 0.96,
    capitalSentiment: 0.92,
    macroChina: 1.3,
    macroUsd: 1.18,
    inventory: 1.26,
    directionBull: 0.1,
    directionBear: -0.1,
    strongBull: 0.18,
    strongBear: -0.18,
    strongMinSectorHitRate: 0.5,
  },
  precious: {
    philosophyWeight: 0.62,
    adaptiveWeight: 0.16,
    factorWeight: 0.22,
    priceFeedback: 1.08,
    capitalSentiment: 0.62,
    macroUsd: 1.38,
    macroGeo: 1.28,
    macroFed: 1.18,
    vix: 1.22,
    directionBull: 0.12,
    directionBear: -0.12,
    strongBull: 0.22,
    strongBear: -0.22,
    strongMinSectorHitRate: 0.52,
  },
  agriculture: {
    philosophyWeight: 0.58,
    adaptiveWeight: 0.18,
    factorWeight: 0.24,
    priceFeedback: 0.9,
    capitalSentiment: 0.88,
    weather: 1.48,
    macroClimate: 1.38,
    directionBull: 0.18,
    directionBear: -0.18,
    strongBull: 0.28,
    strongBear: -0.28,
    strongMinSectorHitRate: 0.48,
  },
};

let cachedCalibration = null;

function getCalibrationPath() {
  const dataDir = getDataDir();
  const base = dataDir || path.join(process.cwd(), 'data');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, CALIBRATION_FILENAME);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeWeightTriple(pw, aw, fw) {
  let philosophyWeight = Number.isFinite(pw) ? pw : DEFAULT_WEIGHTS.philosophyWeight;
  let adaptiveWeight = Number.isFinite(aw) ? aw : DEFAULT_WEIGHTS.adaptiveWeight;
  let factorWeight = Number.isFinite(fw) ? fw : DEFAULT_WEIGHTS.factorWeight;
  philosophyWeight = clamp(philosophyWeight, 0.35, 0.75);
  adaptiveWeight = clamp(adaptiveWeight, 0.1, 0.4);
  factorWeight = clamp(factorWeight, 0.08, 0.35);
  const sum = philosophyWeight + adaptiveWeight + factorWeight;
  if (Math.abs(sum - 1) > 0.02) {
    return { ...DEFAULT_WEIGHTS };
  }
  return {
    philosophyWeight: +philosophyWeight.toFixed(3),
    adaptiveWeight: +adaptiveWeight.toFixed(3),
    factorWeight: +factorWeight.toFixed(3),
  };
}

function normalizeSectorWeightEntry(raw, sectorId) {
  const base = DEFAULT_SECTOR_WEIGHTS[sectorId] || DEFAULT_SECTOR_WEIGHTS.agriculture;
  const blend = normalizeWeightTriple(
    raw?.philosophyWeight ?? base.philosophyWeight,
    raw?.adaptiveWeight ?? base.adaptiveWeight,
    raw?.factorWeight ?? base.factorWeight
  );
  const out = { ...base, ...blend };
  for (const key of Object.keys(base)) {
    if (key.endsWith('Weight') && blend[key] != null) out[key] = blend[key];
    else if (raw?.[key] != null && Number.isFinite(Number(raw[key]))) out[key] = +Number(raw[key]).toFixed(4);
    else if (raw?.[key] != null) out[key] = raw[key];
  }
  if (raw?.hitRate != null) out.hitRate = raw.hitRate;
  if (raw?.hits != null) out.hits = raw.hits;
  if (raw?.total != null) out.total = raw.total;
  out.directionBull = Number.isFinite(raw?.directionBull)
    ? Math.max(base.directionBull, raw.directionBull)
    : base.directionBull;
  out.directionBear = -Math.abs(out.directionBull);
  return out;
}

function normalizeSectorWeights(raw = {}) {
  const out = {};
  for (const id of SECTOR_IDS) {
    out[id] = normalizeSectorWeightEntry(raw[id], id);
  }
  return out;
}

function loadCalibration(force = false) {
  if (cachedCalibration && !force) return cachedCalibration;
  const filePath = getCalibrationPath();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cachedCalibration = normalizeCalibration(parsed);
      return cachedCalibration;
    }
  } catch {
    // fall through
  }
  cachedCalibration = normalizeCalibration({});
  return cachedCalibration;
}

function normalizeCalibration(raw) {
  const weights = normalizeWeightTriple(raw.philosophyWeight, raw.adaptiveWeight, raw.factorWeight);
  const epochWeights = {};
  for (const era of eventCalendar.BACKTEST_ERAS) {
    const ew = raw.epochWeights?.[era.id];
    if (ew) {
      epochWeights[era.id] = {
        ...normalizeWeightTriple(ew.philosophyWeight, ew.adaptiveWeight, ew.factorWeight),
        hitRate: ew.hitRate ?? null,
      };
    }
  }
  return {
    ...weights,
    financeRegime: raw.financeRegime || 'neutral',
    financeRegimeSince: raw.financeRegimeSince || null,
    sectorWeights: normalizeSectorWeights(raw.sectorWeights),
    sectorHitRates: raw.sectorHitRates || {},
    instrumentHitRates: raw.instrumentHitRates || {},
    epochWeights,
    backtestSummary: raw.backtestSummary || null,
    longrunBacktestSummary: raw.longrunBacktestSummary || null,
    longRunHitRate: raw.longRunHitRate ?? raw.longrunBacktestSummary?.overallHitRate ?? null,
    tunedAt: raw.tunedAt || null,
    hitRateTarget: HIT_RATE_TARGET,
    version: raw.version || CALIBRATION_VERSION,
  };
}

function saveCalibration(partial = {}) {
  const prev = loadCalibration(true);
  const next = normalizeCalibration({ ...prev, ...partial, version: CALIBRATION_VERSION });
  fs.writeFileSync(getCalibrationPath(), JSON.stringify(next, null, 2), 'utf8');
  cachedCalibration = next;
  return next;
}

function getSectorWeights(sector) {
  const c = loadCalibration();
  const id = SECTOR_IDS.includes(sector) ? sector : 'agriculture';
  return { ...(DEFAULT_SECTOR_WEIGHTS[id] || DEFAULT_SECTOR_WEIGHTS.agriculture), ...(c.sectorWeights?.[id] || {}) };
}

function getSectorDirectionThresholds(sector, profileThresholds = null) {
  const sw = getSectorWeights(sector);
  const prof = profileThresholds || {};
  return {
    bull: sw.directionBull ?? prof.bull ?? 0.1,
    bear: sw.directionBear ?? prof.bear ?? -0.1,
    strongBull: sw.strongBull ?? prof.strongBull ?? 0.18,
    strongBear: sw.strongBear ?? prof.strongBear ?? -0.18,
  };
}

function mergeSectorIntoEventMultipliers(eventCtx, sector) {
  const sw = getSectorWeights(sector);
  const base = eventCtx?.weightMultipliers || {};
  const merged = { ...base };
  for (const key of ['macroFed', 'macroGeo', 'macroChina', 'oilSpillover', 'capitalSentiment', 'philosophy']) {
    if (sw[key] != null && sw[key] !== 1) {
      merged[key] = +((merged[key] ?? 1) * sw[key]).toFixed(4);
    }
  }
  return { ...(eventCtx || {}), weightMultipliers: merged };
}

function applyEventMultipliersToWeights(weights, eventCtx) {
  if (!eventCtx?.weightMultipliers) return { ...weights };
  const m = eventCtx.weightMultipliers;
  let pw = weights.philosophyWeight * (m.philosophy ?? 1);
  let aw = weights.adaptiveWeight * (m.capitalSentiment ?? 1);
  let fw =
    weights.factorWeight *
    (((m.macroFed ?? 1) + (m.macroGeo ?? 1) + (m.macroChina ?? 1) + (m.oilSpillover ?? 1)) / 4);
  const sum = pw + aw + fw;
  if (sum <= 0) return { ...weights };
  pw /= sum;
  aw /= sum;
  fw /= sum;
  return normalizeWeightTriple(pw, aw, fw);
}

/**
 * @param {string|null} date YYYY-MM-DD
 * @param {object|null} eventCtx
 * @param {string|null} sector UI sector id
 */
function getCompositeWeights(date = null, eventCtx = null, sector = null) {
  const c = loadCalibration();
  let base;
  if (sector && c.sectorWeights?.[sector]) {
    const sw = c.sectorWeights[sector];
    base = normalizeWeightTriple(sw.philosophyWeight, sw.adaptiveWeight, sw.factorWeight);
  } else {
    base = {
      philosophyWeight: c.philosophyWeight,
      adaptiveWeight: c.adaptiveWeight,
      factorWeight: c.factorWeight,
    };
  }
  if (date) {
    const eraId = eventCalendar.classifyEpoch(date);
    const ew = c.epochWeights?.[eraId];
    if (ew?.philosophyWeight != null) {
      base = normalizeWeightTriple(ew.philosophyWeight, ew.adaptiveWeight, ew.factorWeight);
    }
  } else if (eventCtx == null) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      eventCtx = eventCalendar.getActiveEventsMerged(today);
    } catch {
      // ignore
    }
  }
  if (sector) {
    eventCtx = mergeSectorIntoEventMultipliers(eventCtx, sector);
  }
  if (eventCtx) {
    base = applyEventMultipliersToWeights(base, eventCtx);
  }
  return {
    ...base,
    sector: sector || null,
    eventMultipliers: eventCtx?.weightMultipliers || null,
    epochId: date ? eventCalendar.classifyEpoch(date) : null,
  };
}

/** 板块分量加权合成 compositeScore */
function blendSectorComposite({ philosophyScore, adaptiveScore, factorComposite, sector, date, eventCtx }) {
  const sw = getSectorWeights(sector);
  const blend = getCompositeWeights(date, eventCtx, sector);
  const ps = (philosophyScore ?? 0) * (sw.priceFeedback != null ? (0.85 + sw.priceFeedback * 0.15) : 1);
  const as = (adaptiveScore ?? 0) * (sw.capitalSentiment ?? 1);
  const fc = factorComposite ?? 0;
  return clamp(ps * blend.philosophyWeight + as * blend.adaptiveWeight + fc * blend.factorWeight, -1, 1);
}

function scoreDirectionWithThreshold(compositeScore, th = 0.1) {
  if (compositeScore > th) return 'bullish';
  if (compositeScore < -th) return 'bearish';
  return 'neutral';
}

function scoreToDirectionTier(compositeScore, sector, profileThresholds = null, smoothedVol = null) {
  const th = getSectorDirectionThresholds(sector, profileThresholds);
  if (smoothedVol?.regime === 'high') {
    const widen = 1.1;
    th.bull *= widen;
    th.bear *= widen;
    th.strongBull *= widen;
    th.strongBear *= widen;
  }
  if (compositeScore >= th.strongBull) return { direction: 'strong_bullish', label: '强多', arrow: '↑↑' };
  if (compositeScore >= th.bull) return { direction: 'bullish', label: '偏多', arrow: '↑' };
  if (compositeScore <= th.strongBear) return { direction: 'strong_bearish', label: '强空', arrow: '↓↓' };
  if (compositeScore <= th.bear) return { direction: 'bearish', label: '偏空', arrow: '↓' };
  return { direction: 'neutral', label: '震荡', arrow: '→' };
}

function getFinanceRegimeState() {
  const c = loadCalibration();
  return { regime: c.financeRegime, since: c.financeRegimeSince };
}

function persistFinanceRegime(regime) {
  const prev = loadCalibration();
  if (prev.financeRegime === regime) return prev;
  return saveCalibration({
    financeRegime: regime,
    financeRegimeSince: new Date().toISOString().slice(0, 10),
  });
}

function getSectorHitRate(sector, windowDays = 60) {
  const c = loadCalibration();
  const entry = c.sectorHitRates?.[sector];
  if (!entry) return null;
  if (windowDays >= 365 && entry.hitRateLongrun != null) {
    return {
      rate: entry.hitRateLongrun,
      hits: entry.hitsLongrun ?? 0,
      total: entry.totalLongrun ?? 0,
      windowDays: 'longrun',
    };
  }
  const key = windowDays <= 30 ? 'hitRate30d' : 'hitRate60d';
  const rate = entry[key] ?? entry.hitRate ?? null;
  if (rate == null) return null;
  return {
    rate,
    hits: entry[`hits${windowDays}d`] ?? entry.hits ?? 0,
    total: entry[`total${windowDays}d`] ?? entry.total ?? 0,
    windowDays,
  };
}

function getAllSectorHitRatesLongrun() {
  const c = loadCalibration();
  const out = {};
  for (const id of SECTOR_IDS) {
    const entry = c.sectorHitRates?.[id];
    out[id] = {
      label: SECTOR_LABELS[id],
      hitRate: entry?.hitRateLongrun ?? null,
      hits: entry?.hitsLongrun ?? 0,
      total: entry?.totalLongrun ?? 0,
      gapToTarget: entry?.hitRateLongrun != null ? +(HIT_RATE_TARGET - entry.hitRateLongrun).toFixed(4) : null,
    };
  }
  return out;
}

function getInstrumentHitRate(instrumentId, windowDays = 30) {
  const c = loadCalibration();
  const entry = c.instrumentHitRates?.[instrumentId] ?? c.instrumentHitRates?.[String(instrumentId).toLowerCase()];
  if (!entry) return null;
  const key = windowDays <= 30 ? 'hitRate30d' : 'hitRate60d';
  return {
    rate: entry[key] ?? entry.hitRate ?? null,
    hits: entry.hits ?? 0,
    total: entry.total ?? 0,
    avgGapPct: entry.avgGapPct ?? null,
    windowDays,
  };
}

function getLongRunHitRate() {
  const c = loadCalibration();
  return c.longRunHitRate ?? c.longrunBacktestSummary?.overallHitRate ?? null;
}

function hitDirection(predicted, actual) {
  if (!predicted || !actual || predicted === 'neutral' || actual === 'neutral') return null;
  return predicted === actual;
}

function scoreDirection(compositeScore) {
  return scoreDirectionWithThreshold(compositeScore, 0.08);
}

/**
 * Phase 2 — 高级方向过滤（部分需外部数据时返回 dataNeeded）
 */
function applyAdvancedDirectionFilters({
  sector,
  compositeScore,
  directionTier,
  technical = {},
  eventCtx = {},
  phil = {},
  smoothedVol = null,
  barDate = null,
  eraId = null,
}) {
  const filters = [];
  const dataNeeded = [];
  let tier = { ...directionTier };
  let score = compositeScore;
  let labelOverride = null;

  const sw = getSectorWeights(sector);
  const primaryStrong = Math.abs(phil?.ranked?.primary?.[0]?.score ?? phil?.compositeScore ?? 0) >= 0.28;

  // Regime filter — 需月度板块命中率序列
  if (barDate && eraId) {
    const eraEntry = loadCalibration().longrunBacktestSummary?.byEra?.[eraId];
    if (eraEntry?.hitRate != null && eraEntry.hitRate < 0.4) {
      filters.push('regime-epoch-weak');
      dataNeeded.push({
        id: 'monthly-sector-hit-rates',
        reason: '需按月的板块命中率以精确 regime 过滤（当前仅用时代整体近似）',
      });
      if (tier.direction !== 'neutral' && !primaryStrong) {
        tier = { direction: 'neutral', label: '观望', arrow: '→' };
        labelOverride = '时代环境弱·观望';
        score = clamp(score * 0.4, -0.35, 0.35);
      }
    }
  }

  // Volatility filter
  if (smoothedVol?.regime === 'high' && !primaryStrong) {
    filters.push('vol-extreme-no-primary');
    if (tier.direction === 'strong_bullish' || tier.direction === 'strong_bearish') {
      tier = {
        direction: tier.direction.includes('bull') ? 'bullish' : 'bearish',
        label: tier.direction.includes('bull') ? '偏多' : '偏空',
        arrow: tier.direction.includes('bull') ? '↑' : '↓',
      };
    }
  }

  // Price momentum — 3-day MA alignment
  const ma = technical.maStack;
  if (ma && tier.direction !== 'neutral') {
    const bullAlign = ma.alignment === 'bull' || ma.alignment === 'bull_partial';
    const bearAlign = ma.alignment === 'bear' || ma.alignment === 'bear_partial';
    const wantsBull = tier.direction.includes('bull');
    const wantsBear = tier.direction.includes('bear');
    if ((wantsBull && !bullAlign && bearAlign) || (wantsBear && !bearAlign && bullAlign)) {
      filters.push('ma-misaligned');
      tier = { direction: 'neutral', label: '震荡', arrow: '→' };
      labelOverride = '均线未确认·震荡';
    } else if ((wantsBull && bullAlign) || (wantsBear && bearAlign)) {
      filters.push('ma-confirmed');
    }
  }

  // Event overlap boost
  const eventCount = eventCtx?.eventIds?.length ?? eventCtx?.events?.length ?? 0;
  if (eventCount >= 2 && primaryStrong) {
    filters.push('event-overlap-boost');
    score = clamp(score * 1.06, -1, 1);
    if (Math.abs(score) > Math.abs(compositeScore)) {
      tier = scoreToDirectionTier(score, sector, null, smoothedVol);
    }
  }

  return { directionTier: tier, compositeScore: score, directionLabelOverride: labelOverride, filters, dataNeeded };
}

/** 强多/强空 — v1.49 移除命中率门控，仅保留板块最低样本保护 */
function applyEnsembleStrongDirectionRule(directionTier, sector, compositeScore) {
  const sw = getSectorWeights(sector);
  const minHit = sw.strongMinSectorHitRate ?? 0.55;
  const sectorHit = getSectorHitRate(sector, 9999);
  const longrunRate = sectorHit?.rate;
  let tier = { ...directionTier };

  if (tier.direction === 'strong_bullish' || tier.direction === 'strong_bearish') {
    if (longrunRate == null || longrunRate < minHit) {
      tier = {
        direction: tier.direction === 'strong_bullish' ? 'bullish' : 'bearish',
        label: tier.direction === 'strong_bullish' ? '偏多' : '偏空',
        arrow: tier.direction === 'strong_bullish' ? '↑' : '↓',
        ensembleDowngraded: true,
        reason: longrunRate == null ? '无板块回测数据' : `板块命中${Math.round(longrunRate * 100)}%<${Math.round(minHit * 100)}%`,
      };
    }
  }
  return tier;
}

function gridSearchWeightsFromRows(rows, { minSamples = 25, sector = null, defaults = null } = {}) {
  if (!rows?.length) return { ...(defaults || DEFAULT_WEIGHTS), hitRate: null };

  const scoped = sector ? rows.filter((r) => r.sector === sector) : rows;
  if (scoped.length < minSamples) return { ...(defaults || DEFAULT_WEIGHTS), hitRate: null, hits: 0, total: 0 };

  const gridPw = [0.45, 0.5, 0.55, 0.6, 0.65];
  const gridAw = [0.15, 0.18, 0.22, 0.25, 0.28];
  const gridTh = [0.08, 0.1, 0.12, 0.15, 0.18];

  let best = {
    ...(defaults || DEFAULT_WEIGHTS),
    directionBull: defaults?.directionBull ?? 0.1,
    hitRate: 0,
    hits: 0,
    total: 0,
  };

  for (const pw of gridPw) {
    for (const aw of gridAw) {
      const fw = +(1 - pw - aw).toFixed(3);
      if (fw < 0.08 || fw > 0.35) continue;
      for (const th of gridTh) {
        let hits = 0;
        let total = 0;
        for (const row of scoped) {
          if (row.philosophyScore == null || row.adaptiveScore == null || row.factorComposite == null) continue;
          const composite = clamp(row.philosophyScore * pw + row.adaptiveScore * aw + row.factorComposite * fw, -1, 1);
          const predictedDir = scoreDirectionWithThreshold(composite, th);
          if (!predictedDir || predictedDir === 'neutral' || !row.actualDir || row.actualDir === 'neutral') {
            continue;
          }
          total += 1;
          if (hitDirection(predictedDir, row.actualDir)) hits += 1;
        }
        if (total < Math.max(15, minSamples / 2)) continue;
        const hitRate = hits / total;
        if (hitRate > best.hitRate + 0.0015) {
          best = {
            philosophyWeight: pw,
            adaptiveWeight: aw,
            factorWeight: fw,
            directionBull: th,
            directionBear: -th,
            hitRate,
            hits,
            total,
          };
        }
      }
    }
  }
  return best;
}

function gridSearchSectorWeights(allFlatRows) {
  const sectorWeights = {};
  for (const sector of SECTOR_IDS) {
    const defaults = DEFAULT_SECTOR_WEIGHTS[sector];
    const tuned = gridSearchWeightsFromRows(allFlatRows, { minSamples: 40, sector, defaults });
    sectorWeights[sector] = normalizeSectorWeightEntry(
      {
        ...defaults,
        philosophyWeight: tuned.philosophyWeight,
        adaptiveWeight: tuned.adaptiveWeight,
        factorWeight: tuned.factorWeight,
        directionBull: defaults.directionBull,
        directionBear: defaults.directionBear,
        hitRate: tuned.hitRate,
        hits: tuned.hits,
        total: tuned.total,
      },
      sector
    );
  }
  return sectorWeights;
}

function gridSearchEpochWeights(allFlatRows) {
  const epochWeights = {};
  for (const era of eventCalendar.BACKTEST_ERAS) {
    const eraRows = (allFlatRows || []).filter((r) => r.era === era.id);
    if (eraRows.length < 30) continue;
    const tuned = gridSearchWeightsFromRows(eraRows, { minSamples: 20 });
    if (tuned.total > 0) {
      epochWeights[era.id] = {
        philosophyWeight: tuned.philosophyWeight,
        adaptiveWeight: tuned.adaptiveWeight,
        factorWeight: tuned.factorWeight,
        hitRate: tuned.hitRate != null ? +tuned.hitRate.toFixed(4) : null,
        hits: tuned.hits,
        total: tuned.total,
        label: era.label,
      };
    }
  }
  return epochWeights;
}

function tuneWeightsFromBacktest(backtestSummary) {
  if (!backtestSummary?.instruments?.length) return loadCalibration();

  const flatRows = [];
  for (const inst of backtestSummary.instruments) {
    for (const day of inst.days || []) {
      flatRows.push({ ...day, sector: inst.sector });
    }
  }
  const best = gridSearchWeightsFromRows(flatRows, { minSamples: 15 });
  const sectorWeights = gridSearchSectorWeights(flatRows);

  const sectorHitRates = {};
  for (const [sector, stats] of Object.entries(backtestSummary.bySector || {})) {
    sectorHitRates[sector] = {
      hitRate30d: stats.hitRate30d,
      hitRate60d: stats.hitRate60d,
      hits30d: stats.hits30d,
      total30d: stats.total30d,
      hits60d: stats.hits60d,
      total60d: stats.total60d,
      maeMid30d: stats.maeMid30d,
    };
  }

  const instrumentHitRates = {};
  for (const inst of backtestSummary.instruments || []) {
    instrumentHitRates[inst.id] = {
      hitRate30d: inst.hitRate30d,
      hitRate60d: inst.hitRate60d,
      hits: inst.hits60d ?? inst.hits,
      total: inst.total60d ?? inst.total,
      avgGapPct: inst.avgGapPct,
    };
  }

  return saveCalibration({
    philosophyWeight: best.philosophyWeight,
    adaptiveWeight: best.adaptiveWeight,
    factorWeight: best.factorWeight,
    sectorWeights,
    sectorHitRates,
    instrumentHitRates,
    backtestSummary: {
      runAt: backtestSummary.runAt,
      days: backtestSummary.days,
      overallHitRate30d: backtestSummary.overallHitRate30d,
      overallHitRate60d: backtestSummary.overallHitRate60d,
      tunedHitRate: best.hitRate,
    },
    tunedAt: new Date().toISOString(),
  });
}

function tuneWeightsFromLongrunBacktest(longrunSummary, allFlatRows = null) {
  if (!longrunSummary?.instruments?.length) return loadCalibration();

  const epochWeights = gridSearchEpochWeights(allFlatRows || []);
  const globalBest = gridSearchWeightsFromRows(allFlatRows || [], { minSamples: 50 });
  const sectorWeights = gridSearchSectorWeights(allFlatRows || []);

  const sectorHitRates = { ...(loadCalibration().sectorHitRates || {}) };
  for (const [sector, stats] of Object.entries(longrunSummary.bySector || {})) {
    sectorHitRates[sector] = {
      ...(sectorHitRates[sector] || {}),
      hitRateLongrun: stats.hitRate,
      hitsLongrun: stats.hits,
      totalLongrun: stats.total,
    };
  }

  const instrumentHitRates = { ...(loadCalibration().instrumentHitRates || {}) };
  for (const inst of longrunSummary.instruments || []) {
    instrumentHitRates[inst.id] = {
      ...(instrumentHitRates[inst.id] || {}),
      hitRateLongrun: inst.hitRate,
      hitsLongrun: inst.hits,
      totalLongrun: inst.total,
      avgGapPctLongrun: inst.avgGapPct,
    };
  }

  const patch = {
    sectorWeights,
    sectorHitRates,
    instrumentHitRates,
    epochWeights,
    longRunHitRate: longrunSummary.overallHitRate,
    longrunBacktestSummary: {
      runAt: longrunSummary.runAt,
      periodFrom: longrunSummary.periodFrom,
      periodTo: longrunSummary.periodTo,
      overallHitRate: longrunSummary.overallHitRate,
      byEra: longrunSummary.byEra,
      bySector: longrunSummary.bySector,
      runtimeMs: longrunSummary.runtimeMs,
    },
    tunedAt: new Date().toISOString(),
  };
  if (globalBest.total >= 100) {
    patch.philosophyWeight = globalBest.philosophyWeight;
    patch.adaptiveWeight = globalBest.adaptiveWeight;
    patch.factorWeight = globalBest.factorWeight;
  }
  return saveCalibration(patch);
}

function resetSectorDirectionThresholds() {
  const cal = loadCalibration(true);
  const sectorWeights = { ...(cal.sectorWeights || {}) };
  for (const id of SECTOR_IDS) {
    const base = DEFAULT_SECTOR_WEIGHTS[id];
    sectorWeights[id] = normalizeSectorWeightEntry(
      { ...sectorWeights[id], directionBull: base.directionBull, directionBear: base.directionBear },
      id
    );
  }
  return saveCalibration({ sectorWeights, thresholdsResetAt: new Date().toISOString() });
}

module.exports = {
  CALIBRATION_VERSION,
  HIT_RATE_TARGET,
  SECTOR_IDS,
  SECTOR_LABELS,
  DEFAULT_WEIGHTS,
  DEFAULT_SECTOR_WEIGHTS,
  getCalibrationPath,
  loadCalibration,
  saveCalibration,
  getSectorWeights,
  getSectorDirectionThresholds,
  getCompositeWeights,
  blendSectorComposite,
  scoreDirectionWithThreshold,
  scoreToDirectionTier,
  applyAdvancedDirectionFilters,
  applyEnsembleStrongDirectionRule,
  applyEventMultipliersToWeights,
  mergeSectorIntoEventMultipliers,
  getFinanceRegimeState,
  persistFinanceRegime,
  getSectorHitRate,
  getAllSectorHitRatesLongrun,
  getInstrumentHitRate,
  getLongRunHitRate,
  gridSearchSectorWeights,
  gridSearchEpochWeights,
  tuneWeightsFromBacktest,
  tuneWeightsFromLongrunBacktest,
  resetSectorDirectionThresholds,
  hitDirection,
  scoreDirection,
};
