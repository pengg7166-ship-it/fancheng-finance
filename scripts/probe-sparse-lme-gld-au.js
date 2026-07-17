/**
 * 快速探针：稀疏 LME/GLD 特征对 AU T+3 是否有边际贡献
 * 用法: FANCHENG_DATA_DRIVE=E node scripts/probe-sparse-lme-gld-au.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';
/** LME 仍稀疏门控；GLD 已默认纳入 — 仅 FANCHENG_LOGISTIC_SPARSE=1 时测 LME */
const USE_SPARSE = process.env.FANCHENG_LOGISTIC_SPARSE === '1';
if (USE_SPARSE) process.env.FANCHENG_LOGISTIC_SPARSE = '1';

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

const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const BASELINE_PCT = 59.95;

const LME_IDX = USE_SPARSE ? FEATURE_NAMES.indexOf('lmeInventory_chg_wow') : -1;
const GLD_IDX = FEATURE_NAMES.indexOf('gldHoldings_chg_5d');

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

function rowsToSamples(rows) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    samples.push({ x: rowToFeatureVector(row), y, row });
  }
  return samples;
}

function dot(w, x) {
  let s = w[0];
  for (let i = 0; i < x.length; i += 1) s += w[i + 1] * x[i];
  return s;
}

function trainLogistic(samples, { epochs = 600, lr = 0.08, lambda = 0.02 } = {}) {
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

function evaluateT3(rows, w, zeroIdx = []) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const x = rowToFeatureVector(row);
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
  for (let i = 0; i < FEATURE_NAMES.length; i += 1) {
    out[FEATURE_NAMES[i]] = +w[i + 1].toFixed(4);
  }
  return out;
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const allRows = await collectAuRows(TRAIN_FROM, TEST_TO);
  const trainRows = allRows.filter((r) => r.date >= TRAIN_FROM && r.date <= TRAIN_TO);
  const testRows = allRows.filter((r) => r.date >= TEST_FROM && r.date <= TEST_TO);

  const coverage = {
    train: {
      lme: featureCoverage(trainRows, 'lmeInventory_chg_wow'),
      gld: featureCoverage(trainRows, 'gldHoldings_chg_5d'),
    },
    oos: {
      lme: featureCoverage(testRows, 'lmeInventory_chg_wow'),
      gld: featureCoverage(testRows, 'gldHoldings_chg_5d'),
    },
  };

  const trainSamples = rowsToSamples(trainRows);
  const wFull = trainLogistic(trainSamples);
  const wNoLme =
    LME_IDX >= 0
      ? trainLogistic(trainSamples.map((s) => ({ ...s, x: s.x.map((v, i) => (i === LME_IDX ? 0 : v)) })))
      : null;
  const wNoGld = trainLogistic(
    trainSamples.map((s) => ({ ...s, x: s.x.map((v, i) => (i === GLD_IDX ? 0 : v)) }))
  );
  const wNoSparse =
    LME_IDX >= 0
      ? trainLogistic(
          trainSamples.map((s) => ({
            ...s,
            x: s.x.map((v, i) => (i === LME_IDX || i === GLD_IDX ? 0 : v)),
          }))
        )
      : wNoGld;

  const oosFull = evaluateT3(testRows, wFull);
  const oosNoLme = LME_IDX >= 0 ? evaluateT3(testRows, wNoLme, [LME_IDX]) : null;
  const oosNoGld = evaluateT3(testRows, wNoGld, [GLD_IDX]);
  const oosNoSparse =
    LME_IDX >= 0 ? evaluateT3(testRows, wNoSparse, [LME_IDX, GLD_IDX]) : oosNoGld;

  const payload = {
    instrument: 'au',
    label: 'T+3',
    mode: USE_SPARSE ? 'sparse_lme_gld' : 'default_gld_only',
    featureCount: FEATURE_NAMES.length,
    window: { train: `${TRAIN_FROM}..${TRAIN_TO}`, oos: `${TEST_FROM}..${TEST_TO}` },
    featureCoverage: coverage,
    oosHitRatePct: {
      withGld: oosFull.hitRatePct,
      withoutGld: oosNoGld.hitRatePct,
      ...(oosNoLme ? { zeroLme: oosNoLme.hitRatePct, zeroBothSparse: oosNoSparse.hitRatePct } : {}),
      baselinePct: BASELINE_PCT,
    },
    deltaPp: {
      fullVsBaseline:
        oosFull.hitRatePct != null ? +(oosFull.hitRatePct - BASELINE_PCT).toFixed(2) : null,
      gldMarginal:
        oosFull.hitRatePct != null && oosNoGld.hitRatePct != null
          ? +(oosFull.hitRatePct - oosNoGld.hitRatePct).toFixed(2)
          : null,
      ...(oosNoLme?.hitRatePct != null
        ? {
            fullVsNoSparse:
              oosFull.hitRatePct != null && oosNoSparse.hitRatePct != null
                ? +(oosFull.hitRatePct - oosNoSparse.hitRatePct).toFixed(2)
                : null,
            lmeMarginal:
              oosFull.hitRatePct != null && oosNoLme.hitRatePct != null
                ? +(oosFull.hitRatePct - oosNoLme.hitRatePct).toFixed(2)
                : null,
          }
        : {}),
    },
    gldHelps:
      oosFull.hitRatePct != null &&
      oosNoGld.hitRatePct != null &&
      oosFull.hitRatePct > oosNoGld.hitRatePct,
    featureWeights: weightsSummary(wFull),
    trainSamples: trainSamples.length,
    oosScored: oosFull.scored,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
