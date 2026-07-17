/**
 * 历史 playbook 检测 + 政策/资本 divergence D0-D3
 */
const fs = require('fs');
const path = require('path');
const { normalizeCommodityId } = require('./policy-commodity-map');

const { evaluateOpponentCapitulation, extractOiDeltaPct } = require('./opponent-capitulation');
const { detectSlippageTier } = require('./slippage-detector');
const { evaluateHardPolicy } = require('./exchange-hard-policy');

const PLAYBOOK_VERSION = 'v1.45.0-opponent-playbooks';

let cachedPlaybooks = null;

function loadPlaybooks() {
  if (cachedPlaybooks) return cachedPlaybooks;
  const fp = path.join(__dirname, '..', 'data', 'playbooks.json');
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    cachedPlaybooks = raw.playbooks || [];
  } catch {
    cachedPlaybooks = [];
  }
  return cachedPlaybooks;
}

function nowIso() {
  return new Date().toISOString();
}

function derivePolicyIntent(inst, context = {}) {
  const theses = inst?.macroSynthesis?.activeTheses || context.activeTheses || [];
  const policyNews = context.policyNews || [];
  let intent = 'neutral';
  const evidence = [];

  for (const t of theses) {
    const claim = `${t.claim || ''} ${t.who || ''}`;
    if (/限产|收储|去产能|打压|调控|偏空|看跌/.test(claim)) {
      intent = 'bearish';
      evidence.push(`命题偏空: ${(t.claim || '').slice(0, 40)}`);
    } else if (/刺激|宽松|偏多|看涨|支撑/.test(claim)) {
      intent = 'bullish';
      evidence.push(`命题偏多: ${(t.claim || '').slice(0, 40)}`);
    }
  }
  for (const n of policyNews.slice(0, 3)) {
    const title = n.title || n.headline || '';
    if (/限产|调控|打压|偏空/.test(title)) {
      intent = 'bearish';
      evidence.push(`政策: ${title.slice(0, 40)}`);
    } else if (/刺激|支持|宽松/.test(title)) {
      intent = 'bullish';
      evidence.push(`政策: ${title.slice(0, 40)}`);
    }
  }
  if (!evidence.length) evidence.push('政策意图待校验');
  return { intent, evidence };
}

function derivePricePhaseSignal(inst, tradingGuidance) {
  const tg = tradingGuidance || inst?.tradingGuidance;
  const phase = tg?.phase;
  const bias = tg?.bias;
  const att = inst?.capitalAttention?.score;
  return { phase, bias, att, posture: tg?.posture };
}

function computeDivergence(inst, context = {}) {
  const asOf = nowIso();
  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const { intent, evidence: policyEvidence } = derivePolicyIntent(inst, context);
  const { phase, bias, att } = derivePricePhaseSignal(inst, tg);

  if (intent === 'neutral' || !phase || phase === '暂无') {
    return {
      level: 'D0',
      label: '对齐/未知',
      policyIntent: intent,
      pricePhase: phase || '暂无',
      holderAlert: false,
      closeNewScout: false,
      evidence: [...policyEvidence, 'phase/政策其一待校验'],
      dataSource: 'policy-playbook-engine',
      method: 'policy-vs-phase',
      asOf,
    };
  }

  const priceBullish = bias === '偏多' || (att != null && att >= 60 && (phase === '升温' || phase === '拥挤'));
  const priceBearish = bias === '偏空' || (phase === '退潮' && att != null && att < 45);
  const policyBearPriceUp = intent === 'bearish' && priceBullish;
  const policyBullPriceDown = intent === 'bullish' && priceBearish;

  if (policyBearPriceUp || policyBullPriceDown) {
    const severe = (phase === '拥挤' || phase === '升温') && att != null && att >= 65;
    const level = severe ? 'D3' : 'D2';
    return {
      level,
      label: level === 'D3' ? '严重背离' : '政策/价格背离',
      policyIntent: intent,
      pricePhase: `${phase} · bias=${bias || '—'}`,
      holderAlert: level === 'D2' || level === 'D3',
      closeNewScout: true,
      evidence: [
        ...policyEvidence,
        `价格/phase: ${phase} bias=${bias || '—'} att=${att ?? '—'}`,
        policyBearPriceUp ? '政策偏空 vs 价格/phase 偏强' : '政策偏多 vs 价格/phase 偏弱',
      ],
      dataSource: 'policy-playbook-engine',
      method: 'policy-vs-phase',
      playbookRef: 'PB-I-2023-pattern',
      asOf,
    };
  }

  if (intent !== 'neutral' && phase === '冷淡') {
    return {
      level: 'D1',
      label: '轻度分歧',
      policyIntent: intent,
      pricePhase: phase,
      holderAlert: false,
      closeNewScout: false,
      evidence: [...policyEvidence, 'phase=冷淡 · 价格未确认'],
      dataSource: 'policy-playbook-engine',
      method: 'policy-vs-phase',
      asOf,
    };
  }

  return {
    level: 'D0',
    label: '对齐',
    policyIntent: intent,
    pricePhase: `${phase} · ${bias || '—'}`,
    holderAlert: false,
    closeNewScout: false,
    evidence: policyEvidence,
    dataSource: 'policy-playbook-engine',
    method: 'policy-vs-phase',
    asOf,
  };
}

