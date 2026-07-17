/**
 * 跨境 + logistic 融合探针 — T+1 / T+3 OOS au+ag
 * 用法:
 *   FANCHENG_DATA_DRIVE=E node scripts/probe-cross-market-ensemble.js
 *   FANCHENG_CROSS_MARKET_ENSEMBLE=1 node scripts/probe-cross-market-ensemble.js --mode ensemble
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const { FEATURE_NAMES, rowToFeatureVector } = require('../services/outlook-logistic-features');
const {
  sigmoid,
  directionFromPUp,
  getDefaultWeightsPath,
  predictEnsembleSync,
} = require('../services/outlook-onnx-runner');
const {
  fuseCrossMarketWithLogistic,
  directionFromCrossDelta,
} = require('../services/cross-market-logistic-ensemble');
const crossMarket = require('../services/cross-market-precious-inference');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');

const FROM = '2023-01-01';
const TO = '2026-12-31';
const BASELINE = { auAgT3: 64.16, auT3: 67.62, agT3: 61.16 };

function parseArgs() {
  const args = process.argv.slice(2);
  let mode = 'all';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i += 1;
    }
  }
  return { mode };
}

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

function predictLogisticOnly(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  const pUp = sigmoid(z);
  return directionFromPUp(pUp);
}

function predictCrossOnly(row) {
  const id = row.instrumentId;
  const infer = crossMarket.inferPointChangeFromClose(row.date, id);
  if (infer?.gated || infer?.predictedDelta == null) return null;
  return directionFromCrossDelta(infer.predictedDelta, id);
}

function predictEnsemble(row, weightsObj) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  const pUp = sigmoid(z);
  const base = {
    pUp: +pUp.toFixed(4),
    direction: directionFromPUp(pUp),
    backend: 'logistic-json',
  };
  return fuseCrossMarketWithLogistic(base, row, { crossMarketEnsemble: true }).direction;
}

function evaluateRows(rows, predictFn, horizon) {
  const byId = { au: { hits: 0, scored: 0 }, ag: { hits: 0, scored: 0 } };
  let hits = 0;
  let scored = 0;
  let highConfHits = 0;
  let highConfScored = 0;

  for (const row of rows) {
    const actual =
      horizon === 'T1'
        ? row.actualDir
        : row.actualDirT3;
    if (!actual || actual === 'neutral') continue;
    const pred = predictFn(row);
    if (!pred || pred === 'neutral') continue;
    scored += 1;
    byId[row.instrumentId].scored += 1;
    const hit = hitDirection(pred, actual);
    if (hit) {
      hits += 1;
      byId[row.instrumentId].hits += 1;
    }
    const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
    const prev = infer?.components?.intlLevelPrev;
    const now = infer?.components?.intlLevelNow;
    const intlPct = prev && now ? Math.abs(((now - prev) / prev) * 100) : 0;
    if (intlPct >= 0.5) {
      highConfScored += 1;
      if (hit) highConfHits += 1;
    }
  }

  const pct = (h, s) => (s ? +((h / s) * 100).toFixed(2) : null);
  return {
    overall: { hits, scored, hitRatePct: pct(hits, scored) },
    au: {
      hits: byId.au.hits,
      scored: byId.au.scored,
      hitRatePct: pct(byId.au.hits, byId.au.scored),
    },
    ag: {
      hits: byId.ag.hits,
      scored: byId.ag.scored,
      hitRatePct: pct(byId.ag.hits, byId.ag.scored),
    },
    highConfSubset: {
      hits: highConfHits,
      scored: highConfScored,
      hitRatePct: pct(highConfHits, highConfScored),
    },
  };
}

async function collectRows(ids, from, to) {
  const weights = calibration.getCompositeWeights();
  const rows = [];
  for (const id of ids) {
    const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
    const bars = loadTradingBars(id);
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 3; t += 1) {
      const d = normBarDate(bars[t]);
      if (d < from || d > to) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      rows.push(row);
    }
  }
  return rows;
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });
  crossMarket.resetIntlSeriesCache();

  const weightsObj = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8')).weights;
  const rows = await collectRows(['au', 'ag'], FROM, TO);

  const payload = {
    window: { from: FROM, to: TO },
    baselineV1348: BASELINE,
    T1: {
      logisticOnly: evaluateRows(rows, (r) => predictLogisticOnly(weightsObj, r), 'T1'),
      crossMarketOnly: evaluateRows(rows, predictCrossOnly, 'T1'),
      ensemble: evaluateRows(rows, (r) => predictEnsemble(r, weightsObj), 'T1'),
    },
    T3: {
      logisticOnly: evaluateRows(rows, (r) => predictLogisticOnly(weightsObj, r), 'T3'),
      crossMarketOnly: evaluateRows(rows, predictCrossOnly, 'T3'),
      ensemble: evaluateRows(rows, (r) => predictEnsemble(r, weightsObj), 'T3'),
    },
    config: {
      highConfIntlPct: 0.5,
      wCrossDefault: 0.35,
      wCrossHigh: 0.65,
      env: 'FANCHENG_CROSS_MARKET_ENSEMBLE=1',
    },
    promoteEnsemble:
      evaluateRows(rows, (r) => predictEnsemble(r, weightsObj), 'T3').overall.hitRatePct != null &&
      evaluateRows(rows, (r) => predictEnsemble(r, weightsObj), 'T3').overall.hitRatePct > BASELINE.auAgT3,
  };

  const outPath = path.join(__dirname, '..', '_probe-cross-market-ensemble-out.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
