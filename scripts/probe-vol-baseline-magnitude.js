/**
 * Vol-baseline magnitude probe — realized vol × flow/cross/regime multipliers
 * 用法: FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=8192 node scripts/probe-vol-baseline-magnitude.js
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

const VOL_WINDOWS = [5, 10, 20];
const VOL_MODES = ['mean_abs', 'std'];
const ALPHA_GRID = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const BETA_GRID = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const HORIZON_SCALE = { T1: 1, T3: 1.65 };

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

function dirSign(dir) {
  if (dir === 'bullish') return 1;
  if (dir === 'bearish') return -1;
  return 0;
}

function computeRealizedVol(bars, idx, window, mode = 'mean_abs') {
  if (idx < window) return null;
  const rets = [];
  for (let i = idx - window + 1; i <= idx; i += 1) {
    const prev = bars[i - 1]?.close;
    const now = bars[i]?.close;
    if (!prev || !now) continue;
    rets.push(((now - prev) / prev) * now);
  }
  if (rets.length < Math.max(3, window - 2)) return null;
  if (mode === 'std') {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return Math.sqrt(variance);
  }
  return rets.reduce((a, b) => a + Math.abs(b), 0) / rets.length;
}

function actualPointChange(row, horizon, bars) {
  const retPct = horizon === 'T1' ? row.actualReturn : row.actualReturnT3;
  if (retPct == null) return null;
  const idx = bars.findIndex((b) => normBarDate(b) === row.date);
  if (idx < 0 || !bars[idx]?.close) return null;
  return (retPct / 100) * Number(bars[idx].close);
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
      row.factors = extractFlowFactors(row);
      row._barIdx = t;
      row._bars = bars;
      rows.push(row);
    }
  }
  return rows;
}

function enrichRows(rows, zMap, flowThreshold, weightsObj) {
  for (const row of rows) {
    const factors = row.factors;
    const flowScore = computeFlowScore(factors, zMap);
    row.flowScore = flowScore;
    row.flowDir = directionFromScore(flowScore, flowThreshold);
    row.flowZAbs = Math.abs(flowScore);
    row.crossZAbs = Math.abs(zScore(factors.cross_overnight_pct, zMap.cross_overnight_pct));
    row.crossPctAbs = Math.abs(factors.cross_overnight_pct);
    row.regimeMult = REGIME_GATE[factors.regime] ?? 1;

    const x = rowToFeatureVector(row);
    let z = Number(weightsObj.bias ?? 0);
    for (let i = 0; i < x.length; i += 1) {
      z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
    }
    row.logisticDir = directionFromPUp(sigmoid(z));

    let crossDir = 'neutral';
    try {
      const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
      if (infer?.predictedDelta != null && !infer?.gated) {
        const d = infer.predictedDelta;
        if (d > 0.05) crossDir = 'bullish';
        else if (d < -0.05) crossDir = 'bearish';
        row.crossPredictedDelta = d;
      }
    } catch {
      row.crossPredictedDelta = null;
    }
    row.crossDir = crossDir;

    const votes = [row.flowDir, row.logisticDir, row.crossDir].filter((d) => d !== 'neutral');
    let ens = 'neutral';
    if (votes.length) {
      const bull = votes.filter((d) => d === 'bullish').length;
      const bear = votes.filter((d) => d === 'bearish').length;
      if (bull > bear) ens = 'bullish';
      else if (bear > bull) ens = 'bearish';
    }
    row.ensembleDir = ens;

    for (const w of VOL_WINDOWS) {
      for (const mode of VOL_MODES) {
        row[`vol_${w}d_${mode}`] = computeRealizedVol(row._bars, row._barIdx, w, mode);
      }
    }
  }
  return rows;
}

function predictMag(row, cfg, horizon = 'T1') {
  const volKey = `vol_${cfg.volWindow}d_${cfg.volMode}`;
  const vol = row[volKey];
  if (vol == null) return null;
  const hScale = HORIZON_SCALE[horizon] || 1;
  let mult = 1;
  if (cfg.formula === 'vol_only') {
    mult = 1;
  } else if (cfg.formula === 'vol_flow') {
    mult = 1 + cfg.alpha * row.flowZAbs;
  } else if (cfg.formula === 'vol_flow_cross') {
    mult = 1 + cfg.alpha * row.flowZAbs + cfg.beta * row.crossPctAbs;
  } else if (cfg.formula === 'vol_regime_flow') {
    mult = row.regimeMult * (1 + cfg.alpha * row.flowZAbs);
  }
  return vol * mult * hScale;
}

function predictSignedMag(row, cfg, dirSource, horizon = 'T1') {
  const mag = predictMag(row, cfg, horizon);
  if (mag == null) return null;
  const dir = row[`${dirSource}Dir`] || row.flowDir;
  const sign = dirSign(dir);
  if (!sign) return null;
  return sign * mag;
}

function mae(arr) {
  return arr.length ? +(arr.reduce((s, e) => s + Math.abs(e.actual - e.pred), 0) / arr.length).toFixed(4) : null;
}

function rmse(arr) {
  return arr.length
    ? +Math.sqrt(arr.reduce((s, e) => s + (e.actual - e.pred) ** 2, 0) / arr.length).toFixed(4)
    : null;
}

function corr(arr) {
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
}

function evaluateMag(rows, cfg, horizon, dirSource, absTarget = true, filterFn = null) {
  const errors = { au: [], ag: [], all: [] };
  for (const row of rows) {
    if (filterFn && !filterFn(row)) continue;
    const actualRaw = actualPointChange(row, horizon, row._bars);
    if (actualRaw == null) continue;
    const actual = absTarget ? Math.abs(actualRaw) : actualRaw;
    const pred = absTarget
      ? predictMag(row, cfg, horizon)
      : predictSignedMag(row, cfg, dirSource, horizon);
    if (pred == null) continue;
    const rec = { actual, pred, id: row.instrumentId };
    errors.all.push(rec);
    errors[row.instrumentId].push(rec);
  }
  const pack = (arr) => ({ n: arr.length, mae: mae(arr), rmse: rmse(arr), corr: corr(arr) });
  return { overall: pack(errors.all), au: pack(errors.au), ag: pack(errors.ag) };
}

function evaluateWithin1Sigma(rows, cfg, horizon, dirSource, filterFn = null) {
  let within = 0;
  let scored = 0;
  for (const row of rows) {
    if (filterFn && !filterFn(row)) continue;
    const actualRaw = actualPointChange(row, horizon, row._bars);
    const signedPred = predictSignedMag(row, cfg, dirSource, horizon);
    if (actualRaw == null || signedPred == null) continue;
    const dir = row[`${dirSource}Dir`];
    if (!dir || dir === 'neutral') continue;
    scored += 1;
    const mag = Math.abs(signedPred);
    if (Math.abs(actualRaw) <= mag) within += 1;
  }
  return { within, scored, pct: scored ? +((within / scored) * 100).toFixed(2) : null };
}

function evaluateDirection(rows, dirSource, horizon, filterFn = null) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    if (filterFn && !filterFn(row)) continue;
    const actual = horizon === 'T1' ? row.actualDir : row.actualDirT3;
    const pred = row[`${dirSource}Dir`];
    if (!actual || actual === 'neutral' || !pred || pred === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, actual)) hits += 1;
  }
  return { hits, scored, hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null };
}

function gridSearch(trainRows, horizon, dirSource) {
  let best = null;
  let bestScore = Infinity;
  const formulas = ['vol_only', 'vol_flow', 'vol_flow_cross', 'vol_regime_flow'];
  for (const volWindow of VOL_WINDOWS) {
    for (const volMode of VOL_MODES) {
      for (const formula of formulas) {
        const alphaGrid = formula === 'vol_only' ? [0] : ALPHA_GRID;
        const betaGrid = formula === 'vol_flow_cross' ? BETA_GRID : [0];
        for (const alpha of alphaGrid) {
          for (const beta of betaGrid) {
            const cfg = { volWindow, volMode, formula, alpha, beta };
            const ev = evaluateMag(trainRows, cfg, horizon, dirSource, true);
            const score = (ev.au.mae || 999) + (ev.ag.mae || 999) / 30;
            if (score < bestScore) {
              bestScore = score;
              best = { ...cfg, trainMae: ev };
            }
          }
        }
      }
    }
  }
  return best;
}

function crossMarketPointMae(testRows, horizon) {
  const errors = { au: [], ag: [] };
  for (const row of testRows) {
    const actual = actualPointChange(row, horizon, row._bars);
    if (actual == null) continue;
    try {
      const infer = crossMarket.inferPointChangeFromClose(row.date, row.instrumentId);
      if (infer?.gated || infer?.predictedDelta == null) continue;
      const pred = infer.predictedDelta;
      errors[row.instrumentId].push({ actual, pred });
    } catch {
      /* skip */
    }
  }
  return {
    au: { n: errors.au.length, mae: mae(errors.au), rmse: rmse(errors.au), corr: corr(errors.au) },
    ag: { n: errors.ag.length, mae: mae(errors.ag), rmse: rmse(errors.ag), corr: corr(errors.ag) },
  };
}

