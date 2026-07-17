/**
 * Weekly Red Team Letter — retail adversarial review (Sunday auto or manual IPC).
 * Uses ONLY structured data + behavior-override-log; no synthetic narratives.
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const { summarizeOverridePatterns, readOverrides } = require('./behavior-override-log');
const { buildFactorExposure, RETAIL_RULES, detectRuleViolations } = require('./retail-hf-strategy');

const RED_TEAM_VERSION = 'v1.46.0-retail-hf';

function nowIso() {
  return new Date().toISOString();
}

function weekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const sunday = new Date(d);
  sunday.setDate(d.getDate() - day);
  return sunday.toISOString().slice(0, 10);
}

function isSunday(date = new Date()) {
  return date.getDay() === 0;
}

function slotDeathOrder(holdings = [], instruments = [], globalRisk = null) {
  const instMap = new Map((instruments || []).map((i) => [normalizeCommodityId(i.id), i]));
  const ranked = (holdings || []).map((sym, idx) => {
    const inst = instMap.get(normalizeCommodityId(sym));
    const tg = inst?.tradingGuidance;
    const spec = inst?.integratedSpec;
    let fragility = 0;
    const reasons = [];
    if (tg?.phase === '拥挤') {
      fragility += 30;
      reasons.push('拥挤期');
    }
    if (spec?.divergence?.level === 'D2' || spec?.divergence?.level === 'D3') {
      fragility += 25;
      reasons.push(`背离 ${spec.divergence.level}`);
    }
    if (spec?.expectationGap?.gap === 'overshoot') {
      fragility += 20;
      reasons.push('overshoot');
    }
    if (globalRisk?.tier === 'L3') {
      fragility += 15;
      reasons.push('L3 宏观');
    }
    if (spec?.opponentStatus?.noChase) {
      fragility += 10;
      reasons.push('对手将竭');
    }
    if (tg?.phase === '退潮') {
      fragility += 35;
      reasons.push('退潮');
    }
    return { slot: idx + 1, symbol: sym, name: inst?.name || sym, fragility, reasons, posture: tg?.posture };
  });
  ranked.sort((a, b) => b.fragility - a.fragility);
  return ranked;
}

function scanWrongPlaybookRisk(instruments = []) {
  const risks = [];
  for (const inst of instruments || []) {
    const spec = inst.integratedSpec;
    const tg = inst.tradingGuidance;
    const pb = spec?.playbook?.id;
    const tree = spec?.playbookDecisionTree;
    if (tree?.confidence != null && tree.confidence < 0.4) {
      risks.push(`${inst.name || inst.id}: 决策树置信低 (${tree.confidence}) · 剧本 ${pb || '—'}`);
    }
    if (spec?.squeezeStage?.stage && ['T3', 'T4'].includes(spec.squeezeStage.stage) && tg?.posture !== '观望') {
      risks.push(`${inst.name || inst.id}: 逼仓 ${spec.squeezeStage.stage} 但 posture=${tg?.posture} · 散户不应主导`);
    }
    if (spec?.divergence?.level === 'D2' && tg?.posture === '加仓') {
      risks.push(`${inst.name || inst.id}: D2 政策背离仍加仓 · ${RETAIL_RULES.noFightD2Policy}`);
    }
  }
  return risks.slice(0, 6);
}

function scanOpponentCapitulationMissed(instruments = []) {
  const missed = [];
  for (const inst of instruments || []) {
    const opp = inst.integratedSpec?.opponentStatus;
    const tg = inst.tradingGuidance;
    if (!opp) continue;
    if (opp.opponentSide === 'shortNotDead' && tg?.posture === '减仓' && !opp.blockReduceLongOnHighPrice) {
      missed.push(`${inst.name || inst.id}: 空头未死时过早减多 · 可能错过 ${opp.label}`);
    }
    if (opp.noChase && ['加仓', '试仓'].includes(tg?.posture)) {
      missed.push(`${inst.name || inst.id}: 对手已竭仍追 · ${opp.label}`);
    }
    if (opp.status === '待校验' && ['持有', '加仓'].includes(tg?.posture)) {
      missed.push(`${inst.name || inst.id}: OI 待校验仍重仓 · 应先确认`);
    }
  }
  return missed.slice(0, 5);
}

function scanRetailRuleViolations(instruments = [], context = {}) {
  const all = [];
  for (const inst of instruments || []) {
    const rv = inst.integratedSpec?.retailHf?.ruleViolations || detectRuleViolations(inst, context);
    for (const v of rv.violations || []) {
      all.push(`${inst.name || inst.id}: ${v.rule} — ${v.detail}`);
    }
  }
  const behavior = summarizeOverridePatterns();
  const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
  const recentIgnores = readOverrides().filter(
    (e) => e.userAction === '忽略' && new Date(e.at).getTime() >= weekStart
  );
  if (recentIgnores.length >= 3) {
    all.push(`行为: 本周忽略建议 ${recentIgnores.length} 次 · 复盘 posture 规则`);
  }
  if (behavior.patternWarning) all.push(behavior.patternWarning);
  return all.slice(0, 8);
}

/**
 * @param {object} outlookPayload '{ instruments, globalRisk, masterClock }'
 * @param {object} options '{ holdings, force }'
 */
function buildRedTeamWeekly(outlookPayload = {}, options = {}) {
  const asOf = nowIso();
  const wk = weekKey();
  const instruments = outlookPayload.instruments || [];
  const globalRisk = outlookPayload.globalRisk || outlookPayload.globalLiquidityRisk;
  const holdings = options.holdings || [];

  const factorExposure = buildFactorExposure(holdings, instruments, {
    masterClock: outlookPayload.masterClock,
  });

  const slotDeath = slotDeathOrder(holdings, instruments, globalRisk);
  const wrongPlaybook = scanWrongPlaybookRisk(instruments);
  const opponentMissed = scanOpponentCapitulationMissed(instruments);
  const ruleViolations = scanRetailRuleViolations(instruments, { globalRisk });

  const sections = [
    {
      id: 'slot-death',
      title: '宏观翻转时三槽谁先死',
      items: slotDeath.length
        ? slotDeath.map((s) => `槽${s.slot} ${s.name || s.symbol} (脆弱${s.fragility}) · ${s.reasons.join('、') || '—'}`)
        : ['空仓 · 无持仓槽位'],
    },
    {
      id: 'wrong-playbook',
      title: '错误剧本风险',
      items: wrongPlaybook.length ? wrongPlaybook : ['暂无结构化剧本冲突'],
    },
    {
      id: 'opponent-missed',
      title: '对手 capitulation 遗漏',
      items: opponentMissed.length ? opponentMissed : ['暂无对手盘误判信号'],
    },
    {
      id: 'retail-violations',
      title: '本周散户规则偏离',
      items: ruleViolations.length ? ruleViolations : ['本周无记录偏离 · 跟随·就绪'],
    },
  ];

  const summary = sections
    .map((s) => `${s.title}: ${s.items[0]?.slice(0, 48) || '—'}`)
    .join(' · ');

  return {
    weekKey: wk,
    generatedOnSunday: isSunday(),
    sections,
    summary,
    factorExposure,
    holdings,
    dataSource: 'red-team-weekly',
    method: 'structured-adversarial+behavior-log',
    version: RED_TEAM_VERSION,
    asOf,
  };
}

module.exports = {
  RED_TEAM_VERSION,
  weekKey,
  isSunday,
  buildRedTeamWeekly,
  slotDeathOrder,
};
