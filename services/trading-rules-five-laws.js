/**
 * 五法则计票引—Phase 1
 * 海龟 · 海豚 · 1-2-3 · 波动'· 摆荡
 */
const preciousInference = require('./cross-market-precious-inference');

const LAWS_VERSION = 'five-laws-v1';

const VOL_LOW_PCTILE = 30;
const VOL_HIGH_PCTILE = 70;
const RANGE_OSC_WEIGHT = 1.5;

const TURTLE_SHORT = 20;
const TURTLE_LONG = 55;
const TURTLE_NEAR_ATR = 0.5;
const DOLPHIN_FAST = 13;
const DOLPHIN_SLOW = 34;
const ATR_PERIOD = 20;
const RSI_PERIOD = 14;
const BB_PERIOD = 20;
const KDJ_PERIOD = 9;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normBarDate(bar) {
  return String(bar?.date || bar?.time || '').slice(0, 10);
}

function philToSide(label) {
  if (label === 'bullish') return 'long';
  if (label === 'bearish') return 'short';
  return null;
}

function sideToPhil(side) {
  if (side === 'long') return 'bullish';
  if (side === 'short') return 'bearish';
  return 'neutral';
}

function inactiveVote(law, reason = 'inactive') {
  return { law, state: 'inactive', direction: 'neutral', vote: 0, reason };
}

function activeVote(law, direction, detail = {}) {
  const vote = detail.vote != null ? detail.vote : direction === 'neutral' ? 0 : 1;
  const { vote: _vote, ...rest } = detail;
  return {
    law,
    state: 'active',
    direction,
    vote,
    ...rest,
  };
}

function isLiveTier(tier) {
  const t = String(tier || '').toLowerCase();
  return t === 'live_high_hit' || t === 'high_hit';
}

function isSimRelaxed(tier) {
  const t = String(tier || '').toLowerCase();
  return t === 'sim_relaxed' || t === 'relaxed';
}

function isEventSimTier(regime, tier) {
  return String(regime || '').toLowerCase() === 'event' && !isLiveTier(tier);
}

