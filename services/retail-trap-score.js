/**
 * Retail Trap Score — distribution zone detector (派发区).
 * Score 0–100 from real integrated inputs only; null when insufficient data.
 * v1.47.0-retail-discipline
 */
const TRAP_VERSION = 'v1.47.0-retail-discipline';
const TRAP_HIGH_THRESHOLD = 70;

function nowIso() {
  return new Date().toISOString();
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {object} inst instrument with integratedSpec + tradingGuidance
 * @param {object} context optional extra context
 */
function computeRetailTrapScore(inst, context = {}) {
  const asOf = nowIso();
  const spec = inst?.integratedSpec || context.integratedSpec || {};
  const tg = inst?.tradingGuidance || context.tradingGuidance || {};
  const logicChain = [];
  const components = [];
  let inputsUsed = 0;

  const phase = tg.phase;
  if (phase === '拥挤') {
    components.push({ key: 'phaseCrowded', weight: 25, score: 25, evidence: 'phase=拥挤' });
    inputsUsed += 1;
    logicChain.push({ layer: 'Trap', conclusion: 'phase拥挤', evidence: 'phase=拥挤', dataSource: 'outlook-trading-guidance', asOf });
  } else if (phase === '升温') {
    components.push({ key: 'phaseCrowded', weight: 25, score: 12, evidence: 'phase=升温' });
    inputsUsed += 1;
  }

  const gap = spec.expectationGap;
  if (gap?.gap === 'overshoot') {
    const pi = gap.pricedInDegree?.score;
    const sub = pi != null ? clamp(Math.round(pi * 0.25), 10, 25) : 20;
    components.push({ key: 'overshoot', weight: 25, score: sub, evidence: gap.evidence?.[0] || 'narrative overshoot' });
    inputsUsed += 1;
    logicChain.push({ layer: 'Trap', conclusion: 'overshoot', evidence: gap.evidence?.join(' · ') || 'overshoot', dataSource: 'expectation-gap', asOf });
  } else if (gap?.pricedInDegree?.degree === 'high') {
    components.push({ key: 'narrativeHeat', weight: 15, score: 15, evidence: 'priced-in high' });
    inputsUsed += 1;
  }

  const opp = spec.opponentStatus;
  if (opp?.opponentCapitulated || opp?.status === 'capitulated' || opp?.sideDying) {
    components.push({
      key: 'opponentCapitulated',
      weight: 20,
      score: 20,
      evidence: opp.label || '对手盘将竭/派发',
    });
    inputsUsed += 1;
    logicChain.push({ layer: 'Trap', conclusion: '对手将竭', evidence: opp.label || opp.motto || '', dataSource: opp.dataSource || 'opponent-capitulation', asOf });
  } else if (opp?.noChase) {
    components.push({ key: 'opponentCapitulated', weight: 20, score: 14, evidence: opp.label || 'noChase' });
    inputsUsed += 1;
  }

  const thesisHot = spec.playbook?.stage && ['T3', 'T4', 'T5'].includes(spec.playbook.stage);
  const thesisDensity = context.thesisDensityHot || spec.geoDecay?.heat === 'high';
  if (thesisHot || thesisDensity) {
    components.push({
      key: 'thesisDensityHot',
      weight: 15,
      score: thesisHot ? 15 : 10,
      evidence: thesisHot ? `playbook ${spec.playbook.stage}` : 'narrative heat',
    });
    inputsUsed += 1;
    logicChain.push({ layer: 'Trap', conclusion: 'thesis-hot', evidence: spec.playbook?.id || 'narrative', dataSource: 'policy-playbook-engine', asOf });
  }

  if (spec.squeezeStage?.stage && ['T4', 'T5'].includes(spec.squeezeStage.stage)) {
    components.push({ key: 'squeezeLate', weight: 10, score: 10, evidence: `PB-SQUEEZE ${spec.squeezeStage.stage}` });
    inputsUsed += 1;
  }

  if (!inputsUsed) {
    return {
      score: null,
      band: 'unknown',
      highTrap: false,
      badge: null,
      components: [],
      logicChain: [],
      dataSource: 'retail-trap-score',
      method: 'distribution-zone-composite',
      version: TRAP_VERSION,
      asOf,
      insufficientInputs: true,
    };
  }

  const rawScore = components.reduce((s, c) => s + c.score, 0);
  const score = clamp(rawScore, 0, 100);
  const highTrap = score >= TRAP_HIGH_THRESHOLD;
  const band = highTrap ? 'high' : score >= 45 ? 'mid' : 'low';

  if (highTrap) {
    logicChain.push({
      layer: 'Trap',
      conclusion: '派发区·勿追',
      evidence: `trap=${score} · 持有者减 · 禁 scout`,
      dataSource: 'retail-trap-score',
      asOf,
    });
  }

  return {
    score,
    band,
    highTrap,
    badge: highTrap ? '派发区·勿追' : score >= 45 ? '派发风险' : null,
    components,
    logicChain,
    holderAction: highTrap ? 'reduce' : null,
    blockScout: highTrap,
    dataSource: 'retail-trap-score',
    method: 'thesis+phase+overshoot+opponent+narrative',
    version: TRAP_VERSION,
    asOf,
    insufficientInputs: false,
  };
}

module.exports = {
  TRAP_VERSION,
  TRAP_HIGH_THRESHOLD,
  computeRetailTrapScore,
};
