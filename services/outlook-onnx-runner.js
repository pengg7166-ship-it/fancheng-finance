/**
 * L2 ONNX / logistic 推理 —.onnx 'onnxruntime-node，否'JSON 权重，再否则 ensemble stub
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');
const { blendEnsemble } = require('./outlook-ensemble');
const { fuseCrossMarketWithLogistic } = require('./cross-market-logistic-ensemble');
const {
  rowToFeatureVector,
  rowToAgBasisHeadFeatureVector,
  rowToAuHeadFeatureVector,
  rowToAgHeadFeatureVector,
  scoresFromFlatRowForStub,
  FEATURE_NAMES,
  AG_BASIS_HEAD_FEATURE_NAMES,
  AU_HEAD_FEATURE_NAMES,
  AG_HEAD_FEATURE_NAMES,
  getSplitHeadConfig,
} = require('./outlook-logistic-features');

const MODEL_VERSION = 'v1.34.0-phase3';
const DEFAULT_BULLISH = 0.55;
const DEFAULT_BEARISH = 0.45;

let _ortSession = null;
let _ortLoadError = null;
let _weightsCache = null;
let _onnxPathCache = null;
let _weightsPathCache = null;
let _agBasisHeadCache = null;
let _agBasisHeadPathCache = null;

function getModelsDir() {
  const dataDir = getDataDir() || path.join(process.cwd(), 'data');
  const dir = path.join(dataDir, 'outlook-models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDefaultOnnxPath() {
  return path.join(getModelsDir(), 'outlook-logistic.onnx');
}

function getDefaultWeightsPath() {
  return path.join(getModelsDir(), 'outlook-logistic-weights.json');
}

function getAgBasisHeadWeightsPath() {
  return path.join(getModelsDir(), 'outlook-logistic-ag-basis-head.json');
}

function shouldUseAgBasisHead(row = {}) {
  return (
    String(row.instrumentId || '').toLowerCase() === 'ag' &&
    (row.marketRegime || 'range') === 'basis'
  );
}

function loadAgBasisHeadJson(headPath = getAgBasisHeadWeightsPath()) {
  if (_agBasisHeadCache && _agBasisHeadPathCache === headPath) return _agBasisHeadCache;
  if (!fs.existsSync(headPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(headPath, 'utf8'));
    _agBasisHeadCache = raw;
    _agBasisHeadPathCache = headPath;
    return raw;
  } catch {
    return null;
  }
}

function sigmoid(z) {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function directionFromPUp(pUp, opts = {}) {
  const bullish = opts.bullishThreshold ?? DEFAULT_BULLISH;
  const bearish = opts.bearishThreshold ?? DEFAULT_BEARISH;
  if (pUp >= bullish) return 'bullish';
  if (pUp <= bearish) return 'bearish';
  return 'neutral';
}

function loadWeightsJson(weightsPath = getDefaultWeightsPath()) {
  if (_weightsCache && _weightsPathCache === weightsPath) return _weightsCache;
  if (!fs.existsSync(weightsPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
    _weightsCache = raw;
    _weightsPathCache = weightsPath;
    return raw;
  } catch {
    return null;
  }
}

function isSplitHeadsPayload(weightsPayload) {
  if (!weightsPayload || typeof weightsPayload !== 'object') return false;
  return (
    weightsPayload.architecture === 'split-heads' ||
    Boolean(weightsPayload.heads?.au?.weights || weightsPayload.heads?.ag?.weights)
  );
}

function resolveInstrumentHeadId(row = {}) {
  const id = String(row.instrumentId || '').toLowerCase();
  return id === 'ag' ? 'ag' : 'au';
}

function getSplitHeadPayload(weightsPayload, headId) {
  const id = String(headId || 'au').toLowerCase();
  return weightsPayload.heads?.[id] || null;
}

function resolveHeadDirectionOpts(headPayload, globalOpts = {}) {
  const th = headPayload?.directionThresholds;
  if (!th) return globalOpts;
  return {
    ...globalOpts,
    bullishThreshold: th.bullish ?? th.bullishThreshold ?? globalOpts.bullishThreshold,
    bearishThreshold: th.bearish ?? th.bearishThreshold ?? globalOpts.bearishThreshold,
  };
}

function predictFromSplitHead(weightsPayload, row, opts = {}) {
  const headId = resolveInstrumentHeadId(row);
  const headPayload = getSplitHeadPayload(weightsPayload, headId);
  if (!headPayload?.weights) return null;
  const vectorFn = headId === 'ag' ? rowToAgHeadFeatureVector : rowToAuHeadFeatureVector;
  const featureNames = headPayload.featureNames || (headId === 'ag' ? AG_HEAD_FEATURE_NAMES : AU_HEAD_FEATURE_NAMES);
  const philosophyScale = headPayload.philosophyScale ?? getSplitHeadConfig(headId).philosophyScale;
  const headOpts = resolveHeadDirectionOpts(headPayload, opts);
  return predictFromHeadWeights(
    { ...headPayload, featureNames, philosophyScale },
    row,
    headOpts,
    {
      vectorFn: (r) => vectorFn(r, philosophyScale),
      featureNames,
    }
  );
}

function predictFromHeadWeights(headPayload, row, opts = {}, { vectorFn, featureNames }) {
  const x = vectorFn(row);
  const names = headPayload.featureNames || featureNames;
  const w = headPayload.weights || {};
  let z = Number(w.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    const key = names[i];
    z += Number(w[key] ?? 0) * x[i];
  }
  const pUp = sigmoid(z);
  const direction = directionFromPUp(pUp, opts);
  const composite = Math.max(-1, Math.min(1, (pUp - 0.5) * 2));
  return {
    composite: +composite.toFixed(4),
    direction,
    pUp: +pUp.toFixed(4),
    regime: row.marketRegime || 'range',
    version: headPayload.version || MODEL_VERSION,
    backend:
      headPayload.role === 'ag-basis-secondary-head' || headPayload.head === 'ag-basis'
        ? 'logistic-ag-basis-head'
        : 'logistic-split-head',
    head:
      headPayload.head ||
      (headPayload.role === 'ag-basis-secondary-head' ? 'ag-basis' : headPayload.role || 'split'),
    onnxReady: false,
  };
}

function predictFromWeights(weightsPayload, row, opts = {}) {
  const headPath = opts.agBasisHeadPath || getAgBasisHeadWeightsPath();
  if (shouldUseAgBasisHead(row)) {
    const headPayload = loadAgBasisHeadJson(headPath);
    if (headPayload?.weights) {
      return predictFromHeadWeights(headPayload, row, opts, {
        vectorFn: rowToAgBasisHeadFeatureVector,
        featureNames: AG_BASIS_HEAD_FEATURE_NAMES,
      });
    }
  }

  if (isSplitHeadsPayload(weightsPayload)) {
    const splitOut = predictFromSplitHead(weightsPayload, row, opts);
    if (splitOut) {
      return {
        ...splitOut,
        version: weightsPayload.version || splitOut.version,
        backend: 'logistic-split-head',
      };
    }
  }

  const x = rowToFeatureVector(row);
  const names = weightsPayload.featureNames || FEATURE_NAMES;
  const w = weightsPayload.weights || {};
  let z = Number(w.bias ?? 0);
  for (let i = 0; i < x.length; i += 1) {
    const key = names[i];
    z += Number(w[key] ?? 0) * x[i];
  }
  const pUp = sigmoid(z);
  const direction = directionFromPUp(pUp, opts);
  const composite = Math.max(-1, Math.min(1, (pUp - 0.5) * 2));
  const base = {
    composite: +composite.toFixed(4),
    direction,
    pUp: +pUp.toFixed(4),
    regime: row.marketRegime || 'range',
    version: weightsPayload.version || MODEL_VERSION,
    backend: 'logistic-json',
    onnxReady: Boolean(weightsPayload.onnxPath && fs.existsSync(weightsPayload.onnxPath)),
  };
  return fuseCrossMarketWithLogistic(base, row, opts);
}

async function tryLoadOrtSession(onnxPath = getDefaultOnnxPath()) {
  if (_ortSession && _onnxPathCache === onnxPath) return _ortSession;
  if (_ortLoadError && _onnxPathCache === onnxPath) return null;
  if (!fs.existsSync(onnxPath)) return null;
  try {
    const ort = require('onnxruntime-node');
    _ortSession = await ort.InferenceSession.create(onnxPath);
    _onnxPathCache = onnxPath;
    _ortLoadError = null;
    return _ortSession;
  } catch (err) {
    _ortLoadError = err;
    _onnxPathCache = onnxPath;
    return null;
  }
}

async function predictFromOnnx(session, row, opts = {}) {
  const ort = require('onnxruntime-node');
  const x = rowToFeatureVector(row);
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor('float32', Float32Array.from(x), [1, x.length]);
  const feeds = { [inputName]: tensor };
  const out = await session.run(feeds);
  const outputName = session.outputNames[0];
  const raw = out[outputName]?.data?.[0];
  const pUp = raw != null && raw >= 0 && raw <= 1 ? raw : sigmoid(raw);
  const direction = directionFromPUp(pUp, opts);
  const composite = Math.max(-1, Math.min(1, (pUp - 0.5) * 2));
  return {
    composite: +composite.toFixed(4),
    direction,
    pUp: +pUp.toFixed(4),
    regime: row.marketRegime || 'range',
    version: MODEL_VERSION,
    backend: 'onnx',
    onnxReady: true,
  };
}

function predictFromStub(row, opts = {}) {
  const scores = scoresFromFlatRowForStub(row);
  const out = blendEnsemble(scores, row.marketRegime || 'range', opts);
  return { ...out, backend: 'ensemble-stub' };
}

/**
 * 同步推理（回'walk-forward）'JSON 权重'stub；已 warm 'ONNX session 亦可
 */
