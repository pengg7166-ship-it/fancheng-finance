/**

 * Rolling range bias correction from range-prediction-archive.

 * Shifts H/L toward recent actual-vs-predicted median miss; optional width shrink when bands too loose.

 */

const archive = require('./range-prediction-archive');



const DEFAULT_SESSIONS = 8;

const MIN_SESSIONS = 3;

const BIAS_DAMP = 0.35;

/** v1.35.6: only shrink when bands are very loose AND errors are tiny */
const SHRINK_WHEN_HIT_ABOVE = 0.85;

const SHRINK_MAE_PCT_MAX = 0.012;

const SHRINK_FACTOR = 0.96;



function median(arr) {

  if (!arr.length) return null;

  const s = [...arr].sort((a, b) => a - b);

  const m = Math.floor(s.length / 2);

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;

}



function priceDigits(instrumentId, baseline) {

  const id = String(instrumentId || '').toLowerCase();

  if (id === 'au') return 2;

  if (id === 'ag') return 0;

  if (baseline >= 10000) return 0;

  if (baseline >= 1000) return 1;

  if (baseline >= 100) return 1;

  return 2;

}



function roundPrice(v, digits) {

  if (v == null || Number.isNaN(Number(v))) return null;

  return +Number(v).toFixed(digits);

}



/**

 * @param {string} instrumentId

 * @param {{ sessions?: number, from?: string }} [opts]

 */

function computeRollingBias(instrumentId, opts = {}) {

  const id = String(instrumentId || '').toLowerCase();

  const sessions = opts.sessions ?? DEFAULT_SESSIONS;

  const rows = archive

    .loadArchive(id, opts.from ? { from: opts.from } : {})

    .filter((r) => r.bandHit != null && r.highError != null && r.lowError != null)

    .slice(-sessions);



  if (rows.length < MIN_SESSIONS) return null;



  const highMed = median(rows.map((r) => r.highError));

  const lowMed = median(rows.map((r) => r.lowError));

  const bandHits = rows.filter((r) => r.bandHit).length;

  const hitRate = bandHits / rows.length;

  const avgHighErr = rows.reduce((s, r) => s + Math.abs(r.highError || 0), 0) / rows.length;

  const avgLowErr = rows.reduce((s, r) => s + Math.abs(r.lowError || 0), 0) / rows.length;

  const midBase =
    rows.reduce((s, r) => s + (r.baseClose || ((r.predHigh + r.predLow) / 2) || 0), 0) / rows.length;

  const combinedMaePct = midBase > 0 ? (avgHighErr + avgLowErr) / (2 * midBase) : 1;

  const shrink =
    hitRate >= SHRINK_WHEN_HIT_ABOVE && combinedMaePct <= SHRINK_MAE_PCT_MAX ? SHRINK_FACTOR : 1;



  return {

    instrumentId: id,

    n: rows.length,

    highShift: highMed != null ? highMed * BIAS_DAMP : 0,

    lowShift: lowMed != null ? lowMed * BIAS_DAMP : 0,

    hitRate: +hitRate.toFixed(4),

    combinedMaePct: +combinedMaePct.toFixed(6),

    shrink,

  };

}



/**

 * Apply rolling archive bias to a high/low prediction object.

 * @param {{ instrumentId: string, prediction: object, sessions?: number }} opts

 */

function applyRollingBiasCorrection(opts = {}) {

  const pred = opts.prediction;

  if (!pred?.predictedHigh || !pred?.predictedLow) return pred;



  const bias = computeRollingBias(opts.instrumentId, { sessions: opts.sessions });

  if (!bias) return pred;

  // v1.35.6: do not tighten/shift when recent archive hit already below sim floor
  if (bias.hitRate < 0.75) {
    return {
      ...pred,
      biasCorrection: { skipped: true, hitRate: bias.hitRate, n: bias.n },
    };
  }



  const base = pred.baseClose ?? pred.baseline;

  const digits = priceDigits(opts.instrumentId, base);



  let hi = Number(pred.predictedHigh) + bias.highShift;

  let lo = Number(pred.predictedLow) + bias.lowShift;



  if (bias.shrink < 1) {

    const mid = (hi + lo) / 2;

    const half = ((hi - lo) / 2) * bias.shrink;

    hi = mid + half;

    lo = mid - half;

  }



  if (lo > hi) [lo, hi] = [hi, lo];



  const predictedHigh = roundPrice(hi, digits);

  const predictedLow = roundPrice(lo, digits);

  const baseR = roundPrice(base, digits);



  return {

    ...pred,

    predictedHigh,

    predictedLow,

    highDelta:

      predictedHigh != null && baseR != null ? roundPrice(predictedHigh - baseR, digits) : pred.highDelta,

    lowDelta:

      predictedLow != null && baseR != null ? roundPrice(predictedLow - baseR, digits) : pred.lowDelta,

    rangeDelta:

      predictedHigh != null && predictedLow != null

        ? roundPrice(predictedHigh - predictedLow, digits)

        : pred.rangeDelta,

    biasCorrection: {

      highShift: roundPrice(bias.highShift, digits),

      lowShift: roundPrice(bias.lowShift, digits),

      shrink: bias.shrink,

      n: bias.n,

      hitRate: bias.hitRate,

    },

    method: pred.method ? `${pred.method}+bias` : 'bias-corrected',

  };

}



/**

 * Regime-based band shrink when realized vol is low relative to baseline.

 */

function applyRegimeShrink(prediction, sigma, baseline) {

  if (!prediction?.predictedHigh || !prediction?.predictedLow || !baseline || !sigma) return prediction;

  const volPct = sigma / baseline;

  if (volPct >= 0.011) return prediction;



  const digits = priceDigits(prediction.instrumentId, baseline);

  const shrink = volPct < 0.009 ? 0.94 : 0.97;

  const mid = (prediction.predictedHigh + prediction.predictedLow) / 2;

  const half = ((prediction.predictedHigh - prediction.predictedLow) / 2) * shrink;

  let hi = mid + half;

  let lo = mid - half;

  if (lo > hi) [lo, hi] = [hi, lo];



  return {

    ...prediction,

    predictedHigh: roundPrice(hi, digits),

    predictedLow: roundPrice(lo, digits),

    regimeShrink: shrink,

  };

}



module.exports = {

  computeRollingBias,

  applyRollingBiasCorrection,

  applyRegimeShrink,

  BIAS_DAMP,

};


