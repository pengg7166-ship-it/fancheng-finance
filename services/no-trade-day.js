/**
 * No-Trade Day — daily follow-mode gate: when NOT to open new scouts.
 * v1.47.0-retail-discipline
 */
const { buildFactorExposure } = require('./retail-hf-strategy');
const { computeEventDecayWeight } = require('./event-decay');

const NO_TRADE_VERSION = 'v1.47.0-retail-discipline';

function nowIso() {
  return new Date().toISOString();
}

function cite(source) {
  return source || 'no-trade-day';
}

/**
 * Portfolio-wide min event-decay weight across instruments with decay data.
 */
function portfolioEventDecayWeight(instruments = []) {
  let minWeight = null;
  for (const inst of instruments) {
    const ed = inst.integratedSpec?.eventDecay;
    const w = ed?.weight ?? ed?.edgeWeight;
    if (w == null) continue;
    minWeight = minWeight == null ? w : Math.min(minWeight, w);
  }
  return minWeight;
}

function countW3Candidates(instruments = []) {
  return instruments.filter((i) => {
    const wl = i.integratedSpec?.watchLevel;
    const scoutOk = i.integratedSpec?.poolStatus?.scoutAllowed !== false;
    return wl === 'W3' && scoutOk && (i.tradingGuidance?.posture === '试仓' || i.tradingGuidance?.posture === '持有');
  });
}

/**
 * @param {object} context '{ instruments, globalRisk, factorExposure, holdings, masterClock }'
 */
function evaluateNoTradeDay(context = {}) {
  const asOf = nowIso();
  const instruments = context.instruments || [];
  const globalRisk = context.globalRisk || context.globalLiquidityRisk || {};
  const tier = globalRisk.tier || globalRisk.liquidityShockTier || 'L0';
  const l2Plus = tier === 'L2' || tier === 'L3' || globalRisk.regime === 'deleveraging' || globalRisk.regime === 'shock';
  const l3 = tier === 'L3' || globalRisk.regime === 'shock';

  const factorExposure =
    context.factorExposure ||
    buildFactorExposure(context.holdings || [], instruments, { masterClock: context.masterClock });
  const hedgeDegree = factorExposure?.hedgeDegree;

  const decayWeight = portfolioEventDecayWeight(instruments);
  const eventDecayLow = decayWeight != null && decayWeight < 0.25;

  const w3Candidates = countW3Candidates(instruments);
  const noW3Candidates = w3Candidates.length === 0;

  const reasons = [];
  const logicChain = [];

  if (l3) {
    reasons.push({
      code: 'GLOBAL_L3',
      text: `全球流动 L3 · 系统性冲击 · follow 模式禁新开`,
      citation: cite('global-liquidity-risk'),
    });
  }
  if (l2Plus && !l3) {
    reasons.push({
      code: 'L2_PLUS',
      text: `全球流动 ${tier} · 总敞口上限收紧`,
      citation: cite('global-liquidity-risk'),
    });
  }
  if (hedgeDegree != null && hedgeDegree < 30) {
    reasons.push({
      code: 'HEDGE_LOW',
      text: `组合对冲度 ${hedgeDegree}% < 30 · 因子扎堆`,
      citation: cite('retail-hf-strategy'),
    });
  }
  if (eventDecayLow) {
    reasons.push({
      code: 'EVENT_DECAY_LOW',
      text: `事件边际衰减 ${Math.round(decayWeight * 100)}% < 25% · 旧叙事`,
      citation: cite('event-decay'),
    });
  }
  if (noW3Candidates) {
    reasons.push({
      code: 'NO_W3_CANDIDATES',
      text: '研究池无 W3 已验证试仓候选 · 机构未确认',
      citation: cite('research-pool'),
    });
  }

  let suggestion = null;
  let noTradeDay = false;

  if (l3) {
    noTradeDay = true;
    suggestion = 'NO_NEW_TRADES';
  } else if (l2Plus) {
    const supporting = [
      hedgeDegree != null && hedgeDegree < 30,
      eventDecayLow,
      noW3Candidates,
    ].filter(Boolean).length;
    if (supporting >= 2 || (hedgeDegree != null && hedgeDegree < 30 && noW3Candidates)) {
      noTradeDay = true;
      suggestion = 'NO_NEW_TRADES';
    }
  }

  for (const r of reasons) {
    logicChain.push({
      layer: 'NoTradeDay',
      conclusion: r.code,
      evidence: r.text,
      dataSource: r.citation,
      asOf,
    });
  }

  const top5 = instruments
    .filter((i) => i.integratedSpec?.priorityScore != null)
    .sort((a, b) => (b.integratedSpec.priorityScore ?? 0) - (a.integratedSpec.priorityScore ?? 0))
    .slice(0, 5);

  const teachingLines = top5.map((inst) => {
    const sym = inst.name || inst.id;
    const wl = inst.integratedSpec?.watchLevel || 'W0';
    const phase = inst.tradingGuidance?.phase || '暂无';
    const trap = inst.integratedSpec?.retailTrap?.score;
    const parts = [`${sym} 在池但今日不宜 scout`];
    if (wl !== 'W3') parts.push(`关注级 ${wl}≠W3`);
    if (phase === '拥挤') parts.push('phase 拥挤');
    if (inst.integratedSpec?.expectationGap?.gap === 'overshoot') parts.push('叙事 overshoot');
    if (trap != null && trap >= 70) parts.push(`派发区 trap=${trap}`);
    if (noTradeDay) parts.push('follow 模式全局禁新开');
    return parts.join(' · ');
  });

  const topLine = noTradeDay
    ? `今日系统建议：不新开仓（follow 模式）${reasons.length ? ' — ' + reasons.slice(0, 3).map((r) => r.text).join(' · ') : ''}`
    : null;

  return {
    noTradeDay,
    suggestion,
    reasons,
    teachingLines,
    topLine,
    hedgeDegree: hedgeDegree ?? null,
    eventDecayWeight: decayWeight ?? null,
    w3CandidateCount: w3Candidates.length,
    logicChain,
    dataSource: 'no-trade-day',
    method: 'L2+/hedge/decay/W3/L3-composite',
    version: NO_TRADE_VERSION,
    asOf,
  };
}

module.exports = {
  NO_TRADE_VERSION,
  evaluateNoTradeDay,
  portfolioEventDecayWeight,
  countW3Candidates,
};