function scorePlaybookMatch(inst, playbook, context = {}) {
  const id = normalizeCommodityId(inst?.id || context.symbol);
  const pbSym = normalizeCommodityId(playbook.symbol);
  const linked = (playbook.linkedSymbols || []).map(normalizeCommodityId);
  const isUniversal = Boolean(playbook.universal);
  if (!isUniversal && pbSym !== id && !linked.includes(id)) return null;

  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const div = context.divergence || computeDivergence(inst, context);
  const phase = tg?.phase;
  const att = inst?.capitalAttention?.score;
  let stage = 'T1';
  let confidence = 0.35;
  const n = playbook.sampleN ?? 1;
  const logicChain = [];

  if (playbook.id === 'PB-I-2023') {
    if (div.level === 'D2' || div.level === 'D3') {
      stage = phase === '拥挤' ? 'T3' : 'T2';
      confidence = 0.55;
    }
    logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '政策偏空 vs phase/资本', dataSource: playbook.dataSource });
  } else if (playbook.id === 'PB-LH-2024') {
    if (phase === '退潮' || tg?.bias === '偏空') {
      stage = 'T2';
      confidence = 0.5;
    }
    logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '去产能近端供给冲击', dataSource: playbook.dataSource });
  } else if (playbook.id === 'PB-FG-2024') {
    if (phase === '退潮') {
      stage = 'T3';
      confidence = 0.5;
    } else if (phase === '升温' || phase === '拥挤') {
      stage = 'T2';
      confidence = 0.45;
    }
    logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '供给 reform → 需求锚定', dataSource: playbook.dataSource });
  } else if (playbook.id === 'PB-BLACK-2015') {
    const { intent } = derivePolicyIntent(inst, context);
    const bullishPolicy = intent === 'bullish' || /去产能|供给侧改革|棚改|限产/.test(JSON.stringify(inst?.macroSynthesis?.activeTheses || []));
    if (phase === '冷淡' && bullishPolicy) {
      stage = 'T1';
      confidence = 0.4;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '政策信号 · 长 lag · 2015模板', dataSource: playbook.dataSource });
    } else if (phase === '升温' && tg?.bias !== '偏空') {
      stage = 'T2';
      confidence = 0.5;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '价格初涨 · 黑色系', dataSource: playbook.dataSource });
    } else if (phase === '拥挤' || (att != null && att >= 60)) {
      stage = 'T4';
      confidence = 0.55;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '正反馈/拥挤 · 去库存循环', dataSource: playbook.dataSource });
    } else if (phase === '退潮') {
      stage = 'T5';
      confidence = 0.45;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '力竭/回调 · 2018模板', dataSource: playbook.dataSource });
    } else {
      stage = 'T3';
      confidence = 0.42;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: '去库存确认窗', dataSource: playbook.dataSource });
    }
  } else if (playbook.id === 'PB-OPP-001') {
    const opp = context.opponentStatus || evaluateOpponentCapitulation(inst, context);
    if (opp?.opponentSide) {
      stage = opp.capitulated ? 'T2' : 'T1';
      confidence = opp.sideNotDead ? 0.58 : 0.52;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: opp.evidence?.slice(0, 2).join(' · ') || opp.label, dataSource: 'opponent-capitulation' });
    } else {
      return null;
    }
  } else if (playbook.id === 'PB-SQUEEZE') {
    const sq = context.squeezeStage || detectSqueeze(inst, context);
    if (sq?.stage) {
      stage = sq.stage;
      confidence = sq.stage === 'T2' ? 0.6 : 0.5;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: (sq.evidence || []).join(' · '), dataSource: sq.dataSource || 'policy-playbook-engine' });
    } else {
      return null;
    }
  } else if (playbook.id === 'PB-LIQ-CRISIS') {
    const liq = context.liqCrisis || detectLiqCrisis(context);
    if (liq?.active) {
      stage = liq.stage;
      confidence = 0.65;
      logicChain.push({ layer: 'Playbook', conclusion: stage, evidence: (liq.evidence || []).join(' · '), dataSource: liq.dataSource || 'global-liquidity-risk' });
    } else {
      return null;
    }
  }

  if (!logicChain.length) return null;

  return {
    id: playbook.id,
    title: playbook.title,
    stage,
    stageLabel: playbook.stages?.[stage] || stage,
    narrativeZh: playbook.narrativeZh,
    confidence,
    n,
    lowSample: n < 5,
    sampleWarning: playbook.sampleWarning || (n < 5 ? 'low-sample' : null),
    logicChain,
    dataSource: playbook.dataSource || 'playbooks.json',
    method: 'template-match+phase',
  };
}

