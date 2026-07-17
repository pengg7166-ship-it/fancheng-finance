/**
 * 农产品系（M/Y/P/C/CF/SR/OI…）下一交易'high/low 区间校准参数
 * KPI：真'high '预测 high '真实 low '预测 low（range coverage'
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./data-paths');

const CAL_VERSION = 'agricultural-range-v1';

/**
 * 农产—commodity-instrument-profiles ID_SECTOR=agriculture
 * 不含 au/ag（贵金属）、不含已属其它板块的品种
 * 按流动'/ 数据覆盖排序
 */
const CALIBRATED_IDS = [
  'm', 'y', 'p', 'c', 'cf', 'sr', 'oi', 'rm', 'jd', 'lh', 'ap', 'cs', 'a', 'b',
  'cj', 'pk', 'cy', 'rs', 'wh', 'pm', 'ri', 'lr', 'rr', 'lg', 'sp',
];

const DEFAULT_BASE = { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 };

const DEFAULT_PARAMS = {
  m: { ...DEFAULT_BASE, yCrossBias: true },
  y: { ...DEFAULT_BASE, mCrossBias: true },
  p: { ...DEFAULT_BASE, yCrossBias: true },
  c: { ...DEFAULT_BASE },
  cf: { ...DEFAULT_BASE },
  sr: { ...DEFAULT_BASE },
  oi: { ...DEFAULT_BASE, rmCrossBias: true },
  rm: { ...DEFAULT_BASE, oiCrossBias: true },
  jd: { ...DEFAULT_BASE, minSigmaPct: 0.016 },
  lh: { ...DEFAULT_BASE, minSigmaPct: 0.022, upMult: 1.5, downMult: 1.45 },
  ap: { ...DEFAULT_BASE, minSigmaPct: 0.018 },
  cs: { ...DEFAULT_BASE, cCrossBias: true },
  a: { ...DEFAULT_BASE },
  b: { ...DEFAULT_BASE },
  cj: { ...DEFAULT_BASE, minSigmaPct: 0.018 },
  pk: { ...DEFAULT_BASE, minSigmaPct: 0.022, upMult: 1.5, downMult: 1.45 },
  cy: { ...DEFAULT_BASE, cfCrossBias: true },
  rs: { ...DEFAULT_BASE },
  wh: { ...DEFAULT_BASE, minSigmaPct: 0.016 },
  pm: { ...DEFAULT_BASE, minSigmaPct: 0.016 },
  ri: { ...DEFAULT_BASE, minSigmaPct: 0.016 },
  lr: { ...DEFAULT_BASE, minSigmaPct: 0.016 },
  rr: { ...DEFAULT_BASE },
  lg: { ...DEFAULT_BASE },
  sp: { ...DEFAULT_BASE, minSigmaPct: 0.016, upMult: 1.25, downMult: 1.1, centerLean: 0.18, volWindow: 20 },
};

let cachedParams = null;

function calFilePath() {
  const base = getDataDir() || path.join(process.cwd(), 'data');
  return path.join(base, 'outlook-models', 'agricultural-range-calibration-v1.json');
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
 * 农产品区间：锚定昨收，上下不对称延伸 + 可选方向偏'
 */
function computeAgriculturalRangeBand(opts = {}) {
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

  const lean = cal.centerLean ?? 0.2;
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
  computeAgriculturalRangeBand,
  resetCalCache,
};
