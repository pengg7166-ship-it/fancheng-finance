/**
 * Playbook decision tree — Q0 liquidity crisis, then Q1-Q3 + overlays
 */
const { evaluateHardPolicy } = require('./exchange-hard-policy');
const {
  computeDivergence,
  loadPlaybooks,
  detectSqueeze,
  detectLiqCrisis,
} = require('./policy-playbook-engine');
const { evaluateOpponentCapitulation } = require('./opponent-capitulation');
const { normalizeCommodityId } = require('./policy-commodity-map');

const TREE_VERSION = 'v1.45.0-opponent-playbooks';

function nowIso() {
  return new Date().toISOString();
}

function classifyPriceReaction(divergence, expectationGap, tg) {
  const phase = tg?.phase;
  if (expectationGap?.gap === 'overshoot') return 'spike-then-crash';
  if (divergence?.level === 'D2' || divergence?.level === 'D3') return 'oppose';
  if (phase === '升温' || phase === '拥挤') return 'align';
  if (phase === '退潮') return 'spike-then-crash';
  return 'unknown';
}

function mapPhaseToStage(phase) {
  const map = { 冷淡: 'T1', 升温: 'T2', 拥挤: 'T3', 退潮: 'T4' };
  return map[phase] || 'T1';
}

function runPlaybookDecisionTree(inst, context = {}) {
  const tg = context.tradingGuidance || inst?.tradingGuidance;
  const divergence = context.divergence || inst?.integratedSpec?.divergence || computeDivergence(inst, context);
  const expectationGap = context.expectationGap || inst?.integratedSpec?.expectationGap;
  const hardPolicy = context.hardPolicy || evaluateHardPolicy(inst?.id, context);
  const globalRisk = context.globalRisk || context.globalLiquidityRisk;
  const liqCrisis = context.liqCrisis || detectLiqCrisis({ globalRisk, ...context });
  const squeezeStage = context.squeezeStage || detectSqueeze(inst, { ...context, tradingGuidance: tg, divergence, expectationGap, hardPolicy });
  const opponentStatus = context.opponentStatus || evaluateOpponentCapitulation(inst, { ...context, tradingGuidance: tg, divergence, liqCrisis });
  const phase = tg?.phase || '暂无';
  const theses = inst?.macroSynthesis?.activeTheses || context.activeTheses || [];
  const rhetoricHeavy = theses.some((t) => /叙事|预期|目标价|看涨|看跌/.test(t.claim || ''));
  const playbooks = loadPlaybooks();
  const alternativesRejected = [];
  const overlayPlaybooks = [];
  const logicChain = [];

  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier || 'L0';
  const q0 = tier === 'L3' || liqCrisis?.active ? 'L3-liquidity-crisis' : 'no-L3';

  logicChain.push({
    layer: 'Q0',
    conclusion: q0,
    evidence: q0 === 'L3-liquidity-crisis' ? `PB-LIQ-CRISIS · ${tier} · ${liqCrisis?.stage || 'T1'}` : '非 L3 · 继续 Q1-Q3',
    dataSource: 'global-liquidity-risk',
  });

  let primaryPlaybook = null;
  let confidence = 0.35;
  let stage = mapPhaseToStage(phase);

  if (q0 === 'L3-liquidity-crisis') {
    primaryPlaybook = playbooks.find((p) => p.id === 'PB-LIQ-CRISIS') || { id: 'PB-LIQ-CRISIS', title: '流动性危机' };
    stage = liqCrisis?.stage || 'T1';
    confidence = 0.72;
    alternativesRejected.push('PB-OPP-001', 'PB-SQUEEZE', 'PB-I-2023', 'PB-BLACK-2015');
    logicChain.push({
      layer: 'Q0-override',
      conclusion: 'PB-LIQ-CRISIS',
      evidence: (liqCrisis?.evidence || []).join(' · ') || 'L3 覆盖对手盘/历史剧本',
      dataSource: 'playbook-decision-tree',
    });
  } else {
    const q1 = hardPolicy?.hasHard ? 'hard-policy' : rhetoricHeavy ? 'rhetoric-heavy' : 'mixed';
    const q2 = classifyPriceReaction(divergence, expectationGap, tg);
    const q3 = phase;
    logicChain.push(
      { layer: 'Q1', conclusion: q1, evidence: hardPolicy?.note || (rhetoricHeavy ? 'thesis rhetoric' : 'mixed'), dataSource: 'playbook-decision-tree' },
      { layer: 'Q2', conclusion: q2, evidence: `${divergence?.level || 'D?'} gap=${expectationGap?.gap || '—'}`, dataSource: 'policy-playbook-engine' },
      { layer: 'Q3', conclusion: q3, evidence: `bias=${tg?.bias || '—'}`, dataSource: 'outlook-trading-guidance' },
    );

    const sym = normalizeCommodityId(inst?.id);

    if (sym === 'lh') {
      primaryPlaybook = playbooks.find((p) => p.id === 'PB-LH-2024') || { id: 'PB-LH-2024', title: 'LH' };
      confidence = q2 === 'spike-then-crash' ? 0.62 : 0.48;
      alternativesRejected.push('PB-I-2023', 'PB-FG-2024');
    } else if (sym === 'fg') {
      primaryPlaybook = playbooks.find((p) => p.id === 'PB-FG-2024') || { id: 'PB-FG-2024', title: 'FG' };
      confidence = q2 === 'spike-then-crash' || phase === '退潮' ? 0.58 : 0.45;
      alternativesRejected.push('PB-LH-2024', 'PB-BLACK-2015');
    } else if (['i', 'rb', 'hc', 'jm', 'j'].includes(sym)) {
      if (q1 === 'hard-policy' && (phase === '升温' || phase === '拥挤') && q2 === 'align') {
        primaryPlaybook = playbooks.find((p) => p.id === 'PB-BLACK-2015') || { id: 'PB-BLACK-2015' };
        confidence = 0.55;
        alternativesRejected.push('PB-I-2023');
      } else if (q2 === 'oppose' || divergence?.policyIntent === 'bearish') {
        primaryPlaybook = playbooks.find((p) => p.id === 'PB-I-2023') || { id: 'PB-I-2023' };
        confidence = 0.52;
        alternativesRejected.push('PB-BLACK-2015');
      } else {
        primaryPlaybook = playbooks.find((p) => p.id === 'PB-BLACK-2015') || { id: 'PB-BLACK-2015' };
        confidence = 0.4;
        alternativesRejected.push('PB-I-2023');
      }
    } else {
      primaryPlaybook = { id: '—', title: 'no seed playbook' };
      confidence = 0.2;
    }

    if (squeezeStage?.stage) {
      overlayPlaybooks.push('PB-SQUEEZE');
      const sqRank = { T1: 1, T2: 2, T3: 3, T4: 4, T5: 5 };
      if ((sqRank[squeezeStage.stage] || 0) >= 2) {
        primaryPlaybook = playbooks.find((p) => p.id === 'PB-SQUEEZE') || { id: 'PB-SQUEEZE', title: '挤仓' };
        stage = squeezeStage.stage;
        confidence = Math.max(confidence, 0.58);
        logicChain.push({
          layer: 'Overlay',
          conclusion: `PB-SQUEEZE·${squeezeStage.stage}`,
          evidence: (squeezeStage.evidence || []).join(' · '),
          dataSource: 'policy-playbook-engine',
        });
      }
    }

    if (opponentStatus?.opponentSide) {
      if (!overlayPlaybooks.includes('PB-OPP-001')) overlayPlaybooks.push('PB-OPP-001');
      if (opponentStatus.sideNotDead && confidence < 0.55) {
        confidence = 0.55;
      }
      logicChain.push({
        layer: 'Overlay',
        conclusion: `PB-OPP-001·${opponentStatus.opponentSide}`,
        evidence: opponentStatus.evidence?.slice(0, 2).join(' · ') || opponentStatus.label,
        dataSource: 'opponent-capitulation',
      });
    }
  }

  const badgeParts = [`主剧本: ${primaryPlaybook?.id || '—'}`, stage];
  if (overlayPlaybooks.length) badgeParts.push(`overlay: ${overlayPlaybooks.join('+')}`);

  return {
    primaryPlaybook: primaryPlaybook?.id || '—',
    primaryPlaybookTitle: primaryPlaybook?.title || null,
    stage,
    q0,
    overlayPlaybooks,
    opponentStatus,
    squeezeStage,
    liqCrisis: liqCrisis?.active ? liqCrisis : null,
    alternativesRejected,
    logicChain,
    confidence,
    badge: badgeParts.join(' · '),
    version: TREE_VERSION,
    dataSource: 'playbook-decision-tree',
    method: 'Q0+3-question-tree+overlays',
    asOf: nowIso(),
  };
}

module.exports = {
  TREE_VERSION,
  runPlaybookDecisionTree,
  classifyPriceReaction,
  mapPhaseToStage,
};
