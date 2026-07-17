/**
 * SLV mixed-model ablation — v1.34.8 path + slvHoldings_chg_5d (AG-only)
 * Does NOT overwrite production weights.
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const { FEATURE_NAMES, rowToFeatureVector } = require('../services/outlook-logistic-features');
const { sigmoid, directionFromPUp } = require('../services/outlook-onnx-runner');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');

const SLV_FEATURE = 'slvHoldings_chg_5d';
const MIXED_FEATURE_NAMES = [...FEATURE_NAMES, SLV_FEATURE];
const PRODUCTION_AU_AG = 64.16;
const EXCLUDE = ['cu_momentum_5d', 'gldHoldings_chg_5d'];
const AG_TRAIN_SAMPLE_WEIGHT = 1.35;
const AG_BASIS_SAMPLE_WEIGHT = 1.5;

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

async function collectWalkForwardRows({ ids, from, to, step }) {
  const weights = calibration.getCompositeWeights();
  const allRows = [];
  for (const id of ids) {
    const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
    const bars = loadTradingBars(id);
    let prev = 'neutral';
    for (const t of buildProbeIndices(bars, { from, to, step })) {
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      allRows.push({ ...row, instrumentId: id });
    }
  }
  return allRows;
}

function rowToMixedWithSlv(row = {}) {
  const base = rowToFeatureVector(row);
  const isAg = String(row.instrumentId || '').toLowerCase() === 'ag';
  return [...base, isAg ? Number(row.slvHoldings_chg_5d ?? 0) : 0];
}

function buildTrainPlan() {
  const excluded = new Set(EXCLUDE);
  const trainIndices = [];
  for (let i = 0; i < MIXED_FEATURE_NAMES.length; i += 1) {
    if (!excluded.has(MIXED_FEATURE_NAMES[i])) trainIndices.push(i);
  }
  return { trainIndices };
}

function sampleWeightForRow(row) {
  if (row.instrumentId !== 'ag') return 1;
  if (row.marketRegime === 'basis') return AG_BASIS_SAMPLE_WEIGHT;
  return AG_TRAIN_SAMPLE_WEIGHT;
}

function rowsToSamples(rows, trainIndices) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    const fullX = rowToMixedWithSlv(row);
    const x = trainIndices.map((idx) => fullX[idx]);
    samples.push({ x, y, weight: sampleWeightForRow(row), row });
  }
  return samples;
}

function dot(w, x) {
  let s = w[0];
  for (let i = 0; i < x.length; i += 1) s += w[i + 1] * x[i];
  return s;
}

function trainLogistic(samples, { epochs, lr, lambda }) {
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

function expandTrainWeights(wTrain, trainIndices) {
  const w = new Array(MIXED_FEATURE_NAMES.length + 1).fill(0);
  w[0] = wTrain[0];
  for (let j = 0; j < trainIndices.length; j += 1) {
    w[trainIndices[j] + 1] = wTrain[j + 1];
  }
  return w;
}

function weightsToObject(w) {
  const out = { bias: +w[0].toFixed(6) };
  for (let i = 0; i < MIXED_FEATURE_NAMES.length; i += 1) {
    out[MIXED_FEATURE_NAMES[i]] = +w[i + 1].toFixed(6);
  }
  return out;
}

function predict(weightsObj, row) {
  const x = rowToMixedWithSlv(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < MIXED_FEATURE_NAMES.length; i += 1) {
    z += Number(weightsObj[MIXED_FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function evaluate(rows, predictFn) {
  let hit = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hit += 1;
  }
  return { hitRatePct: scored ? +((hit / scored) * 100).toFixed(2) : null, scored, hit };
}

async function main() {
  const opts = {
    ids: ['au', 'ag'],
    trainFrom: '2019-01-01',
    trainTo: '2022-12-31',
    testFrom: '2023-01-01',
    testTo: '2026-12-31',
    step: 1,
    epochs: 800,
    lr: 0.08,
    lambda: 0.02,
  };

  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const allRows = await collectWalkForwardRows({
    ids: opts.ids,
    from: opts.trainFrom,
    to: opts.testTo,
    step: opts.step,
  });
  const trainRows = allRows.filter((r) => r.date >= opts.trainFrom && r.date <= opts.trainTo);
  const testRows = allRows.filter((r) => r.date >= opts.testFrom && r.date <= opts.testTo);
  const { trainIndices } = buildTrainPlan();
  const trainSamples = rowsToSamples(trainRows, trainIndices);
  const wTrain = trainLogistic(trainSamples, opts);
  const weightsObj = weightsToObject(expandTrainWeights(wTrain, trainIndices));
  const predictFn = (row) => predict(weightsObj, row);

  const oosOverall = evaluate(testRows, predictFn);
  const oosAu = evaluate(testRows.filter((r) => r.instrumentId === 'au'), predictFn);
  const oosAg = evaluate(testRows.filter((r) => r.instrumentId === 'ag'), predictFn);

  const payload = {
    mode: 'mixed_v1348_plus_slv',
    slvWeight: weightsObj[SLV_FEATURE],
    validation: {
      outOfSample: { auAg: oosOverall, au: oosAu, ag: oosAg },
      baselineV1348: { auAgPct: PRODUCTION_AU_AG, auPct: 67.62, agPct: 61.16 },
    },
    promote: oosOverall.hitRatePct != null && oosOverall.hitRatePct > PRODUCTION_AU_AG,
    trainSamples: trainSamples.length,
  };

  const outPath = path.join(__dirname, '..', '_probe-slv-mixed-v1348-out.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