function emaSeries(values, period) {
  if (!values?.length || values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out = new Array(period - 1).fill(null);
  out.push(prev);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function computeAtr(bars, period = ATR_PERIOD) {
  if (!bars?.length || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    const h = Number(bars[i].high ?? bars[i].close);
    const l = Number(bars[i].low ?? bars[i].close);
    const pc = Number(bars[i - 1].close);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  const atr = trs.slice(-period).reduce((s, v) => s + v, 0) / period;
  const lastClose = Number(bars[bars.length - 1].close);
  return {
    atr,
    atrPct: lastClose > 0 ? (atr / lastClose) * 100 : null,
  };
}

function computeRealizedVolPctile(bars, lookback = 20) {
  if (!bars?.length || bars.length < lookback + 1) return null;
  const closes = bars.map((b) => Number(b.close)).filter((c) => c > 0);
  if (closes.length < lookback + 1) return null;
  const rets = [];
  for (let i = closes.length - lookback; i < closes.length; i += 1) {
    rets.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  const current = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length);
  const history = [];
  for (let end = lookback + 1; end <= closes.length; end += 1) {
    const slice = [];
    for (let i = end - lookback; i < end; i += 1) {
      slice.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
    }
    history.push(Math.sqrt(slice.reduce((s, r) => s + r * r, 0) / slice.length));
  }
  const sorted = [...history].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v <= current).length;
  return {
    realizedVol: current,
    percentile: sorted.length ? (rank / sorted.length) * 100 : 50,
  };
}

function computeRsi(closes, period = RSI_PERIOD) {
  if (!closes?.length || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function computeKdj(bars, period = KDJ_PERIOD) {
  if (!bars?.length || bars.length < period) return null;
  const slice = bars.slice(-period);
  const close = Number(slice[slice.length - 1].close);
  const low = Math.min(...slice.map((b) => Number(b.low ?? b.close)));
  const high = Math.max(...slice.map((b) => Number(b.high ?? b.close)));
  if (high === low) return { k: 50, d: 50, j: 50 };
  const rsv = ((close - low) / (high - low)) * 100;
  const k = rsv;
  const d = k;
  const j = 3 * k - 2 * d;
  return { k, d, j };
}

function computeBollinger(closes, period = BB_PERIOD) {
  if (!closes?.length || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((s, v) => s + v, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
  return { mid, upper: mid + 2 * sd, lower: mid - 2 * sd, current: closes[closes.length - 1] };
}

/** L1 regime '激活法'ID 列表 */
function activeLawSet(regime) {
  const r = String(regime || 'trend').toLowerCase();
  if (r === 'range' || r === 'seasonal') return ['oscillation', 'volatility'];
  if (r === 'event') return ['turtle', 'dolphin', 'oneTwoThree'];
  if (r === 'basis') return ['turtle', 'oscillation', 'volatility'];
  return ['turtle', 'dolphin', 'oneTwoThree'];
}

/** 投票阈—sim_relaxed / sim_balanced / live_high_hit */
function getRequiredVotes(regime, tier = 'sim_balanced') {
  const r = String(regime || 'trend').toLowerCase();
  const t = String(tier || 'sim_balanced').toLowerCase();
  const isLive = isLiveTier(t);
  const isRelaxed = isSimRelaxed(t);

  if (r === 'range' || r === 'seasonal') {
    if (isRelaxed) {
      return {
        required: 1,
        total: 2,
        laws: ['oscillation', 'volatility'],
        mustInclude: null,
        rangeVolGuard: true,
      };
    }
    return { required: 2, total: 2, laws: ['oscillation', 'volatility'], mustInclude: null };
  }
  if (r === 'basis') {
    return {
      required: isLive ? 3 : isRelaxed ? 1 : 2,
      total: 3,
      laws: ['turtle', 'oscillation', 'volatility'],
      mustInclude: null,
    };
  }
  if (r === 'event') {
    return {
      required: isLive ? 2 : isRelaxed ? 1 : 2,
      total: 3,
      laws: ['turtle', 'dolphin', 'oneTwoThree'],
      mustInclude: isRelaxed ? null : ['turtle', 'dolphin'],
    };
  }
  return {
    required: isLive ? 3 : isRelaxed ? 1 : 2,
    total: 3,
    laws: ['turtle', 'dolphin', 'oneTwoThree'],
    mustInclude: null,
  };
}

function evaluateTurtle(bars, barIndex, opts = {}) {
  const slice = bars.slice(0, barIndex + 1);
  if (slice.length < TURTLE_LONG + 1) return inactiveVote('turtle', 'insufficient_bars');

  const window = slice.slice(0, -1);
  const current = Number(slice[slice.length - 1].close);
  const highs20 = window.slice(-TURTLE_SHORT).map((b) => Number(b.high ?? b.close));
  const lows20 = window.slice(-TURTLE_SHORT).map((b) => Number(b.low ?? b.close));
  const highs55 = window.slice(-TURTLE_LONG).map((b) => Number(b.high ?? b.close));
  const lows55 = window.slice(-TURTLE_LONG).map((b) => Number(b.low ?? b.close));

  const max20 = Math.max(...highs20);
  const min20 = Math.min(...lows20);
  const max55 = Math.max(...highs55);
  const min55 = Math.min(...lows55);
  const atr = computeAtr(slice, ATR_PERIOD);

  let direction = 'neutral';
  let vote = 0;
  let nearBreakout = null;
  if (current > max20 || current > max55) {
    direction = 'long';
    vote = 1;
  } else if (current < min20 || current < min55) {
    direction = 'short';
    vote = 1;
  } else if (isEventSimTier(opts.regime, opts.tier) && atr?.atr) {
    const band = TURTLE_NEAR_ATR * atr.atr;
    if (current >= max20 - band && current < max20) {
      direction = 'long';
      vote = 0.5;
      nearBreakout = '20d_high';
    } else if (current >= max55 - band && current < max55) {
      direction = 'long';
      vote = 0.5;
      nearBreakout = '55d_high';
    } else if (current <= min20 + band && current > min20) {
      direction = 'short';
      vote = 0.5;
      nearBreakout = '20d_low';
    } else if (current <= min55 + band && current > min55) {
      direction = 'short';
      vote = 0.5;
      nearBreakout = '55d_low';
    }
  }

  return activeVote('turtle', direction, {
    max20,
    min20,
    max55,
    min55,
    atrStop: atr?.atr ?? null,
    vote,
    nearBreakout,
    breakout: current > max20 ? '20d' : current > max55 ? '55d' : current < min20 ? '20d' : current < min55 ? '55d' : null,
  });
}

function getCmxEmaDirection(instrumentId, barDate, crossMarketCtx) {
  const id = String(instrumentId || '').toLowerCase();
  if (id !== 'au' && id !== 'ag') return null;
  const ctx = crossMarketCtx?.comexGold || crossMarketCtx?.comexSilver
    ? crossMarketCtx
    : preciousInference.ensureIntlSeriesLoaded();
  const bars = id === 'ag' ? ctx.comexSilver : ctx.comexGold;
  if (!bars?.length) return null;

  const d = normBarDate(barDate);
  let endIdx = -1;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (bars[i].date <= d) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < DOLPHIN_SLOW + 1) return null;

  const closes = bars
    .slice(0, endIdx + 1)
    .map((b) => Number(b.close))
    .filter((c) => c > 0);
  if (closes.length < DOLPHIN_SLOW + 1) return null;

  const emaFast = emaSeries(closes, DOLPHIN_FAST);
  const emaSlow = emaSeries(closes, DOLPHIN_SLOW);
  const fastNow = emaFast[emaFast.length - 1];
  const slowNow = emaSlow[emaSlow.length - 1];
  if (fastNow == null || slowNow == null) return null;
  if (fastNow > slowNow) return 'long';
  if (fastNow < slowNow) return 'short';
  return 'neutral';
}

function getCmxLeadDirection(instrumentId, barDate, crossMarketCtx) {
  const id = String(instrumentId || '').toLowerCase();
  if (id !== 'au' && id !== 'ag') return { direction: null, ok: true };
  const infer =
    crossMarketCtx?.cmxInference ||
    preciousInference.inferPointChangeFromClose(barDate, id, crossMarketCtx || {});
  if (!infer || infer.gated) return { direction: null, ok: false, gateReason: infer?.gateReason };
  const delta = Number(infer.predictedDelta ?? 0);
  if (delta > 0) return { direction: 'long', ok: true, predictedDelta: delta };
  if (delta < 0) return { direction: 'short', ok: true, predictedDelta: delta };
  return { direction: 'neutral', ok: true };
}

function evaluateDolphin(bars, barIndex, instrumentId, crossMarketCtx, opts = {}) {
  const slice = bars.slice(0, barIndex + 1);
  const closes = slice.map((b) => Number(b.close)).filter((c) => c > 0);
  if (closes.length < DOLPHIN_SLOW + 2) return inactiveVote('dolphin', 'insufficient_bars');

  const emaFast = emaSeries(closes, DOLPHIN_FAST);
  const emaSlow = emaSeries(closes, DOLPHIN_SLOW);
  const fastNow = emaFast[emaFast.length - 1];
  const slowNow = emaSlow[emaSlow.length - 1];
  const fastPrev = emaFast[emaFast.length - 2];
  const slowPrev = emaSlow[emaSlow.length - 2];
  if ([fastNow, slowNow, fastPrev, slowPrev].some((v) => v == null)) {
    return inactiveVote('dolphin', 'ema_unavailable');
  }

  const domesticCrossed =
    (fastPrev <= slowPrev && fastNow > slowNow) || (fastPrev >= slowPrev && fastNow < slowNow);

  let direction = 'neutral';
  if (domesticCrossed) direction = fastNow > slowNow ? 'long' : 'short';
  else if (fastNow > slowNow) direction = 'long';
  else if (fastNow < slowNow) direction = 'short';

  const barDate = normBarDate(slice[slice.length - 1]);
  const id = String(instrumentId || '').toLowerCase();
  const eventSim = isEventSimTier(opts.regime, opts.tier);

  if (id === 'au' || id === 'ag') {
    const cmx = getCmxLeadDirection(id, barDate, crossMarketCtx);
    if (!cmx.ok) return inactiveVote('dolphin', cmx.gateReason || 'cmx_gate');

    const cmxEmaDir = eventSim ? getCmxEmaDirection(id, barDate, crossMarketCtx) : null;
    if (eventSim && cmxEmaDir && cmxEmaDir !== 'neutral' && !domesticCrossed) {
      direction = cmxEmaDir;
      return activeVote('dolphin', direction, {
        ema13: +fastNow.toFixed(4),
        ema34: +slowNow.toFixed(4),
        cmxLeadOnly: true,
        cmxEmaDir,
        cmxLead: cmx.direction,
      });
    }

    if (cmx.direction && direction !== 'neutral' && cmx.direction !== direction) {
      return activeVote('dolphin', 'neutral', { cmxMismatch: true, domestic: direction, cmx: cmx.direction });
    }
    if (cmx.direction && direction === 'neutral') direction = cmx.direction;
    return activeVote('dolphin', direction, { ema13: +fastNow.toFixed(4), ema34: +slowNow.toFixed(4), cmxLead: cmx.direction });
  }

  return activeVote('dolphin', direction, { ema13: +fastNow.toFixed(4), ema34: +slowNow.toFixed(4) });
}

function findSwingPoints(bars, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < bars.length - lookback; i += 1) {
    const h = Number(bars[i].high ?? bars[i].close);
    const l = Number(bars[i].low ?? bars[i].close);
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j === i) continue;
      const hj = Number(bars[j].high ?? bars[j].close);
      const lj = Number(bars[j].low ?? bars[j].close);
      if (hj >= h) isHigh = false;
      if (lj <= l) isLow = false;
    }
    if (isHigh) swings.push({ type: 'high', idx: i, price: h });
    if (isLow) swings.push({ type: 'low', idx: i, price: l });
  }
  return swings;
}

function evaluateOneTwoThree(bars, barIndex) {
  const slice = bars.slice(Math.max(0, barIndex - 60), barIndex + 1);
  if (slice.length < 20) return inactiveVote('oneTwoThree', 'insufficient_bars');

  const swings = findSwingPoints(slice, 3);
  const current = Number(slice[slice.length - 1].close);
  const recent = swings.slice(-6);

  for (let i = 0; i < recent.length - 2; i += 1) {
    const [p1, p2, p3] = [recent[i], recent[i + 1], recent[i + 2]];
    if (p1.type === 'low' && p2.type === 'high' && p3.type === 'low') {
      if (p3.price > p1.price && current > p2.price) {
        return activeVote('oneTwoThree', 'long', { point1: p1.price, point2: p2.price, point3: p3.price, brokePoint2: true });
      }
    }
    if (p1.type === 'high' && p2.type === 'low' && p3.type === 'high') {
      if (p3.price < p1.price && current < p2.price) {
        return activeVote('oneTwoThree', 'short', { point1: p1.price, point2: p2.price, point3: p3.price, brokePoint2: true });
      }
    }
  }
  return activeVote('oneTwoThree', 'neutral', { structure: 'incomplete' });
}

function evaluateVolatility(bars, barIndex, regime) {
  const slice = bars.slice(0, barIndex + 1);
  const atr = computeAtr(slice, ATR_PERIOD);
  const vol = computeRealizedVolPctile(slice, 20);
  if (!atr && !vol) return inactiveVote('volatility', 'insufficient_data');

  const pctile = vol?.percentile ?? 50;
  let regimeLabel = 'mid';
  if (pctile < VOL_LOW_PCTILE) regimeLabel = 'low';
  else if (pctile > VOL_HIGH_PCTILE) regimeLabel = 'high';

  const r = String(regime || '').toLowerCase();
  let direction = 'neutral';
  if (regimeLabel === 'low') {
    direction = 'neutral';
  } else if (regimeLabel === 'high') {
    direction = 'neutral';
  } else {
    const closes = slice.map((b) => Number(b.close));
    const chg = closes.length >= 2 ? closes[closes.length - 1] - closes[closes.length - 2] : 0;
    direction = chg > 0 ? 'long' : chg < 0 ? 'short' : 'neutral';
  }

  return activeVote('volatility', direction, {
    atrPct: atr?.atrPct ?? null,
    volPercentile: pctile != null ? +pctile.toFixed(1) : null,
    volatilityRegime: regimeLabel,
    auxiliary: r === 'trend' || r === 'event',
  });
}

function evaluateOscillation(bars, barIndex, regime, trendLawVotes = []) {
  const slice = bars.slice(0, barIndex + 1);
  const closes = slice.map((b) => Number(b.close)).filter((c) => c > 0);
  if (closes.length < BB_PERIOD) return inactiveVote('oscillation', 'insufficient_bars');

  const rsi = computeRsi(closes, RSI_PERIOD);
  const kdj = computeKdj(slice, KDJ_PERIOD);
  const bb = computeBollinger(closes, BB_PERIOD);

  const votes = [];
  if (rsi != null) {
    if (rsi <= 30) votes.push('long');
    else if (rsi >= 70) votes.push('short');
    else votes.push('neutral');
  }
  if (kdj) {
    if (kdj.k < 20 && kdj.d < 20) votes.push('long');
    else if (kdj.k > 80 && kdj.d > 80) votes.push('short');
    else votes.push('neutral');
  }
  if (bb) {
    if (bb.current <= bb.lower) votes.push('long');
    else if (bb.current >= bb.upper) votes.push('short');
    else votes.push('neutral');
  }

  const longs = votes.filter((v) => v === 'long').length;
  const shorts = votes.filter((v) => v === 'short').length;
  let direction = 'neutral';
  if (longs >= 2) direction = 'long';
  else if (shorts >= 2) direction = 'short';

  const r = String(regime || '').toLowerCase();
  if (r === 'trend') {
    const trendDirs = trendLawVotes
      .filter((v) => v.state === 'active' && v.direction !== 'neutral')
      .map((v) => v.direction);
    if (trendDirs.length >= 2) {
      const majority = trendDirs.filter((d) => d === 'long').length >= 2 ? 'long' : 'short';
      if (direction !== 'neutral' && direction !== majority) {
        return inactiveVote('oscillation', 'counter_trend_disabled');
      }
    }
  }

  const weight = r === 'range' ? RANGE_OSC_WEIGHT : 1;
  return activeVote('oscillation', direction, {
    rsi: rsi != null ? +rsi.toFixed(2) : null,
    kdj,
    bbPosition: bb ? (bb.current >= bb.upper ? 'upper' : bb.current <= bb.lower ? 'lower' : 'mid') : null,
    weight,
  });
}

function evaluateLawPass(votes, regime, tier, philosophyDirection, volatilityRegime = 'mid') {
  const spec = getRequiredVotes(regime, tier);
  const philSide = philToSide(philosophyDirection);
  const active = spec.laws
    .map((law) => votes.find((v) => v.law === law))
    .filter((v) => v && v.state === 'active');

  const aligned = active.filter((v) => philSide && v.direction === philSide && Number(v.vote) > 0);
  let alignedCount = aligned.reduce((sum, v) => sum + Number(v.vote), 0);

  const osc = aligned.find((v) => v.law === 'oscillation');
  if (osc?.weight > 1 && alignedCount > 0) {
    alignedCount = Math.min(spec.total, alignedCount - 1 + osc.weight);
  }

  let pass = philSide && alignedCount >= spec.required;

  if (pass && spec.mustInclude?.length) {
    const hasCore = aligned.some((v) => spec.mustInclude.includes(v.law));
    if (!hasCore) pass = false;
  }

  if (pass && spec.rangeVolGuard && volatilityRegime === 'high') {
    pass = false;
  }

  return {
    pass,
    alignedCount: +alignedCount.toFixed(2),
    requiredVotes: spec.required,
    totalLaws: spec.total,
    spec,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.instrumentId
 * @param {Array} opts.bars
 * @param {number} opts.barIndex
 * @param {string} opts.regime
 * @param {string} [opts.sector]
 * @param {string} [opts.philosophyDirection] 'bullish|bearish|neutral
 * @param {object} [opts.crossMarketCtx]
 * @param {string} [opts.tier]
 */
function evaluateFiveLaws(opts = {}) {
  const {
    instrumentId,
    bars,
    barIndex,
    regime = 'trend',
    philosophyDirection = 'neutral',
    crossMarketCtx,
    tier = 'sim_balanced',
  } = opts;

  const activeLaws = activeLawSet(regime);
  const allVotes = [];

  const lawOpts = { regime, tier };
  const turtle = activeLaws.includes('turtle')
    ? evaluateTurtle(bars, barIndex, lawOpts)
    : inactiveVote('turtle');
  const dolphin = activeLaws.includes('dolphin')
    ? evaluateDolphin(bars, barIndex, instrumentId, crossMarketCtx, lawOpts)
    : inactiveVote('dolphin');
  const oneTwoThree = activeLaws.includes('oneTwoThree')
    ? evaluateOneTwoThree(bars, barIndex)
    : inactiveVote('oneTwoThree');
  const volatility = activeLaws.includes('volatility')
    ? evaluateVolatility(bars, barIndex, regime)
    : inactiveVote('volatility');

  const trendVotes = [turtle, dolphin, oneTwoThree];
  const oscillation = activeLaws.includes('oscillation')
    ? evaluateOscillation(bars, barIndex, regime, trendVotes)
    : inactiveVote('oscillation');

  allVotes.push(turtle, dolphin, oneTwoThree, volatility, oscillation);

  const votes = allVotes.filter((v) => activeLaws.includes(v.law) || v.state === 'inactive');
  const volVote = volatility.state === 'active' ? volatility : null;
  const volatilityRegime = volVote?.volatilityRegime ?? 'mid';
  const passResult = evaluateLawPass(votes, regime, tier, philosophyDirection, volatilityRegime);

  return {
    version: LAWS_VERSION,
    votes,
    pass: passResult.pass,
    requiredVotes: passResult.requiredVotes,
    alignedCount: passResult.alignedCount,
    activeLaws,
    details: {
      turtle,
      dolphin,
      oneTwoThree,
      volatility,
      oscillation,
    },
    volatilityRegime,
    sizeMultiplier: volatilityRegime === 'high' ? 0.5 : 1,
    philosophyDirection,
    regime,
    tier,
  };
}

module.exports = {
  LAWS_VERSION,
  VOL_LOW_PCTILE,
  VOL_HIGH_PCTILE,
  RANGE_OSC_WEIGHT,
  activeLawSet,
  getRequiredVotes,
  evaluateFiveLaws,
  philToSide,
  sideToPhil,
};