async function main() {
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });
  crossMarket.resetIntlSeriesCache();

  const weightsObj = JSON.parse(fs.readFileSync(getDefaultWeightsPath(), 'utf8')).weights;

  console.log('Collecting rows...');
  const trainRows = await collectRows(TRAIN_FROM, TRAIN_TO);
  const testRows = await collectRows(TEST_FROM, TEST_TO);
  console.log(`Train ${trainRows.length} | Test ${testRows.length}`);

  const zMap = {};
  for (const key of FLOW_FACTOR_NAMES) {
    zMap[key] = zStats(trainRows.map((r) => ({ factors: r.factors })), key);
  }

  const flowThresholdGrid = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
  let bestThreshold = 0.15;
  let bestTrainT3 = 0;
  for (const th of flowThresholdGrid) {
    let hits = 0;
    let scored = 0;
    for (const row of trainRows) {
      const actual = row.actualDirT3;
      const pred = directionFromScore(computeFlowScore(row.factors, zMap), th);
      if (!actual || actual === 'neutral' || !pred || pred === 'neutral') continue;
      scored += 1;
      if (hitDirection(pred, actual)) hits += 1;
    }
    const pct = scored ? (hits / scored) * 100 : 0;
    if (pct > bestTrainT3) {
      bestTrainT3 = pct;
      bestThreshold = th;
    }
  }

  enrichRows(trainRows, zMap, bestThreshold, weightsObj);
  enrichRows(testRows, zMap, bestThreshold, weightsObj);

  const highConf = (row) => row.flowZAbs >= 0.35;
  const dirSources = ['flow', 'logistic', 'cross', 'ensemble'];
  const horizons = ['T1', 'T3'];

  const calibrated = {};
  for (const horizon of horizons) {
    calibrated[horizon] = {};
    for (const ds of dirSources) {
      calibrated[horizon][ds] = gridSearch(trainRows, horizon, ds);
    }
  }

  const primaryHorizon = 'T1';
  const primaryDir = 'flow';
  const bestCfg = calibrated[primaryHorizon][primaryDir];

  const modelVariants = {
    vol_only: { ...bestCfg, formula: 'vol_only', alpha: 0, beta: 0 },
    vol_flow: { ...bestCfg, formula: 'vol_flow', beta: 0 },
    vol_flow_cross: { ...bestCfg, formula: 'vol_flow_cross' },
  };

  for (const k of ['vol_flow', 'vol_flow_cross']) {
    const gs = gridSearch(trainRows, primaryHorizon, primaryDir);
    if (modelVariants[k].formula === k) {
      modelVariants[k].alpha = gs.alpha;
      modelVariants[k].beta = gs.beta;
    }
  }
  const gsFlow = gridSearch(trainRows, primaryHorizon, primaryDir);
  modelVariants.vol_flow.alpha = gsFlow.alpha;
  modelVariants.vol_flow_cross.alpha = gsFlow.alpha;
  modelVariants.vol_flow_cross.beta = gsFlow.beta;

  const gsVolOnly = (() => {
    let best = null;
    let bestScore = Infinity;
    for (const volWindow of VOL_WINDOWS) {
      for (const volMode of VOL_MODES) {
        const cfg = { volWindow, volMode, formula: 'vol_only', alpha: 0, beta: 0 };
        const ev = evaluateMag(trainRows, cfg, primaryHorizon, primaryDir, true);
        const score = (ev.au.mae || 999) + (ev.ag.mae || 999) / 30;
        if (score < bestScore) {
          bestScore = score;
          best = cfg;
        }
      }
    }
    return best;
  })();
  modelVariants.vol_only = gsVolOnly;

  const gsFlowOnly = (() => {
    let best = null;
    let bestScore = Infinity;
    for (const volWindow of VOL_WINDOWS) {
      for (const volMode of VOL_MODES) {
        for (const alpha of ALPHA_GRID) {
          const cfg = { volWindow, volMode, formula: 'vol_flow', alpha, beta: 0 };
          const ev = evaluateMag(trainRows, cfg, primaryHorizon, primaryDir, true);
          const score = (ev.au.mae || 999) + (ev.ag.mae || 999) / 30;
          if (score < bestScore) {
            bestScore = score;
            best = cfg;
          }
        }
      }
    }
    return best;
  })();
  modelVariants.vol_flow = gsFlowOnly;

  const gsFlowCross = (() => {
    let best = null;
    let bestScore = Infinity;
    for (const volWindow of VOL_WINDOWS) {
      for (const volMode of VOL_MODES) {
        for (const alpha of ALPHA_GRID) {
          for (const beta of BETA_GRID) {
            const cfg = { volWindow, volMode, formula: 'vol_flow_cross', alpha, beta };
            const ev = evaluateMag(trainRows, cfg, primaryHorizon, primaryDir, true);
            const score = (ev.au.mae || 999) + (ev.ag.mae || 999) / 30;
            if (score < bestScore) {
              bestScore = score;
              best = cfg;
            }
          }
        }
      }
    }
    return best;
  })();
  modelVariants.vol_flow_cross = gsFlowCross;

  const oosResults = {};
  for (const [name, cfg] of Object.entries(modelVariants)) {
    oosResults[name] = {
      config: cfg,
      T1: {
        absMag: evaluateMag(testRows, cfg, 'T1', primaryDir, true),
        signedMag: evaluateMag(testRows, cfg, 'T1', primaryDir, false),
        within1Sigma: evaluateWithin1Sigma(testRows, cfg, 'T1', primaryDir),
        within1SigmaHC: evaluateWithin1Sigma(testRows, cfg, 'T1', primaryDir, highConf),
        highConf: evaluateMag(testRows, cfg, 'T1', primaryDir, true, highConf),
      },
      T3: {
        absMag: evaluateMag(testRows, cfg, 'T3', primaryDir, true),
        signedMag: evaluateMag(testRows, cfg, 'T3', primaryDir, false),
        within1Sigma: evaluateWithin1Sigma(testRows, cfg, 'T3', primaryDir),
        within1SigmaHC: evaluateWithin1Sigma(testRows, cfg, 'T3', primaryDir, highConf),
        highConf: evaluateMag(testRows, cfg, 'T3', primaryDir, true, highConf),
      },
    };
  }

  const bestOverall = gsFlowCross;
  const crossPointMae = crossMarketPointMae(testRows, 'T1');

  const directionOos = {};
  for (const ds of dirSources) {
    directionOos[ds] = {
      T1: evaluateDirection(testRows, ds, 'T1'),
      T3: evaluateDirection(testRows, ds, 'T3'),
      T3highConf: evaluateDirection(testRows, ds, 'T3', highConf),
    };
  }

  const promoteAuMae = oosResults.vol_flow_cross.T1.absMag.au.mae;
  const beatVolOnly =
    promoteAuMae != null &&
    oosResults.vol_only.T1.absMag.au.mae != null &&
    promoteAuMae < oosResults.vol_only.T1.absMag.au.mae;
  const promoteGate = promoteAuMae != null && promoteAuMae < 5 && beatVolOnly;

  const payload = {
    generatedAt: new Date().toISOString(),
    windows: { train: `${TRAIN_FROM}..${TRAIN_TO}`, test: `${TEST_FROM}..${TEST_TO}` },
    flowThreshold: bestThreshold,
    bestVolWindow: bestOverall.volWindow,
    bestVolMode: bestOverall.volMode,
    bestAlpha: bestOverall.alpha,
    bestBeta: bestOverall.beta,
    bestFormula: bestOverall.formula,
    modelVariants: oosResults,
    calibratedPerHorizonDir: calibrated,
    directionOos,
    crossMarketPointMae: crossPointMae,
    crossMarketBaseline: { auMae: 3.7434, note: 'docs/cross-market-au-ag-probe.json T+1 signed' },
    promoteGate: {
      auMaeThreshold: 5,
      beatVolOnly,
      promote: promoteGate,
      reason: promoteGate
        ? 'AU OOS MAE < 5 and beats vol-only'
        : `AU OOS MAE ${promoteAuMae} — ${beatVolOnly ? 'beats vol-only but MAE≥5' : 'does not beat vol-only'}`,
    },
    formula: `mag = realized_vol_${bestOverall.volWindow}d_${bestOverall.volMode} × (1 + α×|flow_z| + β×|cross_overnight_pct|) × horizon_scale`,
    signedFormula: `signed_mag = sign(direction) × mag`,
  };

  const outJson = path.join(__dirname, '..', '_probe-vol-baseline-magnitude-out.json');
  const outTxt = path.join(__dirname, '..', '_probe-vol-baseline-magnitude.txt');
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2));

  const t1 = oosResults;
  const lines = [
    '=== Vol-Baseline Magnitude Probe ===',
    `Train: ${TRAIN_FROM}..${TRAIN_TO} | Test: ${TEST_FROM}..${TEST_TO}`,
    `Best vol: ${bestOverall.volWindow}d ${bestOverall.volMode} | α=${bestOverall.alpha} β=${bestOverall.beta} | ${bestOverall.formula}`,
    '',
    '--- OOS T+1 |Δ| MAE (元) ---',
    `                    AU MAE    AG MAE    AU corr   AG corr   within1σ`,
    `Vol-only:           ${t1.vol_only.T1.absMag.au.mae}     ${t1.vol_only.T1.absMag.ag.mae}     ${t1.vol_only.T1.absMag.au.corr}    ${t1.vol_only.T1.absMag.ag.corr}    ${t1.vol_only.T1.within1Sigma.pct}%`,
    `Vol×flow:           ${t1.vol_flow.T1.absMag.au.mae}     ${t1.vol_flow.T1.absMag.ag.mae}     ${t1.vol_flow.T1.absMag.au.corr}    ${t1.vol_flow.T1.absMag.ag.corr}    ${t1.vol_flow.T1.within1Sigma.pct}%`,
    `Vol×flow×cross:     ${t1.vol_flow_cross.T1.absMag.au.mae}     ${t1.vol_flow_cross.T1.absMag.ag.mae}     ${t1.vol_flow_cross.T1.absMag.au.corr}    ${t1.vol_flow_cross.T1.absMag.ag.corr}    ${t1.vol_flow_cross.T1.within1Sigma.pct}%`,
    '',
    '--- OOS T+1 RMSE ---',
    `Vol-only AU/AG:  ${t1.vol_only.T1.absMag.au.rmse} / ${t1.vol_only.T1.absMag.ag.rmse}`,
    `Vol×flow×cross:  ${t1.vol_flow_cross.T1.absMag.au.rmse} / ${t1.vol_flow_cross.T1.absMag.ag.rmse}`,
    '',
    '--- High-conf flow (|z|≥0.35) T+1 MAE ---',
    `Vol-only:       AU ${t1.vol_only.T1.highConf.au.mae} AG ${t1.vol_only.T1.highConf.ag.mae}`,
    `Vol×flow×cross: AU ${t1.vol_flow_cross.T1.highConf.au.mae} AG ${t1.vol_flow_cross.T1.highConf.ag.mae}`,
    '',
    '--- Cross-market point inference T+1 (signed) ---',
    `AU MAE ${crossPointMae.au.mae} (baseline 3.7434) | AG MAE ${crossPointMae.ag.mae}`,
    '',
    '--- Direction OOS T+3 (flow dir for mag) ---',
    ...dirSources.map((ds) => `  ${ds}: ${directionOos[ds].T3.hitRatePct}% (${directionOos[ds].T3.scored})`),
    '',
    `Promote to production: ${promoteGate ? 'YES' : 'NO'} — ${payload.promoteGate.reason}`,
  ];
  fs.writeFileSync(outTxt, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nWrote ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