function detectPlaybook(context = {}) {
  const inst = context.inst || context;
  const id = normalizeCommodityId(inst?.id || context.symbol);
  if (!id) return null;

  const playbooks = loadPlaybooks();
  const candidates = playbooks.filter((p) => {
    if (normalizeCommodityId(p.symbol) === id) return true;
    const linked = (p.linkedSymbols || []).map(normalizeCommodityId);
    return linked.includes(id);
  });
  if (!candidates.length) return null;

  const div = context.divergence || computeDivergence(inst, context);
  let best = null;
  for (const pb of candidates) {
    const match = scorePlaybookMatch(inst, pb, { ...context, divergence: div });
    if (match && (!best || match.confidence > best.confidence)) best = match;
  }
  return best;
}

/**
 * PB-SQUEEZE — 挤仓五阶段 T1-T5
 */
function detectSqueeze(inst, context = {}) {
  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const slippage = context.slippage || detectSlippageTier(inst, context);
  const hardPolicy = context.hardPolicy || evaluateHardPolicy(inst?.id || inst, context);
  const oiDelta = extractOiDeltaPct(inst);
  const phase = tg?.phase;
  const att = inst?.capitalAttention?.score;
  const expGap = context.expectationGap || inst?.integratedSpec?.expectationGap;
  const evidence = [];
  let stage = null;

  if (phase === '退潮' && oiDelta != null && oiDelta <= -2) {
    stage = 'T5';
    evidence.push('退潮+OI崩塌 · 挤仓后回归');
  } else if (oiDelta != null && oiDelta <= -3) {
    stage = 'T4';
    evidence.push(`OI崩塌 ${oiDelta}%`);
  } else if (hardPolicy?.hasHard) {
    stage = 'T3';
    evidence.push(hardPolicy.note || '交易所提保/限仓');
  } else if (
    (expGap?.gap === 'overshoot' || phase === '拥挤' || (att != null && att >= 68)) &&
    (slippage?.tier === 'severe' || slippage?.tier === 'moderate' || slippage?.flag)
  ) {
    stage = 'T2';
    evidence.push('价格疯狂+滑点/流动性不足');
    if (slippage?.flag) evidence.push(slippage.flag);
  } else if (oiDelta != null && oiDelta >= 2 && (phase === '升温' || phase === '拥挤')) {
    stage = 'T1';
    evidence.push('近月OI集中 · 价涨+持仓增');
  }

  if (!stage) return null;

  const stageRank = { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 };
  const t2Plus = (stageRank[stage] || 0) >= 2;

  return {
    id: 'PB-SQUEEZE',
    stage,
    watchLevel: stage === 'T2' ? 'W2' : null,
    closeNewScout: t2Plus && stage !== 'T5',
    holderReduce: t2Plus && stage !== 'T5',
    slippageLinked: Boolean(slippage?.flag || slippage?.tier === 'severe'),
    hardPolicyLinked: Boolean(hardPolicy?.hasHard),
    evidence,
    dataSource: 'policy-playbook-engine',
    method: 'squeeze-stage-detector',
    asOf: nowIso(),
  };
}

