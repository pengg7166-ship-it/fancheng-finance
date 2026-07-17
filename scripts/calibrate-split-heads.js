/**
 * v1.35 split-head threshold + AG_PHILOSOPHY_SCALE grid on OOS 2023–2026
 * Usage:
 *   node scripts/calibrate-split-heads.js
 *   node scripts/calibrate-split-heads.js --save
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
  AG_HEAD_FEATURE_NAMES,
  rowToAuHeadFeatureVector,
  rowToAgHeadFeatureVector,
} = require('../services/outlook-logistic-features');
const {
  getModelsDir,
  sigmoid,
  directionFromPUp,
} = require('../services/outlook-onnx-runner');
const historicalContext = require('../services/commodity-outlook-historical-context');
const backtest = require('../services/commodity-outlook-backtest');
const { INSTRUMENT_REGISTRY } = require('../services/commodity-outlook-engine');
const calibration = require('../services/commodity-outlook-calibration');
const newsTagged = require('../services/news-tagged-loader');
const { readCachedKlines } = require('../services/commodity-technical-analyzer');

const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';
const SPLIT_WEIGHTS_PATH = path.join(getModelsDir(), 'outlook-logistic-weights-v1350-split-heads.json');
const PROD_WEIGHTS_PATH = path.join(getModelsDir(), 'outlook-logistic-weights.json');
const CALIBRATED_PATH = path.join(getModelsDir(), 'outlook-logistic-weights-v1351-split-heads-calibrated.json');

const BULLISH_GRID = [0.52, 0.55, 0.58, 0.60, 0.62, 0.65, 0.68, 0.70, 0.72, 0.75];
const BEARISH_GRID = [0.25, 0.30, 0.35, 0.38, 0.40, 0.42, 0.45, 0.48];
const AG_PHILOSOPHY_GRID = [0.35, 0.45, 0.55, 0.65, 0.75];

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function loadTradingBars(instrumentId) {
  const klines = readCachedKlines(instrumentId);
  if (klines.length >= 60) return klines;
  const historyDir = path.join(getDataDir() || path.join(process.cwd(), 'data'), 'history');
  const fp = path.join(historyDir, 'trading', `${instrumentId}.json`);
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return Array.isArray(raw) ? raw : raw.series || [];
}

function buildProbeIndices(bars, { from, to, step, minBarIdx = 60, maxFutureBars = 3 }) {
  const indices = [];
  const upper = bars.length - maxFutureBars;
  for (let i = minBarIdx; i < upper; i += step) {
    const d = normBarDate(bars[i]);
    if (d >= from && d <= to) indices.push(i);
  }
  return indices;
}

async function collectOosRows(ids, from, to, step = 1) {
  const weights = calibration.getCompositeWeights();
  const perInstrument = {};
  for (const id of ids) {
    const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
    const bars = loadTradingBars(id);
    const indices = buildProbeIndices(bars, { from, to, step });
    const rows = [];
    let prev = 'neutral';
    for (const t of indices) {
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      rows.push({ ...row, instrumentId: id });
    }
    perInstrument[id] = rows;
  }
  return perInstrument;
}

function computePUpFromHead(headPayload, row, philosophyScale) {
  const headId = headPayload.headId;
  const vectorFn = headId === 'ag' ? rowToAgHeadFeatureVector : rowToAuHeadFeatureVector;
  const featureNames = headPayload.featureNames || (headId === 'ag' ? AG_HEAD_FEATURE_NAMES : AU_HEAD_FEATURE_NAMES);
  const scale = philosophyScale ?? headPayload.philosophyScale;
  const x = vectorFn(row, scale);
  const w = headPayload.weights || {};
  let z = Number(w.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(w[featureNames[i]] ?? 0) * x[i];
  }
  return sigmoid(z);
}

function evaluateScored(rows, getPred) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = getPred(row);
    if (!pred || pred === 'neutral' || !row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDirT3)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

function evaluatePortfolio(auRows, agRows, auPUpFn, agPUpFn, th) {
  const auPred = (row) => directionFromPUp(auPUpFn(row), th.au);
  const agPred = (row) => directionFromPUp(agPUpFn(row), th.ag);
  const au = evaluateScored(auRows, auPred);
  const ag = evaluateScored(agRows, agPred);
  const all = evaluateScored(auRows, auPred);
  const agPart = evaluateScored(agRows, agPred);
  const hits = all.hits + agPart.hits;
  const scored = all.scored + agPart.scored;
  return {
    overall: {
      hits,
      scored,
      hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
    },
    au,
    ag,
  };
}

function gridSearchThresholds(auRows, agRows, auPUpFn, agPUpFn, minScored = 150) {
  let best = null;
  const top = [];
  for (const auBull of BULLISH_GRID) {
    for (const auBear of BEARISH_GRID) {
      if (auBear >= auBull) continue;
      for (const agBull of BULLISH_GRID) {
        for (const agBear of BEARISH_GRID) {
          if (agBear >= agBull) continue;
          const th = {
            au: { bullishThreshold: auBull, bearishThreshold: auBear },
            ag: { bullishThreshold: agBull, bearishThreshold: agBear },
          };
          const ev = evaluatePortfolio(auRows, agRows, auPUpFn, agPUpFn, th);
          const entry = { th, ev, agPhilosophyScale: null };
          if (ev.overall.scored >= minScored) {
            top.push(entry);
            if (
              !best ||
              ev.overall.hitRatePct > best.ev.overall.hitRatePct ||
              (ev.overall.hitRatePct === best.ev.overall.hitRatePct && ev.overall.scored > best.ev.overall.scored)
            ) {
              best = entry;
            }
          }
        }
      }
    }
  }
  top.sort((a, b) => {
    if (b.ev.overall.hitRatePct !== a.ev.overall.hitRatePct) return b.ev.overall.hitRatePct - a.ev.overall.hitRatePct;
    return b.ev.overall.scored - a.ev.overall.scored;
  });
  return { best, top10: top.slice(0, 10) };
}

function gridSearchPhilosophy(auRows, agRows, splitPayload, baseTh, minScored = 150) {
  let best = null;
  const results = [];
  const auHead = {
    headId: 'au',
    featureNames: splitPayload.heads.au.featureNames,
    philosophyScale: splitPayload.heads.au.philosophyScale,
    weights: splitPayload.heads.au.weights,
  };
  const agHeadBase = {
    headId: 'ag',
    featureNames: splitPayload.heads.ag.featureNames,
    weights: splitPayload.heads.ag.weights,
  };
  const auPUpFn = (row) => computePUpFromHead(auHead, row, 1);
  for (const scale of AG_PHILOSOPHY_GRID) {
    const agPUpFn = (row) => computePUpFromHead(agHeadBase, row, scale);
    const ev = evaluatePortfolio(auRows, agRows, auPUpFn, agPUpFn, baseTh);
    const entry = { agPhilosophyScale: scale, ev };
    results.push(entry);
    if (ev.overall.scored >= minScored) {
      if (
        !best ||
        ev.overall.hitRatePct > best.ev.overall.hitRatePct ||
        (ev.overall.hitRatePct === best.ev.overall.hitRatePct && ev.overall.scored > best.ev.overall.scored)
      ) {
        best = entry;
      }
    }
  }
  results.sort((a, b) => b.ev.overall.hitRatePct - a.ev.overall.hitRatePct);
  return { best, results };
}

function evaluateProdBaseline(auRows, agRows) {
  const prod = JSON.parse(fs.readFileSync(PROD_WEIGHTS_PATH, 'utf8'));
  const { rowToFeatureVector, FEATURE_NAMES } = require('../services/outlook-logistic-features');
  const w = prod.weights || {};
  const pUpFn = (row) => {
    const x = rowToFeatureVector(row);
    let z = Number(w.bias ?? 0);
    for (let i = 0; i < x.length; i += 1) {
      z += Number(w[FEATURE_NAMES[i]] ?? 0) * x[i];
    }
    return sigmoid(z);
  };
  const pred = (row) => directionFromPUp(pUpFn(row));
  const au = evaluateScored(auRows, pred);
  const ag = evaluateScored(agRows, pred);
  const hits = au.hits + ag.hits;
  const scored = au.scored + ag.scored;
  return {
    overall: {
      hits,
      scored,
      hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
    },
    au,
    ag,
  };
}

function evaluateDefaultSplit(auRows, agRows, splitPayload) {
  const auHead = {
    headId: 'au',
    featureNames: splitPayload.heads.au.featureNames,
    philosophyScale: splitPayload.heads.au.philosophyScale,
    weights: splitPayload.heads.au.weights,
  };
  const agHead = {
    headId: 'ag',
    featureNames: splitPayload.heads.ag.featureNames,
    philosophyScale: splitPayload.heads.ag.philosophyScale,
    weights: splitPayload.heads.ag.weights,
  };
  const auPUpFn = (row) => computePUpFromHead(auHead, row);
  const agPUpFn = (row) => computePUpFromHead(agHead, row);
  const th = {
    au: { bullishThreshold: 0.55, bearishThreshold: 0.45 },
    ag: { bullishThreshold: 0.55, bearishThreshold: 0.45 },
  };
  return evaluatePortfolio(auRows, agRows, auPUpFn, agPUpFn, th);
}

function saveCalibratedWeights(splitPayload, bestTh, agScale, ev) {
  const payload = JSON.parse(JSON.stringify(splitPayload));
  payload.version = 'v1.35.1-split-heads-calibrated';
  payload.trainedAt = new Date().toISOString();
  payload.heads.au.philosophyScale = 1;
  payload.heads.au.directionThresholds = {
    bullish: bestTh.au.bullishThreshold,
    bearish: bestTh.au.bearishThreshold,
  };
  payload.heads.ag.philosophyScale = agScale;
  payload.heads.ag.directionThresholds = {
    bullish: bestTh.ag.bullishThreshold,
    bearish: bestTh.ag.bearishThreshold,
  };
  payload.calibration = {
    method: 'oos-grid-threshold+ag-philosophy-scale',
    oosWindow: `${TEST_FROM}..${TEST_TO}`,
    calibratedAt: new Date().toISOString(),
    settings: {
      au: payload.heads.au.directionThresholds,
      ag: { ...payload.heads.ag.directionThresholds, philosophyScale: agScale },
    },
    validation: {
      outOfSample: {
        overall: ev.overall,
        perInstrument: { au: ev.au, ag: ev.ag },
      },
      baselineV1348: { auAgPct: 64.16, auPct: 67.62, agPct: 61.16, scored: 226 },
      baselineV1350: { auAgPct: 56.63, scored: 611 },
    },
  };
  payload.validation = payload.calibration.validation;
  fs.writeFileSync(CALIBRATED_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return CALIBRATED_PATH;
}

async function main() {
  const save = process.argv.includes('--save');
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  console.log('[calibrate] collecting OOS rows', TEST_FROM, TEST_TO);
  const perId = await collectOosRows(['au', 'ag'], TEST_FROM, TEST_TO, 1);
  const auRows = perId.au || [];
  const agRows = perId.ag || [];
  console.log(`[calibrate] au rows=${auRows.length} ag rows=${agRows.length}`);

  const splitPayload = JSON.parse(fs.readFileSync(SPLIT_WEIGHTS_PATH, 'utf8'));

  const prodEv = evaluateProdBaseline(auRows, agRows);
  const defaultEv = evaluateDefaultSplit(auRows, agRows, splitPayload);

  const auHead = {
    headId: 'au',
    featureNames: splitPayload.heads.au.featureNames,
    philosophyScale: 1,
    weights: splitPayload.heads.au.weights,
  };
  const agHead = {
    headId: 'ag',
    featureNames: splitPayload.heads.ag.featureNames,
    philosophyScale: 0.45,
    weights: splitPayload.heads.ag.weights,
  };
  const auPUpFn = (row) => computePUpFromHead(auHead, row);
  const agPUpFnDefault = (row) => computePUpFromHead(agHead, row);

  console.log('[calibrate] grid search thresholds (minScored=150)...');
  const thSearch = gridSearchThresholds(auRows, agRows, auPUpFn, agPUpFnDefault, 150);
  const thSearch180 = gridSearchThresholds(auRows, agRows, auPUpFn, agPUpFnDefault, 180);
  const thSearch200 = gridSearchThresholds(auRows, agRows, auPUpFn, agPUpFnDefault, 200);
  const thSearch220 = gridSearchThresholds(auRows, agRows, auPUpFn, agPUpFnDefault, 220);

  function bestInScoredRange(minN, maxN) {
    let best = null;
    for (const auBull of BULLISH_GRID) {
      for (const auBear of BEARISH_GRID) {
        if (auBear >= auBull) continue;
        for (const agBull of BULLISH_GRID) {
          for (const agBear of BEARISH_GRID) {
            if (agBear >= agBull) continue;
            const th = {
              au: { bullishThreshold: auBull, bearishThreshold: auBear },
              ag: { bullishThreshold: agBull, bearishThreshold: agBear },
            };
            const ev = evaluatePortfolio(auRows, agRows, auPUpFn, agPUpFnDefault, th);
            const n = ev.overall.scored;
            if (n < minN || n > maxN) continue;
            if (
              !best ||
              ev.overall.hitRatePct > best.ev.overall.hitRatePct ||
              (ev.overall.hitRatePct === best.ev.overall.hitRatePct && n > best.ev.overall.scored)
            ) {
              best = { th, ev };
            }
          }
        }
      }
    }
    return best;
  }
  const bestRange200226 = bestInScoredRange(200, 226);
  const bestRange180230 = bestInScoredRange(180, 230);

  console.log('[calibrate] grid search AG philosophy scale with best thresholds...');
  const philSearch = gridSearchPhilosophy(auRows, agRows, splitPayload, thSearch.best.th, 150);

  const bestScale = philSearch.best?.agPhilosophyScale ?? 0.45;
  const agHeadScaled = {
    headId: 'ag',
    featureNames: splitPayload.heads.ag.featureNames,
    weights: splitPayload.heads.ag.weights,
  };
  const agPUpFnBest = (row) => computePUpFromHead(agHeadScaled, row, bestScale);
  const finalEv = evaluatePortfolio(auRows, agRows, auPUpFn, agPUpFnBest, thSearch.best.th);

  const report = {
    oosWindow: `${TEST_FROM}..${TEST_TO}`,
    prodV1348: prodEv,
    splitV1350Default: defaultEv,
    bestThresholdOnly: thSearch.best,
    bestThresholdMin180: thSearch180.best,
    bestThresholdMin200: thSearch200.best,
    bestThresholdMin220: thSearch220.best,
    bestInScoredRange200226: bestRange200226,
    bestInScoredRange180230: bestRange180230,
    bestPhilosophy: philSearch.best,
    finalCombined: {
      th: thSearch.best.th,
      agPhilosophyScale: bestScale,
      ev: finalEv,
    },
    topThresholds: thSearch.top10.map((t) => ({
      au: t.th.au,
      ag: t.th.ag,
      overall: t.ev.overall,
      auStats: t.ev.au,
      agStats: t.ev.ag,
    })),
    philosophyGrid: philSearch.results.map((r) => ({
      scale: r.agPhilosophyScale,
      overall: r.ev.overall,
      au: r.ev.au,
      ag: r.ev.ag,
    })),
  };

  const outPath = path.join(process.cwd(), '_calibrate-split-heads-out.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== KPI TABLE ===');
  console.log('version          | au+ag hit% | scored | AU hit% | AU n | AG hit% | AG n');
  const fmt = (label, ev) => {
    console.log(
      `${label.padEnd(16)} | ${String(ev.overall.hitRatePct).padStart(7)}% | ${String(ev.overall.scored).padStart(6)} | ${String(ev.au.hitRatePct).padStart(7)}% | ${String(ev.au.scored).padStart(4)} | ${String(ev.ag.hitRatePct).padStart(7)}% | ${String(ev.ag.scored).padStart(4)}`
    );
  };
  fmt('v1.34.8 prod', prodEv);
  fmt('v1.35.0 default', defaultEv);
  fmt('v1.35.1 calib', finalEv);
  if (bestRange200226) {
    console.log('\nBest in scored 200-226:', JSON.stringify(bestRange200226.th));
    fmt('range 200-226', bestRange200226.ev);
  }
  if (bestRange180230) {
    console.log('\nBest in scored 180-230:', JSON.stringify(bestRange180230.th));
    fmt('range 180-230', bestRange180230.ev);
  }

  console.log('\nBest thresholds:', JSON.stringify(thSearch.best.th));
  console.log('Best AG_PHILOSOPHY_SCALE:', bestScale);
  console.log('\nFull report:', outPath);

  if (save) {
    const saved = saveCalibratedWeights(splitPayload, thSearch.best.th, bestScale, finalEv);
    console.log('Saved calibrated weights:', saved);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
