/**
 * 大宗商品技术面分析 — SMA/EMA、BOLL(20,2)、量比、MA 排列与金叉/死叉
 * 日线不足时用盘中报价 + 可用 K 线推导指标
 */
const diskCache = require('./disk-cache');
const { getCommodityMeta } = require('./commodities-catalog');

const OI_SNAP_PREFIX = 'oi-snap/';
const VOL_FORECAST_PREFIX = 'outlook-vol-forecast/';
const VOL_FORECAST_CAP_RATIO = 0.15;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function sma(values, period) {
  if (!values?.length || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function ema(values, period) {
  if (!values?.length || values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function stdDev(values, mean) {
  if (!values.length) return 0;
  const m = mean ?? values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeBollinger(closes, period = 20, mult = 2) {
  const effectivePeriod = Math.min(period, closes.length);
  if (closes.length < 5 || effectivePeriod < 5) return null;
  const slice = closes.slice(-effectivePeriod);
  const mid = slice.reduce((s, v) => s + v, 0) / effectivePeriod;
  const sd = stdDev(slice, mid);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const current = closes[closes.length - 1];
  const bandwidth = mid > 0 ? ((upper - lower) / mid) * 100 : 0;

  let position = 'mid';
  let positionLabel = '中轨附近';
  const upperZone = mid + (upper - mid) * 0.66;
  const lowerZone = mid - (mid - lower) * 0.66;
  if (current >= upperZone) {
    position = 'upper';
    positionLabel = '上轨区';
  } else if (current <= lowerZone) {
    position = 'lower';
    positionLabel = '下轨区';
  }

  const pctB = upper !== lower ? (current - lower) / (upper - lower) : 0.5;

  return {
    period: effectivePeriod,
    mult,
    upper: +upper.toFixed(4),
    mid: +mid.toFixed(4),
    lower: +lower.toFixed(4),
    bandwidth: +bandwidth.toFixed(3),
    position,
    positionLabel,
    pctB: +pctB.toFixed(3),
    partial: effectivePeriod < period,
  };
}

function detectCross(fastPrev, slowPrev, fastNow, slowNow) {
  if ([fastPrev, slowPrev, fastNow, slowNow].some((v) => v == null)) return null;
  if (fastPrev <= slowPrev && fastNow > slowNow) return 'golden';
  if (fastPrev >= slowPrev && fastNow < slowNow) return 'dead';
  return null;
}

function computeMaStack(closes) {
  const len = closes.length;
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  let alignment = 'mixed';
  let alignmentLabel = '均线交织';
  let alignmentScore = 0;

  if (ma5 != null && ma10 != null && ma20 != null && ma60 != null) {
    if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) {
      alignment = 'bullish';
      alignmentLabel = 'MA多头';
      alignmentScore = 0.7;
    } else if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) {
      alignment = 'bearish';
      alignmentLabel = 'MA空头';
      alignmentScore = -0.7;
    } else if (ma5 > ma20) {
      alignment = 'mild_bull';
      alignmentLabel = 'MA5>MA20';
      alignmentScore = 0.25;
    } else if (ma5 < ma20) {
      alignment = 'mild_bear';
      alignmentLabel = 'MA5<MA20';
      alignmentScore = -0.25;
    }
  } else if (ma5 != null && ma10 != null) {
    if (ma5 > ma10) {
      alignment = 'mild_bull';
      alignmentLabel = 'MA5>MA10';
      alignmentScore = 0.2;
    } else if (ma5 < ma10) {
      alignment = 'mild_bear';
      alignmentLabel = 'MA5<MA10';
      alignmentScore = -0.2;
    }
  }

  const prevCloses = closes.slice(0, -1);
  const cross5_10 =
    len >= 11
      ? detectCross(sma(prevCloses, 5), sma(prevCloses, 10), ma5, ma10)
      : null;
  const cross10_20 =
    len >= 21
      ? detectCross(sma(prevCloses, 10), sma(prevCloses, 20), ma10, ma20)
      : null;

  let crossSignal = null;
  let crossLabel = '';
  if (cross5_10 === 'golden' || cross10_20 === 'golden') {
    crossSignal = 'golden';
    crossLabel = cross5_10 === 'golden' ? 'MA5×MA10 金叉' : 'MA10×MA20 金叉';
    alignmentScore += 0.2;
  } else if (cross5_10 === 'dead' || cross10_20 === 'dead') {
    crossSignal = 'dead';
    crossLabel = cross5_10 === 'dead' ? 'MA5×MA10 死叉' : 'MA10×MA20 死叉';
    alignmentScore -= 0.2;
  }

  let maSpreadPct = null;
  if (ma5 != null && ma10 != null && ma10 > 0) {
    maSpreadPct = +(((ma5 - ma10) / ma10) * 100).toFixed(2);
  }

  return {
    ma5: ma5 != null ? +ma5.toFixed(4) : null,
    ma10: ma10 != null ? +ma10.toFixed(4) : null,
    ma20: ma20 != null ? +ma20.toFixed(4) : null,
    ma60: ma60 != null ? +ma60.toFixed(4) : null,
    ema12: ema12 != null ? +ema12.toFixed(4) : null,
    ema26: ema26 != null ? +ema26.toFixed(4) : null,
    alignment,
    alignmentLabel,
    alignmentScore: clamp(alignmentScore, -1, 1),
    crossSignal,
    crossLabel,
    maSpreadPct,
  };
}

function computeVolumeRatio(bars) {
  if (!bars?.length || bars.length < 6) return null;
  const last = bars[bars.length - 1];
  const prev5 = bars.slice(-6, -1);
  const avgVol = prev5.reduce((s, b) => s + (b.volume || 0), 0) / prev5.length;
  if (!avgVol || avgVol <= 0) return null;
  const ratio = last.volume / avgVol;

  let ratio20 = ratio;
  if (bars.length >= 21) {
    const prev20 = bars.slice(-21, -1);
    const avg20 = prev20.reduce((s, b) => s + (b.volume || 0), 0) / prev20.length;
    if (avg20 > 0) ratio20 = last.volume / avg20;
  }

  let label = '平量';
  if (ratio >= 1.5) label = '放量';
  else if (ratio >= 1.15) label = '温和放量';
  else if (ratio <= 0.65) label = '缩量';
  else if (ratio <= 0.85) label = '温和缩量';
  return {
    ratio: +ratio.toFixed(3),
    ratio20: +ratio20.toFixed(3),
    label,
    todayVolume: last.volume || 0,
    avg5Volume: +avgVol.toFixed(0),
    score: clamp((ratio - 1) * 0.35, -0.5, 0.5),
  };
}

function computeIntradayMetrics(liveQuote) {
  if (!liveQuote?.price || Number.isNaN(Number(liveQuote.price))) return null;
  const price = Number(liveQuote.price);
  const high = Number(liveQuote.high) || price;
  const low = Number(liveQuote.low) || price;
  const open = Number(liveQuote.open) || price;
  const changePct = Number(liveQuote.changePct);
  const safeChange = Number.isNaN(changePct) ? 0 : changePct;

  const rangePct = price > 0 ? ((high - low) / price) * 100 : 0;
  const openGapPct = open > 0 ? ((price - open) / open) * 100 : safeChange;

  let score = clamp(safeChange / 2.5, -0.6, 0.6);
  if (openGapPct > 0.3) score += 0.08;
  else if (openGapPct < -0.3) score -= 0.08;

  return {
    changePct: +safeChange.toFixed(3),
    rangePct: +rangePct.toFixed(3),
    openGapPct: +openGapPct.toFixed(3),
    atrProxyPct: +Math.max(0.12, rangePct * 0.55 + Math.abs(safeChange) * 0.15).toFixed(3),
    score: clamp(score, -1, 1),
  };
}

function computeDailyReturns(closes) {
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) {
      returns.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
    }
  }
  return returns;
}

function percentileSorted(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function computeHistoricalVolMetrics(bars) {
  const closes = (bars || []).map((b) => b.close).filter((c) => c > 0);
  if (closes.length < 5) return null;

  const allReturns = computeDailyReturns(closes);
  const absSorted = allReturns.map((r) => Math.abs(r)).sort((a, b) => a - b);
  const absReturnP90 = percentileSorted(absSorted, 90);

  const retWindow = allReturns.slice(-Math.min(20, allReturns.length));
  const mean20 = retWindow.reduce((s, r) => s + r, 0) / retWindow.length;
  const variance20 = retWindow.reduce((s, r) => s + (r - mean20) ** 2, 0) / retWindow.length;
  const sigmaDaily20 = Math.sqrt(variance20);

  let atrPct14 = null;
  if (bars.length >= 15) {
    const trs = [];
    for (let i = bars.length - 14; i < bars.length; i += 1) {
      const b = bars[i];
      const prevClose = bars[i - 1]?.close ?? b.close;
      const tr = Math.max(
        (b.high || b.close) - (b.low || b.close),
        Math.abs((b.high || b.close) - prevClose),
        Math.abs((b.low || b.close) - prevClose)
      );
      trs.push(tr);
    }
    const atr = trs.reduce((s, v) => s + v, 0) / trs.length;
    const lastClose = closes[closes.length - 1];
    atrPct14 = lastClose > 0 ? (atr / lastClose) * 100 : null;
  }

  return {
    sigmaDaily20: sigmaDaily20 > 0 ? +sigmaDaily20.toFixed(4) : null,
    atrPct14: atrPct14 != null ? +atrPct14.toFixed(4) : null,
    absReturnP90: absReturnP90 != null ? +absReturnP90.toFixed(4) : null,
    histVol20d: sigmaDaily20 > 0 ? +sigmaDaily20.toFixed(4) : null,
    barsUsed: closes.length,
  };
}

function computeRealizedVolPct(bars) {
  const metrics = computeHistoricalVolMetrics(bars);
  if (metrics?.sigmaDaily20 > 0) return +metrics.sigmaDaily20.toFixed(3);
  if (!bars?.length || bars.length < 3) return null;
  const closes = bars.map((b) => b.close).filter((c) => c > 0);
  if (closes.length < 3) return null;
  const returns = computeDailyReturns(closes);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  return std > 0 ? +Math.max(0.1, std).toFixed(3) : null;
}

function computeRollingSigmaSeries(returns, window = 20) {
  if (!returns?.length || returns.length < window) return [];
  const sigmas = [];
  for (let i = window; i <= returns.length; i += 1) {
    const slice = returns.slice(i - window, i);
    const mean = slice.reduce((s, r) => s + r, 0) / window;
    const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / window;
    sigmas.push(Math.sqrt(variance));
  }
  return sigmas;
}

function readPrevVolForecast(commodityId) {
  const key = `${VOL_FORECAST_PREFIX}${String(commodityId || '').toLowerCase()}.json`;
  const stored = diskCache.readStale(key);
  const v = stored?.data?.volForecastPct;
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : null;
}

function writeVolForecast(commodityId, volForecastPct) {
  if (volForecastPct == null || Number.isNaN(Number(volForecastPct))) return;
  const key = `${VOL_FORECAST_PREFIX}${String(commodityId || '').toLowerCase()}.json`;
  diskCache.write(key, { data: { volForecastPct: +Number(volForecastPct).toFixed(4), savedAt: Date.now() } });
}

function capVolForecastDayOverDay(rawForecast, prevForecast) {
  if (prevForecast == null || prevForecast <= 0 || rawForecast == null) return rawForecast;
  const lo = prevForecast * (1 - VOL_FORECAST_CAP_RATIO);
  const hi = prevForecast * (1 + VOL_FORECAST_CAP_RATIO);
  return +clamp(rawForecast, lo, hi).toFixed(4);
}

function classifyVolRegime(percentile) {
  if (percentile == null || Number.isNaN(percentile)) {
    return { regime: 'normal', label: '常态波', trend: 'flat' };
  }
  if (percentile < 33) return { regime: 'low', label: '低波', trend: 'down' };
  if (percentile > 66) return { regime: 'high', label: '高波', trend: 'up' };
  return { regime: 'normal', label: '常态波', trend: 'flat' };
}

function computeSmoothedVolMetrics(bars, { intraday, sectorPrior, commodityId } = {}) {
  const closes = (bars || []).map((b) => b.close).filter((c) => c > 0);
  const barCount = closes.length;
  const prior = sectorPrior ?? 0.75;

  if (barCount < 3) {
    const intradayProxy = intraday?.atrProxyPct ?? intraday?.rangePct;
    const rawForecast = intradayProxy != null ? intradayProxy * 0.55 + prior * 0.45 : prior;
    const prevForecast = commodityId ? readPrevVolForecast(commodityId) : null;
    let volForecastPct = capVolForecastDayOverDay(Math.max(0.1, rawForecast), prevForecast) ?? Math.max(0.1, rawForecast);
    if (commodityId && volForecastPct > 0) writeVolForecast(commodityId, volForecastPct);
    const regimeInfo = classifyVolRegime(50);
    return {
      sigma20: +prior.toFixed(4),
      atr14Pct: intradayProxy != null ? +intradayProxy.toFixed(4) : null,
      p90AbsReturn: null,
      volEma10: null,
      volEma20: null,
      volForecastPct: +volForecastPct.toFixed(4),
      rawForecastPct: +rawForecast.toFixed(4),
      prevForecastPct: prevForecast != null ? +prevForecast.toFixed(4) : null,
      volRising: false,
      volFalling: false,
      volStability: null,
      percentile: 50,
      regime: regimeInfo.regime,
      regimeLabel: regimeInfo.label,
      regimeTrend: regimeInfo.trend,
      forecastCapped: prevForecast != null && Math.abs(volForecastPct - rawForecast) > 0.0001,
      barsUsed: barCount,
      priorBlend: true,
      display: `先验 ${prior.toFixed(2)}% · 预测 ${volForecastPct.toFixed(2)}%`,
    };
  }

  const returns = computeDailyReturns(closes);
  const absReturns = returns.map((r) => Math.abs(r));
  const histWindow = Math.min(60, absReturns.length);
  const histAbs = absReturns.slice(-histWindow);

  const volEma10 = absReturns.length >= 5 ? ema(absReturns, Math.min(10, absReturns.length)) : null;
  const sigmaSeries = computeRollingSigmaSeries(returns, Math.min(20, returns.length));
  const volEma20 =
    sigmaSeries.length >= 5
      ? ema(sigmaSeries, Math.min(20, sigmaSeries.length))
      : volEma10;

  let rawForecast = null;
  if (volEma10 != null && volEma20 != null) {
    rawForecast = 0.65 * volEma10 + 0.35 * volEma20;
  } else if (volEma10 != null) {
    rawForecast = volEma10;
  } else if (volEma20 != null) {
    rawForecast = volEma20;
  }

  const historical = computeHistoricalVolMetrics(bars);
  const sigma20 = historical?.sigmaDaily20 ?? volEma20 ?? volEma10;
  const atr14Pct = historical?.atrPct14;
  const p90AbsReturn = historical?.absReturnP90;

  if (barCount >= 5 && barCount < 20 && rawForecast != null) {
    const intradayProxy = intraday?.atrProxyPct ?? intraday?.rangePct ?? prior;
    const blendWeight = barCount / 20;
    rawForecast = blendWeight * rawForecast + (1 - blendWeight) * (intradayProxy * 0.4 + prior * 0.6);
  } else if (rawForecast == null) {
    const intradayProxy = intraday?.atrProxyPct ?? intraday?.rangePct;
    rawForecast = intradayProxy != null ? intradayProxy * 0.55 + prior * 0.45 : prior;
  }

  rawForecast = Math.max(0.1, rawForecast);

  const prevForecast = commodityId ? readPrevVolForecast(commodityId) : null;
  let volForecastPct = capVolForecastDayOverDay(rawForecast, prevForecast);
  if (volForecastPct == null) volForecastPct = rawForecast;

  if (commodityId && volForecastPct > 0) {
    writeVolForecast(commodityId, volForecastPct);
  }

  const percentile =
    histAbs.length >= 5 && volForecastPct > 0
      ? (histAbs.filter((v) => v <= volForecastPct).length / histAbs.length) * 100
      : 50;
  const regimeInfo = classifyVolRegime(percentile);
  const volStability = volEma10 != null && volEma20 != null ? Math.abs(volEma10 - volEma20) : null;

  return {
    sigma20: sigma20 != null ? +sigma20.toFixed(4) : null,
    atr14Pct: atr14Pct != null ? +atr14Pct.toFixed(4) : null,
    p90AbsReturn: p90AbsReturn != null ? +p90AbsReturn.toFixed(4) : null,
    volEma10: volEma10 != null ? +volEma10.toFixed(4) : null,
    volEma20: volEma20 != null ? +volEma20.toFixed(4) : null,
    volForecastPct: +volForecastPct.toFixed(4),
    rawForecastPct: +rawForecast.toFixed(4),
    prevForecastPct: prevForecast != null ? +prevForecast.toFixed(4) : null,
    volRising: volEma10 != null && volEma20 != null && volEma10 > volEma20 * 1.01,
    volFalling: volEma10 != null && volEma20 != null && volEma10 < volEma20 * 0.99,
    volStability: volStability != null ? +volStability.toFixed(4) : null,
    percentile: +percentile.toFixed(1),
    regime: regimeInfo.regime,
    regimeLabel: regimeInfo.label,
    regimeTrend: regimeInfo.trend,
    forecastCapped: prevForecast != null && Math.abs(volForecastPct - rawForecast) > 0.0001,
    barsUsed: barCount,
    display: `σ20 ${(sigma20 ?? volForecastPct).toFixed(2)}% · EMA10 ${(volEma10 ?? '—')}${typeof volEma10 === 'number' ? '%' : ''} · 预测 ${volForecastPct.toFixed(2)}%`,
  };
}

function mergeLiveBar(bars, liveQuote) {
  if (!liveQuote?.price || Number.isNaN(Number(liveQuote.price))) return bars;
  const price = Number(liveQuote.price);
  const today = new Date().toISOString().slice(0, 10);
  const bar = {
    date: today,
    open: Number(liveQuote.open) || price,
    high: Number(liveQuote.high) || price,
    low: Number(liveQuote.low) || price,
    close: price,
    volume: Number(liveQuote.volume) || 0,
  };
  const merged = [...(bars || [])];
  const idx = merged.findIndex((b) => String(b.date).slice(0, 10) === today);
  if (idx >= 0) merged[idx] = { ...merged[idx], ...bar };
  else merged.push(bar);
  return merged;
}

function readCachedKlines(commodityId) {
  const meta = getCommodityMeta(commodityId);
  const cacheId = meta?.id || String(commodityId || '').toLowerCase();
  const key = `klines/commodity-${cacheId}-day.json`;
  const stored = diskCache.readStale(key);
  if (stored?.data?.klines?.length) return stored.data.klines;
  const altKey = `klines/commodity-${String(commodityId || '').toLowerCase()}-day.json`;
  if (altKey !== key) {
    const alt = diskCache.readStale(altKey);
    return alt?.data?.klines || [];
  }
  return [];
}

function hasCachedDayKlines(commodityId, minBars = 20) {
  return readCachedKlines(commodityId).length >= minBars;
}

function formatOiDisplay(n) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万手`;
  return `${Math.round(n)}手`;
}

const OI_TICK_SNAPSHOT_MIN_MS = 90 * 1000;

function updateOiSnapshot(commodityId, openInterest) {
  const key = `${OI_SNAP_PREFIX}${commodityId}.json`;
  const dayKey = `${OI_SNAP_PREFIX}${commodityId}-day.json`;
  const prev = diskCache.readStale(key);
  const daySnap = diskCache.readStale(dayKey);
  const prevOi = prev?.data?.openInterest;
  const prevSavedAt = prev?.savedAt || prev?.data?.savedAt || 0;
  const oiValid = openInterest != null && !Number.isNaN(openInterest) && openInterest > 0;
  const today = new Date().toISOString().slice(0, 10);

  if (oiValid) {
    if (!daySnap?.data?.day || daySnap.data.day !== today) {
      diskCache.write(dayKey, { data: { openInterest, day: today, savedAt: Date.now() } });
    }
    const tickDelta =
      prevOi > 0 ? Math.abs(openInterest - prevOi) / prevOi : 1;
    const shouldWriteTick =
      !prevOi ||
      Date.now() - prevSavedAt >= OI_TICK_SNAPSHOT_MIN_MS ||
      tickDelta >= 0.002;
    if (shouldWriteTick) {
      diskCache.write(key, { data: { openInterest, savedAt: Date.now() } });
    }
  }

  const dayOi = daySnap?.data?.day === today ? daySnap.data.openInterest : daySnap?.data?.openInterest;
  const refOi = dayOi > 0 ? dayOi : prevOi;

  if (refOi != null && oiValid && refOi > 0) {
    const deltaPct = ((openInterest - refOi) / refOi) * 100;
    if (Math.abs(deltaPct) < 0.04) {
      return {
        current: openInterest,
        previous: refOi,
        deltaPct: null,
        display: formatOiDisplay(openInterest),
        label: `持仓 ${formatOiDisplay(openInterest)}`,
        score: 0,
      };
    }
    let label = '持仓平稳';
    if (deltaPct >= 3) label = '明显增仓';
    else if (deltaPct >= 1) label = '增仓';
    else if (deltaPct <= -3) label = '明显减仓';
    else if (deltaPct <= -1) label = '减仓';
    return {
      current: openInterest,
      previous: refOi,
      deltaPct: +deltaPct.toFixed(3),
      display: formatOiDisplay(openInterest),
      label,
      score: clamp(deltaPct / 8, -0.6, 0.6),
    };
  }
  if (oiValid) {
    return {
      current: openInterest,
      previous: refOi ?? null,
      deltaPct: null,
      display: formatOiDisplay(openInterest),
      label: `持仓 ${formatOiDisplay(openInterest)}`,
      score: 0,
    };
  }
  return {
    current: null,
    previous: refOi ?? null,
    deltaPct: null,
    display: null,
    label: '持仓待更新',
    score: 0,
  };
}

function technicalScoreFromIndicators({ boll, maStack, volume, oi, intraday }) {
  let score = 0;
  let weight = 0;

  if (maStack?.alignmentScore != null) {
    score += maStack.alignmentScore * 0.3;
    weight += 0.3;
  }
  if (boll) {
    const bollScore = boll.position === 'upper' ? 0.15 : boll.position === 'lower' ? -0.15 : 0;
    score += bollScore;
    weight += 0.18;
  }
  if (volume?.score != null) {
    score += volume.score * 0.22;
    weight += 0.22;
  }
  if (oi?.score != null && oi.deltaPct != null) {
    score += oi.score * 0.15;
    weight += 0.15;
  }
  if (intraday?.score != null) {
    score += intraday.score * (weight > 0 ? 0.15 : 0.45);
    weight += weight > 0 ? 0.15 : 0.45;
  }

  return weight > 0 ? clamp(score / weight, -1, 1) : intraday?.score ?? 0;
}

function computeVolatilityProxy({ historicalVol, intraday, liveQuote }) {
  if (historicalVol?.sigmaDaily20 > 0) return historicalVol.sigmaDaily20;
  if (historicalVol?.atrPct14 > 0) return historicalVol.atrPct14 * 0.65;
  if (intraday?.atrProxyPct) return intraday.atrProxyPct;
  if (liveQuote?.high && liveQuote?.low && liveQuote?.price) {
    const p = Number(liveQuote.price);
    const rangePct = p > 0 ? ((Number(liveQuote.high) - Number(liveQuote.low)) / p) * 100 : 0;
    if (rangePct > 0) return Math.max(0.12, rangePct * 0.45);
  }
  const chg = Math.abs(Number(liveQuote?.changePct) || 0);
  return Math.max(0.12, 0.15 + chg * 0.25);
}

function analyzeInstrumentTechnicals(commodityId, liveQuote = null, options = {}) {
  const meta = getCommodityMeta(commodityId);
  if (!meta) return null;

  const cachedBars = readCachedKlines(commodityId);
  const bars = mergeLiveBar(cachedBars, liveQuote);
  const closes = bars.map((b) => b.close).filter((c) => !Number.isNaN(c));
  const dataPoints = closes.length;
  const hasEnough = dataPoints >= 20;
  const hasLivePrice = liveQuote?.price != null && !Number.isNaN(Number(liveQuote.price));

  let boll = null;
  let maStack = null;
  let volume = null;

  if (dataPoints >= 5) {
    boll = computeBollinger(closes, 20, 2);
    maStack = computeMaStack(closes);
    volume = computeVolumeRatio(bars);
  }

  const intraday = computeIntradayMetrics(liveQuote);
  const oi = updateOiSnapshot(commodityId, liveQuote?.openInterest);
  const historicalVol = computeHistoricalVolMetrics(bars);
  const realizedVolPct = computeRealizedVolPct(bars);
  const smoothedVol = computeSmoothedVolMetrics(bars, {
    intraday,
    sectorPrior: options.sectorPrior,
    commodityId: meta.id,
  });
  const volatilityProxy = smoothedVol?.volForecastPct ?? computeVolatilityProxy({ historicalVol, liveQuote, intraday });
  const techScore = technicalScoreFromIndicators({ boll, maStack, volume, oi, intraday });

  let sourceNote = null;
  if (!hasEnough) {
    sourceNote = hasLivePrice ? '日线不足·用盘中+资讯' : '指标待日线积累';
  }

  return {
    commodityId: meta.id,
    name: meta.name,
    exchange: meta.exchange,
    unit: meta.unit,
    dataPoints,
    hasEnough,
    hasLivePrice,
    price: liveQuote?.price ?? (closes.length ? closes[closes.length - 1] : null),
    changePct: liveQuote?.changePct ?? null,
    boll,
    maStack,
    volume,
    oi,
    intraday,
    historicalVol,
    realizedVolPct,
    smoothedVol,
    volatilityProxy,
    techScore,
    sourceNote,
  };
}

module.exports = {
  sma,
  ema,
  computeBollinger,
  computeMaStack,
  computeVolumeRatio,
  computeIntradayMetrics,
  computeDailyReturns,
  computeHistoricalVolMetrics,
  computeRealizedVolPct,
  computeSmoothedVolMetrics,
  computeVolatilityProxy,
  readPrevVolForecast,
  writeVolForecast,
  capVolForecastDayOverDay,
  readCachedKlines,
  hasCachedDayKlines,
  mergeLiveBar,
  updateOiSnapshot,
  analyzeInstrumentTechnicals,
  technicalScoreFromIndicators,
};
