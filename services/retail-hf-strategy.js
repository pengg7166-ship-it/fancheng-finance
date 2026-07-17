/**
 * Retail-Adapted Hedge Fund Framework · v1.46.0-retail-hf
 *
 * CONSTITUTION (Follow, Don't Lead):
 * Institutions amplify price; retail can only follow phase/OI/master-clock confirmation.
 * HF gross/net factor books are DOWN-SHIFTED to net exposure + concentration guardrails.
 * Never lead squeezes, policy narratives, or crowded distribution exits.
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const RETAIL_HF_VERSION = 'v1.47.0-retail-discipline';

/** Explicit retail disadvantage registry — rules are constraints, not HF alpha signals */
const RETAIL_RULES = Object.freeze({
  noLeadSqueeze: '不参与逼仓主导段，仅观察或极小微O2',
  confirmNotPredict: '机构/phase先动，个人W3才试仓',
  noFightD2Policy: '政策与资金背离时跟phase不跟口号',
  exitWhenCrowdedDistribution: '拥挤+对手将竭=机构可能派发给散户，减',
  distributionTrapHigh: '派发区 trap≥70 · 勿追 · 持有者减',
  l3MandatoryDelever: 'L3强制降gross',
  slippageHalfSize: '滑点品种scout减半',
  max3IndependentBets: '已有',
  noHeroicTopBottom: '禁止纯 narrative 摸顶摸底',
});

/** Primary factor tags per symbol (follower view — net, not gross book) */
const SYMBOL_FACTOR_MAP = Object.freeze({
  cu: { growth: 0.6, risk_on: 0.8, dollar: -0.4, china_credit: 0.5 },
  al: { growth: 0.5, risk_on: 0.6, dollar: -0.3, china_credit: 0.4 },
  zn: { growth: 0.4, risk_on: 0.5, dollar: -0.3, china_credit: 0.3 },
  pb: { growth: 0.3, risk_on: 0.4, dollar: -0.2, china_credit: 0.2 },
  ni: { growth: 0.5, risk_on: 0.6, dollar: -0.3, supply_shock: 0.3 },
  sn: { growth: 0.4, risk_on: 0.5, supply_shock: 0.4 },
  lc: { growth: 0.7, risk_on: 0.7, china_credit: 0.5, inflation: 0.3 },
  au: { dollar: -0.6, risk_on: -0.3, inflation: 0.4 },
  ag: { dollar: -0.5, risk_on: -0.2, inflation: 0.3 },
  sc: { inflation: 0.7, supply_shock: 0.5, dollar: -0.4, risk_on: 0.4 },
  fu: { inflation: 0.6, supply_shock: 0.4, dollar: -0.3 },
  rb: { china_credit: 0.8, growth: 0.5, risk_on: 0.4 },
  hc: { china_credit: 0.7, growth: 0.4, risk_on: 0.3 },
  i: { china_credit: 0.9, growth: 0.6, risk_on: 0.5 },
  j: { china_credit: 0.6, growth: 0.4, inflation: 0.3 },
  jm: { china_credit: 0.7, growth: 0.4, inflation: 0.3 },
  p: { inflation: 0.5, supply_shock: 0.3, china_credit: 0.2 },
  m: { inflation: 0.4, china_credit: 0.3 },
  y: { inflation: 0.4, supply_shock: 0.4 },
  ta: { growth: 0.4, china_credit: 0.5, risk_on: 0.3 },
  ma: { growth: 0.3, china_credit: 0.4, inflation: 0.3 },
});

const FACTOR_LABELS = Object.freeze({
  growth: '增长',
  inflation: '通胀',
  dollar: '美元',
  china_credit: '中国信用',
  supply_shock: '供应冲击',
  risk_on: '风险偏好',
});

function nowIso() {
  return new Date().toISOString();
}

function biasSign(bias) {
  if (bias === '偏多') return 1;
  if (bias === '偏空') return -1;
  return 0;
}

