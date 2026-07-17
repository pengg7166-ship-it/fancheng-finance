/**
 * Cross-vol hybrid magnitude probe — cross point + vol ±1σ band
 * 用法: FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-cross-vol-magnitude.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const crossMarket = require('../services/cross-market-precious-inference');
const crossVol = require('../services/cross-vol-magnitude');
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

function actualPointChange(row, bars) {
  const retPct = row.actualReturn;
  if (retPct == null) return null;
  const idx = bars.findIndex((b) => normBarDate(b) === row.date);
  if (idx < 0 || !bars[idx]?.close) return null;
  return (retPct / 100) * Number(bars[idx].close);
}

function prevClose(row, bars) {
  const idx = row._barIdx;
  if (idx <= 0) return null;
  return bars[idx - 1]?.close;
}

function actualClose(row, bars) {
  const idx = row._barIdx;
  if (idx < 0) return null;
  return bars[idx]?.close;
}

function mae(arr) {
  return arr.length ? +(arr.reduce((s, e) => s + Math.abs(e.actual - e.pred), 0) / arr.length).toFixed(4) : null;
}

function packErrors(errors) {
  return {
    n: errors.length,
    mae: mae(errors),
  };
}

async function collectRows(from, to) {
  const weights = calibration.getCompositeWeights();
  const rows = [];
  const barsCache = { au: loadTradingBars('au'), ag: loadTradingBars('ag') };
  for (const id of ['au', 'ag']) {
    const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
    const bars = barsCache[id];
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 3; t += 1) {
      const d = normBarDate(bars[t]);
      if (d < from || d > to) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      row._barIdx = t;
      row._bars = bars;
      rows.push(row);
    }
  }
  return rows;
}

function evaluateCrossOnly(rows) {
  const errors = { au: [], ag: [] };
  for (const row of rows) {
    const actual = actualPointChange(row, row._bars);
    if (actual == null) continue;
    try {
      const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
      if (infer?.gated || infer?.predictedDelta == null) continue;
      errors[row.instrumentId].push({ actual, pred: infer.predictedDelta });
    } catch {
      /* skip */
    }
  }
  return { au: packErrors(errors.au), ag: packErrors(errors.ag) };
}

function evaluateVolOnly(rows) {
  const errors = { au: [], ag: [] };
  let within = 0;
  let bandScored = 0;
  for (const row of rows) {
    const actualAbs = actualPointChange(row, row._bars);
    const actual = actualPointChange(row, row._bars);
    if (actualAbs == null) continue;
    const vol = crossVol.computeRealizedVol(row._bars, row._barIdx);
    if (vol == null) continue;
    errors[row.instrumentId].push({ actual: Math.abs(actualAbs), pred: vol });
    bandScored += 1;
    if (Math.abs(actual) <= vol) within += 1;
  }
  return {
    au: packErrors(errors.au),
    ag: packErrors(errors.ag),
    within1Sigma: {
      within,
      scored: bandScored,
      pct: bandScored ? +((within / bandScored) * 100).toFixed(2) : null,
    },
  };
}

