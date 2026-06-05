/**
 * 大宗走势研判权重校准 — 回测调参 + 金融环境滞后态持久化
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

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
  const pw = Number(raw.philosophyWeight);
  const aw = Number(raw.adaptiveWeight);
  const fw = Number(raw.factorWeight);
  const philosophyWeight = Number.isFinite(pw) && pw >= 0.35 && pw <= 0.75 ? pw : DEFAULT_WEIGHTS.philosophyWeight;
  let adaptiveWeight = Number.isFinite(aw) && aw >= 0.1 && aw <= 0.4 ? aw : DEFAULT_WEIGHTS.adaptiveWeight;
  let factorWeight = Number.isFinite(fw) && fw >= 0.08 && fw <= 0.35 ? fw : DEFAULT_WEIGHTS.factorWeight;
  const sum = philosophyWeight + adaptiveWeight + factorWeight;
  if (Math.abs(sum - 1) > 0.02) {
    adaptiveWeight = DEFAULT_WEIGHTS.adaptiveWeight;
    factorWeight = DEFAULT_WEIGHTS.factorWeight;
  }
  return {
    philosophyWeight,
    adaptiveWeight,
    factorWeight,
    financeRegime: raw.financeRegime || 'neutral',
    financeRegimeSince: raw.financeRegimeSince || null,
    sectorHitRates: raw.sectorHitRates || {},
    instrumentHitRates: raw.instrumentHitRates || {},
    backtestSummary: raw.backtestSummary || null,
    tunedAt: raw.tunedAt || null,
    version: raw.version || 'v1.25.0',
  };
}

function saveCalibration(partial = {}) {
  const prev = loadCalibration(true);
  const next = normalizeCalibration({ ...prev, ...partial, version: 'v1.25.0' });
  fs.writeFileSync(getCalibrationPath(), JSON.stringify(next, null, 2), 'utf8');
  cachedCalibration = next;
  return next;
}

function getCompositeWeights() {
  const c = loadCalibration();
  return {
    philosophyWeight: c.philosophyWeight,
    adaptiveWeight: c.adaptiveWeight,
    factorWeight: c.factorWeight,
  };
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

/**
 * 网格搜索 philosophyWeight 0.45–0.65，最小化方向偏差
 */
function tuneWeightsFromBacktest(backtestSummary) {
  if (!backtestSummary?.instruments?.length) return loadCalibration();

  const grid = [];
  for (let pw = 0.45; pw <= 0.651; pw += 0.05) {
    grid.push(+pw.toFixed(2));
  }

  let best = { philosophyWeight: DEFAULT_WEIGHTS.philosophyWeight, bias: Infinity, hitRate: 0 };
  for (const pw of grid) {
    const aw = 0.22;
    const fw = +(1 - pw - aw).toFixed(3);
    if (fw < 0.08) continue;

    let bullishPred = 0;
    let bearishPred = 0;
    let bullishActual = 0;
    let bearishActual = 0;
    let hits = 0;
    let total = 0;

    for (const inst of backtestSummary.instruments) {
      for (const day of inst.days || []) {
        if (day.predictedDir == null || day.actualDir == null) continue;
        if (day.predictedDir === 'neutral') continue;
        total += 1;
        if (day.predictedDir === 'bullish') bullishPred += 1;
        if (day.predictedDir === 'bearish') bearishPred += 1;
        if (day.actualDir === 'bullish') bullishActual += 1;
        if (day.actualDir === 'bearish') bearishActual += 1;
        if (day.hitDirection) hits += 1;
      }
    }

    const hitRate = total > 0 ? hits / total : 0;
    const predBullRate = total > 0 ? bullishPred / total : 0.5;
    const actBullRate = total > 0 ? bullishActual / total : 0.5;
    const bias = Math.abs(predBullRate - actBullRate);

    if (bias < best.bias - 0.001 || (Math.abs(bias - best.bias) < 0.001 && hitRate > best.hitRate)) {
      best = { philosophyWeight: pw, adaptiveWeight: aw, factorWeight: fw, bias, hitRate };
    }
  }

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
      tunedBias: best.bias,
      tunedHitRate: best.hitRate,
    },
    tunedAt: new Date().toISOString(),
  });
}

module.exports = {
  DEFAULT_WEIGHTS,
  getCalibrationPath,
  loadCalibration,
  saveCalibration,
  getCompositeWeights,
  getFinanceRegimeState,
  persistFinanceRegime,
  getSectorHitRate,
  getInstrumentHitRate,
  tuneWeightsFromBacktest,
};