function predictEnsembleSync(row, opts = {}) {
  if (_ortSession && opts.allowOnnx !== false) {
    try {
      const ort = require('onnxruntime-node');
      const x = rowToFeatureVector(row);
      const inputName = _ortSession.inputNames[0];
      const tensor = new ort.Tensor('float32', Float32Array.from(x), [1, x.length]);
      const out = _ortSession.run({ [inputName]: tensor });
      if (out && typeof out.then === 'function') {
        // session.run async 'skip in sync path
      } else {
        const outputName = _ortSession.outputNames[0];
        const raw = out[outputName]?.data?.[0];
        const pUp = raw != null && raw >= 0 && raw <= 1 ? raw : sigmoid(raw);
        const direction = directionFromPUp(pUp, opts);
        const composite = Math.max(-1, Math.min(1, (pUp - 0.5) * 2));
        return {
          composite: +composite.toFixed(4),
          direction,
          pUp: +pUp.toFixed(4),
          regime: row.marketRegime || 'range',
          version: MODEL_VERSION,
          backend: 'onnx',
          onnxReady: true,
        };
      }
    } catch {
      // fall through
    }
  }

  const weightsPath = opts.weightsPath || getDefaultWeightsPath();
  const weights = loadWeightsJson(weightsPath);
  if (weights?.weights || isSplitHeadsPayload(weights)) {
    return predictFromWeights(weights, row, opts);
  }

  return predictFromStub(row, opts);
}

