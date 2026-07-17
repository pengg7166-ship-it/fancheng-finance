/**
 * Pre-mortem gate — 3 failure paths before scout posture
 */
const { normalizeCommodityId } = require('./policy-commodity-map');

const PRE_MORTEM_VERSION = 'v1.47.0-retail-discipline';

function nowIso() {
  return new Date().toISOString();
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function buildSignalId(symbol, posture, dateStr = todayKey()) {
  return `${normalizeCommodityId(symbol)}|${posture || '试仓'}|${dateStr}`;
}

function cite(field, source = 'integrated-spec-attach') {
  return { field, source };
}

function buildPreMortem(inst, context = {}) {
  const spec = context.integratedSpec || inst?.integratedSpec || {};
  const tg = context.tradingGuidance || inst?.tradingGuidance || {};
  const posture = context.postureIntent || tg.posture || '试仓';
  const playbook = spec.playbook || context.playbook;
  const regime = spec.regime || context.regime;
  const divergence = spec.divergence || context.divergence;
  const expectationGap = spec.expectationGap || context.expectationGap;
  const globalRisk = context.globalRisk || context.globalLiquidityRisk;
  const hardPolicy = spec.hardPolicy;
  const squeezeStage = spec.squeezeStage || context.squeezeStage;
  const opponentStatus = spec.opponentStatus || context.opponentStatus;
  const liqCrisis = spec.liqCrisis || context.liqCrisis;
  const retailTrap = spec.retailTrap || context.retailTrap;
  const failurePaths = [];
  const pbId = playbook?.id || null;
  const falsifyHints = playbook?.falsifyHints || [];

  if (retailTrap?.highTrap && retailTrap.score != null) {
    failurePaths.push({
      title: '派发区 trap · 机构可能向散户派发',
      scenario: `trap=${retailTrap.score} · ${(retailTrap.components || []).map((c) => c.evidence).slice(0, 2).join(' · ') || retailTrap.badge || '拥挤+叙事透支'}`,
      citation: cite('retailTrap', 'retail-trap-score'),
    });
  }

  const squeezeT2Plus = squeezeStage?.id === 'PB-SQUEEZE' && ['T2', 'T3', 'T4', 'T5'].includes(squeezeStage.stage);
  if (squeezeT2Plus) {
    failurePaths.push({
      title: '挤仓止损可能无法按价位执行',
      scenario: `PB-SQUEEZE ${squeezeStage.stage} · ${(squeezeStage.evidence || []).join(' · ') || '滑点/流动性不足'} · 预设止损价可能成交在更差价位`,
      citation: cite('squeezeStage', squeezeStage.dataSource || 'policy-playbook-engine'),
    });
  }

  if (pbId && falsifyHints.length) {
    failurePaths.push({
      title: `剧本证伪 · ${pbId}`,
      scenario: falsifyHints.slice(0, 2).join('；') || playbook.narrativeZh || '历史模板证伪条件触发',
      citation: cite(`playbook.${pbId}`, playbook.dataSource || 'playbooks.json'),
    });
  } else if (divergence?.level === 'D2' || divergence?.level === 'D3') {
    failurePaths.push({
      title: '政策/价格背离加深',
      scenario: (divergence.evidence || []).slice(0, 2).join(' · ') || divergence.label || '政策意图与 phase 反向',
      citation: cite('divergence', divergence.dataSource || 'policy-playbook-engine'),
    });
  } else {
    failurePaths.push({
      title: `Regime ${regime?.regime || '—'} 反转`,
      scenario: regime?.reasons?.slice(0, 2).join(' · ') || regime?.label || '环境 regime 切换导致 posture 失效',
      citation: cite('regime', regime?.dataSource || 'commodity-regime-classifier'),
    });
  }

  if (expectationGap?.gap === 'overshoot' || expectationGap?.pricedInDegree?.degree === 'high') {
    failurePaths.push({
      title: '叙事 overshoot · 二阶预期',
      scenario: `priced-in ${expectationGap.pricedInDegree?.degree || '—'} · 价格已透支命题，试仓易成接盘`,
      citation: cite('expectationGap', 'expectation-gap'),
    });
  } else if (hardPolicy?.hasHard) {
    failurePaths.push({
      title: '交易所硬性政策',
      scenario: hardPolicy.note || '监管/限仓/提保等硬性约束突发',
      citation: cite('hardPolicy', hardPolicy.dataSource || 'exchange-hard-policy'),
    });
  } else if (divergence?.holderAlert) {
    failurePaths.push({
      title: `${divergence.level} 持有者告警`,
      scenario: (divergence.evidence || []).slice(-2).join(' · ') || '政策/资本背离 · 新 scout 关闭',
      citation: cite('divergence', divergence.dataSource || 'policy-playbook-engine'),
    });
  } else {
    failurePaths.push({
      title: `Phase ${tg.phase || '—'} 未确认`,
      scenario: `bias=${tg.bias || '—'} · 试仓时 phase 退潮或 capitalAttention 骤降`,
      citation: cite('tradingGuidance.phase', tg.dataSource || 'outlook-trading-guidance'),
    });
  }

  const tier = globalRisk?.tier || globalRisk?.liquidityShockTier || 'L0';
  const grRegime = globalRisk?.regime || globalRisk?.globalRiskRegime || 'normal';
  if (liqCrisis?.active || tier === 'L3') {
    failurePaths.push({
      title: `PB-LIQ-CRISIS · 全球流动性 ${tier}`,
      scenario: (liqCrisis?.evidence || []).join(' · ') || globalRisk?.summary || 'L3 系统性冲击 · 有效押注≤1 · posture 禁止',
      citation: cite('liqCrisis', liqCrisis?.dataSource || 'global-liquidity-risk'),
    });
  } else if (tier === 'L2' || grRegime === 'shock' || grRegime === 'deleveraging') {
    failurePaths.push({
      title: `全球流动性 ${tier} · ${grRegime}`,
      scenario: globalRisk?.summary || '宏观时钟冲突 · posture 上限收紧 · 试仓敞口被系统性挤压',
      citation: cite('globalRisk', globalRisk?.dataSource || 'global-liquidity-risk'),
    });
  } else if (spec.slippage?.flag) {
    failurePaths.push({
      title: `滑点/执行 ${spec.slippage.tier || spec.slippage.flag}`,
      scenario: (spec.slippage.evidence || []).join(' · ') || 'Regime D 或流动性不足 · 止损难执行',
      citation: cite('slippage', spec.slippage.dataSource || 'slippage-detector'),
    });
  } else {
    failurePaths.push({
      title: '组合/相关性簇',
      scenario: '三槽已满或 black/precious 簇相关性上升 · 试仓未分散化',
      citation: cite('portfolioGate', 'portfolio-gate'),
    });
  }

  while (failurePaths.length < 3) {
    failurePaths.push({
      title: '未知尾部风险',
      scenario: '数据/命题待校验 · 勿以单一 narrative 下注',
      citation: cite('dataQuality', 'pre-mortem-gate'),
    });
  }

  return {
    failurePaths: failurePaths.slice(0, 3),
    playbookId: pbId,
    squeezeStage: squeezeStage?.stage || null,
    opponentSide: opponentStatus?.opponentSide || null,
    signalId: buildSignalId(inst?.id || context.symbol, posture),
    posture,
    symbol: normalizeCommodityId(inst?.id || context.symbol),
    mustAcknowledge: true,
    version: PRE_MORTEM_VERSION,
    dataSource: 'pre-mortem-gate',
    method: 'playbook+regime+divergence+gap+squeeze+opponent+globalRisk',
    asOf: nowIso(),
  };
}

function requiresPreMortemAck(inst, context = {}) {
  const tg = inst?.tradingGuidance;
  const lt = inst?.longTermGuidance;
  const postureIntent = context.postureIntent || context.userPosture;
  const scoutIntent = postureIntent === '试仓' || (tg?.posture !== '试仓' && postureIntent === '试仓');
  const readyLong = lt?.entry?.readiness === 'ready';
  return scoutIntent || readyLong || tg?.posture === '试仓';
}

module.exports = {
  PRE_MORTEM_VERSION,
  buildPreMortem,
  buildSignalId,
  requiresPreMortemAck,
  todayKey,
};
