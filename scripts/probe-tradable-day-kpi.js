/**

 * Tradable-day KPI 报告 — 全样本 + 高置信子集

 * 用法: FANCHENG_DATA_DRIVE=E node scripts/probe-tradable-day-kpi.js

 */

const fs = require('fs');

const path = require('path');



process.chdir(path.join(__dirname, '..'));

process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';



const diskCache = require('../services/disk-cache');

const { getDataDir } = require('../services/data-paths');

const { predictEnsembleSync, getDefaultWeightsPath } = require('../services/outlook-onnx-runner');

const crossMarket = require('../services/cross-market-precious-inference');

const historicalContext = require('../services/commodity-outlook-historical-context');

const backtest = require('../services/commodity-outlook-backtest');

const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');

const calibration = require('../services/commodity-outlook-calibration');

const newsTagged = require('../services/news-tagged-loader');

const { readCachedKlines } = require('../services/commodity-technical-analyzer');

const { computeTradableDayKpiReport, evaluateTradableDay, isTradableDay, fmtHitRateWithSample } = require('../services/tradable-day-kpi');
const { hitDirection } = require('../services/outlook-labels');

const GATE_THRESHOLDS = [0.10, 0.12, 0.15, 0.18, 0.20];



const FROM = '2023-01-01';

const TO = '2026-12-31';

const BASELINE = { auAgT3: 64.16, auT3: 67.62, agT3: 61.16, scored: { au: 105, ag: 121, all: 226 } };



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



function predictLogistic(_weightsObj, row) {
  return predictEnsembleSync(row)?.direction ?? null;
}



function wouldSuppressEmit(row, threshold) {

  const composite = Math.abs(Number(row.compositeScore ?? 0));

  if (row.marketRegime !== 'range') return false;

  if (evaluateTradableDay(row).tradable === true) return false;

  return composite < threshold;

}



function evaluateRegimeGateThreshold(rows, predictFn, threshold) {

  const all = { hits: 0, scored: 0, suppressed: 0, suppressedWouldHit: 0 };

  const tradable = { hits: 0, scored: 0 };

  for (const row of rows) {

    const pred = predictFn(row);

    if (!pred || pred === 'neutral') continue;

    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;

    const hit = hitDirection(pred, row.actualDirT3);

    if (wouldSuppressEmit(row, threshold)) {

      all.suppressed += 1;

      if (hit) all.suppressedWouldHit += 1;

      continue;

    }

    all.scored += 1;

    if (hit) all.hits += 1;

    if (isTradableDay(row)) {

      tradable.scored += 1;

      if (hit) tradable.hits += 1;

    }

  }

  const pct = (h, s) => (s ? +((h / s) * 100).toFixed(2) : null);

  return {

    threshold,

    all: {

      ...all,

      hitRatePct: pct(all.hits, all.scored),

      formatted: fmtHitRateWithSample(all.hits, all.scored).formatted,

      suppressedFormatted: `${all.suppressed} suppressed (${all.suppressedWouldHit} would-hit)`,

    },

    tradableDaySubset: {

      ...tradable,

      hitRatePct: pct(tradable.hits, tradable.scored),

      formatted: fmtHitRateWithSample(tradable.hits, tradable.scored).formatted,

    },

  };

}



function buildRegimeGateThresholdGrid(rows, predictFn) {

  return GATE_THRESHOLDS.map((threshold) => evaluateRegimeGateThreshold(rows, predictFn, threshold));

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

      rows.push({ ...row, instrumentId: id });

    }

  }

  return rows;

}



async function main() {

  diskCache.init(getDataDir());

  backtest.preloadWalkForwardCaches();

  await historicalContext.ensureFredDailyCache();

  newsTagged.loadNewsTagged({ force: true });

  crossMarket.resetIntlSeriesCache();



  const weightsMeta = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8'));

  const rows = await collectRows(['au', 'ag'], FROM, TO);

  const payload = computeTradableDayKpiReport(rows, (row) => predictLogistic(null, row), {
    window: { from: FROM, to: TO },
    model: weightsMeta.version || 'v1.34.8 production logistic',
    baseline: BASELINE,
  });



  payload.regimeGateThresholdGrid = buildRegimeGateThresholdGrid(
    rows,
    (row) => predictLogistic(null, row),
  );

  payload.regimeGateThresholdGridNote =

    'Simulates range+non-tradable weak-signal suppress on logistic T+3; suppressed rows excluded from scored.';



  const outPath = path.join(__dirname, '..', '_probe-tradable-day-kpi-out.json');

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(JSON.stringify(payload, null, 2));

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


