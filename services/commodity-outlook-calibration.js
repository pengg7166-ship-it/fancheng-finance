/**
 * 大宗走势研判权重校准 — 回测调参 + 金融环境滞后态持久化 + 时代权重
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const eventCalendar = require('./commodity-outlook-event-calendar');

const CALIBRATION_FILENAME = 'outlook-calibration.json';

const DEFAULT_WEIGHTS = {
  philosophyWeight: 0.58,
  adaptiveWeight: 0.22,
  factorWeight: 0.2,
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

function loadCalibration(force = false) {
  if (cachedCalibration && !force) return cachedCalibration;
  const filePath = getCalibrationPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cachedCalibration = normalizeCalibration(raw);
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
    if (ew) epochWeights[era.id] = { ...normalizeWeightTriple(ew.philosophyWeight, ew.adaptiveWeight, ew.factorWeight), hitRate: ew.hitRate ?? null };
  }
  return {
    ...weights,
    financeRegime: raw.financeRegime || 'neutral',
    financeRegimeSince: raw.financeRegimeSince || null,
    sectorHitRates: raw.sectorHitRates || {},
    instrumentHitRates: raw.instrumentHitRates || {},
    epochWeights,
    backtestSummary: raw.backtestSummary || null,
    longrunBacktestSummary: raw.longrunBacktestSummary || null,
    longRunHitRate: raw.longRunHitRate ?? raw.longrunBacktestSummary?.overallHitRate ?? null,
    tunedAt: raw.tunedAt || null,
    version: raw.version || 'v1.26.0',
  };
}

function saveCalibration(partial = {}) {
  const prev = loadCalibration(true);
  const next = normalizeCalibration({ ...prev, ...partial, version: 'v1.26.0' });
  fs.writeFileSync(getCalibrationPath(), JSON.stringify(next, null, 2), 'utf8');
  cachedCalibration = next;
  return next;
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
 * @param {string|null} date YYYY-MM-DD — 回测日或 null=今日 live
 * @param {object|null} eventCtx getActiveEventsMerged 结果
 */
function getCompositeWeights(date = null, eventCtx = null) {
  const c = loadCalibration();
  let base = {
    philosophyWeight: c.philosophyWeight,
    adaptiveWeight: c.adaptiveWeight,
    factorWeight: c.factorWeight,
  };
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
  if (eventCtx) {
    base = applyEventMultipliersToWeights(base, eventCtx);
  }
  return { ...base, eventMultipliers: eventCtx?.weightMultipliers || null, epochId: date ? eventCalendar.classifyEpoch(date) : null };
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
  if (compositeScore > 0.08) return 'bullish';
  if (compositeScore < -0.08) return 'bearish';
  return 'neutral';
}

/**
 * 用预存分量分数网格搜索 philosophyWeight
 */
function gridSearchWeightsFromRows(rows, { minSamples = 25 } = {}) {
  if (!rows?.length) return { ...DEFAULT_WEIGHTS, hitRate: null };

  const grid = [];
  for (let pw = 0.45; pw <= 0.651; pw += 0.05) {
    grid.push(+pw.toFixed(2));
  }

  let best = { ...DEFAULT_WEIGHTS, hitRate: 0, hits: 0, total: 0 };
  for (const pw of grid) {
    const aw = 0.22;
    const fw = +(1 - pw - aw).toFixed(3);
    if (fw < 0.08) continue;

    let hits = 0;
    let total = 0;
    for (const row of rows) {
      if (row.philosophyScore == null || row.adaptiveScore == null || row.factorComposite == null) continue;
      const composite = clamp(
        row.philosophyScore * pw + row.adaptiveScore * aw + row.factorComposite * fw,
        -1,
        1
      );
      const predictedDir = scoreDirection(composite);
      if (!predictedDir || predictedDir === 'neutral' || !row.actualDir) continue;
      total += 1;
      if (hitDirection(predictedDir, row.actualDir)) hits += 1;
    }
    if (total < minSamples) continue;
    const hitRate = hits / total;
    if (hitRate > best.hitRate + 0.001 || (Math.abs(hitRate - best.hitRate) < 0.001 && pw > best.philosophyWeight)) {
      best = { philosophyWeight: pw, adaptiveWeight: aw, factorWeight: fw, hitRate, hits, total };
    }
  }
  return best;
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
      flatRows.push(day);
    }
  }
  const best = gridSearchWeightsFromRows(flatRows, { minSamples: 15 });

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

module.exports = {
  DEFAULT_WEIGHTS,
  getCalibrationPath,
  loadCalibration,
  saveCalibration,
  getCompositeWeights,
  applyEventMultipliersToWeights,
  getFinanceRegimeState,
  persistFinanceRegime,
  getSectorHitRate,
  getInstrumentHitRate,
  getLongRunHitRate,
  gridSearchEpochWeights,
  tuneWeightsFromBacktest,
  tuneWeightsFromLongrunBacktest,
};