function evaluateHybrid(rows) {
  const signedErrors = { au: [], ag: [] };
  const absErrors = { au: [], ag: [] };
  let withinPoint = 0;
  let pointScored = 0;
  let withinPrice = 0;
  let priceScored = 0;

  for (const row of rows) {
    const actual = actualPointChange(row, row._bars);
    if (actual == null) continue;
    const prev = prevClose(row, row._bars);
    const todayClose = actualClose(row, row._bars);
    const pred = crossVol.predictMagnitude({
      instrumentId: row.instrumentId,
      close: prev,
      asOfDate: row.date,
      priceHistory: row._bars,
      marketRegime: row.marketRegime,
    });

    if (pred.pointDelta != null) {
      signedErrors[row.instrumentId].push({ actual, pred: pred.pointDelta });
      absErrors[row.instrumentId].push({ actual: Math.abs(actual), pred: Math.abs(pred.pointDelta) });
    }

    if (pred.sigma != null) {
      pointScored += 1;
      const center = pred.pointDelta != null ? pred.pointDelta : 0;
      if (actual >= center - pred.sigma && actual <= center + pred.sigma) withinPoint += 1;
    }

    if (pred.bandLow != null && pred.bandHigh != null && todayClose != null) {
      priceScored += 1;
      if (todayClose >= pred.bandLow && todayClose <= pred.bandHigh) withinPrice += 1;
    }
  }

  return {
    signed: { au: packErrors(signedErrors.au), ag: packErrors(signedErrors.ag) },
    absMag: { au: packErrors(absErrors.au), ag: packErrors(absErrors.ag) },
    within1SigmaPoint: {
      within: withinPoint,
      scored: pointScored,
      pct: pointScored ? +((withinPoint / pointScored) * 100).toFixed(2) : null,
    },
    within1SigmaPrice: {
      within: withinPrice,
      scored: priceScored,
      pct: priceScored ? +((withinPrice / priceScored) * 100).toFixed(2) : null,
    },
  };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });
  crossMarket.resetIntlSeriesCache();

  console.log('Collecting rows...');
  const testRows = await collectRows(TEST_FROM, TEST_TO);
  console.log(`Test rows: ${testRows.length}`);

  const crossOnly = evaluateCrossOnly(testRows);
  const volOnly = evaluateVolOnly(testRows);
  const hybrid = evaluateHybrid(testRows);

  const payload = {
    generatedAt: new Date().toISOString(),
    windows: { train: `${TRAIN_FROM}..${TRAIN_TO}`, test: `${TEST_FROM}..${TEST_TO}` },
    volBaseline: { auMae: 4.37, agMae: 129.13, within1SigmaPct: 55.8 },
    crossOnly: {
      label: 'cross point signed T+1 MAE',
      au: crossOnly.au,
      ag: crossOnly.ag,
    },
    volOnly: {
      label: 'vol-only 20d mean_abs |Δ| MAE',
      au: volOnly.au,
      ag: volOnly.ag,
      within1Sigma: volOnly.within1Sigma,
    },
    hybrid: {
      label: 'cross point + vol ±1σ band',
      signedMae: hybrid.signed,
      absMagMae: hybrid.absMag,
      within1SigmaPoint: hybrid.within1SigmaPoint,
      within1SigmaPrice: hybrid.within1SigmaPrice,
    },
    targets: {
      auMaeBeatVol: 4.37,
      within1SigmaPct: 59,
    },
    beatVolAu:
      hybrid.signed.au.mae != null && hybrid.signed.au.mae < 4.37,
    beatWithin1Sigma:
      hybrid.within1SigmaPoint.pct != null && hybrid.within1SigmaPoint.pct > 59,
  };

  const outJson = path.join(__dirname, '..', '_probe-cross-vol-magnitude-out.json');
  const outTxt = path.join(__dirname, '..', '_probe-cross-vol-magnitude.txt');

  const lines = [
    '=== Cross-Vol Hybrid Magnitude Probe ===',
    `Test: ${TEST_FROM}..${TEST_TO} · rows ${testRows.length}`,
    '',
    '--- OOS T+1 signed point MAE ---',
    `Cross-only:  AU ${crossOnly.au.mae} (${crossOnly.au.n}) · AG ${crossOnly.ag.mae} (${crossOnly.ag.n})`,
    `Hybrid pt:   AU ${hybrid.signed.au.mae} (${hybrid.signed.au.n}) · AG ${hybrid.signed.ag.mae} (${hybrid.signed.ag.n})`,
  '',
    '--- OOS T+1 |Δ| MAE (vol baseline) ---',
    `Vol-only:    AU ${volOnly.au.mae} (${volOnly.au.n}) · AG ${volOnly.ag.mae} (${volOnly.ag.n})`,
    `Hybrid |pt|: AU ${hybrid.absMag.au.mae} (${hybrid.absMag.au.n}) · AG ${hybrid.absMag.ag.mae} (${hybrid.absMag.ag.n})`,
    '',
    '--- Within ±1σ (点位变动) ---',
    `Vol-only:    ${volOnly.within1Sigma.pct}% (${volOnly.within1Sigma.within}/${volOnly.within1Sigma.scored})`,
    `Hybrid pt:   ${hybrid.within1SigmaPoint.pct}% (${hybrid.within1SigmaPoint.within}/${hybrid.within1SigmaPoint.scored})`,
    '',
    '--- Within ±1σ (价格带 UI) ---',
    `Hybrid band: ${hybrid.within1SigmaPrice.pct}% (${hybrid.within1SigmaPrice.within}/${hybrid.within1SigmaPrice.scored})`,
    `Prior vol-only within1σ: ~55.8% · target >59%`,
    '',
    `Beat vol AU MAE (<4.37): ${payload.beatVolAu ? 'YES' : 'NO'}`,
    `Beat within1σ (>59%): ${payload.beatWithin1Sigma ? 'YES' : 'NO'}`,
  ];

  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nWrote ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
