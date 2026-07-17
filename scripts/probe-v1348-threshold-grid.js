/**
 * v1.34.8 shared-head threshold grid — weights unchanged.
 * Usage: FANCHENG_DATA_DRIVE=E node scripts/probe-v1348-threshold-grid.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const { FEATURE_NAMES, rowToFeatureVector } = require('../services/outlook-logistic-features');
const { sigmoid, directionFromPUp, getDefaultWeightsPath } = require('../services/outlook-onnx-runner');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');

const FROM = '2023-01-01';
const TO = '2026-12-31';
const MIN_SCORED = 150;

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

function pUpFromRow(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return sigmoid(z);
}

async function collectRows() {
  const weights = calibration.getCompositeWeights();
  const rows = [];
  for (const id of ['au', 'ag']) {
    const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
    const bars = loadTradingBars(id);
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 3; t += 1) {
      const d = normBarDate(bars[t]);
      if (d < FROM || d > TO) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      row._pUp = pUpFromRow(globalWeights, row);
      rows.push(row);
    }
  }
  return rows;
}

let globalWeights;

function scoreWithThresholds(rows, th) {
  const byId = { au: { hits: 0, scored: 0 }, ag: { hits: 0, scored: 0 } };
  let allHits = 0;
  let allScored = 0;
  for (const row of rows) {
    const pred = directionFromPUp(row._pUp, th);
    if (!pred || pred === 'neutral') continue;
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    allScored += 1;
    byId[row.instrumentId].scored += 1;
    if (hitDirection(pred, row.actualDirT3)) {
      allHits += 1;
      byId[row.instrumentId].hits += 1;
    }
  }
  return {
    all: {
      hits: allHits,
      scored: allScored,
      hitRatePct: allScored ? +((allHits / allScored) * 100).toFixed(2) : null,
    },
    au: {
      ...byId.au,
      hitRatePct: byId.au.scored ? +((byId.au.hits / byId.au.scored) * 100).toFixed(2) : null,
    },
    ag: {
      ...byId.ag,
      hitRatePct: byId.ag.scored ? +((byId.ag.hits / byId.ag.scored) * 100).toFixed(2) : null,
    },
  };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });
  globalWeights = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8')).weights;
  const rows = await collectRows();

  const defaultTh = { bullishThreshold: 0.55, bearishThreshold: 0.45 };
  const baseline = scoreWithThresholds(rows, defaultTh);

  const grid = [];
  for (let bull = 0.5; bull <= 0.72; bull += 0.02) {
    for (let bear = 0.28; bear <= 0.5; bear += 0.02) {
      if (bear >= bull) continue;
      const th = { bullishThreshold: +bull.toFixed(2), bearishThreshold: +bear.toFixed(2) };
      const s = scoreWithThresholds(rows, th);
      if (s.all.scored < MIN_SCORED) continue;
      grid.push({ thresholds: th, ...s });
    }
  }
  grid.sort((a, b) => (b.all.hitRatePct ?? 0) - (a.all.hitRatePct ?? 0) || b.all.scored - a.all.scored);

  const payload = {
    generatedAt: new Date().toISOString(),
    window: { from: FROM, to: TO },
    model: 'v1.34.8 shared head — weights unchanged',
    baselineDefault055045: baseline,
    minScored: MIN_SCORED,
    top10: grid.slice(0, 10),
    best: grid[0] || null,
  };

  const outPath = path.join(__dirname, '..', '_probe-v1348-threshold-grid-out.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
