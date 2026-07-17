/**
 * AG basis 次级 logistic head — v1.34.7 Round 4
 * 仅在 ag+basis 样本上训练；主权重 outlook-logistic-weights.json 不动
 *
 * 用法:
 *   node scripts/train-outlook-logistic-ag-basis-head.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const {
  AG_BASIS_HEAD_FEATURE_NAMES,
  rowToAgBasisHeadFeatureVector,
} = require('../services/outlook-logistic-features');
const {
  getAgBasisHeadWeightsPath,
  getDefaultWeightsPath,
  getModelsDir,
  sigmoid,
  directionFromPUp,
  predictEnsembleSync,
  clearRunnerCache,
} = require('../services/outlook-onnx-runner');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { REGIME_IDS } = require('../services/market-regime-classifier');

const VERSION = 'v1.34.7-ag-basis-secondary-head';
const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const MIN_BASIS_SAMPLES = 20;
const BASIS_ONLY_WEIGHT = 1;
const NON_BASIS_FALLBACK_WEIGHT = 0.15;

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadTradingBars(instrumentId) {
  const klines = readCachedKlines(instrumentId);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', `${instrumentId}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function buildProbeIndices(bars, { from, to, step = 1, minBarIdx = 60, maxFutureBars = 3 }) {
  const indices = [];
  const upper = bars.length - maxFutureBars;
  for (let i = minBarIdx; i < upper; i += step) {
    const d = normBarDate(bars[i]);
    if (d >= from && d <= to) indices.push(i);
  }
  return indices;
}

function filterRowsByWindow(rows, from, to) {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

async function collectAgRows({ from, to, step = 1 }) {
  const weights = calibration.getCompositeWeights();
  const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === 'ag');
  if (!spec) throw new Error('ag not in registry');
  const bars = loadTradingBars('ag');
  const indices = buildProbeIndices(bars, { from, to, step });
  const rows = [];
  let prev = 'neutral';
  for (const t of indices) {
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    rows.push({ ...row, instrumentId: 'ag' });
  }
  return rows;
}

function sampleWeightForRow(row, basisOnly) {
  if (row.marketRegime === 'basis') return BASIS_ONLY_WEIGHT;
  return basisOnly ? 0 : NON_BASIS_FALLBACK_WEIGHT;
}

function rowsToSamples(rows, basisOnly) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const weight = sampleWeightForRow(row, basisOnly);
    if (weight <= 0) continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    samples.push({ x: rowToAgBasisHeadFeatureVector(row), y, weight, row });
  }
  return samples;
}

function dot(w, x) {
  let s = w[0];
  for (let i = 0; i < x.length; i += 1) s += w[i + 1] * x[i];
  return s;
}

function trainLogistic(samples, { epochs = 600, lr = 0.1, lambda = 0.03 }) {
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

function weightsArrayToObject(w) {
  const out = { bias: +w[0].toFixed(6) };
  for (let i = 0; i < AG_BASIS_HEAD_FEATURE_NAMES.length; i += 1) {
    out[AG_BASIS_HEAD_FEATURE_NAMES[i]] = +w[i + 1].toFixed(6);
  }
  return out;
}

function predictFromHeadWeightsObject(weightsObj, row) {
  const x = rowToAgBasisHeadFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[AG_BASIS_HEAD_FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function evaluateT3HitRate(rows, predictFn) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

function evaluateByRegime(rows, predictFn) {
  const byRegime = Object.fromEntries(REGIME_IDS.map((r) => [r, { hits: 0, scored: 0 }]));
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const reg = row.marketRegime || 'range';
    byRegime[reg].scored += 1;
    if (hitDirection(pred, row.actualDirT3)) byRegime[reg].hits += 1;
  }
  const out = {};
  for (const r of REGIME_IDS) {
    const s = byRegime[r];
    out[r] = {
      ...s,
      hitRatePct: s.scored ? +((s.hits / s.scored) * 100).toFixed(2) : null,
    };
  }
  return out;
}

async function evaluateBlendedOos(auRows, agRows) {
  clearRunnerCache();
  const predictBlended = (row) => predictEnsembleSync(row, { allowOnnx: false }).direction;
  const auAgRows = [...auRows, ...agRows];
  return {
    auAg: evaluateT3HitRate(auAgRows, predictBlended),
    au: evaluateT3HitRate(auRows, predictBlended),
    ag: evaluateT3HitRate(agRows, predictBlended),
    agByRegime: evaluateByRegime(agRows, predictBlended),
  };
}

async function collectAuOosRows({ from, to, step = 1 }) {
  const weights = calibration.getCompositeWeights();
  const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === 'au');
  const bars = loadTradingBars('au');
  const indices = buildProbeIndices(bars, { from, to, step });
  const rows = [];
  let prev = 'neutral';
  for (const t of indices) {
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    rows.push({ ...row, instrumentId: 'au' });
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(getDefaultWeightsPath())) {
    throw new Error(`main weights missing: ${getDefaultWeightsPath()}`);
  }

  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const fullFrom = TRAIN_FROM;
  const fullTo = TEST_TO;
  const allAgRows = await collectAgRows({ from: fullFrom, to: fullTo, step: 1 });
  const trainRows = filterRowsByWindow(allAgRows, TRAIN_FROM, TRAIN_TO);
  const testRows = filterRowsByWindow(allAgRows, TEST_FROM, TEST_TO);
  const basisTrainRows = trainRows.filter((r) => r.marketRegime === 'basis');
  const basisOnly = basisTrainRows.length >= MIN_BASIS_SAMPLES;
  const trainSamples = rowsToSamples(trainRows, basisOnly);
  if (trainSamples.length < MIN_BASIS_SAMPLES) {
    throw new Error(`insufficient train samples: ${trainSamples.length}`);
  }

  const w = trainLogistic(trainSamples, { epochs: 600, lr: 0.1, lambda: 0.03 });
  const weightsObj = weightsArrayToObject(w);
  const predictHead = (row) => predictFromHeadWeightsObject(weightsObj, row);

  const isHead = evaluateT3HitRate(
    basisOnly ? basisTrainRows : trainRows.filter((r) => r.marketRegime === 'basis'),
    predictHead
  );
  const oosHeadBasis = evaluateT3HitRate(
    testRows.filter((r) => r.marketRegime === 'basis'),
    predictHead
  );
  const oosHeadAllAg = evaluateT3HitRate(testRows, predictHead);

  getModelsDir();
  const headPath = getAgBasisHeadWeightsPath();
  const payload = {
    version: VERSION,
    role: 'ag-basis-secondary-head',
    mainWeightsVersion: JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8')).version,
    trainedAt: new Date().toISOString(),
    cv: {
      train: `${TRAIN_FROM}..${TRAIN_TO}`,
      test: `${TEST_FROM}..${TEST_TO}`,
    },
    instrument: 'ag',
    regime: 'basis',
    featureNames: AG_BASIS_HEAD_FEATURE_NAMES,
    weights: weightsObj,
    training: {
      basisOnly,
      basisTrainSamples: basisTrainRows.length,
      trainSamples: trainSamples.length,
      basisSamplesInTrain: trainSamples.filter((s) => s.row.marketRegime === 'basis').length,
      epochs: 600,
      lr: 0.1,
      lambda: 0.03,
    },
    validation: {
      inSampleBasisHead: isHead,
      outOfSampleBasisHead: oosHeadBasis,
      outOfSampleAllAgHead: oosHeadAllAg,
    },
  };

  fs.writeFileSync(headPath, JSON.stringify(payload, null, 2), 'utf8');

  const auTestRows = await collectAuOosRows({ from: TEST_FROM, to: TEST_TO, step: 1 });
  const blended = await evaluateBlendedOos(auTestRows, testRows);
  payload.validation.blendedWithMainHead = blended;

  const targets = {
    agBasisMinPct: 60,
    auAgMinPct: 64,
    auMinPct: 68,
  };
  const agBasisPct = blended.agByRegime.basis?.hitRatePct;
  const passed =
    agBasisPct != null &&
    agBasisPct >= targets.agBasisMinPct &&
    blended.auAg.hitRatePct != null &&
    blended.auAg.hitRatePct >= targets.auAgMinPct &&
    blended.au.hitRatePct != null &&
    blended.au.hitRatePct >= targets.auMinPct;

  payload.targets = targets;
  payload.gate = { passed, deployRecommended: passed };

  fs.writeFileSync(headPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
