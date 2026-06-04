/**
 * 大宗商品技术面分析 — SMA/EMA、BOLL(20,2)、量比、MA 排列与金叉/死叉
 */
const diskCache = require('./disk-cache');
const { getCommodityMeta } = require('./commodities-catalog');

const OI_SNAP_PREFIX = 'oi-snap/';

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
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((s, v) => s + v, 0) / period;
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
    period,
    mult,
    upper: +upper.toFixed(4),
    mid: +mid.toFixed(4),
    lower: +lower.toFixed(4),
    bandwidth: +bandwidth.toFixed(3),
    position,
    positionLabel,
    pctB: +pctB.toFixed(3),
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
      alignmentLabel = '多头排列';
      alignmentScore = 0.7;
    } else if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) {
      alignment = 'bearish';
      alignmentLabel = '空头排列';
      alignmentScore = -0.7;
    } else if (ma5 > ma20) {
      alignment = 'mild_bull';
      alignmentLabel = '短多';
      alignmentScore = 0.25;
    } else if (ma5 < ma20) {
      alignment = 'mild_bear';
      alignmentLabel = '短空';
      alignmentScore = -0.25;
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
  };
}

function computeVolumeRatio(bars) {
  if (!bars?.length || bars.length < 6) return null;
  const last = bars[bars.length - 1];
  const prev5 = bars.slice(-6, -1);
  const avgVol = prev5.reduce((s, b) => s + (b.volume || 0), 0) / prev5.length;
  if (!avgVol || avgVol <= 0) return null;
  const ratio = last.volume / avgVol;
  let label = '平量';
  if (ratio >= 1.5) label = '放量';
  else if (ratio >= 1.15) label = '温和放量';
  else if (ratio <= 0.65) label = '缩量';
  else if (ratio <= 0.85) label = '温和缩量';
  return {
    ratio: +ratio.toFixed(3),
    label,
    todayVolume: last.volume || 0,
    avg5Volume: +avgVol.toFixed(0),
    score: clamp((ratio - 1) * 0.35, -0.5, 0.5),
  };
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

function updateOiSnapshot(commodityId, openInterest) {
  const key = `${OI_SNAP_PREFIX}${commodityId}.json`;
  const prev = diskCache.readStale(key);
  const prevOi = prev?.data?.openInterest;
  if (openInterest != null && !Number.isNaN(openInterest) && openInterest > 0) {
    diskCache.write(key, { data: { openInterest, savedAt: Date.now() } });
  }
  if (prevOi != null && openInterest != null && prevOi > 0) {
    const deltaPct = ((openInterest - prevOi) / prevOi) * 100;
    let label = '持仓平稳';
    if (deltaPct >= 3) label = '明显增仓';
    else if (deltaPct >= 1) label = '增仓';
    else if (deltaPct <= -3) label = '明显减仓';
    else if (deltaPct <= -1) label = '减仓';
    return {
      current: openInterest,
      previous: prevOi,
      deltaPct: +deltaPct.toFixed(3),
      label,
      score: clamp(deltaPct / 8, -0.6, 0.6),
    };
  }
  return {
    current: openInterest ?? null,
    previous: prevOi ?? null,
    deltaPct: null,
    label: '持仓数据积累中',
    score: 0,
  };
}

function technicalScoreFromIndicators({ boll, maStack, volume, oi }) {
  let score = 0;
  let weight = 0;

  if (maStack?.alignmentScore != null) {
    score += maStack.alignmentScore * 0.35;
    weight += 0.35;
  }
  if (boll) {
    const bollScore = boll.position === 'upper' ? 0.15 : boll.position === 'lower' ? -0.15 : 0;
    score += bollScore;
    weight += 0.2;
  }
  if (volume?.score != null) {
    score += volume.score * 0.25;
    weight += 0.25;
  }
  if (oi?.score != null) {
    score += oi.score * 0.2;
    weight += 0.2;
  }

  return weight > 0 ? clamp(score / weight, -1, 1) : 0;
}

function analyzeInstrumentTechnicals(commodityId, liveQuote = null) {
  const meta = getCommodityMeta(commodityId);
  if (!meta) return null;

  const bars = readCachedKlines(commodityId);
  const closes = bars.map((b) => b.close).filter((c) => !Number.isNaN(c));
  const dataPoints = closes.length;
  const hasEnough = dataPoints >= 20;

  let boll = null;
  let maStack = null;
  let volume = null;
  if (hasEnough) {
    boll = computeBollinger(closes, 20, 2);
    maStack = computeMaStack(closes);
    volume = computeVolumeRatio(bars);
  } else if (dataPoints >= 5) {
    maStack = computeMaStack(closes);
    volume = computeVolumeRatio(bars);
  }

  const oi = updateOiSnapshot(commodityId, liveQuote?.openInterest);

  const techScore = technicalScoreFromIndicators({ boll, maStack, volume, oi });

  return {
    commodityId: meta.id,
    name: meta.name,
    exchange: meta.exchange,
    unit: meta.unit,
    dataPoints,
    hasEnough,
    price: liveQuote?.price ?? (closes.length ? closes[closes.length - 1] : null),
    changePct: liveQuote?.changePct ?? null,
    boll,
    maStack,
    volume,
    oi,
    techScore,
    sourceNote: hasEnough ? null : '指标待日线积累',
  };
}

module.exports = {
  sma,
  ema,
  computeBollinger,
  computeMaStack,
  computeVolumeRatio,
  readCachedKlines,
  updateOiSnapshot,
  analyzeInstrumentTechnicals,
  technicalScoreFromIndicators,
};
