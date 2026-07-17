/**
 * SLV 特征 AG T+3 消融 — split AG head with/without slvHoldings_chg_5d
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/probe-slv-ag-ablation.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const {
  AG_HEAD_FEATURE_NAMES,
  rowToAgHeadFeatureVector,
  AG_PHILOSOPHY_SCALE,
} = require('../services/outlook-logistic-features');
const { sigmoid, directionFromPUp } = require('../services/outlook-onnx-runner');
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
const AG_BASELINE_T3 = 61.16;
const AG_TRAIN_SAMPLE_WEIGHT = 1.35;
const AG_BASIS_SAMPLE_WEIGHT = 1.5;

const SLV_IDX = AG_HEAD_FEATURE_NAMES.indexOf('slvHoldings_chg_5d');

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

async function collectAgRows(from, to) {
  const spec = INSTRUMENT_REGISTRY.find((s) => s.id === 'ag');
  const bars = loadTradingBars('ag');
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

function sampleWeightForRow(row) {
  let w = AG_TRAIN_SAMPLE_WEIGHT;
  if (row.marketRegime === 'basis') w *= AG_BASIS_SAMPLE_WEIGHT;
  return w;
}

function rowsToSamples(rows) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    samples.push({
      x: rowToAgHeadFeatureVector(row, AG_PHILOSOPHY_SCALE),
      y,
      weight: sampleWeightForRow(row),
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
    for (const { x, y, weight = 1 } of samples) {
      const p = sigmoid(dot(w, x));
      const err = (p - y) * weight;
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

function evaluateT3(rows, w, zeroIdx = []) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const x = rowToAgHeadFeatureVector(row, AG_PHILOSOPHY_SCALE);
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
  };
}

function weightsSummary(w) {
  const out = { bias: +w[0].toFixed(4) };
  for (let i = 0; i < AG_HEAD_FEATURE_NAMES.length; i += 1) {
    out[AG_HEAD_FEATURE_NAMES[i]] = +w[i + 1].toFixed(4);
  }
  return out;
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const slvRows = loadSlvRows();
  const slvDataExists = Boolean(slvRows?.length);

  const allRows = await collectAgRows(TRAIN_FROM, TEST_TO);
  const trainRows = allRows.filter((r) => r.date >= TRAIN_FROM && r.date <= TRAIN_TO);
  const testRows = allRows.filter((r) => r.date >= TEST_FROM && r.date <= TEST_TO);

  const coverage = {
    train: featureCoverage(trainRows, 'slvHoldings_chg_5d'),
    oos: featureCoverage(testRows, 'slvHoldings_chg_5d'),
  };

  const trainSamples = rowsToSamples(trainRows);
  const wFull = trainLogistic(trainSamples);
  const wNoSlv = trainLogistic(
    trainSamples.map((s) => ({
      ...s,
      x: s.x.map((v, i) => (i === SLV_IDX ? 0 : v)),
    }))
  );

  const oosFull = evaluateT3(testRows, wFull);
  const oosNoSlv = evaluateT3(testRows, wNoSlv, [SLV_IDX]);

  const payload = {
    instrument: 'ag',
    label: 'T+3',
    mode: 'split_ag_head_slv_ablation',
    featureCount: AG_HEAD_FEATURE_NAMES.length,
    slvDataExists,
    slvRowCount: slvRows?.length || 0,
    blocked: !slvDataExists || coverage.oos.nonNull === 0,
    window: { train: `${TRAIN_FROM}..${TRAIN_TO}`, oos: `${TEST_FROM}..${TEST_TO}` },
    featureCoverage: coverage,
    oosHitRatePct: {
      withSlv: oosFull.hitRatePct,
      withoutSlv: oosNoSlv.hitRatePct,
      baselineAgPct: AG_BASELINE_T3,
      productionV1348AgPct: AG_BASELINE_T3,
    },
    deltaPp: {
      slvMarginal:
        oosFull.hitRatePct != null && oosNoSlv.hitRatePct != null
          ? +(oosFull.hitRatePct - oosNoSlv.hitRatePct).toFixed(2)
          : null,
      vsProductionAg:
        oosFull.hitRatePct != null ? +(oosFull.hitRatePct - AG_BASELINE_T3).toFixed(2) : null,
    },
    slvHelps:
      oosFull.hitRatePct != null &&
      oosNoSlv.hitRatePct != null &&
      oosFull.hitRatePct > oosNoSlv.hitRatePct,
    featureWeights: weightsSummary(wFull),
    trainSamples: trainSamples.length,
    oosScored: oosFull.scored,
    userAction: !slvDataExists
      ? 'Import user-slv-holdings.csv via: FANCHENG_DATA_DRIVE=E node scripts/fetch-slv-etf-holdings.js --import E:\\FanchengFinance\\data\\history\\user-slv-holdings.csv'
      : null,
  };

  const outPath = path.join(__dirname, '..', '_probe-slv-ag-ablation-out.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
