/**
 * Phase 3 鈥?绾?JS logistic 璁粌锛坵alk-forward CV锛?
 * 璁粌 2019鈥?022锛孫OS 娴嬭瘯 2023鈥?026锛涗骇鍑?outlook-logistic-weights.json
 *
 * 鐢ㄦ硶:
 *   node scripts/train-outlook-logistic.js
 *   node scripts/train-outlook-logistic.js --id au,ag
 *   node scripts/train-outlook-logistic.js --split-heads --version v1.35.0-split-heads
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
  AU_HEAD_FEATURE_NAMES,
  AG_HEAD_FEATURE_NAMES,
  rowToAuHeadFeatureVector,
  rowToAgHeadFeatureVector,
  getSplitHeadConfig,
  AG_PHILOSOPHY_SCALE,
  AU_PHILOSOPHY_SCALE,
} = require('../services/outlook-logistic-features');
const {
  getDefaultOnnxPath,
  getDefaultWeightsPath,
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

const STUB_AU_T3_BASELINE = 59.95;
const PRECIOUS_PROBE_TARGET = 60;
const AU_OOS_GATE_PCT = 58;
/** AG OOS 鏍锋湰鍔犳潈 鈥?寮ヨˉ term 鐗瑰緛鏇剧己澶辨椂鐨勮缁冨亸 AU */
const AG_TRAIN_SAMPLE_WEIGHT = 1.35;
/** AG basis regime 棰濆鍔犳潈 鈥?鎶崌 basis 妗?OOS锛坋nv 鍙皟 1.3鈥?.8锛?*/
const AG_BASIS_SAMPLE_WEIGHT = Number(process.env.AG_BASIS_SAMPLE_WEIGHT) || 1.5;
const TRAIN_FROM = '2019-01-01';
const TRAIN_TO = '2022-12-31';
const TEST_FROM = '2023-01-01';
const TEST_TO = '2026-12-31';

function parseArgs() {
  const args = process.argv.slice(2);
  let ids = ['au', 'ag'];
  let trainFrom = TRAIN_FROM;
  let trainTo = TRAIN_TO;
  let testFrom = TEST_FROM;
  let testTo = TEST_TO;
  let step = 1;
  let epochs = 800;
  let lr = 0.08;
  let lambda = 0.02;
  let version = 'v1.34.8-ag-cu-spread+basis-term';
  let excludeFeatures = [
    'cu_momentum_5d',
    'gldHoldings_chg_5d',
  ];
  let splitHeads = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--id' && args[i + 1]) {
      ids = args[i + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      i += 1;
    } else if (args[i] === '--train-from' && args[i + 1]) {
      trainFrom = args[i + 1];
      i += 1;
    } else if (args[i] === '--train-to' && args[i + 1]) {
      trainTo = args[i + 1];
      i += 1;
    } else if (args[i] === '--test-from' && args[i + 1]) {
      testFrom = args[i + 1];
      i += 1;
    } else if (args[i] === '--test-to' && args[i + 1]) {
      testTo = args[i + 1];
      i += 1;
    } else if (args[i] === '--step' && args[i + 1]) {
      step = Math.max(1, Number(args[i + 1]) || 1);
      i += 1;
    } else if (args[i] === '--epochs' && args[i + 1]) {
      epochs = Number(args[i + 1]) || 800;
      i += 1;
    } else if (args[i] === '--lr' && args[i + 1]) {
      lr = Number(args[i + 1]) || 0.08;
      i += 1;
    } else if (args[i] === '--version' && args[i + 1]) {
      version = args[i + 1];
      i += 1;
    } else if (args[i] === '--exclude-features' && args[i + 1]) {
      excludeFeatures = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (args[i] === '--split-heads') {
      splitHeads = true;
      if (version === 'v1.34.8-ag-cu-spread+basis-term') {
        version = 'v1.35.0-split-heads';
      }
    }
  }
  return { ids, trainFrom, trainTo, testFrom, testTo, step, epochs, lr, lambda, version, excludeFeatures, splitHeads };
}

