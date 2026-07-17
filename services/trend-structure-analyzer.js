/**
 * 攻城台阶 / 回踩结构 — auditable trend vs consolidation detection.
 * Used by market-regime-classifier (L1 range/trend) and direction filters.
 */
const ANALYZER_VERSION = 'v1.30.1';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function rangePct(bars) {
  if (!bars?.length) return 0;
  const highs = bars.map((b) => Number(b.high || b.close));
  const lows = bars.map((b) => Number(b.low || b.close));
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  const mid = (maxH + minL) / 2;
  return mid > 0 ? ((maxH - minL) / mid) * 100 : 0;
}

function findSwingPoints(bars, window = 3) {
  const swings = [];
  for (let i = window; i < bars.length - window; i += 1) {
    const c = bars[i].close;
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (j === i) continue;
      if (bars[j].close >= c) isHigh = false;
      if (bars[j].close <= c) isLow = false;
    }
    if (isHigh) swings.push({ type: 'high', idx: i, price: c });
    else if (isLow) swings.push({ type: 'low', idx: i, price: c });
  }
  return swings;
}

function countHigherLows(swings) {
  const lows = swings.filter((s) => s.type === 'low');
  let count = 0;
  for (let i = 1; i < lows.length; i += 1) {
    if (lows[i].price > lows[i - 1].price * 1.001) count += 1;
  }
  return count;
}

function countLowerHighs(swings) {
  const highs = swings.filter((s) => s.type === 'high');
  let count = 0;
  for (let i = 1; i < highs.length; i += 1) {
    if (highs[i].price < highs[i - 1].price * 0.999) count += 1;
  }
  return count;
}

/**
 * @param {Array} klines OHLC bars (typically last 60–120)
 * @param {'short'|'medium'|'long'} [horizon]
 */
function analyzeTrendStructure(klines, horizon = 'medium') {
  const bars = (klines || []).filter((b) => b?.close > 0);
  const minBars = horizon === 'short' ? 30 : horizon === 'long' ? 90 : 40;
  if (bars.length < minBars) {
    return {
      ok: false,
      version: ANALYZER_VERSION,
      reason: 'insufficient_bars',
      stepBias: null,
      trendPhase: 'consolidation',
      stepCount: 0,
      summary: 'K线不足',
    };
  }

  const lookback = horizon === 'short' ? 40 : horizon === 'long' ? 100 : 60;
  const slice = bars.slice(-Math.min(lookback, bars.length));
  const closes = slice.map((b) => b.close);
  const n = closes.length;

  const ret20 = n >= 21 ? ((closes[n - 1] - closes[n - 21]) / closes[n - 21]) * 100 : 0;
  const range20 = rangePct(slice.slice(-20));
  const range60 = rangePct(slice);
  const rangeRatio = range60 > 0.01 ? range20 / range60 : 1;

  const swingWindow = horizon === 'short' ? 2 : 3;
  const swings = findSwingPoints(slice, swingWindow);
  const higherLows = countHigherLows(swings);
  const lowerHighs = countLowerHighs(swings);

  let stepBias = 'neutral';
  let trendPhase = 'consolidation';
  let stepCount = 0;

  const consolidated = rangeRatio < 0.68 && Math.abs(ret20) < 2.8;
  const bullSteps = higherLows >= 2;
  const bearSteps = lowerHighs >= 2;

  if (consolidated && !bullSteps && !bearSteps) {
    trendPhase = 'consolidation';
    stepBias = 'neutral';
  } else if (bullSteps && ret20 > 1.2) {
    stepBias = 'bull';
    stepCount = higherLows;
    trendPhase = consolidated ? 'pullback' : 'uptrend';
  } else if (bearSteps && ret20 < -1.2) {
    stepBias = 'bear';
    stepCount = lowerHighs;
    trendPhase = consolidated ? 'pullback' : 'downtrend';
  } else if (Math.abs(ret20) >= 3) {
    stepBias = ret20 > 0 ? 'bull' : 'bear';
    stepCount = 1;
    trendPhase = ret20 > 0 ? 'uptrend' : 'downtrend';
  } else if (consolidated) {
    trendPhase = 'consolidation';
  } else {
    stepBias = ret20 > 0.8 ? 'bull' : ret20 < -0.8 ? 'bear' : 'neutral';
    trendPhase = stepBias === 'neutral' ? 'consolidation' : ret20 > 0 ? 'uptrend' : 'downtrend';
    stepCount = stepBias === 'neutral' ? 0 : 1;
  }

  const summary =
    trendPhase === 'consolidation'
      ? `震荡整理 · 20d区间${range20.toFixed(1)}%`
      : `${stepBias === 'bull' ? '多头' : stepBias === 'bear' ? '空头' : '中性'}台阶 x${stepCount} · ${trendPhase}`;

  return {
    ok: true,
    version: ANALYZER_VERSION,
    stepBias,
    trendPhase,
    stepCount,
    rangeRatio: +rangeRatio.toFixed(3),
    ret20: +ret20.toFixed(3),
    higherLows,
    lowerHighs,
    summary,
  };
}

/** Direction filter when step structure opposes tier (probe / calibration hook). */
function applyTrendStructureDirectionFilter({
  fundScore = 0,
  trendStructure,
  directionTier,
  compositeScore = 0,
}) {
  const ts = trendStructure || {};
  const tier = { ...directionTier };
  const filters = [];
  if (!ts.ok) return { directionTier: tier, compositeScore, filters, fundScore };

  const opposed =
    (ts.stepBias === 'bear' && tier.direction?.includes('bull')) ||
    (ts.stepBias === 'bull' && tier.direction?.includes('bear'));
  const inPullback = ts.trendPhase === 'pullback' || ts.trendPhase === 'consolidation';

  if (opposed && inPullback) {
    filters.push('trend_structure_opposed_pullback');
    tier.direction = 'neutral';
    tier.label = '震荡';
    tier.arrow = '→';
  } else if (ts.trendPhase === 'consolidation' && Math.abs(compositeScore) < 0.25) {
    filters.push('consolidation_weak');
    if (tier.direction?.includes('strong')) {
      tier.direction = tier.direction.includes('bull') ? 'bullish' : 'bearish';
      tier.label = tier.direction.includes('bull') ? '偏多' : '偏空';
      tier.arrow = tier.direction.includes('bull') ? '↑' : '↓';
    }
  }

  return { directionTier: tier, compositeScore, filters, fundScore };
}

/** ADX-like proxy: directional move vs average daily range (0–100 scale). */
function computeTrendStrengthProxy(klines) {
  const bars = (klines || []).filter((b) => b?.close > 0);
  if (bars.length < 21) return null;
  const slice = bars.slice(-21);
  const ret20 = ((slice[20].close - slice[0].close) / slice[0].close) * 100;
  let avgRange = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const c = slice[i].close;
    const hi = Number(slice[i].high || c);
    const lo = Number(slice[i].low || c);
    avgRange += c > 0 ? ((hi - lo) / c) * 100 : 0;
  }
  avgRange /= slice.length - 1;
  if (avgRange <= 0) return null;
  return +clamp((Math.abs(ret20) / (avgRange * Math.sqrt(20))) * 25, 0, 100).toFixed(2);
}

module.exports = {
  ANALYZER_VERSION,
  analyzeTrendStructure,
  applyTrendStructureDirectionFilter,
  computeTrendStrengthProxy,
  trendStructureAnalyzer: analyzeTrendStructure,
};
