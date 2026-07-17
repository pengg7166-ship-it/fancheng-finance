/**
 * 贵金属（AU/AG）下一交易'high/low 区间校准参数
 * KPI：真'high '预测 high '真实 low '预测 low（range coverage'
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const CAL_VERSION = 'precious-range-v1';
const DEFAULT_PARAMS = {
  au: {
    upMult: 1.3,
    downMult: 1.1,
    centerLean: 0.35,
    minSigmaPct: 0.008,
    volWindow: 20,
  },
  ag: {
    upMult: 1.25,
    downMult: 1.65,
    centerLean: 0.3,
    minSigmaPct: 0.012,
    volWindow: 20,
  },
};

let cachedParams = null;

function calFilePath() {
  const base = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(base, 'outlook-models', 'precious-range-calibration-v1.json');
}

function loadCalParams(force = false) {
  if (cachedParams && !force) return cachedParams;
  const fp = calFilePath();
  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      cachedParams = {
        version: raw.version || CAL_VERSION,
        trainFrom: raw.trainFrom,
        trainTo: raw.trainTo,
        oosFrom: raw.oosFrom,
        oosTo: raw.oosTo,
        au: { ...DEFAULT_PARAMS.au, ...(raw.au || raw.instruments?.au || {}) },
        ag: { ...DEFAULT_PARAMS.ag, ...(raw.ag || raw.instruments?.ag || {}) },
        metrics: raw.metrics || null,
      };
      return cachedParams;
    }
  } catch {
    // fall through
  }
  cachedParams = {
    version: CAL_VERSION,
    au: { ...DEFAULT_PARAMS.au },
    ag: { ...DEFAULT_PARAMS.ag },
    metrics: null,
  };
  return cachedParams;
}

function saveCalParams(payload) {
  const fp = calFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf8');
  cachedParams = null;
  return fp;
}

function getInstrumentCal(instrumentId) {
  const id = String(instrumentId || '').toLowerCase();
  const all = loadCalParams();
  return all[id] || DEFAULT_PARAMS[id] || null;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/**
 * 贵金属区间：锚定昨收，上下不对称延伸 + 跨境方向偏置
 * @param {{
 *   instrumentId: 'au'|'ag',
 *   baselineClose: number,
 *   upExtents?: number[],
 *   downExtents?: number[],
 *   pointDelta?: number|null,
 *   sigma?: number|null,
 *   cal?: object,
 * }} opts
 */
function computePreciousRangeBand(opts = {}) {
  const id = String(opts.instrumentId || '').toLowerCase();
  const cal = opts.cal || getInstrumentCal(id);
  if (!cal || !opts.baselineClose) return null;

  const digits = id === 'au' ? 2 : 0;
  const round = (v) => (v != null ? +Number(v).toFixed(digits) : null);
  const baseline = Number(opts.baselineClose);

  const meanUp = opts.upExtents?.length ? mean(opts.upExtents) : null;
  const meanDown = opts.downExtents?.length ? mean(opts.downExtents) : null;
  const sigma = opts.sigma != null && opts.sigma > 0 ? opts.sigma : null;

  const minHalf = baseline * (cal.minSigmaPct || 0.008);
  let upHalf = Math.max(meanUp ?? 0, (sigma ?? 0) * 0.5, minHalf) * (cal.upMult || 1);
  let downHalf = Math.max(meanDown ?? 0, (sigma ?? 0) * 0.5, minHalf) * (cal.downMult || 1);

  const lean = cal.centerLean ?? 0.35;
  const pt = opts.pointDelta != null ? Number(opts.pointDelta) : 0;
  const centerShift = pt * lean;

  let predictedHigh = baseline + upHalf + Math.max(0, centerShift);
  let predictedLow = baseline - downHalf + Math.min(0, centerShift);

  const lowBias = (cal.lowBiasPct || 0) * baseline;
  if (lowBias > 0) predictedLow += lowBias;

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
  DEFAULT_PARAMS,
  calFilePath,
  loadCalParams,
  saveCalParams,
  getInstrumentCal,
  computePreciousRangeBand,
  resetCalCache,
};
