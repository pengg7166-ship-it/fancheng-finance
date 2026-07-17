/**
 * 下一交易日最'最低点位预—国内期货 session 对齐
 *
 * 基准 = 昨收 close[t]（T '15:00 日盘收，'settle'
 * 目标 = 下一交易日周'high/low[t+1]（T '21:00 夜盘 'T+1 '15:00'
 *   high_delta = high[t+1] - close[t]
 *   low_delta  = low[t+1] - close[t]
 * 'K 代理：见 cn-futures-session-calendar.js
 */
const { getCommodityMeta } = require('./commodities-catalog');
const crossVolMagnitude = require('./cross-vol-magnitude');
const cnSession = require('./cn-futures-session-calendar');
const preciousCal = require('./precious-range-calibration');
const nonferrousCal = require('./nonferrous-range-calibration');
const blackCal = require('./black-range-calibration');
const chemicalCal = require('./chemical-range-calibration');
const energyCal = require('./energy-range-calibration');
const agriCal = require('./agricultural-range-calibration');
const shippingCal = require('./shipping-range-calibration');
const crossMarket = require('./cross-market-precious-inference');
const { loadHistoryBars: loadCrossHistoryBars } = require('./cross-market-precious-fetcher');
const rangeBias = require('./range-bias-correction');

const PREDICTOR_VERSION = 'v1.1-cn-session-range';
const RANGE_WINDOWS = [10, 20];
const MIN_BARS = 8;

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

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/**
 * 滚动 (high-low) 均—优先 20 日，不足'10 '
 */
function rollingMeanRange(highs, lows, endIdx, windows = RANGE_WINDOWS) {
  for (const w of windows) {
    const start = Math.max(0, endIdx - w + 1);
    const ranges = [];
    for (let i = start; i <= endIdx; i += 1) {
      const h = highs[i];
      const l = lows[i];
      if (h == null || l == null || Number.isNaN(h) || Number.isNaN(l)) continue;
      ranges.push(h - l);
    }
    if (ranges.length >= MIN_BARS - 2) {
      return { meanRange: mean(ranges), window: w, n: ranges.length };
    }
  }
  return null;
}

/**
 * @param {{
 *   instrumentId?: string,
 *   closes?: number[],
 *   highs?: number[],
 *   lows?: number[],
 *   lastClose: number,
 *   pointCenterDelta?: number|null,
 *   sigma?: number|null,
 *   bandLow?: number|null,
 *   bandHigh?: number|null,
 *   confidence?: string,
 *   method?: string,
 * }} opts
 */
function predictNextDayHighLow(opts = {}) {
  const id = String(opts.instrumentId || '').toLowerCase();
  const lastClose = Number(opts.lastClose);
  if (!lastClose || lastClose <= 0 || Number.isNaN(lastClose)) return null;

  const meta = getCommodityMeta(id);
  const unit = meta?.unit || '';
  const digits = priceDigits(id, lastClose);
  const center = Number(opts.pointCenterDelta) || 0;

  // 贵金属：直接使用 cross-vol ±1σ 带作'high/low
  if (opts.bandLow != null && opts.bandHigh != null) {
    let predictedHigh = Number(opts.bandHigh);
    let predictedLow = Number(opts.bandLow);
    if (predictedLow > predictedHigh) [predictedLow, predictedHigh] = [predictedHigh, predictedLow];
    const hi = roundPrice(predictedHigh, digits);
    const lo = roundPrice(predictedLow, digits);
    const base = roundPrice(lastClose, digits);
    return {
      version: PREDICTOR_VERSION,
      baseClose: base,
      predictedHigh: hi,
      predictedLow: lo,
      highDelta: hi != null && base != null ? roundPrice(hi - base, digits) : null,
      lowDelta: lo != null && base != null ? roundPrice(lo - base, digits) : null,
      rangeDelta: hi != null && lo != null ? roundPrice(hi - lo, digits) : null,
      unit,
      confidence: opts.confidence || '',
      method: opts.method || 'cross-vol-band',
    };
  }

  const closes = opts.closes || [];
  const highs = opts.highs || [];
  const lows = opts.lows || [];
  const endIdx = closes.length ? closes.length - 1 : highs.length - 1;

  const rangeStats = endIdx >= 0 ? rollingMeanRange(highs, lows, endIdx) : null;
  let meanRange = rangeStats?.meanRange;

  // sigma 作为单日振幅代理（元/单位'
  if ((meanRange == null || meanRange <= 0) && opts.sigma != null && opts.sigma > 0) {
    meanRange = opts.sigma * 2;
  }

  if (meanRange == null || meanRange <= 0) {
    meanRange = lastClose * 0.016;
  }

  const half = meanRange / 2;
  let predictedHigh = lastClose + center + half;
  let predictedLow = lastClose + center - half;
  if (predictedLow > predictedHigh) [predictedLow, predictedHigh] = [predictedHigh, predictedLow];

  const hi = roundPrice(predictedHigh, digits);
  const lo = roundPrice(predictedLow, digits);
  const base = roundPrice(lastClose, digits);

  return {
    version: PREDICTOR_VERSION,
    baseClose: base,
    predictedHigh: hi,
    predictedLow: lo,
    highDelta: hi != null && base != null ? roundPrice(hi - base, digits) : null,
    lowDelta: lo != null && base != null ? roundPrice(lo - base, digits) : null,
    rangeDelta: hi != null && lo != null ? roundPrice(hi - lo, digits) : null,
    unit,
    confidence: rangeStats?.n >= 15 ? '' : '',
    method: opts.method || (rangeStats ? `rolling-range-${rangeStats.window}d` : 'fallback-pct'),
  };
}

