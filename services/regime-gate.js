/**
 * L1 regime gate — auditable prediction emission + confidence labels.
 * Uses market-regime-classifier五态; no fake defaults when regime missing.
 */
const {
  REGIME_VERSION,
  REGIME_LABELS,
  REGIME_IDS,
  classifyMarketRegime,
} = require('./market-regime-classifier');
const { evaluateTradableDay } = require('./tradable-day-kpi');

const GATE_VERSION = 'v1.47.0-regime-gate';

/** Probe-aligned confidence multipliers (flow/vol experiments). */
const REGIME_CONFIDENCE_MULTIPLIER = Object.freeze({
  trend: 1.0,
  event: 1.15,
  basis: 0.85,
  range: 0.9,
  seasonal: 0.95,
});

/** Weak composite below this on non-tradable range days → suppress emit.
 *  Retained 0.15 for live UI — aligns with direction-tier weak band; OOS grid showed no better threshold. */
const RANGE_SUPPRESS_COMPOSITE = 0.15;

function nowIso() {
  return new Date().toISOString();
}

function resolveRegime(ctx = {}) {
  if (ctx.marketRegime && REGIME_IDS.includes(ctx.marketRegime)) {
    return {
      regime: ctx.marketRegime,
      regimeLabel: ctx.marketRegimeLabel || REGIME_LABELS[ctx.marketRegime] || ctx.marketRegime,
      reasons: ctx.marketRegimeReasons || ctx.reasons || [],
      version: ctx.marketRegimeVersion || REGIME_VERSION,
      dataSource: 'market-regime-classifier',
    };
  }
  if (ctx.l1Regime?.regime) {
    return {
      regime: ctx.l1Regime.regime,
      regimeLabel: ctx.l1Regime.regimeLabel || REGIME_LABELS[ctx.l1Regime.regime],
      reasons: ctx.l1Regime.reasons || [],
      version: ctx.l1Regime.version || REGIME_VERSION,
      dataSource: 'market-regime-classifier',
    };
  }
  return null;
}

function classifyConfidenceLabel(multiplier, emit, hasRegime) {
  if (!hasRegime) return '待校验';
  if (!emit) return '低';
  if (multiplier == null) return '待校验';
  if (multiplier >= 1.05) return '高';
  if (multiplier >= 0.92) return '中';
  return '低';
}

/**
 * @param {object} ctx
 * @param {string} [ctx.instrumentId]
 * @param {string} [ctx.marketRegime]
 * @param {string} [ctx.direction] bullish|bearish|neutral
 * @param {number} [ctx.compositeScore]
 * @param {number} [ctx.pUp]
 * @param {string} [ctx.baselineDate]
 * @param {number} [ctx.baseClose]
 * @param {object} [ctx.tradableDay] evaluateTradableDay output
 * @param {object} [ctx.l1Regime] classifyMarketRegime output
 */
function evaluateRegimeGate(ctx = {}) {
  const asOf = ctx.asOf || nowIso();
  const resolved = resolveRegime(ctx);
  const tradable =
    ctx.tradableDay ||
    evaluateTradableDay({
      instrumentId: ctx.instrumentId,
      date: ctx.date || ctx.baselineDate,
      marketRegime: resolved?.regime,
      overnightIntlPct: ctx.overnightIntlPct,
    });

  const reasons = [];
  let emit = true;
  let gated = false;
  let gateReason = null;

  if (!resolved?.regime) {
    emit = false;
    gated = true;
    gateReason = 'regime_missing';
    reasons.push('L1 regime 待校验');
  } else {
    reasons.push(...(resolved.reasons || []).slice(0, 4));
    const mult = REGIME_CONFIDENCE_MULTIPLIER[resolved.regime] ?? 1;
    const composite = Math.abs(Number(ctx.compositeScore ?? 0));
    const isRange = resolved.regime === 'range';
    const isEvent = resolved.regime === 'event';

    if (isRange && tradable.tradable !== true && composite < RANGE_SUPPRESS_COMPOSITE) {
      emit = false;
      gated = true;
      gateReason = 'range_non_tradable_weak_signal';
      reasons.push('震荡非 tradable-day · 信号偏弱 · 抑制方向输出');
    } else if (isEvent) {
      reasons.push('高波动事件市 · 谨慎模式');
    } else if (isRange && tradable.tradable !== true) {
      reasons.push('震荡非 tradable-day · 降置信');
    }

    if (tradable.tradable === true) {
      reasons.push('tradable-day 条件命中');
    }
  }

  const multiplier =
    resolved?.regime != null ? (REGIME_CONFIDENCE_MULTIPLIER[resolved.regime] ?? 1) : null;
  const confidenceLabel = classifyConfidenceLabel(multiplier, emit, Boolean(resolved?.regime));

  return {
    version: GATE_VERSION,
    dataSource: 'regime-gate',
    method: 'l1-regime-multiplier+tradable-day-emit',
    modelSource: resolved?.dataSource || 'market-regime-classifier',
    asOf,
    marketRegime: resolved?.regime ?? null,
    marketRegimeLabel: resolved?.regimeLabel ?? null,
    marketRegimeVersion: resolved?.version ?? REGIME_VERSION,
    marketRegimeReasons: resolved?.reasons ?? [],
    emit,
    gated,
    gateReason,
    confidenceLabel,
    confidenceMultiplier: multiplier,
    tradableDay: tradable.tradable,
    tradableDayReasons: tradable.reasons ?? [],
    baselineDate: ctx.baselineDate ?? null,
    baseClose: ctx.baseClose ?? null,
    reasons,
  };
}

/**
 * Classify L1 regime from bars (live / backtest hook).
 */
function classifyL1RegimeFromBars(ctx = {}) {
  const { bars, barIndex, instrumentId, sector, technical, newsImpact, barDate } = ctx;
  if (!bars?.length || barIndex == null || barIndex < 0) return null;
  const date = barDate || String(bars[barIndex]?.date || bars[barIndex]?.time || '').slice(0, 10);
  if (!date) return null;
  return classifyMarketRegime({
    barDate: date,
    sector: sector || 'unknown',
    instrumentId,
    barIndex,
    klines: bars,
    bars,
    technical: technical || {},
    newsImpact: newsImpact || {},
  });
}

/**
 * Apply gate to direction output (does not fabricate direction when suppressed).
 */
function applyRegimeGateToDirection(direction, gate) {
  if (!gate || gate.emit !== false) {
    return { direction, suppressed: false, gateReason: gate?.gateReason ?? null };
  }
  return { direction: 'neutral', suppressed: true, gateReason: gate.gateReason || 'regime_gate' };
}

module.exports = {
  GATE_VERSION,
  REGIME_CONFIDENCE_MULTIPLIER,
  REGIME_SUPPRESS_COMPOSITE: RANGE_SUPPRESS_COMPOSITE,
  evaluateRegimeGate,
  classifyL1RegimeFromBars,
  applyRegimeGateToDirection,
  classifyConfidenceLabel,
};