/**
 * PB-LIQ-CRISIS — 全球 L3 流动性危机
 */
function detectLiqCrisis(context = {}) {
  const globalRisk = context.globalRisk || context.globalLiquidityRisk;
  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier || 'L0';
  if (tier !== 'L3') return { active: false, tier };

  const regime = globalRisk?.regime || globalRisk?.globalRiskRegime || 'shock';
  const evidence = [globalRisk?.summary || `全球流动性 ${tier}`];
  let stage = 'T1';

  if (regime === 'shock') {
    stage = 'T2';
    evidence.push('系统性冲击 regime');
  }
  const vixObs = (globalRisk?.observables || []).find((o) => o.id === 'vix' || /VIX/i.test(o.label || ''));
  if (vixObs?.status === 'red') {
    stage = 'T3';
    evidence.push(`VIX 警戒 ${vixObs.value ?? '—'}`);
  }
  if (regime === 'deleveraging' || globalRisk?.creditStress) {
    stage = 'T4';
    evidence.push('去杠杆/信用压力');
  }

  return {
    active: true,
    id: 'PB-LIQ-CRISIS',
    tier,
    stage,
    overridesOpponent: true,
    effectiveBetsCap: 1,
    portfolioClusterCap: 1,
    evidence,
    dataSource: globalRisk?.dataSource || 'global-liquidity-risk',
    method: 'L3-tier+regime',
    asOf: nowIso(),
  };
}

function detectUniversalPlaybooks(inst, context = {}) {
  const playbooks = loadPlaybooks().filter((p) => p.universal);
  const enriched = { ...context, inst };
  const matches = [];
  for (const pb of playbooks) {
    const match = scorePlaybookMatch(inst, pb, enriched);
    if (match) matches.push(match);
  }
  return matches;
}

function detectPlaybookWithOverlays(context = {}) {
  const inst = context.inst || context;
  const historical = detectPlaybook(context);
  const universal = detectUniversalPlaybooks(inst, context);
  const squeezeStage = context.squeezeStage || detectSqueeze(inst, context);
  const liqCrisis = context.liqCrisis || detectLiqCrisis(context);
  const opponentStatus = context.opponentStatus || evaluateOpponentCapitulation(inst, { ...context, liqCrisis });

  let primary = historical;
  if (liqCrisis?.active) {
    const liqMatch = universal.find((m) => m.id === 'PB-LIQ-CRISIS');
    if (liqMatch) primary = liqMatch;
  } else {
    const squeezeMatch = universal.find((m) => m.id === 'PB-SQUEEZE');
    const oppMatch = universal.find((m) => m.id === 'PB-OPP-001');
    if (squeezeMatch && (!primary || squeezeMatch.confidence > primary.confidence)) primary = squeezeMatch;
    else if (oppMatch && (!primary || (oppMatch.confidence > (primary?.confidence || 0) && opponentStatus?.sideNotDead))) {
      primary = oppMatch;
    }
  }

  return {
    primary,
    historical,
    universal,
    squeezeStage,
    liqCrisis,
    opponentStatus,
  };
}

module.exports = {
  PLAYBOOK_VERSION,
  loadPlaybooks,
  computeDivergence,
  detectPlaybook,
  detectSqueeze,
  detectLiqCrisis,
  detectUniversalPlaybooks,
  detectPlaybookWithOverlays,
  derivePolicyIntent,
  scorePlaybookMatch,
};