function getSymbolFactors(symbol) {
  const id = normalizeCommodityId(symbol);
  return SYMBOL_FACTOR_MAP[id] || { growth: 0.2, risk_on: 0.2, dollar: -0.2 };
}

function dominantFactor(factorWeights) {
  let best = null;
  let bestVal = 0;
  for (const [k, v] of Object.entries(factorWeights || {})) {
    const abs = Math.abs(v);
    if (abs > bestVal) {
      bestVal = abs;
      best = k;
    }
  }
  return best;
}

/**
 * Which factor institutions are pushing TODAY (phase/OI/master clock proxy).
 */
function deriveFollowSignal(instruments = [], masterClock = null) {
  const signals = [];
  for (const inst of instruments || []) {
    const tg = inst.tradingGuidance;
    const phase = tg?.phase;
    if (!phase || phase === '暂无') continue;
    const factors = getSymbolFactors(inst.id);
    const dom = dominantFactor(factors);
    if (!dom) continue;
    const phaseHot = phase === '升温' || phase === '拥挤';
    const oiUp = inst.factors?.technical?.oi?.deltaPct > 0;
    if (phaseHot || oiUp) {
      signals.push({
        factor: dom,
        via: `${inst.id.toUpperCase()}`,
        phase,
        oiConfirm: oiUp,
        posture: tg?.posture,
      });
    }
  }
  if (masterClock?.regimeLead) {
    signals.push({ factor: masterClock.regimeLead, via: 'master-clock', phase: null, oiConfirm: false });
  }
  const byFactor = new Map();
  for (const s of signals) {
    byFactor.set(s.factor, (byFactor.get(s.factor) || 0) + 1);
  }
  const ranked = [...byFactor.entries()].sort((a, b) => b[1] - a[1]);
  return {
    primary: ranked[0]?.[0] || null,
    signals,
    dataSource: 'retail-hf-strategy:phase-oi-clock',
  };
}

/**
 * @param {string[]} holdings
 * @param {object[]} instruments
 * @param {object} context '{ masterClock }'
 */
function buildFactorExposure(holdings = [], instruments = [], context = {}) {
  const asOf = nowIso();
  const held = (holdings || []).map(normalizeCommodityId).filter(Boolean);
  const instMap = new Map((instruments || []).map((i) => [normalizeCommodityId(i.id), i]));

  const netExposure = {};
  const perSymbol = [];
  const factorCounts = {};

  for (const sym of held) {
    const inst = instMap.get(sym);
    const tg = inst?.tradingGuidance;
    const sign = biasSign(tg?.bias);
    const weights = getSymbolFactors(sym);
    const dom = dominantFactor(weights);
    if (dom) factorCounts[dom] = (factorCounts[dom] || 0) + 1;

    const exposure = {};
    for (const [f, w] of Object.entries(weights)) {
      const net = sign * w;
      exposure[f] = net;
      netExposure[f] = (netExposure[f] || 0) + net;
    }
    perSymbol.push({ symbol: sym, bias: tg?.bias || '暂无', dominantFactor: dom, exposure });
  }

  const n = held.length || 1;
  for (const f of Object.keys(netExposure)) {
    netExposure[f] = +(netExposure[f] / n).toFixed(3);
  }

  const uniqueFactors = Object.keys(factorCounts).length;
  const maxSameFactor = Math.max(0, ...Object.values(factorCounts));
  let hedgeDegree = 100;
  if (held.length >= 2) {
    hedgeDegree = Math.round((uniqueFactors / Math.min(held.length, 3)) * 100);
    if (maxSameFactor >= 2) hedgeDegree = Math.max(0, hedgeDegree - (maxSameFactor - 1) * 35);
    if (held.length >= 3 && maxSameFactor >= 3) hedgeDegree = 0;
  }

  const follow = deriveFollowSignal(instruments, context.masterClock);
  const youAreFollowing = follow.signals
    .filter((s) => s.factor === follow.primary)
    .slice(0, 4)
    .map((s) => `${s.factor}_via_${s.via}`);

  const accidentalConcentration = Object.entries(factorCounts)
    .filter(([, count]) => count >= 2)
    .map(([f, count]) => `${FACTOR_LABELS[f] || f}×${count}`);

  const followAdvice =
    youAreFollowing.length && accidentalConcentration.length
      ? `宜跟随 ${FACTOR_LABELS[follow.primary] || follow.primary} · 勿扎堆 ${accidentalConcentration.join('、')}`
      : youAreFollowing.length
        ? `宜跟随 ${FACTOR_LABELS[follow.primary] || follow.primary}`
        : accidentalConcentration.length
          ? `勿扎堆 ${accidentalConcentration.join('、')}`
          : '分散跟随 · 等待 phase 确认';

  return {
    netExposure,
    perSymbol,
    hedgeDegree,
    followSignal: follow,
    youAreFollowing,
    accidentalConcentration,
    followAdvice,
    factorLine: `组合因子：净暴露 ${Object.keys(netExposure).length || 0}维 · 对冲度 ${hedgeDegree} · 散户${followAdvice}`,
    dataSource: 'retail-hf-strategy',
    method: 'net-factor-exposure+concentration-guard',
    version: RETAIL_HF_VERSION,
    asOf,
  };
}

