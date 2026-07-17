/**
 * GLD 特征 AU T+3 消融 — AU split head with/without gldHoldings_chg_5d
 * 对比 v1.34.8 生产权重 AU OOS 基线
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/probe-gld-au-ablation.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const {
  AU_HEAD_FEATURE_NAMES,
  rowToAuHeadFeatureVector,
  AU_PHILOSOPHY_SCALE,
  FEATURE_NAMES,
  rowToFeatureVector,
} = require('../services/outlook-logistic-features');
const { sigmoid, directionFromPUp, getDefaultWeightsPath } = require('../services/outlook-onnx-runner');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');
const { loadGldRows } = require('../services/precious-etf-fetcher');

const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const AU_BASELINE_T3 = 67.62;
const AU_PRODUCTION_V1348 = 67.62;

const GLD_AU_IDX = AU_HEAD_FEATURE_NAMES.indexOf('gldHoldings_chg_5d');
const GLD_MIXED_IDX = FEATURE_NAMES.indexOf('gldHoldings_chg_5d');

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadTradingBars(id) {
  const klines = readCachedKlines(id);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const raw = JSON.parse(fs.readFileSync(path.join(historyDir, 'trading', `${id}.json`), 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

async function collectAuRows(from, to) {
  const spec = INSTRUMENT_REGISTRY.find((s) => s.id === 'au');
  const bars = loadTradingBars('au');
  const weights = calibration.getCompositeWeights();
  const rows = [];
  let prev = 'neutral';
  for (let t = 60; t < bars.length - 3; t += 1) {
    const d = normBarDate(bars[t]);
    if (d < from || d > to) continue;
    const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
    if (!row) continue;
    prev = row.financeRegimeNext || prev;
    rows.push(row);
  }
  return rows;
}

function featureCoverage(rows, field) {
  let nonNull = 0;
  for (const row of rows) {
    if (row[field] != null && !Number.isNaN(row[field])) nonNull += 1;
  }
  return {
    field,
    nonNull,
    total: rows.length,
    coveragePct: rows.length ? +((nonNull / rows.length) * 100).toFixed(2) : null,
  };
}

function rowsToAuSamples(rows) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    samples.push({
      x: rowToAuHeadFeatureVector(row, AU_PHILOSOPHY_SCALE),
      y,
      row,
    });
  }
  return samples;
}

function dot(w, x) {
  let s = w[0];
  for (let i = 0; i < x.length; i += 1) s += w[i + 1] * x[i];
  return s;
}

function trainLogistic(samples, { epochs = 800, lr = 0.08, lambda = 0.02 } = {}) {
  const nFeatures = samples[0].x.length;
  const w = new Array(nFeatures + 1).fill(0);
  const m = samples.length;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Array(nFeatures + 1).fill(0);
    for (const { x, y } of samples) {
      const p = sigmoid(dot(w, x));
      const err = p - y;
      grad[0] += err;
      for (let i = 0; i < nFeatures; i += 1) grad[i + 1] += err * x[i];
    }
    for (let i = 0; i <= nFeatures; i += 1) {
      const reg = i > 0 ? lambda * w[i] : 0;
      w[i] -= lr * (grad[i] / m + reg);
    }
  }
  return w;
}

function evaluateAuT3(rows, w, featureNames, vectorFn, zeroIdx = []) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const x = vectorFn(row);
    for (const idx of zeroIdx) x[idx] = 0;
    const pUp = sigmoid(dot(w, x));
    const pred = directionFromPUp(pUp);
    if (!pred || pred === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
    featureNames,
  };
}

function predictProductionV1348(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function evaluateProductionAu(rows, weightsObj) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const pred = predictProductionV1348(weightsObj, row);
    if (!pred || pred === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

function weightsSummary(w, featureNames) {
  const out = { bias: +w[0].toFixed(4) };
  for (let i = 0; i < featureNames.length; i += 1) {
    out[featureNames[i]] = +w[i + 1].toFixed(4);
  }
  return out;
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const gldRows = loadGldRows();
  const weightsPath = getDefaultWeightsPath();
  const weightsFile = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  const productionWeights = weightsFile.weights;

  const allRows = await collectAuRows(TRAIN_FROM, TEST_TO);
  const trainRows = allRows.filter((r) => r.date >= TRAIN_FROM && r.date <= TRAIN_TO);
  const testRows = allRows.filter((r) => r.date >= TEST_FROM && r.date <= TEST_TO);

  const coverage = {
    train: featureCoverage(trainRows, 'gldHoldings_chg_5d'),
    oos: featureCoverage(testRows, 'gldHoldings_chg_5d'),
  };

  const trainSamples = rowsToAuSamples(trainRows);
  const wWithGld = trainLogistic(trainSamples);
  const wNoGld = trainLogistic(
    trainSamples.map((s) => ({
      ...s,
      x: s.x.map((v, i) => (i === GLD_AU_IDX ? 0 : v)),
    }))
  );

  const oosWithGld = evaluateAuT3(testRows, wWithGld, AU_HEAD_FEATURE_NAMES, (r) =>
    rowToAuHeadFeatureVector(r, AU_PHILOSOPHY_SCALE)
  );
  const oosNoGld = evaluateAuT3(
    testRows,
    wNoGld,
    AU_HEAD_FEATURE_NAMES,
    (r) => rowToAuHeadFeatureVector(r, AU_PHILOSOPHY_SCALE),
    [GLD_AU_IDX]
  );
  const oosProduction = evaluateProductionAu(testRows, productionWeights);

  const payload = {
    instrument: 'au',
    label: 'T+3',
    mode: 'au_split_head_gld_ablation',
    gldDataRows: gldRows?.length || 0,
    gldExcludedInProduction: (weightsFile.excludedFromTraining || []).includes('gldHoldings_chg_5d'),
    productionWeightGld: productionWeights.gldHoldings_chg_5d ?? 0,
    window: { train: `${TRAIN_FROM}..${TRAIN_TO}`, oos: `${TEST_FROM}..${TEST_TO}` },
    featureCoverage: coverage,
    oosHitRatePct: {
      auSplitHeadWithGld: oosWithGld.hitRatePct,
      auSplitHeadWithoutGld: oosNoGld.hitRatePct,
      productionV1348Mixed: oosProduction.hitRatePct,
      baselineAuPct: AU_BASELINE_T3,
    },
    oosScored: {
      auSplitHeadWithGld: oosWithGld.scored,
      auSplitHeadWithoutGld: oosNoGld.scored,
      productionV1348Mixed: oosProduction.scored,
    },
    deltaPp: {
      gldMarginalAuHead:
        oosWithGld.hitRatePct != null && oosNoGld.hitRatePct != null
          ? +(oosWithGld.hitRatePct - oosNoGld.hitRatePct).toFixed(2)
          : null,
      auHeadWithGldVsProduction:
        oosWithGld.hitRatePct != null && oosProduction.hitRatePct != null
          ? +(oosWithGld.hitRatePct - oosProduction.hitRatePct).toFixed(2)
          : null,
      productionVsBaseline:
        oosProduction.hitRatePct != null
          ? +(oosProduction.hitRatePct - AU_PRODUCTION_V1348).toFixed(2)
          : null,
    },
    gldHelps: oosWithGld.hitRatePct != null && oosNoGld.hitRatePct != null && oosWithGld.hitRatePct > oosNoGld.hitRatePct,
    promoteGldToProduction:
      oosWithGld.hitRatePct != null &&
      oosProduction.hitRatePct != null &&
      oosWithGld.hitRatePct > oosProduction.hitRatePct + 0.5,
    auHeadFeatureWeights: weightsSummary(wWithGld, AU_HEAD_FEATURE_NAMES),
    trainSamples: trainSamples.length,
    weightsFile: path.basename(weightsPath),
  };

  const outPath = path.join(__dirname, '..', '_probe-gld-au-ablation-out.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