/**
 * 'K 线序列提'arrays 并预'
 * @param {{
 *   instrumentId: string,
 *   klines: Array<{close:number,high?:number,low?:number}>,
 *   asOfDate?: string,
 *   pointCenterDelta?: number,
 *   crossMarketCtx?: object,
 *   marketRegime?: string,
 * }} opts
 */
function predictNextDayHighLowFromBars(opts = {}) {
  const id = String(opts.instrumentId || '').toLowerCase();
  const bars = opts.klines || [];
  if (!bars.length) return null;

  const barIdx = cnSession.resolveBarIdx(bars, opts.asOfDate);
  if (barIdx < 0) return null;

  const baseline = cnSession.getBaselineClose(bars, barIdx);
  if (!baseline) return null;

  const slice = bars.slice(0, barIdx + 1);
  const closes = slice.map((b) => b.close);
  const highs = slice.map((b) => b.high ?? b.close);
  const lows = slice.map((b) => b.low ?? b.close);
  const lastClose = baseline.close;

  let pointCenter = opts.pointCenterDelta;
  let bandLow;
  let bandHigh;
  let confidence;
  let method;

  if (id === 'au' || id === 'ag') {
    const mag = crossVolMagnitude.predictMagnitude({
      instrumentId: id,
      close: lastClose,
      asOfDate: opts.asOfDate,
      crossMarketCtx: opts.crossMarketCtx,
      priceHistory: bars,
      marketRegime: opts.marketRegime,
    });
    if (mag) {
      if (pointCenter == null && mag.pointDelta != null) pointCenter = mag.pointDelta;
      confidence = mag.confidence;
      const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
      const calBand = preciousCal.computePreciousRangeBand({
        instrumentId: id,
        baselineClose: lastClose,
        upExtents: extents.upExtents,
        downExtents: extents.downExtents,
        pointDelta: mag.pointDelta,
        sigma: mag.sigma,
      });
      if (calBand) {
        bandLow = calBand.predictedLow;
        bandHigh = calBand.predictedHigh;
        method = mag.crossGated
          ? 'precious-range-vol-fallback'
          : mag.source === 'cross'
            ? 'precious-range-cross'
            : mag.source === 'hybrid'
              ? 'precious-range-hybrid'
              : 'precious-range-vol';
      } else {
        bandLow = mag.bandLow;
        bandHigh = mag.bandHigh;
        method =
          mag.source === 'cross'
            ? 'cross-vol'
            : mag.source === 'hybrid'
              ? 'cross-vol-hybrid'
              : 'cross-vol-atr';
      }
    }
  } else if (nonferrousCal.isCalibrated(id)) {
    const calParams = nonferrousCal.getInstrumentCal(id);
    const volWindow = calParams?.volWindow || 20;
    const sigma = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
    const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
    if (pointCenter == null && id === 'bc' && calParams?.cuCrossBias !== false) {
      try {
        const cuBars = crossMarket.loadTradingBars('cu');
        const cuIdx = cnSession.resolveBarIdx(cuBars, opts.asOfDate ?? baseline.date);
        if (cuIdx > 0 && cuBars[cuIdx]?.close && cuBars[cuIdx - 1]?.close) {
          pointCenter = cuBars[cuIdx].close - cuBars[cuIdx - 1].close;
        }
      } catch {
        // ignore 'vol-only center
      }
    }
    const calBand = nonferrousCal.computeNonferrousRangeBand({
      instrumentId: id,
      baselineClose: lastClose,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: pointCenter,
      sigma,
    });
    if (calBand) {
      bandLow = calBand.predictedLow;
      bandHigh = calBand.predictedHigh;
      confidence = extents.upExtents?.length >= 12 ? '' : '';
      method = 'nonferrous-range-calibrated';
    }
  } else if (energyCal.isCalibrated(id)) {
    const calParams = energyCal.getInstrumentCal(id);
    const volWindow = calParams?.volWindow || 20;
    const sigma = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
    const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
    if (pointCenter == null && calParams) {
      if (calParams.wtiCrossBias) {
        try {
          const wtiBars = loadCrossHistoryBars('fred-wti-daily.json').bars;
          const wtiIdx = cnSession.resolveBarIdx(wtiBars, opts.asOfDate ?? baseline.date);
          if (wtiIdx > 0 && wtiBars[wtiIdx]?.close && wtiBars[wtiIdx - 1]?.close) {
            const prev = wtiBars[wtiIdx - 1].close;
            const cur = wtiBars[wtiIdx].close;
            pointCenter = lastClose * ((cur - prev) / prev);
          }
        } catch {
          // ignore 'vol-only center
        }
      } else if (calParams.scCrossBias) {
        try {
          const scBars = crossMarket.loadTradingBars('sc');
          const scIdx = cnSession.resolveBarIdx(scBars, opts.asOfDate ?? baseline.date);
          if (scIdx > 0 && scBars[scIdx]?.close && scBars[scIdx - 1]?.close) {
            pointCenter = scBars[scIdx].close - scBars[scIdx - 1].close;
          }
        } catch {
          // ignore 'vol-only center
        }
      }
    }
    const calBand = energyCal.computeEnergyRangeBand({
      instrumentId: id,
      baselineClose: lastClose,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: pointCenter,
      sigma,
    });
    if (calBand) {
      bandLow = calBand.predictedLow;
      bandHigh = calBand.predictedHigh;
      confidence = extents.upExtents?.length >= 12 ? '' : '';
      method = 'energy-range-calibrated';
    }
  } else if (agriCal.isCalibrated(id)) {
    const calParams = agriCal.getInstrumentCal(id);
    const volWindow = calParams?.volWindow || 20;
    const sigma = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
    const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
    if (pointCenter == null && calParams) {
      let crossId = null;
      if (calParams.yCrossBias) crossId = 'y';
      else if (calParams.mCrossBias) crossId = 'm';
      else if (calParams.pCrossBias) crossId = 'p';
      else if (calParams.oiCrossBias) crossId = 'oi';
      else if (calParams.rmCrossBias) crossId = 'rm';
      else if (calParams.cCrossBias) crossId = 'c';
      else if (calParams.cfCrossBias) crossId = 'cf';
      if (crossId) {
        try {
          const crossBars = crossMarket.loadTradingBars(crossId);
          const crossIdx = cnSession.resolveBarIdx(crossBars, opts.asOfDate ?? baseline.date);
          if (crossIdx > 0 && crossBars[crossIdx]?.close && crossBars[crossIdx - 1]?.close) {
            pointCenter = crossBars[crossIdx].close - crossBars[crossIdx - 1].close;
          }
        } catch {
          // ignore 'vol-only center
        }
      }
    }
    const calBand = agriCal.computeAgriculturalRangeBand({
      instrumentId: id,
      baselineClose: lastClose,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: pointCenter,
      sigma,
    });
    if (calBand) {
      bandLow = calBand.predictedLow;
      bandHigh = calBand.predictedHigh;
      confidence = extents.upExtents?.length >= 12 ? '' : '';
      method = 'agricultural-range-calibrated';
    }
  } else if (chemicalCal.isCalibrated(id)) {
    const calParams = chemicalCal.getInstrumentCal(id);
    const volWindow = calParams?.volWindow || 20;
    const sigma = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
    const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
    if (pointCenter == null && calParams) {
      let crossId = null;
      if (calParams.taCrossBias) crossId = 'ta';
      else if (calParams.lCrossBias) crossId = 'l';
      else if (calParams.egCrossBias) crossId = 'eg';
      if (crossId) {
        try {
          const crossBars = crossMarket.loadTradingBars(crossId);
          const crossIdx = cnSession.resolveBarIdx(crossBars, opts.asOfDate ?? baseline.date);
          if (crossIdx > 0 && crossBars[crossIdx]?.close && crossBars[crossIdx - 1]?.close) {
            pointCenter = crossBars[crossIdx].close - crossBars[crossIdx - 1].close;
          }
        } catch {
          // ignore 'vol-only center
        }
      }
    }
    const calBand = chemicalCal.computeChemicalRangeBand({
      instrumentId: id,
      baselineClose: lastClose,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: pointCenter,
      sigma,
    });
    if (calBand) {
      bandLow = calBand.predictedLow;
      bandHigh = calBand.predictedHigh;
      confidence = extents.upExtents?.length >= 12 ? '' : '';
      method = 'chemical-range-calibrated';
    }
  } else if (shippingCal.isCalibrated(id)) {
    const calParams = shippingCal.getInstrumentCal(id);
    const volWindow = calParams?.volWindow || 20;
    const sigma = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
    const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
    const calBand = shippingCal.computeShippingRangeBand({
      instrumentId: id,
      baselineClose: lastClose,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: pointCenter,
      sigma,
    });
    if (calBand) {
      bandLow = calBand.predictedLow;
      bandHigh = calBand.predictedHigh;
      confidence = extents.upExtents?.length >= 12 ? '' : '';
      method = 'shipping-range-calibrated';
    }
  } else if (blackCal.isCalibrated(id)) {
    const calParams = blackCal.getInstrumentCal(id);
    const volWindow = calParams?.volWindow || 20;
    const sigma = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
    const extents = cnSession.collectSessionExtents(bars, barIdx, 15);
    if (pointCenter == null && calParams) {
      let crossId = null;
      if (calParams.rbCrossBias) crossId = 'rb';
      else if (calParams.iCrossBias) crossId = 'i';
      else if (calParams.jmCrossBias) crossId = 'jm';
      else if (calParams.jCrossBias) crossId = 'j';
      if (crossId) {
        try {
          const crossBars = crossMarket.loadTradingBars(crossId);
          const crossIdx = cnSession.resolveBarIdx(crossBars, opts.asOfDate ?? baseline.date);
          if (crossIdx > 0 && crossBars[crossIdx]?.close && crossBars[crossIdx - 1]?.close) {
            pointCenter = crossBars[crossIdx].close - crossBars[crossIdx - 1].close;
          }
        } catch {
          // ignore 'vol-only center
        }
      }
    }
    const calBand = blackCal.computeBlackRangeBand({
      instrumentId: id,
      baselineClose: lastClose,
      upExtents: extents.upExtents,
      downExtents: extents.downExtents,
      pointDelta: pointCenter,
      sigma,
    });
    if (calBand) {
      bandLow = calBand.predictedLow;
      bandHigh = calBand.predictedHigh;
      confidence = extents.upExtents?.length >= 12 ? '' : '';
      method = 'black-range-calibrated';
    }
  }

  let sigmaForShrink = null;
  if (bandLow != null && bandHigh != null) {
    const calMod =
      id === 'au' || id === 'ag'
        ? preciousCal
        : nonferrousCal.isCalibrated(id)
          ? nonferrousCal
          : energyCal.isCalibrated(id)
            ? energyCal
            : chemicalCal.isCalibrated(id)
              ? chemicalCal
              : blackCal.isCalibrated(id)
                ? blackCal
                : agriCal.isCalibrated(id)
                  ? agriCal
                  : null;
    const volWindow = calMod?.getInstrumentCal?.(id)?.volWindow || 20;
    sigmaForShrink = crossVolMagnitude.computeRealizedVol(bars, barIdx, volWindow);
  }

  const core = predictNextDayHighLow({
    instrumentId: id,
    closes,
    highs,
    lows,
    lastClose,
    pointCenterDelta: pointCenter,
    sigma: sigmaForShrink,
    bandLow,
    bandHigh,
    confidence,
    method,
  });

  let result = cnSession.attachSessionMeta(
    core ? { ...core, baselineDate: baseline.date } : null,
    bars,
    barIdx,
  );

  if (result && sigmaForShrink != null) {
    result = rangeBias.applyRegimeShrink(result, sigmaForShrink, lastClose);
  }
  if (result) {
    result = rangeBias.applyRollingBiasCorrection({ instrumentId: id, prediction: result }) || result;
  }

  return result;
}

/** 优先 disk cache K 线，不足则回退 trading/{id}.json */
function loadEffectiveBars(instrumentId, klines) {
  if (klines?.length >= 10) return klines;
  const id = String(instrumentId || '').toLowerCase();
  if (id === 'au' || id === 'ag') return crossMarket.loadTradingBars(id);
  return klines || [];
}

module.exports = {
  PREDICTOR_VERSION,
  rollingMeanRange,
  predictNextDayHighLow,
  predictNextDayHighLowFromBars,
  loadEffectiveBars,
};