/**
 * Retail convexity & exit liquidity — NOT HF gamma; scout sizing only.
 */
function assessRetailPositionQuality(inst, context = {}) {
  const asOf = nowIso();
  const spec = inst?.integratedSpec || context.integratedSpec || {};
  const tg = inst?.tradingGuidance || context.tradingGuidance;
  const phase = tg?.phase;
  const posture = tg?.posture;
  const slippage = spec.slippage || context.slippage;
  const evidence = [];

  let convexityScore = 50;
  let convexityLabel = '中性';
  const hasStop = !!(inst?.longTermGuidance?.stop?.hardStop ?? context.hardStop);
  const isScout = posture === '试仓' || spec.watchLevel === 'W2' || spec.watchLevel === 'W3';
  const crowded = phase === '拥挤';
  const narrativeFull =
    spec.expectationGap?.gap === 'overshoot' && !spec.opponentStatus?.blockReduceLongOnHighPrice;

  if (isScout && hasStop && !crowded) {
    convexityScore = 85;
    convexityLabel = 'scout+止损 · 适合散户';
    evidence.push('试仓+硬止损 · 凸性友好');
  } else if (narrativeFull && ['持有', '加仓'].includes(posture)) {
    convexityScore = 15;
    convexityLabel = '裸 narrative · 不宜';
    evidence.push(RETAIL_RULES.noHeroicTopBottom);
  } else if (crowded && ['持有', '加仓'].includes(posture)) {
    convexityScore = 25;
    convexityLabel = '拥挤满仓 · 派发风险';
    evidence.push(RETAIL_RULES.exitWhenCrowdedDistribution);
  } else if (hasStop) {
    convexityScore = 65;
    convexityLabel = '有止损 · 可持有';
    evidence.push('结构/命题止损在位');
  }

  let exitLiquidityTier = slippage?.tier || 'normal';
  let scoutSizeMultiplier = 1;
  if (exitLiquidityTier === 'severe') {
    scoutSizeMultiplier = 0.5;
    evidence.push(RETAIL_RULES.slippageHalfSize);
  } else if (exitLiquidityTier === 'moderate') {
    scoutSizeMultiplier = 0.75;
    evidence.push('滑点中等 · scout 略减');
  }

  const positionPctCap = Math.round(100 * scoutSizeMultiplier);

  return {
    convexity: {
      score: convexityScore,
      label: convexityLabel,
      evidence,
    },
    exitLiquidity: {
      tier: exitLiquidityTier,
      scoutSizeMultiplier,
      positionPctCap,
      flag: slippage?.flag || null,
    },
    dataSource: 'retail-hf-strategy',
    method: 'retail-convexity+exit-liquidity',
    version: RETAIL_HF_VERSION,
    asOf,
  };
}

