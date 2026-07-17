/**
 * T+1 unified logistic retrain — au/ag only, saves experiment weights (never production).
 *
 * Usage:
 *   FANCHENG_DATA_DRIVE=E NODE_OPTIONS=--max-old-space-size=4096 node scripts/train-outlook-logistic-t1-unified.js
 *   ... --train-from 2017-01-01 --train-to 2022-12-31
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const diskCache = require('../services/disk-cache');
const { getDataDir } = require('../services/data-paths');
const { hitDirection } = require('../services/outlook-labels');
const {
  FEATURE_NAMES,
  rowToFeatureVector,
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
const t1Config = require('../services/t1-unified-config');
const { skipOiProxyCount, loadOverrides } = require('../services/basis-regime-overrides');

const OUT_JSON = path.join(process.cwd(), 'data', 'exports', 't1-unified-train-report.json');
const OUT_TXT = path.join(process.cwd(), '_t1-unified-train-out.txt');

function parseArgs(config) {
  const args = process.argv.slice(2);
  let trainFrom = config.train.from;
  let trainTo = config.train.to;
  let testFrom = config.oos.from;
  let testTo = config.oos.to;
  let step = config.trainHyperparams?.step ?? 1;
  let epochs = config.trainHyperparams?.epochs ?? 800;
  let lr = config.trainHyperparams?.lr ?? 0.08;
  let lambda = config.trainHyperparams?.lambda ?? 0.02;
  let excludeFeatures = [...(config.trainHyperparams?.excludeFeatures || [])];
  const ids = [...(config.trainHyperparams?.instruments || ['au', 'ag'])];

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--train-from' && args[i + 1]) { trainFrom = args[++i]; continue; }
    if (args[i] === '--train-to' && args[i + 1]) { trainTo = args[++i]; continue; }
    if (args[i] === '--test-from' && args[i + 1]) { testFrom = args[++i]; continue; }
    if (args[i] === '--test-to' && args[i + 1]) { testTo = args[++i]; continue; }
    if (args[i] === '--step' && args[i + 1]) { step = Number(args[++i]) || 1; continue; }
    if (args[i] === '--epochs' && args[i + 1]) { epochs = Number(args[++i]) || 800; continue; }
  }
  return { ids, trainFrom, trainTo, testFrom, testTo, step, epochs, lr, lambda, excludeFeatures };
}

function buildFeatureTrainPlan(excludeFeatures = []) {
  const excluded = new Set(excludeFeatures);
  const trainIndices = [];
  for (let i = 0; i < FEATURE_NAMES.length; i += 1) {
    if (!excluded.has(FEATURE_NAMES[i])) trainIndices.push(i);
  }
  return { excluded, trainIndices };
}

function projectSampleFeatures(x, trainIndices) {
  return trainIndices.map((idx) => x[idx]);
}

function expandTrainWeights(wTrain, trainIndices, nFullFeatures) {
  const w = new Array(nFullFeatures + 1).fill(0);
  w[0] = wTrain[0];
  for (let j = 0; j < trainIndices.length; j += 1) {
    w[trainIndices[j] + 1] = wTrain[j + 1];
  }
  return w;
}

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

function buildProbeIndices(bars, { from, to, step, minBarIdx = 60, maxFutureBars = 1 }) {
  const indices = [];
  const upper = bars.length - maxFutureBars;
  for (let i = minBarIdx; i < upper; i += step) {
    const d = normBarDate(bars[i]);
    if (d >= from && d <= to) indices.push(i);
  }
  return indices;
}

function filterRowsByWindow(rows, from, to) {
  return rows.filter((r) => r.date >= from && r.date <= to);
}

async function collectWalkForwardRows({ ids, from, to, step }) {
  const weights = calibration.getCompositeWeights();
  const allRows = [];
  const perInstrument = {};

  for (const id of ids) {
    const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
    if (!spec) throw new Error(`instrument ${id} not in registry`);
    const bars = loadTradingBars(id);
    const indices = buildProbeIndices(bars, { from, to, step, maxFutureBars: 1 });
    const rows = [];
    let prev = 'neutral';
    for (const t of indices) {
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, {});
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      rows.push({ ...row, instrumentId: id });
    }
    perInstrument[id] = rows;
    allRows.push(...rows);
  }
  return { allRows, perInstrument };
}

function sampleWeightForRow(row, config) {
  if (row.instrumentId !== 'ag') return 1;
  const basisW = config.trainHyperparams?.agBasisSampleWeight ?? 1.5;
  const trainW = config.trainHyperparams?.agTrainSampleWeight ?? 1.35;
  if (row.marketRegime === 'basis') return basisW;
  return trainW;
}

function rowsToSamples(rows, trainIndices, config) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDir || row.actualDir === 'neutral') continue;
    const y = row.actualDir === 'bullish' ? 1 : 0;
    const weight = sampleWeightForRow(row, config);
    const fullX = rowToFeatureVector(row);
    const x = trainIndices ? projectSampleFeatures(fullX, trainIndices) : fullX;
    samples.push({ x, y, weight, row });
  }
  return samples;
}

function dot(w, x) {
  let s = w[0];
  for (let i = 0; i < x.length; i += 1) s += w[i + 1] * x[i];
  return s;
}

function trainLogistic(samples, { epochs, lr, lambda }) {
  const nFeatures = samples[0].x.length;
  const w = new Array(nFeatures + 1).fill(0);
  const totalWeight = samples.reduce((s, { weight = 1 }) => s + weight, 0) || samples.length;

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
      w[i] -= lr * (grad[i] / totalWeight + reg);
    }
  }
  return w;
}

function weightsArrayToObject(w) {
  const out = { bias: +w[0].toFixed(6) };
  for (let i = 0; i < FEATURE_NAMES.length; i += 1) {
    out[FEATURE_NAMES[i]] = +w[i + 1].toFixed(6);
  }
  return out;
}

function evaluateT1HitRate(rows, predictFn) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = predictFn(row);
    if (!pred || pred === 'neutral' || !row.actualDir || row.actualDir === 'neutral') continue;
    scored += 1;
    if (hitDirection(pred, row.actualDir)) hits += 1;
  }
  return {
    hits,
    scored,
    hitRatePct: scored ? +((hits / scored) * 100).toFixed(2) : null,
  };
}

function predictDirectionFromWeightsObject(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function checkGate(oosOverall, oosAuAg, config) {
  const baselines = config.scoring?.baselines || {};
  const minN = config.scoring?.gateMinScored ?? 200;
  const beatPp = config.scoring?.gateBeatBaselinePp ?? 2;
  const target = config.scoring?.targetHitRatePct ?? 75;

  const rawBaseline = baselines.t1RawOverallPct ?? 52.11;
  const auAgBaseline = baselines.t1GatedAuAgPct ?? 54.28;

  const beatRaw =
    oosOverall?.hitRatePct != null &&
    oosOverall.scored >= minN &&
    oosOverall.hitRatePct >= rawBaseline + beatPp;

  const reach75 =
    oosOverall?.hitRatePct != null &&
    oosOverall.scored >= minN &&
    oosOverall.hitRatePct >= target;

  const beatAuAg =
    oosAuAg?.hitRatePct != null &&
    oosAuAg.scored >= 100 &&
    oosAuAg.hitRatePct >= auAgBaseline + beatPp;

  return {
    passed: beatRaw || reach75 || beatAuAg,
    beatRaw,
    reach75,
    beatAuAg,
    rawBaseline,
    auAgBaseline,
    minN,
    beatPp,
  };
}

function countNewsTaggedRows() {
  const fp = path.join(getDataDir(), 'history', 'news-tagged.csv');
  if (!fs.existsSync(fp)) return 0;
  return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean).length - 1;
}

async function main() {
  const config = t1Config.loadConfig();
  t1Config.applyRegimeEnv(config);
  if (config.regime?.useBasisRegimeOverrides) loadOverrides(true);

  const opts = parseArgs(config);
  diskCache.init(getDataDir());
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

  const newsRows = countNewsTaggedRows();
  const overrideCount = skipOiProxyCount();
  console.log('=== T+1 UNIFIED LOGISTIC TRAIN ===');
  console.log('horizon T+1 | news-tagged rows:', newsRows, '| skip_oi_proxy overrides:', overrideCount);
  console.log('train', opts.trainFrom, '→', opts.trainTo, '| OOS', opts.testFrom, '→', opts.testTo);

  const fullFrom = opts.trainFrom;
  const fullTo = opts.testTo;
  const { allRows: allRowsFull, perInstrument: perInstrumentFull } = await collectWalkForwardRows({
    ids: opts.ids,
    from: fullFrom,
    to: fullTo,
    step: opts.step,
  });

  const trainRows = filterRowsByWindow(allRowsFull, opts.trainFrom, opts.trainTo);
  const testRows = filterRowsByWindow(allRowsFull, opts.testFrom, opts.testTo);
  const trainPerId = {};
  const testPerId = {};
  for (const id of opts.ids) {
    trainPerId[id] = filterRowsByWindow(perInstrumentFull[id] || [], opts.trainFrom, opts.trainTo);
    testPerId[id] = filterRowsByWindow(perInstrumentFull[id] || [], opts.testFrom, opts.testTo);
  }

  const { trainIndices } = buildFeatureTrainPlan(opts.excludeFeatures);
  const trainSamples = rowsToSamples(trainRows, trainIndices.length ? trainIndices : null, config);
  if (trainSamples.length < 30) {
    throw new Error(`insufficient T+1 train samples: ${trainSamples.length}`);
  }

  const wTrain = trainLogistic(trainSamples, opts);
  const w = trainIndices.length
    ? expandTrainWeights(wTrain, trainIndices, FEATURE_NAMES.length)
    : wTrain;
  const weightsObj = weightsArrayToObject(w);
  const predictLogistic = (row) => predictDirectionFromWeightsObject(weightsObj, row);

  const isOverall = evaluateT1HitRate(trainRows, predictLogistic);
  const oosOverall = evaluateT1HitRate(testRows, predictLogistic);
  const isPerId = {};
  const oosPerId = {};
  for (const id of opts.ids) {
    isPerId[id] = evaluateT1HitRate(trainPerId[id], predictLogistic);
    oosPerId[id] = evaluateT1HitRate(testPerId[id], predictLogistic);
  }

  const oosAuAgRows = [...(testPerId.au || []), ...(testPerId.ag || [])];
  const oosAuAg = evaluateT1HitRate(oosAuAgRows, predictLogistic);
  const gate = checkGate(oosOverall, oosAuAg, config);

  const weightsPath = t1Config.getExperimentWeightsPath();
  getModelsDir();

  const payload = {
    version: config.modelId,
    horizon: 1,
    horizonLabel: 'T+1',
    productionBaseline: config.productionModelVersion,
    trainedAt: new Date().toISOString(),
    unifiedConfig: t1Config.CONFIG_FILENAME,
    cv: {
      train: `${opts.trainFrom}..${opts.trainTo}`,
      test: `${opts.testFrom}..${opts.testTo}`,
    },
    instruments: opts.ids,
    step: opts.step,
    featureNames: FEATURE_NAMES,
    excludedFromTraining: opts.excludeFeatures.length ? opts.excludeFeatures : undefined,
    weights: weightsObj,
    dataSnapshot: {
      newsTaggedRows: newsRows,
      basisSkipOiProxyOverrides: overrideCount,
      strictOiProxy: Boolean(config.regime?.agBasisStrictOiProxy),
    },
    training: {
      labelHorizon: 'T+1',
      trainSamples: trainSamples.length,
      testSamples: rowsToSamples(testRows, trainIndices.length ? trainIndices : null, config).length,
      epochs: opts.epochs,
      lr: opts.lr,
      lambda: opts.lambda,
      agTrainSampleWeight: config.trainHyperparams?.agTrainSampleWeight,
      agBasisSampleWeight: config.trainHyperparams?.agBasisSampleWeight,
    },
    validation: {
      inSample: { overall: isOverall, perInstrument: isPerId },
      outOfSample: { overall: oosOverall, perInstrument: oosPerId, auAg: oosAuAg },
    },
    gate: {
      targetHitRatePct: config.scoring?.targetHitRatePct ?? 75,
      ...gate,
    },
    deployRecommendation: gate.passed
      ? 'EXPERIMENT_PASSED — document deploy; do NOT overwrite production without explicit approval'
      : 'GATE_FAIL — keep production v1.34.8',
  };

  fs.writeFileSync(weightsPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(OUT_TXT, JSON.stringify(payload, null, 2), 'utf8');

  console.log(JSON.stringify(payload, null, 2));
  console.log('\nWrote experiment weights ONLY:', weightsPath);
  console.log('Gate:', gate.passed ? 'PASS' : 'FAIL');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
