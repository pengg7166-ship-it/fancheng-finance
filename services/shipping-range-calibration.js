/**
 * 航运系（EC 集运指数/欧线）下一交易'high/low 区间校准参数
 * KPI：真'high '预测 high '真实 low '预测 low（range coverage'
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const CAL_VERSION = 'shipping-range-v1';

/** INE 集运指数 '2023 上市，高波动 */
const CALIBRATED_IDS = ['ec'];

const DEFAULT_PARAMS = {
  ec: { upMult: 1.65, downMult: 1.65, centerLean: 0.12, minSigmaPct: 0.03, volWindow: 20 },
};

let cachedParams = null;

function calFilePath() {
  const base = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(base, 'outlook-models', 'shipping-range-calibration-v1.json');
}

function loadCalParams(force = false) {
  if (cachedParams && !force) return cachedParams;
  const fp = calFilePath();
  const merged = {};
  for (const id of CALIBRATED_IDS) {
    merged[id] = { ...DEFAULT_PARAMS[id] };
  }
  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const id of CALIBRATED_IDS) {
        merged[id] = { ...DEFAULT_PARAMS[id], ...(raw[id] || raw.instruments?.[id] || {}) };
      }
      cachedParams = {
        version: raw.version || CAL_VERSION,
        trainFrom: raw.trainFrom,
        trainTo: raw.trainTo,
        oosFrom: raw.oosFrom,
        oosTo: raw.oosTo,
        ...merged,
        metrics: raw.metrics || null,
      };
      return cachedParams;
    }
  } catch {
    // fall through
  }
  cachedParams = { version: CAL_VERSION, ...merged, metrics: null };
  return cachedParams;
}

function saveCalParams(payload) {
  const fp = calFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  cachedParams = null;
  return fp;
}

function isCalibrated(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (!CALIBRATED_IDS.includes(id)) return false;
  if (!fs.existsSync(calFilePath())) return false;
  const all = loadCalParams();
  return !!all.metrics?.[id];
}

function getInstrumentCal(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  if (!CALIBRATED_IDS.includes(id)) return null;
  const all = loadCalParams();
  return all[id] || DEFAULT_PARAMS[id] || null;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function priceDigits(instrumentId, baseline) {
  if (baseline >= 10000) return 0;
  if (baseline >= 1000) return 1;
  if (baseline >= 100) return 1;
  return 2;
}

/**
 * 航运系区间：锚定昨收，上下不对称延伸（无跨市场偏置）
 */
function computeShippingRangeBand(opts = {}) {
  const id = String(opts.instrumentId || '').toLowerCase();
  const cal = opts.cal || getInstrumentCal(id);
  if (!cal || !opts.baselineClose) return null;

  const baseline = Number(opts.baselineClose);
  const digits = priceDigits(id, baseline);
  const round = (v) => (v != null ? +Number(v).toFixed(digits) : null);

  const meanUp = opts.upExtents?.length ? mean(opts.upExtents) : null;
  const meanDown = opts.downExtents?.length ? mean(opts.downExtents) : null;
  const sigma = opts.sigma != null && opts.sigma > 0 ? opts.sigma : null;

  const minHalf = baseline * (cal.minSigmaPct || 0.01);
  let upHalf = Math.max(meanUp ?? 0, (sigma ?? 0) * 0.5, minHalf) * (cal.upMult || 1);
  let downHalf = Math.max(meanDown ?? 0, (sigma ?? 0) * 0.5, minHalf) * (cal.downMult || 1);

  const lean = cal.centerLean ?? 0.15;
  const pt = opts.pointDelta != null ? Number(opts.pointDelta) : 0;
  const centerShift = pt * lean;

  let predictedHigh = baseline + upHalf + Math.max(0, centerShift);
  let predictedLow = baseline - downHalf + Math.min(0, centerShift);

  if (predictedLow > predictedHigh) [predictedLow, predictedHigh] = [predictedHigh, predictedLow];

  return {
    predictedHigh: round(predictedHigh),
    predictedLow: round(predictedLow),
    upHalf: round(upHalf),
    downHalf: round(downHalf),
    centerShift: round(centerShift),
    calVersion: cal.version || CAL_VERSION,
  };
}

function resetCalCache() {
  cachedParams = null;
}

module.exports = {
  CAL_VERSION,
  CALIBRATED_IDS,
  DEFAULT_PARAMS,
  calFilePath,
  loadCalParams,
  saveCalParams,
  isCalibrated,
  getInstrumentCal,
  computeShippingRangeBand,
  resetCalCache,
};