function detectRuleViolations(inst, context = {}) {
  const violations = [];
  const spec = inst?.integratedSpec || context.integratedSpec || {};
  const tg = inst?.tradingGuidance || context.tradingGuidance;
  const tier = context.globalRisk?.tier || context.globalRisk?.liquidityShockTier;

  if (spec.squeezeStage?.stage && ['T3', 'T4', 'T5'].includes(spec.squeezeStage.stage) && ['试仓', '加仓'].includes(tg?.posture)) {
    violations.push({ rule: 'noLeadSqueeze', detail: RETAIL_RULES.noLeadSqueeze });
  }
  if (spec.watchLevel === 'W2' && tg?.posture === '试仓' && tg?.phase !== '升温') {
    violations.push({ rule: 'confirmNotPredict', detail: RETAIL_RULES.confirmNotPredict });
  }
  if (spec.divergence?.level === 'D2' && tg?.bias && spec.divergence?.policyIntent) {
    violations.push({ rule: 'noFightD2Policy', detail: RETAIL_RULES.noFightD2Policy });
  }
  if (tg?.phase === '拥挤' && spec.opponentStatus?.noChase === false && ['持有', '加仓'].includes(tg?.posture)) {
    violations.push({ rule: 'exitWhenCrowdedDistribution', detail: RETAIL_RULES.exitWhenCrowdedDistribution });
  }
  if (spec.retailTrap?.highTrap && ['试仓', '加仓', '持有'].includes(tg?.posture)) {
    violations.push({ rule: 'distributionTrapHigh', detail: RETAIL_RULES.distributionTrapHigh });
  }
  if (tier === 'L3' && ['试仓', '加仓', '持有'].includes(tg?.posture)) {
    violations.push({ rule: 'l3MandatoryDelever', detail: RETAIL_RULES.l3MandatoryDelever });
  }
  if (spec.expectationGap?.gap === 'overshoot' && tg?.posture === '加仓' && !spec.opponentStatus?.blockReduceLongOnHighPrice) {
    violations.push({ rule: 'noHeroicTopBottom', detail: RETAIL_RULES.noHeroicTopBottom });
  }

  return {
    violations,
    count: violations.length,
    badge: violations.length ? '规则偏离' : '跟随·就绪',
    dataSource: 'retail-hf-strategy',
    method: 'retail-rule-violation-scan',
    version: RETAIL_HF_VERSION,
    asOf: nowIso(),
  };
}

function buildRetailHfForInstrument(inst, context = {}) {
  const convexity = assessRetailPositionQuality(inst, context);
  const ruleViolations = detectRuleViolations(inst, context);
  const factorExposure = context.factorExposure || null;
  const followAdvice = factorExposure?.followAdvice || null;

  return {
    factorExposure,
    followAdvice,
    ruleViolations,
    convexity,
    exitLiquidity: convexity.exitLiquidity,
    badges: {
      followReady: ruleViolations.count === 0 ? '跟随·就绪' : null,
      noCrowd: factorExposure?.accidentalConcentration?.length ? '勿扎堆' : null,
      eventDecay: context.eventDecayBadge || null,
    },
    dataSource: 'retail-hf-strategy',
    version: RETAIL_HF_VERSION,
    asOf: nowIso(),
  };
}

function buildFollowAdviceLine(factorExposure) {
  if (!factorExposure?.factorLine) return null;
  return factorExposure.factorLine;
}

module.exports = {
  RETAIL_HF_VERSION,
  RETAIL_RULES,
  SYMBOL_FACTOR_MAP,
  FACTOR_LABELS,
  buildFactorExposure,
  assessRetailPositionQuality,
  detectRuleViolations,
  buildRetailHfForInstrument,
  buildFollowAdviceLine,
  deriveFollowSignal,
  getSymbolFactors,
  dominantFactor,
};
