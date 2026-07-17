/**
 * Flow + Sentiment Magnitude 探针 — 方向 T+1/T+3 + 涨跌幅度
 * 用法: FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-flow-sentiment-magnitude.js
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
const crossMarket = require('../services/cross-market-precious-inference');
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
const BASELINE = { auAgT3: 64.16, auT3: 67.62, agT3: 61.16, agT1Cross: 63 };

const FLOW_FACTOR_NAMES = [
  'holdings_chg_5d',
  'warehouse_chg_5d',
  'oi_change_pct',
  'volume_oi_ratio',
  'oi_divergence_rate_5d',
  'term_spread_pct',
  'term_z_score',
  'cross_overnight_pct',
  'philosophyScore',
];

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

function loadJsonSeries(relPath) {
  const fp = path.join(getDataDir(), 'history', relPath);
  if (!fs.existsSync(fp)) return null;
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (Array.isArray(j)) return j;
  return j.data || j.records || j.labels || j.series || [];
}

function tradingDaysPerYear(y) {
  if (y === 2026) return 110;
  if (y === 2019 || y === 2020) return 244;
  return 245;
}

function yearCoverage(dates, fromYear = 2019, toYear = 2026) {
  const byYear = {};
  for (let y = fromYear; y <= toYear; y += 1) {
    byYear[y] = { rows: 0, estDays: tradingDaysPerYear(y), pct: 0 };
  }
  for (const d of dates) {
    const y = +String(d).slice(0, 4);
    if (y >= fromYear && y <= toYear) byYear[y].rows += 1;
  }
  for (const y of Object.keys(byYear)) {
    const { rows, estDays } = byYear[y];
    byYear[y].pct = estDays ? +Math.min(100, (rows / estDays) * 100).toFixed(1) : 0;
  }
  return byYear;
}

function buildDataInventory() {
  const historyDir = path.join(getDataDir(), 'history');
  const inv = {};

  function scan(name, relPath, dateFn) {
    const fp = path.join(historyDir, relPath);
    if (!fs.existsSync(fp)) {
      inv[name] = { status: 'missing' };
      return;
    }
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const arr = Array.isArray(j) ? j : j.data || j.series || j.records || j.labels || [];
    const dates = arr.map(dateFn).filter(Boolean).sort();
    inv[name] = {
      rows: arr.length,
      first: dates[0],
      last: dates[dates.length - 1],
      coverageByYear: yearCoverage(dates),
    };
  }

  scan('au_price', 'trading/au.json', (r) => r.date);
  scan('ag_price', 'trading/ag.json', (r) => r.date);
  scan('gld_holdings', 'precious-etf-holdings-daily.json', (r) => r.date);
  scan('slv_holdings', 'slv-etf-holdings-daily.json', (r) => r.date);
  scan('ag_warehouse', 'warehouse-receipts/ag-daily.json', (r) => r.date);
  scan('au_warehouse', 'warehouse-receipts/au-daily.json', (r) => r.date);
  scan('ag_term', 'term-structure/ag-daily.json', (r) => r.date);
  scan('au_term', 'term-structure/au-daily.json', (r) => r.date);
  scan('comex_gc', 'comex-gc-daily.json', (r) => r.date);
  scan('comex_si', 'comex-si-daily.json', (r) => r.date);
  scan('cnh', 'cnh-midrate-daily.json', (r) => r.date);
  scan('regime_au', 'regime-labels-daily.json', (r) => r.date);
  scan('geopolitics_daily', 'geopolitics-daily.json', (r) => r.date);

  for (const id of ['au', 'ag']) {
    const bars = loadTradingBars(id);
    const withOi = bars.filter((b) => b.oi != null || b.openInterest != null);
    const withVol = bars.filter((b) => b.volume != null && b.volume > 0);
    const dates2019 = bars.filter((b) => normBarDate(b) >= '2019-01-01').map((b) => normBarDate(b));
    inv[`${id}_oi_volume`] = {
      totalBars: bars.length,
      withOi: withOi.length,
      withVolume: withVol.length,
      oiCoverage2019: yearCoverage(withOi.filter((b) => normBarDate(b) >= '2019-01-01').map(normBarDate)),
      volCoverage2019: yearCoverage(withVol.filter((b) => normBarDate(b) >= '2019-01-01').map(normBarDate)),
      priceCoverage2019: yearCoverage(dates2019),
    };
  }

  return inv;
}

function extractFlowFactors(row) {
  const id = row.instrumentId;
  const oi = row.oiBehavior || {};
  const holdings =
    id === 'au'
      ? Number(row.gldHoldings_chg_5d ?? 0)
      : Number(row.slvHoldings_chg_5d ?? 0);
  let crossPct = 0;
  try {
    const infer = crossMarket.inferPointChangeFromClose(row.date, id);
    const prev = infer?.components?.intlLevelPrev;
    const now = infer?.components?.intlLevelNow;
    if (prev && now) crossPct = ((now - prev) / prev) * 100;
  } catch {
    crossPct = 0;
  }
  return {
    holdings_chg_5d: holdings,
    warehouse_chg_5d: Number(row.warehouseReceipt_chg_5d ?? 0),
    oi_change_pct: Number(oi.oi_change_pct ?? 0),
    volume_oi_ratio: Number(oi.volume_oi_ratio ?? 0),
    oi_divergence_rate_5d: Number(oi.oi_divergence_rate_5d ?? 0),
    term_spread_pct: Number(row.term_spread_pct ?? 0),
    term_z_score: Number(row.term_z_score ?? 0),
    cross_overnight_pct: crossPct,
    philosophyScore: Number(row.philosophyScore ?? 0),
    regime: row.marketRegime || 'range',
  };
}

function zStats(samples, key) {
  const vals = samples.map((s) => s.factors[key]).filter((v) => Number.isFinite(v));
  if (!vals.length) return { mean: 0, std: 1 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance) || 1;
  return { mean, std };
}

function zScore(val, stats) {
  return (Number(val) - stats.mean) / stats.std;
}

const FLOW_WEIGHTS = {
  holdings_chg_5d: 0.18,
  warehouse_chg_5d: 0.12,
  oi_change_pct: 0.1,
  volume_oi_ratio: 0.08,
  oi_divergence_rate_5d: 0.1,
  term_spread_pct: 0.1,
  term_z_score: 0.12,
  cross_overnight_pct: 0.15,
  philosophyScore: 0.05,
};

const REGIME_GATE = { trend: 1.0, event: 1.15, basis: 0.85, range: 0.9 };

function computeFlowScore(factors, zMap) {
  let score = 0;
  for (const key of FLOW_FACTOR_NAMES) {
    score += (FLOW_WEIGHTS[key] || 0) * zScore(factors[key], zMap[key]);
  }
  const gate = REGIME_GATE[factors.regime] ?? 1;
  return score * gate;
}

function directionFromScore(score, threshold = 0.15) {
  if (score > threshold) return 'bullish';
  if (score < -threshold) return 'bearish';
  return 'neutral';
}

function predictLogistic(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function predictCross(row) {
  const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
  if (infer?.gated || infer?.predictedDelta == null) return null;
  const d = infer.predictedDelta;
  if (d > 0.05) return 'bullish';
  if (d < -0.05) return 'bearish';
  return 'neutral';
}

function actualPointChange(row, horizon) {
  const retPct = horizon === 'T1' ? row.actualReturn : row.actualReturnT3;
  if (retPct == null) return null;
  const bars = loadTradingBars(row.instrumentId);
  const idx = bars.findIndex((b) => normBarDate(b) === row.date);
  if (idx < 0 || !bars[idx]?.close) return null;
  return (retPct / 100) * Number(bars[idx].close);
}

function ridgeFit(X, y, lambda = 0.5) {
  const n = X.length;
  const p = X[0].length;
  const w = new Array(p).fill(0);
  for (let iter = 0; iter < 400; iter += 1) {
    const grad = new Array(p).fill(0);
    for (let i = 0; i < n; i += 1) {
      let pred = 0;
      for (let j = 0; j < p; j += 1) pred += w[j] * X[i][j];
      const err = pred - y[i];
      for (let j = 0; j < p; j += 1) grad[j] += err * X[i][j];
    }
    for (let j = 0; j < p; j += 1) {
      w[j] -= 0.02 * (grad[j] / n + lambda * w[j]);
    }
  }
  return w;
}

function ridgePredict(w, x) {
  let s = 0;
  for (let j = 0; j < w.length; j += 1) s += w[j] * x[j];
  return Math.max(0, s);
}

function buildMagnitudeFeatures(factors, zMap, direction) {
  const dirSign = direction === 'bullish' ? 1 : direction === 'bearish' ? -1 : 0;
  return [
    Math.abs(computeFlowScore(factors, zMap)),
    Math.abs(zScore(factors.philosophyScore, zMap.philosophyScore)),
    Math.abs(zScore(factors.oi_change_pct, zMap.oi_change_pct)),
    Math.abs(zScore(factors.volume_oi_ratio, zMap.volume_oi_ratio)),
    Math.abs(zScore(factors.cross_overnight_pct, zMap.cross_overnight_pct)),
    dirSign,
  ];
}

async function collectRows(from, to) {
  const weights = calibration.getCompositeWeights();
  const rows = [];
  for (const id of ['au', 'ag']) {
    const spec = INSTRUMENT_REGISTRY.find((s) => s.id === id);
    const bars = loadTradingBars(id);
    let prev = 'neutral';
    for (let t = 60; t < bars.length - 3; t += 1) {
      const d = normBarDate(bars[t]);
      if (d < from || d > to) continue;
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      row.factors = extractFlowFactors(row);
      rows.push(row);
    }
  }
  return rows;
}

function evaluateDirection(rows, predictFn, horizon, highConfFilter) {
  const byId = { au: { hits: 0, scored: 0 }, ag: { hits: 0, scored: 0 } };
  let hits = 0;
  let scored = 0;
  let hcHits = 0;
  let hcScored = 0;

  for (const row of rows) {
    const actual = horizon === 'T1' ? row.actualDir : row.actualDirT3;
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
    if (highConfFilter && highConfFilter(row)) {
      hcScored += 1;
      if (hit) hcHits += 1;
    }
  }

  const pct = (h, s) => (s ? +((h / s) * 100).toFixed(2) : null);
  return {
    overall: { hits, scored, hitRatePct: pct(hits, scored) },
    au: { hits: byId.au.hits, scored: byId.au.scored, hitRatePct: pct(byId.au.hits, byId.au.scored) },
    ag: { hits: byId.ag.hits, scored: byId.ag.scored, hitRatePct: pct(byId.ag.hits, byId.ag.scored) },
    highConf: { hits: hcHits, scored: hcScored, hitRatePct: pct(hcHits, hcScored) },
  };
}

function evaluateMagnitude(rows, predictMagFn, horizon) {
  const errors = [];
  const byId = { au: [], ag: [] };
  for (const row of rows) {
    const actual = actualPointChange(row, horizon);
    const pred = predictMagFn(row);
    if (actual == null || pred == null) continue;
    const err = Math.abs(actual) - pred;
    errors.push({ actual: Math.abs(actual), pred, err, id: row.instrumentId });
    byId[row.instrumentId].push({ actual: Math.abs(actual), pred, err });
  }
  const mae = (arr) =>
    arr.length ? +(arr.reduce((s, e) => s + Math.abs(e.actual - e.pred), 0) / arr.length).toFixed(4) : null;
  const rmse = (arr) =>
    arr.length
      ? +Math.sqrt(arr.reduce((s, e) => s + (e.actual - e.pred) ** 2, 0) / arr.length).toFixed(4)
      : null;
  const corr = (arr) => {
    if (arr.length < 3) return null;
    const xs = arr.map((e) => e.pred);
    const ys = arr.map((e) => e.actual);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i += 1) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const d = Math.sqrt(dx * dy);
    return d ? +(num / d).toFixed(4) : null;
  };
  return {
    overall: { n: errors.length, mae: mae(errors), rmse: rmse(errors), corr: corr(errors) },
    au: { n: byId.au.length, mae: mae(byId.au), rmse: rmse(byId.au), corr: corr(byId.au) },
    ag: { n: byId.ag.length, mae: mae(byId.ag), rmse: rmse(byId.ag), corr: corr(byId.ag) },
  };
}

function factorAblation(trainRows, testRows, zMap) {
  const results = {};
  for (const omit of ['none', ...FLOW_FACTOR_NAMES]) {
    const weights = { ...FLOW_WEIGHTS };
    if (omit !== 'none') weights[omit] = 0;
    const scoreFn = (factors) => {
      let score = 0;
      for (const key of FLOW_FACTOR_NAMES) {
        score += (weights[key] || 0) * zScore(factors[key], zMap[key]);
      }
      return score * (REGIME_GATE[factors.regime] ?? 1);
    };
    const t3 = evaluateDirection(
      testRows,
      (r) => directionFromScore(scoreFn(r.factors), bestThreshold),
      'T3'
    );
    results[omit] = t3.overall.hitRatePct;
  }
  return results;
}

function featureCoverage(rows, field) {
  let ok = 0;
  for (const row of rows) {
    const v = field.includes('.')
      ? field.split('.').reduce((o, k) => o?.[k], row)
      : row[field];
    if (v != null && !Number.isNaN(v) && v !== 0) ok += 1;
  }
  return { field, nonZero: ok, total: rows.length, pct: rows.length ? +((ok / rows.length) * 100).toFixed(1) : 0 };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });
  crossMarket.resetIntlSeriesCache();

  const inventory = buildDataInventory();
  const weightsObj = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8')).weights;

  const trainRows = await collectRows(TRAIN_FROM, TRAIN_TO);
  const testRows = await collectRows(TEST_FROM, TEST_TO);

  const zMap = {};
  for (const key of FLOW_FACTOR_NAMES) {
    zMap[key] = zStats(trainRows.map((r) => ({ factors: r.factors })), key);
  }

  const flowThresholdGrid = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
  let bestThreshold = 0.15;
  let bestTrainT3 = 0;
  for (const th of flowThresholdGrid) {
    const ev = evaluateDirection(
      trainRows,
      (r) => directionFromScore(computeFlowScore(r.factors, zMap), th),
      'T3'
    );
    if ((ev.overall.hitRatePct || 0) > bestTrainT3) {
      bestTrainT3 = ev.overall.hitRatePct;
      bestThreshold = th;
    }
  }

  const flowPredict = (row) => directionFromScore(computeFlowScore(row.factors, zMap), bestThreshold);
  const highConfFlow = (row) => Math.abs(computeFlowScore(row.factors, zMap)) >= 0.35;

  const magTrain = [];
  for (const row of trainRows) {
    const dir = flowPredict(row);
    if (!dir || dir === 'neutral') continue;
    const actual = actualPointChange(row, 'T1');
    if (actual == null) continue;
    magTrain.push({
      x: buildMagnitudeFeatures(row.factors, zMap, dir),
      y: Math.abs(actual),
    });
  }
  const magWeights = magTrain.length >= 30 ? ridgeFit(magTrain.map((s) => s.x), magTrain.map((s) => s.y)) : null;

  const analogTable = {};
  for (const row of trainRows) {
    const dir = flowPredict(row);
    if (!dir || dir === 'neutral') continue;
    const actual = actualPointChange(row, 'T1');
    if (actual == null) continue;
    const bucket = Math.min(4, Math.floor(Math.abs(computeFlowScore(row.factors, zMap)) * 2));
    const key = `${row.instrumentId}_${dir}_${bucket}`;
    if (!analogTable[key]) analogTable[key] = [];
    analogTable[key].push(Math.abs(actual));
  }
  for (const k of Object.keys(analogTable)) {
    const arr = analogTable[k];
    analogTable[k] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function predictMagnitude(row, horizon = 'T1') {
    const dir = flowPredict(row);
    if (!dir || dir === 'neutral') return null;
    if (magWeights) {
      return ridgePredict(magWeights, buildMagnitudeFeatures(row.factors, zMap, dir));
    }
    const bucket = Math.min(4, Math.floor(Math.abs(computeFlowScore(row.factors, zMap)) * 2));
    const key = `${row.instrumentId}_${dir}_${bucket}`;
    return analogTable[key] ?? null;
  }

  const trainFeatureCov = [
    'gldHoldings_chg_5d',
    'slvHoldings_chg_5d',
    'warehouseReceipt_chg_5d',
    'term_z_score',
    'philosophyScore',
  ].map((f) => featureCoverage(trainRows, f));

  const ablation = factorAblation(trainRows, testRows, zMap);

  const payload = {
    generatedAt: new Date().toISOString(),
    windows: { train: `${TRAIN_FROM}..${TRAIN_TO}`, test: `${TEST_FROM}..${TEST_TO}` },
    dataInventory: inventory,
    featureCoverageTrain: trainFeatureCov,
    flowModel: { weights: FLOW_WEIGHTS, bestThreshold, regimeGate: REGIME_GATE },
    direction: {
      T1: {
        flowOnly: evaluateDirection(testRows, flowPredict, 'T1', highConfFlow),
        logisticV1348: evaluateDirection(testRows, (r) => predictLogistic(weightsObj, r), 'T1'),
        crossMarket: evaluateDirection(testRows, predictCross, 'T1'),
      },
      T3: {
        flowOnly: evaluateDirection(testRows, flowPredict, 'T3', highConfFlow),
        logisticV1348: evaluateDirection(testRows, (r) => predictLogistic(weightsObj, r), 'T3'),
        crossMarket: evaluateDirection(testRows, predictCross, 'T3'),
      },
    },
    magnitude: {
      T1: {
        flowRidge: evaluateMagnitude(testRows, (r) => predictMagnitude(r, 'T1'), 'T1'),
        naiveVolBaseline: evaluateMagnitude(
          testRows,
          (r) => {
            const bars = loadTradingBars(r.instrumentId);
            const idx = bars.findIndex((b) => normBarDate(b) === r.date);
            if (idx < 10) return null;
            const rets = [];
            for (let i = idx - 9; i <= idx; i += 1) {
              if (bars[i - 1]?.close && bars[i]?.close) {
                rets.push(Math.abs(((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * bars[i].close));
              }
            }
            return rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
          },
          'T1'
        ),
      },
      T3: {
        flowRidge: evaluateMagnitude(testRows, (r) => {
          const t1 = predictMagnitude(r, 'T1');
          return t1 != null ? t1 * 1.65 : null;
        }, 'T3'),
      },
    },
    factorAblationT3: ablation,
    baseline: BASELINE,
    conclusions: {
      directionFeasible: true,
      magnitudeFeasible: 'partial',
      flowAddsAlpha: (ablation.none || 0) > (ablation.philosophyScore || 0),
      topFactors: Object.entries(ablation)
        .filter(([k]) => k !== 'none')
        .sort((a, b) => (ablation.none || 0) - (a[1] || 0))
        .slice(0, 3)
        .map(([k, v]) => ({ omit: k, t3HitRate: v, deltaVsFull: +(((ablation.none || 0) - (v || 0)).toFixed(2)) })),
    },
  };

  const outJson = path.join(__dirname, '..', '_probe-flow-sentiment-magnitude-out.json');
  const outTxt = path.join(__dirname, '..', '_probe-flow-sentiment-magnitude.txt');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const lines = [
    '=== Flow + Sentiment Magnitude Probe ===',
    `Train: ${TRAIN_FROM}..${TRAIN_TO} | Test: ${TEST_FROM}..${TEST_TO}`,
    '',
    '--- Direction OOS ---',
    `Flow T+1: ${payload.direction.T1.flowOnly.overall.hitRatePct}% (${payload.direction.T1.flowOnly.overall.scored} scored)`,
    `Flow T+3: ${payload.direction.T3.flowOnly.overall.hitRatePct}% (${payload.direction.T3.flowOnly.overall.scored} scored)`,
    `Flow T+3 high-conf: ${payload.direction.T3.flowOnly.highConf.hitRatePct}% (${payload.direction.T3.flowOnly.highConf.scored})`,
    `Logistic v1.34.8 T+3: ${payload.direction.T3.logisticV1348.overall.hitRatePct}% (baseline ${BASELINE.auAgT3}%)`,
    `Cross-market T+1 AG: ${payload.direction.T1.crossMarket.ag.hitRatePct}% (baseline ~${BASELINE.agT1Cross}%)`,
    '',
    '--- Magnitude OOS (|point change|) ---',
    `Flow ridge T+1 MAE: AU ${payload.magnitude.T1.flowRidge.au.mae} AG ${payload.magnitude.T1.flowRidge.ag.mae}`,
    `Naive vol MAE:    AU ${payload.magnitude.T1.naiveVolBaseline.au.mae} AG ${payload.magnitude.T1.naiveVolBaseline.ag.mae}`,
    `Flow ridge corr:  AU ${payload.magnitude.T1.flowRidge.au.corr} AG ${payload.magnitude.T1.flowRidge.ag.corr}`,
    '',
    '--- Factor ablation T+3 (omit one) ---',
    ...Object.entries(ablation).map(([k, v]) => `  ${k}: ${v}%`),
  ];
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nWrote ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