function buildHeadFeatureTrainPlan(headId, excludeFeatures = []) {
  const cfg = getSplitHeadConfig(headId);
  const featureNames = cfg.featureNames;
  const excluded = new Set([...(cfg.defaultExclude || []), ...excludeFeatures]);
  const trainIndices = [];
  for (let i = 0; i < featureNames.length; i += 1) {
    if (!excluded.has(featureNames[i])) trainIndices.push(i);
  }
  return { featureNames, excluded, trainIndices, philosophyScale: cfg.philosophyScale };
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

function expandHeadTrainWeights(wTrain, trainIndices, featureNames) {
  const w = new Array(featureNames.length + 1).fill(0);
  w[0] = wTrain[0];
  for (let j = 0; j < trainIndices.length; j += 1) {
    w[trainIndices[j] + 1] = wTrain[j + 1];
  }
  return w;
}

function headWeightsArrayToObject(w, featureNames) {
  const out = { bias: +w[0].toFixed(6) };
  for (let i = 0; i < featureNames.length; i += 1) {
    out[featureNames[i]] = +w[i + 1].toFixed(6);
  }
  return out;
}

function predictDirectionFromHeadWeights(headId, weightsObj, row, philosophyScale) {
  const vectorFn = headId === 'ag' ? rowToAgHeadFeatureVector : rowToAuHeadFeatureVector;
  const featureNames = headId === 'ag' ? AG_HEAD_FEATURE_NAMES : AU_HEAD_FEATURE_NAMES;
  const x = vectorFn(row, philosophyScale);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[featureNames[i]] ?? 0) * x[i];
  }
  return directionFromPUp(sigmoid(z));
}

function trainSplitHead(headId, trainRows, opts) {
  const plan = buildHeadFeatureTrainPlan(headId, []);
  const vectorFn = headId === 'ag' ? rowToAgHeadFeatureVector : rowToAuHeadFeatureVector;
  const samples = [];
  for (const row of trainRows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    const weight = headId === 'ag' ? sampleWeightForRow(row) : 1;
    const fullX = vectorFn(row, plan.philosophyScale);
    const x = projectSampleFeatures(fullX, plan.trainIndices);
    samples.push({ x, y, weight, row });
  }
  if (samples.length < 20) {
    throw new Error(`insufficient ${headId} train samples: ${samples.length}`);
  }
  const wTrain = trainLogistic(samples, opts);
  const w = expandHeadTrainWeights(wTrain, plan.trainIndices, plan.featureNames);
  const weightsObj = headWeightsArrayToObject(w, plan.featureNames);
  const predictFn = (row) => predictDirectionFromHeadWeights(headId, weightsObj, row, plan.philosophyScale);
  return {
    headId,
    plan,
    weightsObj,
    predictFn,
    trainSamples: samples.length,
  };
}

