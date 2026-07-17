/**

 * 下一交易日最'最低点位预—国内期货 session 对齐

 * 基准 = 昨收（T '15:00 close，非 settle'
 * 目标 = 下一交易日（T '21:00 夜盘 'T+1 '15:00）high/low

 * 委托 intraday-range-predictor 核心算法

 */

const { getCommodityMeta } = require('./commodities-catalog');

const { classifyMarketRegime } = require('./market-regime-classifier');

const cnSession = require('./cn-futures-session-calendar');

const {

  predictNextDayHighLowFromBars,

  predictNextDayHighLow,

  rollingMeanRange,

  loadEffectiveBars,

} = require('./intraday-range-predictor');

const crossVolMagnitude = require('./cross-vol-magnitude');
const chemicalCal = require('./chemical-range-calibration');
const priceTick = require('./price-tick');

const PREDICTOR_VERSION = 'v1.2-cn-session-range';

const DEFAULT_LOOKBACK = 15;

const MIN_BARS = 10;



/** L1 market regime '区间宽度乘数 */

const REGIME_RANGE_MULT = {

  event: 1.25,

  trend: 1.05,

  range: 0.92,

  seasonal: 1.0,

  basis: 1.08,

};



function normBarDate(bar) {

  return String(bar?.date || bar?.time || '').slice(0, 10);

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



function roundPrice(v, digitsOrId) {
  if (v == null || Number.isNaN(Number(v))) return null;
  if (typeof digitsOrId === 'string') return priceTick.roundPriceToTick(digitsOrId, v);
  return +Number(v).toFixed(digitsOrId);
}



function computeIntradayStats(bars, idx, lookback = DEFAULT_LOOKBACK) {

  const collected = cnSession.collectSessionExtents(bars, idx, lookback);

  const { ranges, upExtents, downExtents, n } = collected;

  if (n < MIN_BARS - 2) return null;

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {

    meanRange: mean(ranges),

    meanUp: mean(upExtents),

    meanDown: mean(downExtents),

    n,

  };

}



function resolveRegimeMultiplier(regime) {

  const r = String(regime || '').toLowerCase();

  if (REGIME_RANGE_MULT[r] != null) return REGIME_RANGE_MULT[r];

  return 1.0;

}



function resolveMarketRegime({ regime, marketRegime, asOfDate, instrumentId, barIdx, bars, technical, newsImpact }) {

  if (marketRegime && REGIME_RANGE_MULT[String(marketRegime).toLowerCase()] != null) {

    return String(marketRegime).toLowerCase();

  }

  if (regime && REGIME_RANGE_MULT[String(regime).toLowerCase()] != null) {

    return String(regime).toLowerCase();

  }

  try {

    const cls = classifyMarketRegime({

      barDate: asOfDate,

      instrumentId,

      barIndex: barIdx,

      klines: bars,

      technical: technical || {},

      newsImpact: newsImpact || {},

    });

    return cls?.regime || 'range';

  } catch {

    return 'range';

  }

}



function buildResult(hl, baselineDate, regimeMult, modelSourceOverride) {

  if (!hl) return null;

  return {

    version: PREDICTOR_VERSION,

    baseline: hl.baseClose,

    baselineDate,

    predictedHigh: hl.predictedHigh,

    predictedLow: hl.predictedLow,

    highDelta: hl.highDelta,

    lowDelta: hl.lowDelta,

    rangeSpread: hl.rangeDelta,

    unit: hl.unit || '',

    confidence: hl.confidence || '',

    modelSource: modelSourceOverride || hl.method || 'intraday-range',

    regimeMult: regimeMult != null ? +regimeMult.toFixed(3) : 1,

    session: hl.session || null,

    labels: hl.labels || cnSession.LABELS,

  };

}



function applyRegimeMultFromBaseline(baseline, predictedHigh, predictedLow, regimeMult, instrumentId) {

  if (regimeMult === 1 || baseline == null) {

    return { predictedHigh, predictedLow };

  }

  const up = (predictedHigh - baseline) * regimeMult;

  const down = (baseline - predictedLow) * regimeMult;

  return {

    predictedHigh: roundPrice(baseline + up, instrumentId),

    predictedLow: roundPrice(baseline - down, instrumentId),

  };

}



function enforceCalibratedMaxSpread(instrumentId, predictedHigh, predictedLow) {
  const maxSpread = chemicalCal.getInstrumentCal(instrumentId)?.maxSpreadYuan;
  let hi = predictedHigh;
  let lo = predictedLow;
  if (maxSpread && maxSpread > 0 && hi != null && lo != null) {
    const spread = hi - lo;
    if (spread > maxSpread) {
      const center = (hi + lo) / 2;
      const half = maxSpread / 2;
      hi = center + half;
      lo = center - half;
    }
  }
  return {
    predictedHigh: roundPrice(hi, instrumentId),
    predictedLow: roundPrice(lo, instrumentId),
  };
}



function mapHighLowToLegacy(hl, baselineDate, regimeMult, modelSource) {

  const base = buildResult(hl, baselineDate, regimeMult, modelSource);

  if (!base) return null;

  return base;

}



/**

 * @param {{

 *   instrumentId: string,

 *   klines?: Array<{date?:string,time?:string,open?:number,high?:number,low?:number,close:number}>,

 *   asOfDate?: string,

 *   crossMarketCtx?: object,

 *   regime?: string,

 *   marketRegime?: string,

 *   technical?: object,

 *   newsImpact?: object,

 *   pointCenterDelta?: number,

 * }} opts

 */

function predictNextDayRange(opts = {}) {

  const id = String(opts.instrumentId || '').toLowerCase();

  const bars = loadEffectiveBars(id, opts.klines || []);

  const asOf = opts.asOfDate || new Date().toISOString().slice(0, 10);



  const barIdx = cnSession.resolveBarIdx(bars, asOf);

  if (barIdx < 0) return null;



  const baselineInfo = cnSession.getBaselineClose(bars, barIdx);

  const baseline = baselineInfo?.close;

  const baselineDate = baselineInfo?.date || normBarDate(bars[barIdx]);

  if (!baseline || baseline <= 0 || Number.isNaN(baseline)) return null;



  const digits = priceDigits(id, baseline);

  const mRegime = resolveMarketRegime({

    regime: opts.regime,

    marketRegime: opts.marketRegime,

    asOfDate: asOf,

    instrumentId: id,

    barIdx,

    bars,

    technical: opts.technical,

    newsImpact: opts.newsImpact,

  });

  const regimeMult = resolveRegimeMultiplier(mRegime);

  let pointCenterDelta = opts.pointCenterDelta;
  if (pointCenterDelta == null && opts.centerPct != null && !Number.isNaN(Number(opts.centerPct))) {
    pointCenterDelta = baseline * (Number(opts.centerPct) / 100);
  } else if (pointCenterDelta == null && opts.compositeScore != null && !Number.isNaN(Number(opts.compositeScore))) {
    const s = Math.max(-1, Math.min(1, Number(opts.compositeScore)));
    pointCenterDelta = baseline * s * 0.004;
  }

  const hl = predictNextDayHighLowFromBars({
    instrumentId: id,
    klines: bars,
    asOfDate: asOf,
    pointCenterDelta,
    crossMarketCtx: opts.crossMarketCtx,
    marketRegime: mRegime,
  });



  const isCalibratedRange =
    (id === 'au' || id === 'ag') &&
    (hl.method?.includes('precious-range') || hl.method?.includes('cross-vol'));
  const isNonferrousCalibrated = hl?.method?.includes('nonferrous-range');

  if (hl && (isCalibratedRange || isNonferrousCalibrated)) {

    let { predictedHigh, predictedLow } = applyRegimeMultFromBaseline(

      hl.baseClose,

      hl.predictedHigh,

      hl.predictedLow,

      regimeMult,

      id,

    );

    if (predictedLow > predictedHigh) [predictedLow, predictedHigh] = [predictedHigh, predictedLow];

    ({ predictedHigh, predictedLow } = enforceCalibratedMaxSpread(id, predictedHigh, predictedLow));

    const adjusted = predictNextDayHighLow({

      instrumentId: id,

      lastClose: baseline,

      bandLow: predictedLow,

      bandHigh: predictedHigh,

      confidence: hl.confidence,

      method: hl.method,

    });

    return mapHighLowToLegacy(adjusted, baselineDate, regimeMult, adjusted.method);

  }



  if (hl && hl.method !== 'fallback-pct') {

    let { predictedHigh, predictedLow } = applyRegimeMultFromBaseline(

      hl.baseClose,

      hl.predictedHigh,

      hl.predictedLow,

      regimeMult,

      id,

    );

    if (predictedLow > predictedHigh) [predictedLow, predictedHigh] = [predictedHigh, predictedLow];

    ({ predictedHigh, predictedLow } = enforceCalibratedMaxSpread(id, predictedHigh, predictedLow));

    const adjusted = predictNextDayHighLow({

      instrumentId: id,

      lastClose: baseline,

      bandLow: predictedLow,

      bandHigh: predictedHigh,

      confidence: hl.confidence,

      method: hl.method,

    });

    return mapHighLowToLegacy(adjusted, baselineDate, regimeMult, adjusted.method);

  }



  // 非贵金属 fallback：上下_extent 不对称修'
  const stats = computeIntradayStats(bars, barIdx, DEFAULT_LOOKBACK);

  if (stats) {

    const up = stats.meanUp * regimeMult;

    const down = stats.meanDown * regimeMult;

    const center = pointCenterDelta || 0;

    const adjusted = predictNextDayHighLow({

      instrumentId: id,

      closes: bars.slice(0, barIdx + 1).map((b) => b.close),

      highs: bars.slice(0, barIdx + 1).map((b) => b.high ?? b.close),

      lows: bars.slice(0, barIdx + 1).map((b) => b.low ?? b.close),

      lastClose: baseline,

      pointCenterDelta: center,

      method: 'intraday-atr-asymmetric',

      confidence: stats.n >= DEFAULT_LOOKBACK ? '' : '',

    });

    if (adjusted) {

      let hi = roundPrice(baseline + center + up, digits);

      let lo = roundPrice(baseline - down, digits);

      if (lo > hi) [lo, hi] = [hi, lo];

      const asym = predictNextDayHighLow({

        instrumentId: id,

        lastClose: baseline,

        bandLow: lo,

        bandHigh: hi,

        confidence: adjusted.confidence,

        method: 'intraday-atr-asymmetric',

      });

      return mapHighLowToLegacy(asym, baselineDate, regimeMult, 'intraday-atr-asymmetric');

    }

  }



  const fallback = predictNextDayHighLow({

    instrumentId: id,

    lastClose: baseline,

    pointCenterDelta: pointCenterDelta || 0,

    method: 'fallback-pct',

    confidence: '',

  });

  return mapHighLowToLegacy(fallback, baselineDate, regimeMult, 'fallback-pct');

}



/** 映射'engine/UI 使用'highLowPrediction 字段 */

function toHighLowPrediction(rangeResult) {

  if (!rangeResult) return null;

  return {

    baseClose: rangeResult.baseline,

    baselineDate: rangeResult.baselineDate,

    predictedHigh: rangeResult.predictedHigh,

    predictedLow: rangeResult.predictedLow,

    highDelta: rangeResult.highDelta,

    lowDelta: rangeResult.lowDelta,

    rangeDelta: rangeResult.rangeSpread,

    unit: rangeResult.unit,

    confidence: rangeResult.confidence,

    method: rangeResult.modelSource,

    dataSource: rangeResult.modelSource || 'next-day-range',

    regimeMult: rangeResult.regimeMult,

    version: rangeResult.version,

    session: rangeResult.session || null,

    labels: rangeResult.labels || cnSession.LABELS,

  };

}



module.exports = {

  PREDICTOR_VERSION,

  REGIME_RANGE_MULT,

  predictNextDayRange,

  toHighLowPrediction,

  loadEffectiveBars,

  computeIntradayStats,

  rollingMeanRange,

};