/**
 * @param {object} row 'predictAtBarIndexHistorical flatRow
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
async function predictEnsemble(row, opts = {}) {
  const onnxPath = opts.onnxPath || getDefaultOnnxPath();
  const weightsPath = opts.weightsPath || getDefaultWeightsPath();

  const session = await tryLoadOrtSession(onnxPath);
  if (session) {
    try {
      return await predictFromOnnx(session, row, opts);
    } catch {
      // fall through
    }
  }

  const weights = loadWeightsJson(weightsPath);
  if (weights?.weights || isSplitHeadsPayload(weights)) {
    return predictFromWeights(weights, row, opts);
  }

  return predictFromStub(row, opts);
}

function getRunnerStatus() {
  const onnxPath = getDefaultOnnxPath();
  const weightsPath = getDefaultWeightsPath();
  return {
    onnxPath,
    onnxPresent: fs.existsSync(onnxPath),
    weightsPath,
    weightsPresent: fs.existsSync(weightsPath),
    ortAvailable: (() => {
      try {
        require.resolve('onnxruntime-node');
        return true;
      } catch {
        return false;
      }
    })(),
    ortLoadError: _ortLoadError ? String(_ortLoadError.message || _ortLoadError) : null,
    fallback: 'ensemble-stub',
    version: MODEL_VERSION,
  };
}

function clearRunnerCache() {
  _ortSession = null;
  _ortLoadError = null;
  _weightsCache = null;
  _onnxPathCache = null;
  _weightsPathCache = null;
  _agBasisHeadCache = null;
  _agBasisHeadPathCache = null;
}

module.exports = {
  MODEL_VERSION,
  FEATURE_NAMES,
  getModelsDir,
  getDefaultOnnxPath,
  getDefaultWeightsPath,
  getAgBasisHeadWeightsPath,
  shouldUseAgBasisHead,
  loadAgBasisHeadJson,
  isSplitHeadsPayload,
  predictFromSplitHead,
  predictEnsemble,
  predictEnsembleSync,
  predictFromWeights,
  predictFromStub,
  getRunnerStatus,
  clearRunnerCache,
  tryLoadOrtSession,
  directionFromPUp,
  sigmoid,
};