async function runSplitHeadTraining(opts, { allRowsFull, perInstrumentFull, trainPerId, testPerId, testRows }) {
  const trainRowsById = {
    au: filterRowsByWindow(perInstrumentFull.au || [], opts.trainFrom, opts.trainTo),
    ag: filterRowsByWindow(perInstrumentFull.ag || [], opts.trainFrom, opts.trainTo),
  };
  const auHead = trainSplitHead('au', trainRowsById.au, opts);
  const agHead = trainSplitHead('ag', trainRowsById.ag, opts);

  const predictPortfolio = (row) => {
    const id = String(row.instrumentId || '').toLowerCase();
    if (id === 'ag') return agHead.predictFn(row);
    return auHead.predictFn(row);
  };

  const isOverall = evaluateT3HitRate(filterRowsByWindow(allRowsFull, opts.trainFrom, opts.trainTo), predictPortfolio);
  const oosOverall = evaluateT3HitRate(testRows, predictPortfolio);
  const oosPerId = {
    au: evaluateT3HitRate(testPerId.au || [], auHead.predictFn),
    ag: evaluateT3HitRate(testPerId.ag || [], agHead.predictFn),
  };
  const isPerId = {
    au: evaluateT3HitRate(trainRowsById.au, auHead.predictFn),
    ag: evaluateT3HitRate(trainRowsById.ag, agHead.predictFn),
  };

  const oosStubRows = await collectEnsembleStubRows({
    ids: opts.ids,
    from: opts.testFrom,
    to: opts.testTo,
    step: opts.step,
  });
  const oosStubAuFromId = testPerId.au?.length
    ? evaluateT3HitRate(
        (await collectEnsembleStubRows({ ids: ['au'], from: opts.testFrom, to: opts.testTo, step: opts.step })),
        (r) => r.predictedDir
      )
    : evaluateT3HitRate(
        oosStubRows.filter((r) => r.instrumentId === 'au'),
        (r) => r.predictedDir
      );

  const gate = checkGate({
    oosPrecious: oosOverall,
    oosAu: oosPerId.au,
    oosStubAu: oosStubAuFromId,
  });

  const weightsPath = getDefaultWeightsPath();
  getModelsDir();

  const payload = {
    version: opts.version,
    architecture: 'split-heads',
    trainedAt: new Date().toISOString(),
    cv: {
      train: `${opts.trainFrom}..${opts.trainTo}`,
      test: `${opts.testFrom}..${opts.testTo}`,
    },
    instruments: opts.ids,
    step: opts.step,
    heads: {
      au: {
        featureNames: auHead.plan.featureNames,
        excludedFromTraining: [...auHead.plan.excluded],
        philosophyScale: auHead.plan.philosophyScale,
        weights: auHead.weightsObj,
        training: {
          trainSamples: auHead.trainSamples,
          philosophyScaleDefault: AU_PHILOSOPHY_SCALE,
        },
      },
      ag: {
        featureNames: agHead.plan.featureNames,
        excludedFromTraining: [...agHead.plan.excluded],
        philosophyScale: agHead.plan.philosophyScale,
        weights: agHead.weightsObj,
        training: {
          trainSamples: agHead.trainSamples,
          philosophyScaleDefault: AG_PHILOSOPHY_SCALE,
          agTrainSampleWeight: AG_TRAIN_SAMPLE_WEIGHT,
          agBasisSampleWeight: AG_BASIS_SAMPLE_WEIGHT,
        },
      },
    },
    legacyFeatureNames: FEATURE_NAMES,
    validation: {
      inSample: {
        overall: isOverall,
        perInstrument: isPerId,
      },
      outOfSample: {
        overall: oosOverall,
        perInstrument: oosPerId,
        ensembleStub: {
          au: oosStubAuFromId,
        },
      },
      deltaPp: {
        oosLogisticVsStubAu:
          oosPerId.au?.hitRatePct != null && oosStubAuFromId?.hitRatePct != null
            ? +(oosPerId.au.hitRatePct - oosStubAuFromId.hitRatePct).toFixed(2)
            : null,
        oosLogisticVsStubBaseline58_93:
          oosPerId.au?.hitRatePct != null ? +(oosPerId.au.hitRatePct - STUB_AU_T3_BASELINE).toFixed(2) : null,
      },
      baselineV1348: {
        auAgPct: 64.16,
        auPct: 67.62,
        agPct: 61.16,
      },
    },
    gate: {
      preciousOosTargetPct: PRECIOUS_PROBE_TARGET,
      auOosGatePct: AU_OOS_GATE_PCT,
      stubAuBaselinePct: STUB_AU_T3_BASELINE,
      ...gate,
    },
    onnxPath: getDefaultOnnxPath(),
    onnxExport: exportOnnxStubNote(getDefaultOnnxPath()),
    longrunPaused: !gate.preciousMet,
    preciousProbeEligible: gate.passed,
  };

  fs.writeFileSync(weightsPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
  return payload;
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

function buildProbeIndices(bars, { from, to, step, minBarIdx = 60, maxFutureBars = 3 }) {
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
    allRows.push(...rows);
  }
  return { allRows, perInstrument };
}

function sampleWeightForRow(row) {
  if (row.instrumentId !== 'ag') return 1;
  if (row.marketRegime === 'basis') return AG_BASIS_SAMPLE_WEIGHT;
  return AG_TRAIN_SAMPLE_WEIGHT;
}

function rowsToSamples(rows, trainIndices = null) {
  const samples = [];
  for (const row of rows) {
    if (!row.actualDirT3 || row.actualDirT3 === 'neutral') continue;
    const y = row.actualDirT3 === 'bullish' ? 1 : 0;
    const weight = sampleWeightForRow(row);
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

function evaluateT3HitRate(rows, predictFn) {
  let hits = 0;
  let scored = 0;
  for (const row of rows) {
    const pred = predictFn(row);
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

function computePUpFromWeightsObject(weightsObj, row) {
  const x = rowToFeatureVector(row);
  let z = Number(weightsObj.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    z += Number(weightsObj[FEATURE_NAMES[i]] ?? 0) * x[i];
  }
  return sigmoid(z);
}

function predictDirectionFromWeightsObject(weightsObj, row) {
  const pUp = computePUpFromWeightsObject(weightsObj, row);
  return directionFromPUp(pUp);
}

async function collectEnsembleStubRows({ ids, from, to, step }) {
  const weights = calibration.getCompositeWeights();
  const rows = [];
  for (const id of ids) {
    const spec = INSTRUMENT_REGISTRY.find((s) => String(s.id).toLowerCase() === id);
    const bars = loadTradingBars(id);
    const indices = buildProbeIndices(bars, { from, to, step });
    let prev = 'neutral';
    for (const t of indices) {
      const row = backtest.predictAtBarIndexHistorical(spec, bars, t, weights, prev, { useEnsembleStub: true });
      if (!row) continue;
      prev = row.financeRegimeNext || prev;
      rows.push({ ...row, instrumentId: id });
    }
  }
  return rows;
}

function exportOnnxStubNote(outPath) {
  return {
    status: 'stub',
    message: 'ONNX export not implemented in Phase 3 scaffold; use logistic JSON weights or add Python/sklearn export later',
    expectedPath: outPath,
    generatedAt: new Date().toISOString(),
  };
}

function checkGate({ oosPrecious, oosAu, oosStubAu }) {
  const preciousMet = oosPrecious?.hitRatePct != null && oosPrecious.hitRatePct >= PRECIOUS_PROBE_TARGET;
  const auVsStub =
    oosAu?.hitRatePct != null &&
    oosStubAu?.hitRatePct != null &&
    oosAu.hitRatePct >= AU_OOS_GATE_PCT &&
    oosAu.hitRatePct >= oosStubAu.hitRatePct;
  return {
    preciousMet,
    auVsStub,
    passed: preciousMet || auVsStub,
  };
}

async function main() {
  const opts = parseArgs();
  diskCache.init(getDataDir());
  backtest.preloadWalkForwardCaches();
  await historicalContext.ensureFredDailyCache();
  newsTagged.loadNewsTagged({ force: true });

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

  if (opts.splitHeads) {
    await runSplitHeadTraining(opts, { allRowsFull, perInstrumentFull, trainPerId, testPerId, testRows });
    return;
  }

  const { trainIndices } = buildFeatureTrainPlan(opts.excludeFeatures);
  const trainSamples = rowsToSamples(trainRows, trainIndices.length ? trainIndices : null);
  if (trainSamples.length < 30) {
    throw new Error(`insufficient train samples: ${trainSamples.length}`);
  }

  const wTrain = trainLogistic(trainSamples, opts);
  const w = trainIndices.length
    ? expandTrainWeights(wTrain, trainIndices, FEATURE_NAMES.length)
    : wTrain;
  const weightsObj = weightsArrayToObject(w);
  const predictLogistic = (row) => predictDirectionFromWeightsObject(weightsObj, row);

  const isOverall = evaluateT3HitRate(trainRows, predictLogistic);
  const oosOverall = evaluateT3HitRate(testRows, predictLogistic);
  const isPerId = {};
  const oosPerId = {};
  for (const id of opts.ids) {
    isPerId[id] = evaluateT3HitRate(trainPerId[id], predictLogistic);
    oosPerId[id] = evaluateT3HitRate(testPerId[id], predictLogistic);
  }

  const oosStubRows = await collectEnsembleStubRows({
    ids: opts.ids,
    from: opts.testFrom,
    to: opts.testTo,
    step: opts.step,
  });
  const oosStubOverall = evaluateT3HitRate(oosStubRows, (r) => r.predictedDir);
  const oosStubAu = evaluateT3HitRate(
    oosStubRows.filter((r) => r.instrumentId === 'au' || (!r.instrumentId && opts.ids.includes('au'))),
    (r) => r.predictedDir
  );
  const oosStubAuFromId = testPerId.au?.length
    ? evaluateT3HitRate(
        (await collectEnsembleStubRows({ ids: ['au'], from: opts.testFrom, to: opts.testTo, step: opts.step })),
        (r) => r.predictedDir
      )
    : oosStubAu;

  const gate = checkGate({
    oosPrecious: oosOverall,
    oosAu: oosPerId.au,
    oosStubAu: oosStubAuFromId,
  });

  const onnxPath = getDefaultOnnxPath();
  const weightsPath = getDefaultWeightsPath();
  getModelsDir();

  const payload = {
    version: opts.version,
    ...(opts.version.includes('restored') ? { restoredFrom: 'v1.34.3-ag-term (c94e6e20)' } : {}),
    trainedAt: new Date().toISOString(),
    cv: {
      train: `${opts.trainFrom}..${opts.trainTo}`,
      test: `${opts.testFrom}..${opts.testTo}`,
    },
    instruments: opts.ids,
    step: opts.step,
    featureNames: FEATURE_NAMES,
    excludedFromTraining: opts.excludeFeatures.length ? opts.excludeFeatures : undefined,
    weights: weightsObj,
    training: {
      trainSamples: trainSamples.length,
      testSamples: rowsToSamples(testRows, trainIndices.length ? trainIndices : null).length,
      epochs: opts.epochs,
      lr: opts.lr,
      lambda: opts.lambda,
      agTrainSampleWeight: AG_TRAIN_SAMPLE_WEIGHT,
      agBasisSampleWeight: AG_BASIS_SAMPLE_WEIGHT,
    },
    validation: {
      inSample: {
        overall: isOverall,
        perInstrument: isPerId,
      },
      outOfSample: {
        overall: oosOverall,
        perInstrument: oosPerId,
        ensembleStub: {
          overall: oosStubOverall,
          au: oosStubAuFromId,
        },
      },
      deltaPp: {
        oosLogisticVsStubAu:
          oosPerId.au?.hitRatePct != null && oosStubAuFromId?.hitRatePct != null
            ? +(oosPerId.au.hitRatePct - oosStubAuFromId.hitRatePct).toFixed(2)
            : null,
        oosLogisticVsStubBaseline58_93:
          oosPerId.au?.hitRatePct != null ? +(oosPerId.au.hitRatePct - STUB_AU_T3_BASELINE).toFixed(2) : null,
        isVsOosOverall:
          isOverall.hitRatePct != null && oosOverall.hitRatePct != null
            ? +(oosOverall.hitRatePct - isOverall.hitRatePct).toFixed(2)
            : null,
      },
    },
    gate: {
      preciousOosTargetPct: PRECIOUS_PROBE_TARGET,
      auOosGatePct: AU_OOS_GATE_PCT,
      stubAuBaselinePct: STUB_AU_T3_BASELINE,
      ...gate,
    },
    onnxPath,
    onnxExport: exportOnnxStubNote(onnxPath),
    longrunPaused: !gate.preciousMet,
    preciousProbeEligible: gate.passed,
  };

  fs.writeFileSync(weightsPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
