/**
 * Experiment #2 — SLV feature grid retrain for AG head (precious metals direction)
 * Does NOT overwrite production outlook-logistic-weights.json.
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-slv-ag-grid.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const {
  FEATURE_NAMES,
  AG_HEAD_FEATURE_NAMES,
  AU_HEAD_FEATURE_NAMES,
  rowToFeatureVector,
  rowToAgHeadFeatureVector,
  rowToAuHeadFeatureVector,
} = require('../services/outlook-logistic-features');
const {
  sigmoid,
  directionFromPUp,
  getDefaultWeightsPath,
  getModelsDir,
} = require('../services/outlook-onnx-runner');
const crossMarket = require('../services/cross-market-precious-inference');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { loadSlvRows } = require('../services/slv-etf-fetcher');

const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const AG_TRAIN_SAMPLE_WEIGHT = 1.35;
const SLV_FEATURE = 'slvHoldings_chg_5d';
const SLV_IDX = AG_HEAD_FEATURE_NAMES.indexOf(SLV_FEATURE);
const MIXED_FEATURE_NAMES = [...FEATURE_NAMES, SLV_FEATURE];
const PRODUCTION_BASELINE = { auAgPct: 64.16, auPct: 67.62, agPct: 61.16, scored: 226 };
const FRESH_BASELINE = { auAgPct: 61.15, auPct: 66.15, agPct: 57.23, scored: 296 };
const HIGH_CONF_INTL_PCT = 0.5;

const GRID = [
  { id: 'split-ag-slv-default', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.45 },
  { id: 'split-ag-no-slv', mode: 'split', includeSlv: false, agBasisWeight: 1.5, agPhilosophyScale: 0.45 },
  { id: 'split-ag-slv-basis2.0', mode: 'split', includeSlv: true, agBasisWeight: 2.0, agPhilosophyScale: 0.45 },
  { id: 'split-ag-slv-basis2.5', mode: 'split', includeSlv: true, agBasisWeight: 2.5, agPhilosophyScale: 0.45 },
  { id: 'split-ag-slv-phil0.35', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.35 },
  { id: 'split-ag-slv-phil0.55', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.55 },
  { id: 'split-ag-slv-lambda0.01', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.45, lambda: 0.01 },
  { id: 'split-ag-slv-lambda0.04', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.45, lambda: 0.04 },
  { id: 'hybrid-au-prod-ag-slv', mode: 'hybrid', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.45 },
  { id: 'mixed-v1348-plus-slv', mode: 'mixed', includeSlv: true, agBasisWeight: 1.5 },
];

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadTradingBars(instrumentId) {
  const klines = readCachedKlines(instrumentId);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const raw = JSON.parse(fs.readFileSync(path.join(historyDir, 'trading', `${instrumentId}.json`), 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function buildProbeIndices(bars, { from, to, step }) {
  const indices = [];
  for (let i = 60; i < bars.length - 3; i += step) {
    const d = normBarDate(bars[i]);
    if (d >= from && d <= to) indices.push(i);
  }
  return indices;
}

async function collectWalkForwardRows({ ids, from, to, step = 1 }) {
  const weights = calibration.getCompositeWeights();
  const allRows = [];
  const perInstrument = {};
  for (const id of ids) {
    const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
    const bars = loadTradingBars(id);
    const rows = [];
    let prev = 'neutral';
    for (const t of buildProbeIndices(bars, { from, to, step })) {
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      const enriched = { ...row, instrumentId: id };
      rows.push(enriched);
      allRows.push(enriched);
    }
    perInstrument[id] = rows;
  }
  return { allRows, perInstrument };
}

function dot(w, x) {
  let s = w[0];
  for (let i = 0; i < x.length; i += 1) s += w[i + 1] * x[i];
  return s;
}

function trainLogistic(samples, { epochs = 800, lr = 0.08, lambda = 0.02 } = {}) {
  const nFeatures = samples[0].x.length;
  const w = new Array(nFeatures + 1).fill(0);
  const totalWeight = samples.reduce((s, { weight = 1 }) => s + weight, 0) || samples.length;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Array(nFeatures + 1).fill(0);
    for (const { x, y, weight = 1 } of samples) {
      const p = sigmoid(dot(w, x));
      const err = (p - y) * weight;
      grad[0] += err;
      for (let i = 0; i < nFeatures; i += 1) grad[i + 1] += err * x[i];
    }
    for (let i = 0; i <= nFeatures; i += 1) {
      const reg = i > 0 ? lambda * w[i] : 0;
      w[i] -= lr * (grad[i] / totalWeight + reg);
    }
  }
  return w;
}

function buildAgTrainIndices(includeSlv) {
  const excluded = new Set(['cu_momentum_5d']);
  if (!includeSlv) excluded.add(SLV_FEATURE);
  const trainIndices = [];
  for (let i = 0; i < AG_HEAD_FEATURE_NAMES.length; i += 1) {
    if (!excluded.has(AG_HEAD_FEATURE_NAMES[i])) trainIndices.push(i);
  }
  return trainIndices;
}

function buildAuTrainIndices() {
  return AU_HEAD_FEATURE_NAMES.map((_, i) => i);
}

function sampleWeightForAgRow(row, agBasisWeight) {
  if (row.marketRegime === 'basis') return agBasisWeight;
  return AG_TRAIN_SAMPLE_WEIGHT;
}

function rowsToAgSamples(rows, trainIndices, { agBasisWeight, agPhilosophyScale }) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    const fullX = rowToAgHeadFeatureVector(row, agPhilosophyScale);
    const x = trainIndices.map((idx) => fullX[idx]);
    samples.push({ x, y, weight: sampleWeightForAgRow(row, agBasisWeight), row });
  }
  return samples;
}

function rowsToAuSamples(rows, trainIndices, { auPhilosophyScale = 1 } = {}) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    const fullX = rowToAuHeadFeatureVector(row, auPhilosophyScale);
    const x = trainIndices.map((idx) => fullX[idx]);
    samples.push({ x, y, weight: 1, row });
  }
  return samples;
}

function expandHeadWeights(wTrain, trainIndices, featureNames) {
  const w = new Array(featureNames.length + 1).fill(0);
  w[0] = wTrain[0];
  for (let j = 0; j < trainIndices.length; j += 1) {
    w[trainIndices[j] + 1] = wTrain[j + 1];
  }
  return w;
}

function weightsArrayToObject(w, featureNames) {
  const out = { bias: +w[0].toFixed(6) };
  for (let i = 0; i < featureNames.length; i += 1) {
    out[featureNames[i]] = +w[i + 1].toFixed(6);
  }
  return out;
}

function predictFromHeadWeights(weightsObj, featureNames, vectorFn, row) {
  const x = vectorFn(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < featureNames.length; i += 1) {
    z += Number(weightsObj[featureNames[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function predictProductionV1348(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < FEATURE_NAMES.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function overnightIntlPct(row) {
  const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
  const prev = infer?.components?.intlLevelPrev;
  const now = infer?.components?.intlLevelNow;
  if (!prev || !now) return null;
  return Math.abs(((now - prev) / prev) * 100);
}

function isTradableDay(row) {
  const intlPct = overnightIntlPct(row);
  const highIntl = intlPct != null && intlPct >= HIGH_CONF_INTL_PCT;
  const notRange = row.marketRegime && row.marketRegime !== 'range';
  return highIntl || notRange;
}

function evaluateRows(rows, predictFn) {
  const buckets = {
    all: mk(),
    au: mk(),
    ag: mk(),
    agBasis: mk(),
    tradableAuAg: mk(),
    tradableAgBasis: mk(),
  };
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const hit = hitDirection(pred, row.actualDirT3);
    const id = String(row.instrumentId || '').toLowerCase();
    scoreBucket(buckets.all, hit);
    if (id === 'au') scoreBucket(buckets.au, hit);
    if (id === 'ag') {
      scoreBucket(buckets.ag, hit);
      if (row.marketRegime === 'basis') scoreBucket(buckets.agBasis, hit);
    }
    if (isTradableDay(row)) {
      scoreBucket(buckets.tradableAuAg, hit);
      if (id === 'ag' && row.marketRegime === 'basis') scoreBucket(buckets.tradableAgBasis, hit);
    }
  }
  return finalizeBuckets(buckets);
}

function mk() {
  return { hits: 0, scored: 0 };
}

function scoreBucket(b, hit) {
  b.scored += 1;
  if (hit) b.hits += 1;
}

function finalizeBuckets(buckets) {
  const out = {};
  for (const [k, b] of Object.entries(buckets)) {
    out[k] = {
      hits: b.hits,
      scored: b.scored,
      hitRatePct: b.scored ? +((b.hits / b.scored) * 100).toFixed(2) : null,
    };
  }
  out.auAg = {
    hits: buckets.au.hits + buckets.ag.hits,
    scored: buckets.au.scored + buckets.ag.scored,
    hitRatePct:
      buckets.au.scored + buckets.ag.scored
        ? +(((buckets.au.hits + buckets.ag.hits) / (buckets.au.scored + buckets.ag.scored)) * 100).toFixed(2)
        : null,
  };
  return out;
}

function trainSplitHeads(trainRows, variant) {
  const auTrainIndices = buildAuTrainIndices();
  const agTrainIndices = buildAgTrainIndices(variant.includeSlv);
  const auTrain = trainRows.filter((r) => r.instrumentId === 'au');
  const agTrain = trainRows.filter((r) => r.instrumentId === 'ag');
  const auSamples = rowsToAuSamples(auTrain, auTrainIndices);
  const agSamples = rowsToAgSamples(agTrain, agTrainIndices, variant);
  const wAu = trainLogistic(auSamples, variant);
  const wAg = trainLogistic(agSamples, variant);
  const auWeights = weightsArrayToObject(expandHeadWeights(wAu, auTrainIndices, AU_HEAD_FEATURE_NAMES), AU_HEAD_FEATURE_NAMES);
  const agWeights = weightsArrayToObject(expandHeadWeights(wAg, agTrainIndices, AG_HEAD_FEATURE_NAMES), AG_HEAD_FEATURE_NAMES);
  const predictFn = (row) => {
    const id = String(row.instrumentId || '').toLowerCase();
    if (id === 'ag') {
      return predictFromHeadWeights(
        agWeights,
        AG_HEAD_FEATURE_NAMES,
        (r) => rowToAgHeadFeatureVector(r, variant.agPhilosophyScale),
        row
      );
    }
    return predictFromHeadWeights(auWeights, AU_HEAD_FEATURE_NAMES, (r) => rowToAuHeadFeatureVector(r, 1), row);
  };
  return { auWeights, agWeights, predictFn, auSamples: auSamples.length, agSamples: agSamples.length };
}

function trainHybridAgSplit(trainRows, prodWeights, variant) {
  const agTrainIndices = buildAgTrainIndices(variant.includeSlv);
  const agTrain = trainRows.filter((r) => r.instrumentId === 'ag');
  const agSamples = rowsToAgSamples(agTrain, agTrainIndices, variant);
  const wAg = trainLogistic(agSamples, variant);
  const agWeights = weightsArrayToObject(expandHeadWeights(wAg, agTrainIndices, AG_HEAD_FEATURE_NAMES), AG_HEAD_FEATURE_NAMES);
  const predictFn = (row) => {
    const id = String(row.instrumentId || '').toLowerCase();
    if (id === 'ag') {
      return predictFromHeadWeights(
        agWeights,
        AG_HEAD_FEATURE_NAMES,
        (r) => rowToAgHeadFeatureVector(r, variant.agPhilosophyScale),
        row
      );
    }
    return predictProductionV1348(prodWeights, row);
  };
  return { auWeights: prodWeights, agWeights, predictFn, agSamples: agSamples.length, auSamples: 0 };
}

function rowToMixedWithSlv(row = {}) {
  const base = rowToFeatureVector(row);
  const isAg = String(row.instrumentId || '').toLowerCase() === 'ag';
  return [...base, isAg ? Number(row.slvHoldings_chg_5d ?? 0) : 0];
}

function trainMixedV1348(trainRows, variant) {
  const excluded = new Set(['cu_momentum_5d', 'gldHoldings_chg_5d']);
  if (!variant.includeSlv) excluded.add(SLV_FEATURE);
  const trainIndices = [];
  for (let i = 0; i < MIXED_FEATURE_NAMES.length; i += 1) {
    if (!excluded.has(MIXED_FEATURE_NAMES[i])) trainIndices.push(i);
  }
  const samples = [];
  for (const row of trainRows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    const fullX = rowToMixedWithSlv(row);
    const x = trainIndices.map((idx) => fullX[idx]);
    const weight = row.instrumentId === 'ag' ? sampleWeightForAgRow(row, variant.agBasisWeight) : 1;
    samples.push({ x, y, weight, row });
  }
  const wTrain = trainLogistic(samples, variant);
  const w = expandHeadWeights(wTrain, trainIndices, MIXED_FEATURE_NAMES);
  const weightsObj = weightsArrayToObject(w, MIXED_FEATURE_NAMES);
  const predictFn = (row) => {
    const x = rowToMixedWithSlv(row);
    let z = Number(weightsObj.bias ?? 0);
    for (let i = 0; i < MIXED_FEATURE_NAMES.length; i += 1) {
      z += Number(weightsObj[MIXED_FEATURE_NAMES[i]] ?? 0) * x[i];
    }
    return directionFromPUp(sigmoid(z));
  };
  return { weightsObj, predictFn, trainSamples: samples.length };
}

function checkGate(metrics) {
  const auAg = metrics.auAg?.hitRatePct;
  const agBasis = metrics.agBasis?.hitRatePct;
  const agBasisN = metrics.agBasis?.scored ?? 0;
  const au = metrics.au?.hitRatePct;
  const scored = metrics.auAg?.scored ?? 0;
  const beatProd = auAg != null && auAg > PRODUCTION_BASELINE.auAgPct;
  const beatFresh = auAg != null && auAg > FRESH_BASELINE.auAgPct;
  const comparableN = scored >= FRESH_BASELINE.scored * 0.9;
  const agBasisGate = agBasisN >= 40 && agBasis != null && agBasis > 53.04;
  const auOk = au == null || au >= FRESH_BASELINE.auPct - 3;
  const passed = (beatProd || (beatFresh && comparableN)) && agBasisGate && auOk;
  return {
    passed,
    beatProd,
    beatFresh,
    comparableN,
    agBasisGate,
    agBasisN,
    auOk,
    gapVs70: auAg != null ? +(70 - auAg).toFixed(2) : null,
    gapVsProd: auAg != null ? +(auAg - PRODUCTION_BASELINE.auAgPct).toFixed(2) : null,
    gapVsFresh: auAg != null ? +(auAg - FRESH_BASELINE.auAgPct).toFixed(2) : null,
  };
}

function buildExperimentPayload(variant, trainResult, metrics, gate) {
  const base = {
    version: `slv-experiment-${variant.id}`,
    experiment: 'Experiment #2 SLV feature grid',
    trainedAt: new Date().toISOString(),
    variant,
    cv: { train: `${TRAIN_FROM}..${TRAIN_TO}`, test: `${TEST_FROM}..${TEST_TO}` },
    gate,
    metrics,
    baselines: { productionV1348: PRODUCTION_BASELINE, freshE20260615: FRESH_BASELINE },
  };
  if (variant.mode === 'mixed') {
    return {
      ...base,
      architecture: 'mixed-v1348-plus-slv',
      featureNames: MIXED_FEATURE_NAMES,
      weights: trainResult.weightsObj,
      training: { trainSamples: trainResult.trainSamples },
    };
  }
  return {
    ...base,
    architecture: variant.mode === 'hybrid' ? 'hybrid-au-prod-ag-split' : 'split-heads',
    heads: {
      au: trainResult.auWeights,
      ag: trainResult.agWeights,
    },
    headFeatureNames: { au: AU_HEAD_FEATURE_NAMES, ag: AG_HEAD_FEATURE_NAMES },
    training: {
      auSamples: trainResult.auSamples,
      agSamples: trainResult.agSamples,
      agBasisSampleWeight: variant.agBasisWeight,
      agPhilosophyScale: variant.agPhilosophyScale,
      includeSlv: variant.includeSlv,
    },
  };
}

async function main() {
  const t0 = Date.now();
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const slvRows = loadSlvRows();
  const prodPayload = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8'));
  const prodWeights = prodPayload.weights;

  console.log('[slv-grid] collecting walk-forward rows…');
  const { allRows, perInstrument } = await collectWalkForwardRows({
    ids: ['au', 'ag'],
    from: TRAIN_FROM,
    to: TEST_TO,
    step: 1,
  });
  const trainRows = allRows.filter((r) => r.date >= TRAIN_FROM && r.date <= TRAIN_TO);
  const testRows = allRows.filter((r) => r.date >= TEST_FROM && r.date <= TEST_TO);

  const baselineMetrics = evaluateRows(testRows, (row) => predictProductionV1348(prodWeights, row));
  const baselineGate = checkGate(baselineMetrics);

  const results = [
    {
      id: 'prod-v1348-baseline',
      mode: 'eval-only',
      metrics: baselineMetrics,
      gate: baselineGate,
      slvWeight: null,
    },
  ];

  console.log(`[slv-grid] SLV rows=${slvRows?.length || 0} · train=${trainRows.length} · test=${testRows.length}`);
  console.log(`[slv-grid] baseline au+ag=${baselineMetrics.auAg.hitRatePct}% (${baselineMetrics.auAg.scored}) AG basis=${baselineMetrics.agBasis.hitRatePct}% (${baselineMetrics.agBasis.scored})`);

  for (const variant of GRID) {
    console.log(`[slv-grid] training ${variant.id}…`);
    let trainResult;
    if (variant.mode === 'mixed') {
      trainResult = trainMixedV1348(trainRows, variant);
    } else if (variant.mode === 'hybrid') {
      trainResult = trainHybridAgSplit(trainRows, prodWeights, variant);
    } else {
      trainResult = trainSplitHeads(trainRows, variant);
    }
    const metrics = evaluateRows(testRows, trainResult.predictFn);
    const gate = checkGate(metrics);
    const slvWeight =
      variant.mode === 'mixed'
        ? trainResult.weightsObj?.[SLV_FEATURE]
        : trainResult.agWeights?.[SLV_FEATURE];
    results.push({
      id: variant.id,
      mode: variant.mode,
      variant,
      metrics,
      gate,
      slvWeight: slvWeight != null ? +Number(slvWeight).toFixed(6) : null,
      trainSamples: trainResult.trainSamples || trainResult.agSamples,
    });
    console.log(
      `  → au+ag=${metrics.auAg.hitRatePct}% (${metrics.auAg.scored}) AG=${metrics.ag.hitRatePct}% AG basis=${metrics.agBasis.hitRatePct}% (${metrics.agBasis.scored}) gate=${gate.passed ? 'PASS' : 'FAIL'}`
    );
  }

  results.sort((a, b) => {
    const aRate = a.metrics?.auAg?.hitRatePct ?? -1;
    const bRate = b.metrics?.auAg?.hitRatePct ?? -1;
    if (bRate !== aRate) return bRate - aRate;
    return (b.metrics?.agBasis?.hitRatePct ?? -1) - (a.metrics?.agBasis?.hitRatePct ?? -1);
  });

  const bestExperimental = results.find((r) => r.id !== 'prod-v1348-baseline' && r.gate?.passed);
  const bestOverall = results.find((r) => r.id !== 'prod-v1348-baseline');

  let experimentWeightsPath = null;
  if (bestExperimental) {
    const variant = GRID.find((g) => g.id === bestExperimental.id);
    let trainResult;
    if (variant.mode === 'mixed') trainResult = trainMixedV1348(trainRows, variant);
    else if (variant.mode === 'hybrid') trainResult = trainHybridAgSplit(trainRows, prodWeights, variant);
    else trainResult = trainSplitHeads(trainRows, variant);
    const payload = buildExperimentPayload(variant, trainResult, bestExperimental.metrics, bestExperimental.gate);
    experimentWeightsPath = path.join(getModelsDir(), 'outlook-logistic-weights-slv-experiment.json');
    fs.writeFileSync(experimentWeightsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  const summary = {
    experiment: 'Experiment #2 SLV feature grid retrain AG',
    generatedAt: new Date().toISOString(),
    elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
    slvRowCount: slvRows?.length || 0,
    window: { train: `${TRAIN_FROM}..${TRAIN_TO}`, oos: `${TEST_FROM}..${TEST_TO}` },
    productionLocked: 'v1.34.8-ag-cu-spread+basis-term',
    baselines: { productionV1348: PRODUCTION_BASELINE, freshE20260615: FRESH_BASELINE },
    prodBaselineOnFreshData: { metrics: baselineMetrics, gate: baselineGate },
    gridVariants: results.map((r) => ({
      id: r.id,
      mode: r.mode,
      auAgT3: r.metrics?.auAg?.hitRatePct,
      auAgScored: r.metrics?.auAg?.scored,
      auT3: r.metrics?.au?.hitRatePct,
      agT3: r.metrics?.ag?.hitRatePct,
      agBasisT3: r.metrics?.agBasis?.hitRatePct,
      agBasisScored: r.metrics?.agBasis?.scored,
      tradableAuAgT3: r.metrics?.tradableAuAg?.hitRatePct,
      tradableAuAgScored: r.metrics?.tradableAuAg?.scored,
      slvWeight: r.slvWeight,
      gate: r.gate,
    })),
    bestExperimental: bestExperimental
      ? { id: bestExperimental.id, metrics: bestExperimental.metrics, gate: bestExperimental.gate }
      : null,
    bestOverallNonProd: bestOverall
      ? { id: bestOverall.id, metrics: bestOverall.metrics, gate: bestOverall.gate }
      : null,
    gateRecommendation: bestExperimental
      ? 'PASS — experimental weights saved; user decision needed before production deploy'
      : `FAIL — best variant ${bestOverall?.id} au+ag=${bestOverall?.metrics?.auAg?.hitRatePct}% vs prod ${PRODUCTION_BASELINE.auAgPct}% / fresh ${FRESH_BASELINE.auAgPct}%`,
    experimentWeightsPath,
    reproduce: 'FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-slv-ag-grid.js',
  };

  const outPath = path.join(__dirname, '..', '_train-slv-ag-grid-out.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
