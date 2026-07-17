/**

 * 化工系（FG/SA/MA/TA/EG/PP/L/V/UR…）下一交易'high/low 区间校准参数

 * KPI：真'high '预测 high '真实 low '预测 low（range coverage'
 */

const fs = require('fs');

const path = require('path');

const { getDataDir } = require('./data-paths');
const priceTick = require('./price-tick');



const CAL_VERSION = 'chemical-range-v1';



/**

 * 化工—commodity-instrument-profiles ID_SECTOR=chemical

 * 不含 jm（已'black-range 校准）、不'sc/fu 等能'
 * 按流动'/ 数据覆盖排序

 */

const CALIBRATED_IDS = [

  'fg', 'sa', 'ma', 'ta', 'eg', 'pp', 'l', 'v', 'ur', 'eb', 'pf',

  'ru', 'br', 'px', 'sh', 'pr', 'ad',

];



const DEFAULT_PARAMS = {

  fg: {
    upMult: 1.2,
    downMult: 1.3,
    centerLean: 0.12,
    minSigmaPct: 0.008,
    volWindow: 20,
    maxUpPct: 0.015,
    maxDownPct: 0.018,
    maxSpreadYuan: 20,
    lowBiasPct: 0,
  },

  sa: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 },

  ma: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20, taCrossBias: true },

  ta: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 },

  eg: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.015, volWindow: 20 },

  pp: { upMult: 1.3, downMult: 1.25, centerLean: 0.2, minSigmaPct: 0.012, volWindow: 20, lCrossBias: true },

  l: { upMult: 1.3, downMult: 1.25, centerLean: 0.2, minSigmaPct: 0.012, volWindow: 20 },

  v: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 },

  ur: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 },

  eb: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.015, volWindow: 20, egCrossBias: true },

  pf: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 },

  ru: { upMult: 1.35, downMult: 1.3, centerLean: 0.2, minSigmaPct: 0.014, volWindow: 20 },

  br: { upMult: 1.4, downMult: 1.35, centerLean: 0.18, minSigmaPct: 0.016, volWindow: 20 },

  px: { upMult: 1.4, downMult: 1.35, centerLean: 0.18, minSigmaPct: 0.016, volWindow: 20 },

  sh: { upMult: 1.4, downMult: 1.35, centerLean: 0.18, minSigmaPct: 0.016, volWindow: 20 },

  pr: { upMult: 1.45, downMult: 1.4, centerLean: 0.18, minSigmaPct: 0.018, volWindow: 20 },

  ad: { upMult: 1.45, downMult: 1.4, centerLean: 0.18, minSigmaPct: 0.018, volWindow: 20 },

};



let cachedParams = null;



function calFilePath() {

  const base = getDataDir() || path.join(process.cwd(), 'data');

  return path.join(base, 'outlook-models', 'chemical-range-calibration-v1.json');

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

  const id = String(instrumentId || '').toLowerCase();

  if (baseline >= 10000) return 0;

  if (baseline >= 1000) return 1;

  if (baseline >= 100) return 1;

  return 2;

}



/**

 * 化工系区间：锚定昨收，上下不对称延伸 + 可选方向偏'
 */

function computeChemicalRangeBand(opts = {}) {

  const id = String(opts.instrumentId || '').toLowerCase();

  const cal = opts.cal || getInstrumentCal(id);

  if (!cal || !opts.baselineClose) return null;



  const baseline = Number(opts.baselineClose);

  const digits = priceDigits(id, baseline);

  const round = (v) => (v != null ? priceTick.roundPriceToTick(id, v) : null);



  const meanUp = opts.upExtents?.length ? mean(opts.upExtents) : null;

  const meanDown = opts.downExtents?.length ? mean(opts.downExtents) : null;

  const sigma = opts.sigma != null && opts.sigma > 0 ? opts.sigma : null;



  const minHalf = baseline * (cal.minSigmaPct || 0.01);

  const sigmaHalf = sigma != null && sigma > 0 ? sigma * 0.5 : 0;

  const extentCount = Math.min(opts.upExtents?.length ?? 0, opts.downExtents?.length ?? 0);

  const hasExtents = extentCount >= 6 && meanUp != null && meanDown != null;

  let upHalf;

  let downHalf;

  if (hasExtents) {

    upHalf = meanUp * (cal.upMult || 1);

    downHalf = meanDown * (cal.downMult || 1);

  } else {

    upHalf = Math.max(sigmaHalf, minHalf) * (cal.upMult || 1);

    downHalf = Math.max(sigmaHalf, minHalf) * (cal.downMult || 1);

  }

  const maxUpPct = cal.maxUpPct ?? 0.022;

  const maxDownPct = cal.maxDownPct ?? 0.028;

  upHalf = Math.min(upHalf, baseline * maxUpPct);

  downHalf = Math.min(downHalf, baseline * maxDownPct);



  const lean = cal.centerLean ?? 0.2;

  const pt = opts.pointDelta != null ? Number(opts.pointDelta) : 0;

  const centerShift = pt * lean;



  let predictedHigh = baseline + upHalf + Math.max(0, centerShift);

  let predictedLow = baseline - downHalf + Math.min(0, centerShift);



  const lowBias = (cal.lowBiasPct || 0) * baseline;

  if (lowBias > 0) predictedLow += lowBias;



  if (predictedLow > predictedHigh) [predictedLow, predictedHigh] = [predictedHigh, predictedLow];

  const maxSpreadYuan = cal.maxSpreadYuan;
  if (maxSpreadYuan != null && maxSpreadYuan > 0) {
    const spread = predictedHigh - predictedLow;
    if (spread > maxSpreadYuan) {
      const center = (predictedHigh + predictedLow) / 2;
      const half = maxSpreadYuan / 2;
      predictedHigh = center + half;
      predictedLow = center - half;
    }
  }

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

  computeChemicalRangeBand,

  resetCalCache,

};


