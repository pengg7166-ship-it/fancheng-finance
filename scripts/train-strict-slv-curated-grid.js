/**
 * Combined Experiment — strict OI-proxy + SLV joint retrain + curated news
 * Does NOT overwrite production outlook-logistic-weights.json.
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-strict-slv-curated-grid.js
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
const curation = require('../services/news-tagged-curation');
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
const HIGH_CONF_INTL_PCT = 0.5;

const PRODUCTION_BASELINE = { auAgPct: 64.16, auPct: 67.62, agPct: 61.16, scored: 226 };
const FRESH_BASELINE = { auAgPct: 61.15, auPct: 66.15, agPct: 57.23, scored: 296 };
const STRICT_ONLY_BASELINE = { auAgPct: 64.65, auPct: null, agPct: null, agBasisPct: 61.54, auAgScored: 215, agBasisScored: 26 };

const GRID = [
  { id: 'strict-slv-mixed', mode: 'mixed', includeSlv: true, agBasisWeight: 1.5, curatedNews: false },
  { id: 'strict-slv-split', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.45, curatedNews: false },
  { id: 'strict-slv-split-basis2', mode: 'split', includeSlv: true, agBasisWeight: 2.0, agPhilosophyScale: 0.45, curatedNews: false },
  { id: 'strict-slv-mixed-curated', mode: 'mixed', includeSlv: true, agBasisWeight: 1.5, curatedNews: true },
  { id: 'strict-slv-split-curated', mode: 'split', includeSlv: true, agBasisWeight: 1.5, agPhilosophyScale: 0.45, curatedNews: true },
  { id: 'strict-slv-split-basis2-curated', mode: 'split', includeSlv: true, agBasisWeight: 2.0, agPhilosophyScale: 0.45, curatedNews: true },
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

async function collectWalkForwardRows({ ids, from, to, step = 1, useCuratedNews = false }) {
  if (useCuratedNews) process.env.NEWS_TAGGED_USE_CURATED = '1';
  else delete process.env.NEWS_TAGGED_USE_CURATED;
  newsTagged.loadNewsTagged({ force: true });

  process.env.AG_BASIS_STRICT_OI_PROXY = '1';
  delete process.env.AG_BASIS_DISABLE_OI_PROXY;

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
    tradableAu: mk(),
    tradableAg: mk(),
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
      if (id === 'au') scoreBucket(buckets.tradableAu, hit);
      if (id === 'ag') {
        scoreBucket(buckets.tradableAg, hit);
        if (row.marketRegime === 'basis') scoreBucket(buckets.tradableAgBasis, hit);
      }
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

function checkGate(metrics, { useTradablePrimary = true } = {}) {
  const primary = useTradablePrimary ? metrics.tradableAuAg : metrics.auAg;
  const auAg = primary?.hitRatePct;
  const fullAuAg = metrics.auAg?.hitRatePct;
  const agBasis = metrics.agBasis?.hitRatePct;
  const tradableAgBasis = metrics.tradableAgBasis?.hitRatePct;
  const agBasisN = metrics.agBasis?.scored ?? 0;
  const au = metrics.au?.hitRatePct;
  const scored = primary?.scored ?? 0;

  const beatProd = auAg != null && auAg > PRODUCTION_BASELINE.auAgPct;
  const beatFresh = auAg != null && auAg > FRESH_BASELINE.auAgPct;
  const beatStrictOnly = auAg != null && auAg > STRICT_ONLY_BASELINE.auAgPct;
  const comparableN = scored >= FRESH_BASELINE.scored * 0.85;
  const agBasisGate = agBasisN >= 40 && agBasis != null && agBasis > 53.04;
  const auOk = au == null || au >= FRESH_BASELINE.auPct - 3;

  const passed = (beatProd || (beatFresh && comparableN) || beatStrictOnly) && agBasisGate && auOk;

  return {
    passed,
    beatProd,
    beatFresh,
    beatStrictOnly,
    comparableN,
    agBasisGate,
    agBasisN,
    tradableAgBasisPct: tradableAgBasis?.hitRatePct,
    tradableAgBasisN: metrics.tradableAgBasis?.scored,
    fullAuAgPct: fullAuAg,
    auOk,
    gapVs70: auAg != null ? +(70 - auAg).toFixed(2) : null,
    gapVsProd: auAg != null ? +(auAg - PRODUCTION_BASELINE.auAgPct).toFixed(2) : null,
    gapVsFresh: auAg != null ? +(auAg - FRESH_BASELINE.auAgPct).toFixed(2) : null,
    gapVsStrictOnly: auAg != null ? +(auAg - STRICT_ONLY_BASELINE.auAgPct).toFixed(2) : null,
  };
}

function buildExperimentPayload(variant, trainResult, metrics, gate) {
  const base = {
    version: `strict-slv-curated-${variant.id}`,
    experiment: 'Combined strict OI-proxy + SLV + curated news',
    trainedAt: new Date().toISOString(),
    env: { AG_BASIS_STRICT_OI_PROXY: true, curatedNews: !!variant.curatedNews },
    variant,
    cv: { train: `${TRAIN_FROM}..${TRAIN_TO}`, test: `${TEST_FROM}..${TEST_TO}` },
    gate,
    metrics,
    baselines: {
      productionV1348: PRODUCTION_BASELINE,
      freshE20260615: FRESH_BASELINE,
      strictOnlyEval: STRICT_ONLY_BASELINE,
    },
  };
  if (variant.mode === 'mixed') {
    return {
      ...base,
      architecture: 'mixed-v1348-plus-slv-strict-oi',
      featureNames: MIXED_FEATURE_NAMES,
      weights: trainResult.weightsObj,
      training: { trainSamples: trainResult.trainSamples },
    };
  }
  return {
    ...base,
    architecture: 'split-heads-strict-oi',
    heads: { au: trainResult.auWeights, ag: trainResult.agWeights },
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

  const curatedPath = curation.getCuratedNewsTaggedPath();
  if (!fs.existsSync(curatedPath)) {
    const buildScript = path.join(__dirname, 'build-news-tagged-curated.js');
    require('child_process').execFileSync(process.execPath, [buildScript], {
      env: process.env,
      stdio: 'inherit',
    });
  }

  delete process.env.NEWS_TAGGED_USE_CURATED;
  newsTagged.loadNewsTagged({ force: true });
  const { rows: fullNews } = newsTagged.loadNewsTagged({ force: true });
  const curatedBuild = curation.buildCuratedRows(fullNews);
  const newsCuratedStats = curatedBuild.stats;

  const slvRows = loadSlvRows();
  const prodPayload = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8'));
  const prodWeights = prodPayload.weights;

  console.log('[strict-slv-curated] collecting walk-forward rows (strict OI, full news)…');
  const fullNewsWf = await collectWalkForwardRows({
    ids: ['au', 'ag'],
    from: TRAIN_FROM,
    to: TEST_TO,
    step: 1,
    useCuratedNews: false,
  });

  console.log('[strict-slv-curated] collecting walk-forward rows (strict OI, curated news)…');
  const curatedNewsWf = await collectWalkForwardRows({
    ids: ['au', 'ag'],
    from: TRAIN_FROM,
    to: TEST_TO,
    step: 1,
    useCuratedNews: true,
  });

  delete process.env.AG_BASIS_STRICT_OI_PROXY;
  delete process.env.NEWS_TAGGED_USE_CURATED;

  const results = [];

  function splitTrainTest(allRows) {
    return {
      train: allRows.filter((r) => r.date >= TRAIN_FROM && r.date <= TRAIN_TO),
      test: allRows.filter((r) => r.date >= TEST_FROM && r.date <= TEST_TO),
    };
  }

  const fullSplit = splitTrainTest(fullNewsWf.allRows);
  const curatedSplit = splitTrainTest(curatedNewsWf.allRows);

  const strictProdEval = evaluateRows(fullSplit.test, (row) => predictProductionV1348(prodWeights, row));
  results.push({
    id: 'prod-v1348-strict-oi-eval',
    mode: 'eval-only',
    curatedNews: false,
    metrics: strictProdEval,
    gate: checkGate(strictProdEval),
    slvWeight: null,
  });
  console.log(
    `[baseline] prod strict OI eval tradable au+ag=${strictProdEval.tradableAuAg.hitRatePct}% (${strictProdEval.tradableAuAg.scored}) full au+ag=${strictProdEval.auAg.hitRatePct}% AG basis=${strictProdEval.agBasis.hitRatePct}% (${strictProdEval.agBasis.scored})`
  );

  for (const variant of GRID) {
    const wf = variant.curatedNews ? curatedSplit : fullSplit;
    console.log(`[strict-slv-curated] training ${variant.id}…`);
    let trainResult;
    if (variant.mode === 'mixed') trainResult = trainMixedV1348(wf.train, variant);
    else trainResult = trainSplitHeads(wf.train, variant);

    const metrics = evaluateRows(wf.test, trainResult.predictFn);
    const gate = checkGate(metrics);
    const slvWeight =
      variant.mode === 'mixed'
        ? trainResult.weightsObj?.[SLV_FEATURE]
        : trainResult.agWeights?.[SLV_FEATURE];

    results.push({
      id: variant.id,
      mode: variant.mode,
      curatedNews: variant.curatedNews,
      variant,
      metrics,
      gate,
      slvWeight: slvWeight != null ? +Number(slvWeight).toFixed(6) : null,
    });
    console.log(
      `  → tradable au+ag=${metrics.tradableAuAg.hitRatePct}% (${metrics.tradableAuAg.scored}) full au+ag=${metrics.auAg.hitRatePct}% (${metrics.auAg.scored}) AG basis=${metrics.agBasis.hitRatePct}% (${metrics.agBasis.scored}) gate=${gate.passed ? 'PASS' : 'FAIL'}`
    );
  }

  results.sort((a, b) => {
    const aRate = a.metrics?.tradableAuAg?.hitRatePct ?? a.metrics?.auAg?.hitRatePct ?? -1;
    const bRate = b.metrics?.tradableAuAg?.hitRatePct ?? b.metrics?.auAg?.hitRatePct ?? -1;
    if (bRate !== aRate) return bRate - aRate;
    return (b.metrics?.agBasis?.hitRatePct ?? -1) - (a.metrics?.agBasis?.hitRatePct ?? -1);
  });

  const bestExperimental = results.find((r) => r.id !== 'prod-v1348-strict-oi-eval' && r.gate?.passed);
  const bestOverall = results.find((r) => r.id !== 'prod-v1348-strict-oi-eval');

  let experimentWeightsPath = null;
  if (bestExperimental) {
    const variant = bestExperimental.variant;
    const wf = variant.curatedNews ? curatedSplit : fullSplit;
    let trainResult;
    if (variant.mode === 'mixed') trainResult = trainMixedV1348(wf.train, variant);
    else trainResult = trainSplitHeads(wf.train, variant);
    const payload = buildExperimentPayload(variant, trainResult, bestExperimental.metrics, bestExperimental.gate);
    experimentWeightsPath = path.join(getModelsDir(), 'outlook-logistic-weights-strict-slv-curated-experiment.json');
    fs.writeFileSync(experimentWeightsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  const comparisonTable = results.map((r) => ({
    id: r.id,
    curatedNews: r.curatedNews ?? false,
    tradableAuAgT3: r.metrics?.tradableAuAg?.hitRatePct,
    tradableAuAgN: r.metrics?.tradableAuAg?.scored,
    fullAuAgT3: r.metrics?.auAg?.hitRatePct,
    fullAuAgN: r.metrics?.auAg?.scored,
    auT3: r.metrics?.au?.hitRatePct,
    auN: r.metrics?.au?.scored,
    agT3: r.metrics?.ag?.hitRatePct,
    agN: r.metrics?.ag?.scored,
    agBasisT3: r.metrics?.agBasis?.hitRatePct,
    agBasisN: r.metrics?.agBasis?.scored,
    tradableAgBasisT3: r.metrics?.tradableAgBasis?.hitRatePct,
    slvWeight: r.slvWeight,
    gate: r.gate?.passed ? 'PASS' : 'FAIL',
  }));

  const summary = {
    experiment: 'Combined strict OI-proxy + SLV joint retrain + curated news',
    generatedAt: new Date().toISOString(),
    elapsedSec: +((Date.now() - t0) / 1000).toFixed(1),
    slvRowCount: slvRows?.length || 0,
    newsCuratedStats,
    curatedCsvPath: curatedPath,
    window: { train: `${TRAIN_FROM}..${TRAIN_TO}`, oos: `${TEST_FROM}..${TEST_TO}` },
    productionLocked: 'v1.34.8-ag-cu-spread+basis-term',
    envFlags: { AG_BASIS_STRICT_OI_PROXY: true },
    baselines: {
      productionV1348: PRODUCTION_BASELINE,
      freshE20260615: FRESH_BASELINE,
      strictOnlyEvalNoRetrain: STRICT_ONLY_BASELINE,
    },
    comparisonTable,
    bestExperimental: bestExperimental
      ? { id: bestExperimental.id, metrics: bestExperimental.metrics, gate: bestExperimental.gate }
      : null,
    bestOverallNonProd: bestOverall
      ? { id: bestOverall.id, metrics: bestOverall.metrics, gate: bestOverall.gate }
      : null,
    gateRecommendation: bestExperimental
      ? 'PASS — experimental weights saved; user decision needed before production deploy'
      : `FAIL — best variant ${bestOverall?.id} tradable au+ag=${bestOverall?.metrics?.tradableAuAg?.hitRatePct}% vs prod ${PRODUCTION_BASELINE.auAgPct}% / strict-only ${STRICT_ONLY_BASELINE.auAgPct}%`,
    experimentWeightsPath,
    productionRecommendation: bestExperimental
      ? 'Gate passed — review experimental weights before any deploy; do NOT overwrite v1.34.8 without sign-off'
      : 'Maintain production v1.34.8-ag-cu-spread+basis-term; consider strict OI-proxy as runtime flag only (+3.5pp au+ag eval)',
    reproduce: [
      'FANCHENG_DATA_DRIVE=E node scripts/build-news-tagged-curated.js',
      'FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-strict-slv-curated-grid.js',
    ],
  };

  const outPath = path.join(__dirname, '..', '_train-strict-slv-curated-out.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
