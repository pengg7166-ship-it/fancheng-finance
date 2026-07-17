/**
 * 多维'priorityScore 'fundamental表观/预期, policy, liquidity, supply shock, capital/phase, technical, playbook
 */
const { classifyRegime } = require('./commodity-regime-classifier');
const { detectPlaybook, computeDivergence } = require('./policy-playbook-engine');
const { computeExpectationGap } = require('./expectation-gap');

const SCORING_VERSION = 'v1.42.0-integrated-spec';

const WEIGHTS = Object.freeze({
  fundamentalApparent: 0.12,
  fundamentalExpected: 0.15,
  policy: 0.18,
  liquidity: 0.1,
  supplyShock: 0.12,
  capitalPhase: 0.2,
  technical: 0.08,
  playbook: 0.05,
});

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function scoreDirection(inst) {
  const label = inst?.directionLabel || '';
  const tier = inst?.directionTier || inst?.direction;
  if (/强多/.test(label) || tier === 'strong_bullish') return 0.85;
  if (/偏多|bullish/.test(label) || tier === 'bullish') return 0.7;
  if (/强空|strong_bearish/.test(label) || tier === 'strong_bearish') return 0.15;
  if (/偏空|bearish/.test(label) || tier === 'bearish') return 0.3;
  return 0.5;
}

function scoreCapitalPhase(inst, tg) {
  const att = inst?.capitalAttention?.score;
  const phase = tg?.phase;
  if (att == null && !phase) return null;
  let s = 0.5;
  if (att != null) s = att / 100;
  if (phase === '升温') s = Math.min(1, s + 0.15);
  if (phase === '拥挤') s = Math.min(1, s + 0.05);
  if (phase === '退潮') s = Math.max(0, s - 0.25);
  if (phase === '冷淡') s = Math.max(0, s - 0.1);
  return clamp01(s);
}

function scoreTechnical(inst) {
  const tech = inst?.factors?.technical;
  if (!tech?.hasEnough) return null;
  const pct = tech.smoothedVol?.percentile;
  if (pct != null) return clamp01(pct / 100);
  return scoreDirection(inst) * 0.5 + 0.25;
}

/**
 * Regime B/C can score high even when表观/技术差
 */
function computePriorityScore(inst, context = {}) {
  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const regime = context.regime || classifyRegime(inst?.id, { inst, ...context });
  const divergence = context.divergence || computeDivergence(inst, { ...context, tradingGuidance: tg });
  const playbook = context.playbook || detectPlaybook({ inst, tradingGuidance: tg, divergence });
  const gap = context.expectationGap || computeExpectationGap(inst, { tradingGuidance: tg });

  const dims = {
    fundamentalApparent: scoreDirection(inst),
    fundamentalExpected: inst?.philosophyFilter?.filterPass === false ? 0.35 : scoreDirection(inst) * 0.9 + 0.05,
    policy: divergence.level === 'D2' || divergence.level === 'D3' ? 0.75 : divergence.level === 'D1' ? 0.55 : 0.45,
    liquidity: inst?.quantGate?.tradableForSim === false ? 0.2 : 0.65,
    supplyShock: regime.regime === 'C' ? 0.7 : 0.4,
    capitalPhase: scoreCapitalPhase(inst, tg),
    technical: scoreTechnical(inst),
    playbook: playbook ? playbook.confidence : null,
  };

  if (regime.regime === 'B' || regime.regime === 'C') {
    if (dims.fundamentalApparent != null) dims.fundamentalApparent = Math.max(dims.fundamentalApparent, 0.45);
    if (dims.technical != null) dims.technical = Math.max(dims.technical, 0.35);
  }
  if (regime.regime === 'D') {
    dims.fundamentalApparent = dims.fundamentalApparent != null ? dims.fundamentalApparent * 0.7 : null;
    dims.technical = dims.technical != null ? dims.technical * 0.8 : null;
  }

  let totalW = 0;
  let sum = 0;
  const breakdown = {};
  for (const [key, w] of Object.entries(WEIGHTS)) {
    const v = dims[key];
    if (v == null) {
      breakdown[key] = { score: null, weight: w, note: '待校验' };
      continue;
    }
    breakdown[key] = { score: +v.toFixed(3), weight: w };
    sum += v * w;
    totalW += w;
  }

  const priorityScore = totalW > 0 ? +(sum / totalW).toFixed(3) : null;
  const regimeTags = [regime.regime, regime.label].filter(Boolean);

  return {
    priorityScore,
    regimeTags,
    regime,
    divergence,
    playbook,
    expectationGap: gap,
    dimensions: breakdown,
    playbookMatch: playbook
      ? {
          id: playbook.id,
          stage: playbook.stage,
          confidence: playbook.confidence,
          n: playbook.n,
          lowSample: playbook.lowSample,
        }
      : null,
    dataSource: 'multi-dimensional-scoring',
    method: 'weighted-dimensions+regime-boost',
    version: SCORING_VERSION,
    asOf: new Date().toISOString(),
  };
}

module.exports = {
  SCORING_VERSION,
  WEIGHTS,
  computePriorityScore,
};
