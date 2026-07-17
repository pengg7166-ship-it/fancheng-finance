/**
 * 梵澄 AI 融合 '结构化叙'+ 可'LLM 增强
 * 严禁编造：仅读取引'payload；缺—暂无/待校验；每句可追溯到 citations[]'
 */
const { normalizeCommodityId } = require('./policy-commodity-map');
const outlookTradingGuidance = require('./outlook-trading-guidance');
const { isLlmConfigured } = require('./config');
const {
  PRESET_CHIPS,
  getHubPresetChips,
  getDetailPresetChips,
  getDetailPresetChipsByGroup,
} = require('../src/fancheng-ai-preset-chips');
const { fmtBacktestHitWithSample } = require('./core-tactical-slots');

const FUSION_VERSION = 'v1.48.0-l2-live';
const { RETAIL_RULES } = require('./retail-hf-strategy');

const READINESS_LABELS = Object.freeze({
  ready: '就绪',
  approaching: '接近',
  'not-ready': '未就',
  missed: '已错',
});

function nowIso() {
  return new Date().toISOString();
}

function cite(field, value, source) {
  return { field, value, source: source || 'fancheng-ai-fusion' };
}

function pushCitation(citations, field, value, source) {
  if (value == null || value === '') return;
  citations.push(cite(field, value, source));
}

function collectLogicChainPoints(logicChain, prefix, keyPoints, citations) {
  for (const row of logicChain || []) {
    const text = row.conclusion != null ? `${row.layer || prefix}${row.conclusion}` : null;
    if (!text) continue;
    const c = cite(`${prefix}:${row.layer}`, row.conclusion, row.dataSource || prefix);
    keyPoints.push({ text: row.evidence ? `${text}${row.evidence}）` : text, citation: c });
    pushCitation(citations, c.field, c.value, c.source);
  }
}

function deriveActionAdvice(tg, lt, citations) {
  if (!tg?.posture) return '暂无 · 交易指导待校验';
  const posture = tg.posture;
  pushCitation(citations, 'tradingGuidance.posture', posture, tg.dataSource || 'outlook-trading-guidance');

  const readiness = lt?.entry?.readiness;
  const readinessLabel = readiness ? READINESS_LABELS[readiness] || readiness : null;
  if (readinessLabel) {
    pushCitation(citations, 'longTermGuidance.entry.readiness', readiness, lt.dataSource || 'long-term-trading-guidance');
  }

  const parts = [`短线 posture 为${posture}」`];
  if (readinessLabel) {
    parts.push(`长线入场 ${readinessLabel}`);
    if (lt.entry?.reason) parts.push(`依据${lt.entry.reason}`);
  } else {
    parts.push('长线入场状态待校验');
  }
  if (tg.globalRiskCap && tg.globalRiskCap !== posture) {
    parts.push(`全球流动性上限 ${tg.globalRiskCap}`);
    pushCitation(citations, 'tradingGuidance.globalRiskCap', tg.globalRiskCap, tg.dataSource || 'outlook-trading-guidance');
  }
  return parts.join('') + '';
}

function extractMacroHydrateSnippets(sources = {}) {
  const snippets = [];
  const push = (tag, text, source) => {
    if (!text) return;
    snippets.push({ tag, text: String(text).slice(0, 120), source });
  };

  const fed = sources.fed;
  if (fed?.indicators?.length) {
    const hit = fed.indicators.find((i) => /vix|rate|yield/i.test(`${i.id} ${i.name}`)) || fed.indicators[0];
    push('fed', `${hit.name || hit.id} ${hit.value ?? hit.latest ?? '—'}`, 'fed');
  } else if (fed?.speeches?.[0]?.title) {
    push('fed', fed.speeches[0].title, 'fed');
  }

  const geo = sources.geopolitics;
  if (geo?.news?.[0]) {
    push('geo', geo.news[0].title || geo.news[0].headline, 'geopolitics');
  } else if (geo?.regions?.[0]?.headline) {
    push('geo', geo.regions[0].headline, 'geopolitics');
  }

  const policy = sources.policy;
  if (policy?.news?.[0]) {
    push('policy', policy.news[0].title || policy.news[0].headline, 'policy');
  } else if (policy?.items?.[0]?.title) {
    push('policy', policy.items[0].title, 'policy');
  }

  const climate = sources.climate;
  if (climate?.news?.[0]) {
    push('climate', climate.news[0].title || climate.news[0].headline, 'climate');
  } else if (climate?.alerts?.[0]?.title) {
    push('climate', climate.alerts[0].title, 'climate');
  }

  const macro = sources.macro;
  if (macro?.groups?.[0]?.indicators?.[0]) {
    const ind = macro.groups[0].indicators[0];
    push('macro', `${ind.name || ind.id}: ${ind.value ?? '—'}`, 'macro');
  }

  return snippets;
}

function buildCounterThesis(inst, macroContext = {}) {
  const citations = [];
  const points = [];
  const tg = inst?.tradingGuidance;
  const spec = inst?.integratedSpec;
  const globalRisk = macroContext.globalRisk;

  if (spec?.divergence?.level === 'D2' || spec?.divergence?.level === 'D3') {
    const text = `${inst.name || inst.id}：政策·资本背离 ${spec.divergence.level} '持有者优先减仓；退潮期不宜追 narrative。`;
    points.push({ text, citation: cite('integratedSpec.divergence', spec.divergence.level, 'policy-playbook-engine') });
    pushCitation(citations, 'divergence', spec.divergence.level, 'policy-playbook-engine');
  }

  if (spec?.expectationGap?.gap === 'overshoot') {
    points.push({
      text: `叙事 overshoot${(spec.expectationGap.evidence || []).join(' · ') || '价格可能透支预期'}`,
      citation: cite('expectationGap', 'overshoot', 'expectation-gap'),
    });
  }

  if (spec?.playbook?.narrativeZh) {
    points.push({
      text: `Playbook ${spec.playbook.id} · ${spec.playbook.stage}${spec.playbook.narrativeZh}`,
      citation: cite('playbook', spec.playbook.id, 'playbooks.json'),
    });
    if (spec.playbook.lowSample) {
      points.push({
        text: `样本警告：playbook 匹配置信 ${spec.playbook.confidence} · n=${spec.playbook.n ?? '—'}（低样本 seed）`,
        citation: cite('playbook.n', spec.playbook.n, 'playbooks.json'),
      });
    }
  }

  if (globalRisk?.tier === 'L2' || globalRisk?.tier === 'L3') {
    points.push({
      text: `全球流动性 ${globalRisk.tier}：反身性—避险/叙事品种在去杠杆期亦可能同步承压。`,
      citation: cite('globalRisk.tier', globalRisk.tier, 'global-liquidity-risk'),
    });
  }

  if (tg?.bias === '偏多' && tg?.phase === '拥挤') {
    points.push({
      text: '反证：拥挤区追多风险 · phase 退潮或波动放大可快速逆转',
      citation: cite('tradingGuidance.phase', tg.phase, tg.dataSource),
    });
  }

  if (!points.length) {
    points.push({
      text: '暂无强反证信号 · 仍需跟踪命题 falsify 与结构失效位',
      citation: cite('counterThesis', 'none', 'fancheng-ai-fusion'),
    });
  }

  return {
    points,
    mandatory: true,
    summary: points.map((p) => p.text).join(' '),
    citations,
    dataSource: 'fancheng-ai-fusion',
    method: 'counter-thesis-mandatory',
    asOf: nowIso(),
  };
}

function buildInstrumentBrief(inst, macroContext = {}) {
  const asOf = nowIso();
  const citations = [];
  const keyPoints = [];
  const risks = [];

  if (!inst?.id) {
    return {
      summary: '品种标识缺失，暂无研判摘要',
      keyPoints: [{ text: 'instrument.id 缺失', citation: cite('id', null, 'fancheng-ai-fusion') }],
      risks: [],
      actionAdvice: '暂无',
      dataSource: 'fancheng-ai-fusion',
      method: 'structured-synthesis',
      asOf,
      citations,
    };
  }

  if (!outlookTradingGuidance.isPilotSymbol(inst.id)) {
    pushCitation(citations, 'pilot', false, 'outlook-trading-guidance');
    const spec = inst.integratedSpec;
    const regimeLine = spec?.regime ? `regime ${spec.regime.regime}${spec.regime.label}）` : 'regime 待校验';
    const playbookLine = spec?.playbook ? `playbook ${spec.playbook.id} · ${spec.playbook.stage}` : 'playbook 暂无';
    const counterThesis = buildCounterThesis(inst, macroContext);
    return {
      summary: `${inst.name || inst.id} 'pilot 完整指导 · ${regimeLine} · W${spec?.watchLevel || '0'} · ${playbookLine}。长线指导：暂无（试点外）。`,
      keyPoints: [
        { text: regimeLine, citation: cite('integratedSpec.regime', spec?.regime?.regime, 'commodity-regime-classifier') },
        { text: playbookLine, citation: cite('integratedSpec.playbook', spec?.playbook?.id, 'policy-playbook-engine') },
      ],
      risks: counterThesis.points.map((p) => ({ text: p.text, citation: p.citation })),
      actionAdvice: '暂无 · 完整 posture · pilot 品种',
      counterThesis,
      dataSource: 'fancheng-ai-fusion',
      method: 'structured-synthesis+integrated-spec-lite',
      asOf,
      citations,
    };
  }

  const tg = inst.tradingGuidance;
  const lt = inst.longTermGuidance;
  const ms = inst.macroSynthesis || macroContext.macroSynthesis?.perSymbol?.[normalizeCommodityId(inst.id)];

  if (!tg?.pilot) {
    return {
      summary: `${inst.name || inst.id} 交易指导待校验，无法生成可审计摘要。`,
      keyPoints: [{ text: 'tradingGuidance.pilot=false 或缺失', citation: cite('tradingGuidance.pilot', false, 'outlook-trading-guidance') }],
      risks: [],
      actionAdvice: '暂无',
      dataSource: 'fancheng-ai-fusion',
      method: 'structured-synthesis',
      asOf,
      citations,
    };
  }

  const name = inst.name || inst.id;
  const posture = tg.posture || '暂无';
  const phase = tg.phase || '暂无';
  const bias = tg.bias || '暂无';
  pushCitation(citations, 'tradingGuidance.posture', posture, tg.dataSource);
  pushCitation(citations, 'tradingGuidance.phase', phase, tg.dataSource);
  pushCitation(citations, 'tradingGuidance.bias', bias, tg.dataSource);

  const conf = tg.confidence;
  const confText =
    conf?.hitRate != null && conf?.n != null
      ? `回测置信 ${Math.round(conf.hitRate * 100)}% (${conf.hits ?? '?'}/${conf.n})`
      : conf?.level
        ? `置信 ${conf.level}`
        : null;
  if (confText) pushCitation(citations, 'tradingGuidance.confidence', confText, tg.dataSource);

  const rg = inst.regimeGate;
  if (rg?.marketRegime) {
    const rgLine = `L1 regime ${rg.marketRegimeLabel || rg.marketRegime}${rg.confidenceLabel ? ` · 门禁置信${rg.confidenceLabel}` : ''}${rg.emit === false ? ' · 方向抑制' : ''}`;
    keyPoints.push({ text: rgLine, citation: cite('regimeGate.marketRegime', rg.marketRegime, rg.dataSource || 'regime-gate') });
    pushCitation(citations, 'regimeGate.marketRegime', rg.marketRegime, rg.dataSource || 'regime-gate');
    if (rg.confidenceLabel) pushCitation(citations, 'regimeGate.confidenceLabel', rg.confidenceLabel, rg.dataSource || 'regime-gate');
  } else if (inst.marketRegime) {
    pushCitation(citations, 'marketRegime', inst.marketRegime, 'market-regime-classifier');
  }
  const td = inst.tradableDay;
  if (td?.tradable === true || td?.tradable === false) {
    const tdLine = td.tradable ? 'tradable-day 可交易窗口' : 'non-tradable-day · KPI 子集外';
    keyPoints.push({ text: tdLine, citation: cite('tradableDay.tradable', td.tradable, td.dataSource || 'tradable-day-kpi') });
    pushCitation(citations, 'tradableDay.tradable', td.tradable, td.dataSource || 'tradable-day-kpi');
  }
  const cal = inst.calendarStaleness;
  if (cal?.state && cal.state !== 'fresh') {
    pushCitation(citations, 'calendarStaleness.state', cal.state, cal.dataSource || 'tradable-day-kpi');
  }

  const summaryParts = [
    `${name} 当前 posture${posture}」，阶段${phase}」，方向 bias${bias}」。`,
  ];
  if (confText) summaryParts.push(confText + '');
  if (tg.timing) {
    const timingText =
      typeof tg.timing === 'string'
        ? tg.timing
        : `${tg.timing.action || ''} · ${tg.timing.slot || ''}${tg.timing.reason ? ` · ${tg.timing.reason}` : ''}`;
    summaryParts.push(`时机${timingText}。`);
    pushCitation(citations, 'tradingGuidance.timing', timingText, tg.dataSource);
  }
  if (lt?.entry?.readiness) {
    const rl = READINESS_LABELS[lt.entry.readiness] || lt.entry.readiness;
    summaryParts.push(`长线入场 ${rl}${lt.entry.reason ? `${lt.entry.reason}）` : ''}。`);
    pushCitation(citations, 'longTermGuidance.entry.readiness', lt.entry.readiness, lt.dataSource);
  }

  collectLogicChainPoints((tg.logicChain || []).slice(0, 4), 'tradingGuidance', keyPoints, citations);

  if (tg.globalRiskCap) {
    const capText = tg.uncappedPosture && tg.uncappedPosture !== tg.posture
      ? `全球流动性 cap ${tg.globalRiskCap}（原 posture ${tg.uncappedPosture} 已下调）`
      : `全球流动性 cap ${tg.globalRiskCap}`;
    risks.push({ text: capText, citation: cite('tradingGuidance.globalRiskCap', tg.globalRiskCap, tg.dataSource) });
    pushCitation(citations, 'tradingGuidance.globalRiskCap', tg.globalRiskCap, tg.dataSource);
  }

  for (const alert of (tg.alerts || []).filter((a) => a.triggered)) {
    risks.push({
      text: `告警 · ${alert.type || ''}${alert.reason || alert.condition || ''}`,
      citation: cite('tradingGuidance.alerts', alert.type, tg.dataSource),
    });
  }

  const preMortem = inst.integratedSpec?.preMortem;
  if (preMortem?.failurePaths?.length) {
    for (const fp of preMortem.failurePaths.slice(0, 3)) {
      risks.push({
        text: `事前验尸 · ${fp.title}${fp.scenario}`,
        citation: cite(fp.citation?.field || 'preMortem', fp.title, fp.citation?.source || 'pre-mortem-gate'),
      });
    }
    pushCitation(citations, 'preMortem.signalId', preMortem.signalId, 'pre-mortem-gate');
  }

  if (lt?.stop?.riskOfEarlyStop && lt.stop.riskOfEarlyStop !== 'low') {
    risks.push({
      text: `过早止损风险 ${lt.stop.riskOfEarlyStop}${lt.stop.rationale ? ` · ${lt.stop.rationale}` : ''}`,
      citation: cite('longTermGuidance.stop.riskOfEarlyStop', lt.stop.riskOfEarlyStop, lt.dataSource),
    });
    pushCitation(citations, 'longTermGuidance.stop.riskOfEarlyStop', lt.stop.riskOfEarlyStop, lt.dataSource);
  }

  const hardStop = lt?.stop?.hardStop;
  if (hardStop != null) {
    pushCitation(citations, 'longTermGuidance.stop.hardStop', hardStop, lt.dataSource);
  }

  const theses = ms?.activeTheses || inst.macroSynthesis?.activeTheses || [];
  if (theses.length) {
    const top = theses[0];
    keyPoints.push({
      text: `活跃命题 · ${top.who || ''}${(top.claim || '').slice(0, 100)}`,
      citation: cite('macroSynthesis.activeTheses[0]', top.claim, 'thesis-registry'),
    });
    pushCitation(citations, 'macroSynthesis.activeTheses.count', theses.length, 'thesis-synthesis');
  }

  const hydrateSnippets = macroContext.macroHydrate || extractMacroHydrateSnippets(macroContext.sources);
  for (const sn of hydrateSnippets.slice(0, 3)) {
    keyPoints.push({
      text: `[${sn.tag}] ${sn.text}`,
      citation: cite(`macroHydrate.${sn.tag}`, sn.text, sn.source),
    });
    pushCitation(citations, `macroHydrate.${sn.tag}`, sn.text, sn.source);
  }

  const retailHf = inst.integratedSpec?.retailHf;
  if (retailHf?.ruleViolations?.violations?.length) {
    for (const v of retailHf.ruleViolations.violations.slice(0, 3)) {
      risks.push({
        text: `散户规则 · ${v.rule}：${v.detail}`,
        citation: cite('retailHf.ruleViolations', v.rule, 'retail-hf-strategy'),
      });
    }
  } else if (retailHf?.badges?.followReady) {
    keyPoints.push({
      text: `散户跟随 · ${retailHf.badges.followReady} · ${RETAIL_RULES.confirmNotPredict}`,
      citation: cite('retailHf.followReady', true, 'retail-hf-strategy'),
    });
  }
  if (retailHf?.eventDecay?.badge || inst.integratedSpec?.eventDecay?.badge) {
    risks.push({
      text: `事件衰减 · ${inst.integratedSpec?.eventDecay?.evidence?.[0] || '陈旧事件需价格确认'}`,
      citation: cite('eventDecay', inst.integratedSpec?.eventDecay?.band, 'event-decay'),
    });
  }
  if (inst.integratedSpec?.carryRoll?.carryLine) {
    keyPoints.push({
      text: inst.integratedSpec.carryRoll.carryLine,
      citation: cite('carryRoll', inst.integratedSpec.carryRoll.bias, 'term-structure-bias'),
    });
  }
  if (inst.integratedSpec?.painMemory?.fusionLine) {
    keyPoints.push({
      text: inst.integratedSpec.painMemory.fusionLine,
      citation: cite('painMemory', inst.integratedSpec.painMemory.matches?.[0]?.id, 'pain-memory-playbook'),
    });
  }
  if (inst.integratedSpec?.retailTrap?.highTrap && inst.integratedSpec.retailTrap.score != null) {
    risks.push({
      text: `派发区 trap=${inst.integratedSpec.retailTrap.score} · ${inst.integratedSpec.retailTrap.badge || '勿追'}`,
      citation: cite('retailTrap', inst.integratedSpec.retailTrap.score, 'retail-trap-score'),
    });
  }

  const actionAdvice = deriveActionAdvice(tg, lt, citations);
  const counterThesis = buildCounterThesis(inst, { globalRisk: macroContext.globalRisk, ...macroContext });

  return {
    summary: summaryParts.join(' '),
    keyPoints,
    risks,
    actionAdvice,
    counterThesis,
    dataSource: 'fancheng-ai-fusion',
    method: 'structured-synthesis+counter-thesis',
    version: FUSION_VERSION,
    asOf,
    citations,
  };
}

function buildMacroBrief(globalRisk, activeTheses = [], macroSynthesis = null, options = {}) {
  const asOf = nowIso();
  const citations = [];
  const keyPoints = [];
  const risks = [];

  if (!globalRisk) {
    return {
      summary: '全球风险数据待校验，暂无宏观解读',
      keyPoints: [{ text: 'globalRisk 缺失', citation: cite('globalRisk', null, 'global-risk-regime') }],
      risks: [],
      actionAdvice: '暂无',
      dataSource: 'fancheng-ai-fusion',
      method: 'structured-synthesis',
      asOf,
      citations,
    };
  }

  const tier = globalRisk.tier || globalRisk.liquidityShockTier || 'L?';
  const regime = globalRisk.regime || globalRisk.globalRiskRegime || 'normal';
  pushCitation(citations, 'globalRisk.tier', tier, 'global-liquidity-risk');
  pushCitation(citations, 'globalRisk.regime', regime, 'global-risk-regime');

  const summaryParts = [
    `全球流动性 ${tier} · regime ${regime}。`,
    globalRisk.summary ? `${globalRisk.summary}` : '',
  ].filter(Boolean);

  const greenObs = (globalRisk.observables || []).filter((o) => o.status === 'green').length;
  const redObs = (globalRisk.observables || []).filter((o) => o.status === 'red').length;
  if (globalRisk.observables?.length) {
    summaryParts.push(`可观测指标 ${globalRisk.okCount ?? greenObs}/${globalRisk.observableTotal ?? globalRisk.observables.length} 正常${redObs ? `${redObs} 项告警` : ''}。`);
    pushCitation(citations, 'globalRisk.observables', `${greenObs}/${globalRisk.observables.length}`, 'global-liquidity-risk');
  }

  collectLogicChainPoints((globalRisk.logicChain || []).slice(0, 5), 'globalRisk', keyPoints, citations);

  const thesisList = Array.isArray(activeTheses) ? activeTheses : [];
  const synthSummary = macroSynthesis?.narrativeSummary || macroSynthesis?.macroSynthesis?.narrativeSummary;
  if (synthSummary && synthSummary !== '暂无活跃命题') {
    keyPoints.push({ text: `命题合成${synthSummary}`, citation: cite('macroSynthesis.narrativeSummary', synthSummary, 'thesis-synthesis') });
    pushCitation(citations, 'macroSynthesis.narrativeSummary', synthSummary, 'thesis-synthesis');
  } else if (thesisList.length) {
    const snippet = thesisList
      .slice(0, 3)
      .map((t) => `${t.who || ''}: ${(t.claim || '').slice(0, 60)}`)
      .join(' | ');
    keyPoints.push({ text: `活跃命题 ${thesisList.length} 条：${snippet}`, citation: cite('activeTheses.count', thesisList.length, 'thesis-registry') });
    pushCitation(citations, 'activeTheses.count', thesisList.length, 'thesis-registry');
  } else {
    keyPoints.push({ text: '活跃命题暂无', citation: cite('activeTheses', 0, 'thesis-registry') });
  }

  if (regime === 'shock' || tier === 'L3') {
    risks.push({ text: '流动性冲击 tier 偏高，pilot 品种 posture 上限趋保守', citation: cite('globalRisk.tier', tier, 'global-liquidity-risk') });
  }
  if (globalRisk.narrativeHeat >= 3 || globalRisk.narrativeHeat?.bubbleTalk === 'hot') {
    risks.push({ text: '叙事热度偏高，需警惕拥挤交易', citation: cite('globalRisk.narrativeHeat', globalRisk.narrativeHeat, 'global-liquidity-risk') });
  }

  const cross = macroSynthesis?.crossCommodity || macroSynthesis?.macroSynthesis?.crossCommodity;
  if (cross) {
    keyPoints.push({
      text: `跨品种通道 · 金融 ${cross.financialChannel || ''} · 实物 ${cross.physicalChannel || ''} · 避险 ${cross.safeHavenChannel || ''}`,
      citation: cite('macroSynthesis.crossCommodity', cross.financialChannel, 'thesis-synthesis'),
    });
  }

  const hydrateSnippets = options.macroHydrate || extractMacroHydrateSnippets(options.sources);
  for (const sn of hydrateSnippets.slice(0, 4)) {
    keyPoints.push({
      text: `[${sn.tag}] ${sn.text}`,
      citation: cite(`macroHydrate.${sn.tag}`, sn.text, sn.source),
    });
    pushCitation(citations, `macroHydrate.${sn.tag}`, sn.text, sn.source);
  }

  try {
    const { computeMacroMasterClock } = require('./macro-master-clock');
    const clock = computeMacroMasterClock({ sources: options.sources, globalRisk, macroSynthesis });
    if (clock?.summaryThreeLines?.length) {
      for (const line of clock.summaryThreeLines) {
        keyPoints.push({ text: `主时'· ${line}`, citation: cite('masterClock', line, 'macro-master-clock') });
      }
      if (clock.crossMarket?.gsr?.zScore != null) {
        keyPoints.push({
          text: `GSR z=${clock.crossMarket.gsr.zScore} · 金银比跨市场提示`,
          citation: cite('crossMarket.gsr', clock.crossMarket.gsr.zScore, 'gsr-proxy'),
        });
      }
      if (clock.conflict) {
        risks.push({ text: `宏观五时钟冲'· posture cap ${clock.postureCap || '试仓'}`, citation: cite('masterClock.conflict', true, 'macro-master-clock') });
      }
    }
  } catch {
    // non-fatal
  }

  const overshootTheses = thesisList.filter((t) => t.status === 'overshoot');
  if (overshootTheses.length) {
    risks.push({
      text: `命题 overshoot ${overshootTheses.length} '· 二阶预期：priced-in 程度高，警惕二次反弹(O2)快钱陷阱`,
      citation: cite('activeTheses.overshoot', overshootTheses.length, 'thesis-registry'),
    });
  }

  try {
    const instruments = options.instruments || [];
    const scoutPosture = instruments.filter((i) => i.tradingGuidance?.posture === '试仓' || i.longTermGuidance?.entry?.readiness === 'ready');
    if (scoutPosture.length) {
      const pm = scoutPosture[0]?.integratedSpec?.preMortem;
      if (pm?.failurePaths?.[0]) {
        keyPoints.push({
          text: `事前验尸${scoutPosture[0].name || scoutPosture[0].id}）'${pm.failurePaths[0].title}`,
          citation: cite('preMortem', pm.signalId, 'pre-mortem-gate'),
        });
      }
    }
  } catch {
    // non-fatal
  }

  try {
    const factorLine = options.factorLine || options.retailFollowAdvice;
    if (factorLine) {
      keyPoints.push({ text: factorLine, citation: cite('retailHf.factorLine', factorLine, 'retail-hf-strategy') });
    } else if (options.holdings?.length) {
      const { buildFactorExposure } = require('./retail-hf-strategy');
      const fe = buildFactorExposure(options.holdings, options.instruments || [], { masterClock: null });
      if (fe?.factorLine) {
        keyPoints.push({ text: fe.factorLine, citation: cite('retailHf.factorLine', fe.hedgeDegree, 'retail-hf-strategy') });
      }
    }
  } catch {
    // non-fatal
  }

  if (tier === 'L3') {
    risks.push({
      text: `散户规则 · ${RETAIL_RULES.l3MandatoryDelever}`,
      citation: cite('retailRules.l3', tier, 'retail-hf-strategy'),
    });
  }

  let actionAdvice = '宏观层仅作 posture 上限约束，具体品种操作见 pilot 交易指导';
  if (tier === 'L3' || regime === 'shock') {
    actionAdvice = '全球流动性冲击态，pilot 品种 posture 上限为「禁止」，宜观望';
  } else if (tier === 'L2' || regime === 'deleveraging') {
    actionAdvice = '去杠杆收紧态，工业品种 posture 上限偏保守，贵金属叙事品种上限「观望」';
  }

  return {
    summary: summaryParts.join(' '),
    keyPoints,
    risks,
    actionAdvice,
    dataSource: 'fancheng-ai-fusion',
    method: 'structured-synthesis+master-clock+second-order',
    version: FUSION_VERSION,
    asOf,
    citations,
  };
}

function matchQuestionPattern(question) {
  const q = String(question || '').trim();
  if (!q) return null;
  const patterns = [
    { re: /^派发区|零售陷阱|retail\s*trap|trap\s*风险/i, type: 'retailTrap' },
    { re: /^痛苦记忆|^有痛苦|pain\s*memory/i, type: 'painMemory' },
    { re: /^回测置信|backtest|命中率/i, type: 'backtest' },
    { re: /^今天\s*no-?trade|no-?trade\s*吗|禁交易|不新开仓/i, type: 'noTrade' },
    { re: /^对手盘|opponent/i, type: 'opponent' },
    { re: /^playbook\s*阶段|^剧本阶段|^playbook/i, type: 'playbook' },
    { re: /^三槽|快钱超标|tactical\s*over|槽型/i, type: 'coreTactical' },
    { re: /^止损(?:为什么|逻辑|为何|在哪)/i, type: 'stop' },
    { re: /^止损逻辑是什么[吗嘛?？]?/i, type: 'stop' },
    { re: /^全球风险(?:对(?:本品种|本品))?有什么影响[吗嘛?？]?/i, type: 'globalRisk' },
    { re: /^全球风险有何影响[吗嘛?？]?/i, type: 'globalRisk' },
    { re: /^宏观风险|global\s*risk/i, type: 'globalRisk' },
    { re: /^当前活跃命题是什么[吗嘛?？]?/i, type: 'theses' },
    { re: /^宏观命题[吗嘛?？]?/i, type: 'theses' },
    { re: /^活跃命题[吗嘛?？]?/i, type: 'theses' },
    { re: /^长线入场逻辑[吗嘛?？]?/i, type: 'longEntry' },
    { re: /^(?:现在|当前)(?:适合|能否)长线开仓[吗嘛?？]?/i, type: 'longEntry' },
    { re: /^现在适合长线开仓吗[吗嘛?？]?/i, type: 'longEntry' },
    { re: /^为什么(?:现在)?(?:.+?)(?:posture|姿态|立场)[吗嘛?？]?$/i, type: 'posture' },
    { re: /^为什么(?:是这个|该)\s*posture[吗嘛?？]?/i, type: 'posture' },
    { re: /^为什么(?:现在)?(?:是|建议)(.+?)(?:posture|姿态|立场)[吗嘛?？]?/i, type: 'posture' },
    { re: /^为什么(?:现在)?(?:是|建议).+[吗嘛?？]?$/i, type: 'posture' },
    { re: /^为什么(?:不)?(?:就绪|接近|未就绪|已错过)/i, type: 'entry' },
    { re: /^为什么建(?:议)?(.+?)(?:入场|entry|readiness)[吗嘛?？]?/i, type: 'entry' },
  ];
  for (const p of patterns) {
    const m = q.match(p.re);
    if (m) return { type: p.type, match: m };
  }
  return { type: 'unknown', match: null };
}

function answerPostureQuestion(context, citations, unknowns) {
  const tg = context.instrument?.tradingGuidance;
  if (!tg?.pilot) {
    unknowns.push('tradingGuidance');
    return '交易指导待校验，无法解释 posture';
  }
  const posture = tg.posture || '暂无';
  pushCitation(citations, 'tradingGuidance.posture', posture, tg.dataSource);
  const chain = tg.logicChain || [];
  if (!chain.length) {
    unknowns.push('logicChain');
    return `当前 posture 为${posture}」，'logicChain 暂无，原因待校验。`;
  }
  const lines = chain.map((c) => `${c.layer}${c.conclusion}${c.evidence || ''} · ${c.dataSource || ''}）`);
  for (const c of chain) pushCitation(citations, `logicChain:${c.layer}`, c.conclusion, c.dataSource);
  if (tg.globalRiskCap && tg.uncappedPosture && tg.uncappedPosture !== tg.posture) {
    lines.push(`全球流动性 cap${tg.globalRiskCap}，原 posture ${tg.uncappedPosture} 已下调`);
    pushCitation(citations, 'tradingGuidance.globalRiskCap', tg.globalRiskCap, tg.dataSource);
  }
  return `posture${posture}」来自以'logicChain${lines.join('')}。`;
}

function answerEntryQuestion(context, citations, unknowns) {
  const lt = context.instrument?.longTermGuidance;
  if (!lt?.pilot) {
    unknowns.push('longTermGuidance');
    return '长线交易指导待校验';
  }
  const readiness = lt.entry?.readiness;
  const label = readiness ? READINESS_LABELS[readiness] || readiness : '暂无';
  pushCitation(citations, 'longTermGuidance.entry.readiness', readiness, lt.dataSource);
  const conds = (lt.entry?.conditions || [])
    .map((c) => `${c.label} ${c.met ? '' : ''}${c.evidence ? ` (${c.evidence})` : ''}`)
    .join('');
  if (!readiness) unknowns.push('entry.readiness');
  return `入场 readiness${label}${lt.entry?.reason ? `，理由：${lt.entry.reason}` : ''}${conds ? `。条件：${conds}` : ''}。`;
}

function answerStopQuestion(context, citations, unknowns) {
  const lt = context.instrument?.longTermGuidance;
  if (!lt?.pilot || !lt.stop) {
    unknowns.push('longTermGuidance.stop');
    return '止损阶梯待校验';
  }
  const stop = lt.stop;
  const parts = [];
  if (stop.hardStop != null) {
    parts.push(`硬止'${stop.hardStop}${stop.stopType || ''}）`);
    pushCitation(citations, 'longTermGuidance.stop.hardStop', stop.hardStop, lt.dataSource);
  } else {
    unknowns.push('stop.hardStop');
  }
  if (stop.softStop != null) {
    parts.push(`软预'${stop.softStop}`);
    pushCitation(citations, 'longTermGuidance.stop.softStop', stop.softStop, lt.dataSource);
  }
  if (stop.rationale) parts.push(`依据${stop.rationale}`);
  const chain = (stop.logicChain || []).slice(-4);
  if (chain.length) {
    parts.push(`logicChain${chain.map((c) => `${c.layer}${c.conclusion}`).join('')}`);
    for (const c of chain) pushCitation(citations, `stop.logicChain:${c.layer}`, c.conclusion, c.dataSource);
  }
  return parts.length ? parts.join('') + '' : '止损数据暂无';
}

function answerGlobalRiskQuestion(context, citations, unknowns) {
  const gr = context.globalRisk;
  const tg = context.instrument?.tradingGuidance;
  const sym = normalizeCommodityId(context.instrument?.id);
  if (!gr) {
    unknowns.push('globalRisk');
    return '全球风险数据暂无';
  }
  const tier = gr.tier || gr.liquidityShockTier || 'L?';
  const cap = tg?.globalRiskCap;
  pushCitation(citations, 'globalRisk.tier', tier, 'global-liquidity-risk');
  const capRow = outlookTradingGuidance.resolvePostureCap?.(sym, gr);
  const capPosture = cap || capRow?.cap;
  if (capPosture) pushCitation(citations, 'postureCap', capPosture, 'outlook-trading-guidance');
  const obsSnippet = (gr.observables || [])
    .filter((o) => o.status === 'red' || o.status === 'yellow')
    .slice(0, 3)
    .map((o) => `${o.label}=${o.value ?? '—'}(${o.status})`)
    .join('');
  return `全球流动性 ${tier} · ${gr.regime || gr.globalRiskRegime || ''}。本'posture 上限 ${capPosture || '待校验'}${capRow?.reason ? `${capRow.reason}）` : ''}${obsSnippet ? `关键观测${obsSnippet}。` : ''}${gr.summary ? gr.summary : ''}`;
}

function answerThesesQuestion(context, citations, unknowns) {
  const ms = context.instrument?.macroSynthesis;
  const theses = ms?.activeTheses || context.activeTheses || [];
  if (!theses.length) {
    unknowns.push('activeTheses');
    return '当前无活跃命題 · registry 待抓取';
  }
  pushCitation(citations, 'activeTheses.count', theses.length, 'thesis-registry');
  return theses
    .slice(0, 5)
    .map((t, i) => {
      pushCitation(citations, `activeTheses[${i}].claim`, (t.claim || '').slice(0, 80), 'thesis-registry');
      return `${i + 1}. [${t.sourceTier || 'D'}] ${t.who || ''}${(t.claim || '').slice(0, 120)}${t.falsify ? ` · 失效${t.falsify}` : ''}`;
    })
    .join('\n');
}

function answerRetailTrapQuestion(context, citations, unknowns) {
  const trap = context.instrument?.integratedSpec?.retailTrap;
  if (!trap || trap.insufficientInputs) {
    unknowns.push('retailTrap');
    return '派发区 trap 数据暂无 · 待校验 OI/phase/叙事输入';
  }
  pushCitation(citations, 'retailTrap.score', trap.score, trap.dataSource || 'retail-trap-score');
  if (trap.highTrap) {
    pushCitation(citations, 'retailTrap.highTrap', true, trap.dataSource || 'retail-trap-score');
    const comp = (trap.components || []).slice(0, 3).map((c) => c.evidence).filter(Boolean).join(' · ');
    return `派发区风险偏高 · trap=${trap.score} · ${trap.badge || '勿追'}${comp ? ` · 依据：${comp}` : ''}${trap.blockScout ? ' · scout 禁入' : ''}`;
  }
  if (trap.score != null) {
    return `派发区风险 ${trap.band || 'mid'} · trap=${trap.score}${trap.badge ? ` · ${trap.badge}` : ''} · 未达高危阈值`;
  }
  unknowns.push('retailTrap.score');
  return '派发区 trap 分数暂无';
}

function answerPainMemoryQuestion(context, citations, unknowns) {
  const pain = context.instrument?.integratedSpec?.painMemory;
  const matches = pain?.matches || [];
  if (!matches.length && !pain?.fusionLine) {
    unknowns.push('painMemory');
    return '暂无痛苦记忆匹配 · pain-memory registry 待录入或上下文未命中';
  }
  if (pain?.fusionLine) {
    pushCitation(citations, 'painMemory.fusionLine', pain.fusionLine, pain.dataSource || 'pain-memory-playbook');
  }
  const lines = matches.slice(0, 3).map((m, i) => {
    pushCitation(citations, `painMemory.matches[${i}]`, m.id, pain.dataSource || 'pain-memory-playbook');
    return `${m.id}${m.lesson ? ` · ${m.lesson}` : ''}${m.date ? ` (${m.date})` : ''}`;
  });
  const head = pain.fusionLine ? `${pain.fusionLine}。` : '';
  return `${head}${lines.length ? `匹配 ${lines.length} 条：${lines.join('；')}` : ''}`;
}

function answerBacktestQuestion(context, citations, unknowns) {
  const inst = context.instrument;
  const tg = inst?.tradingGuidance;
  const conf = tg?.confidence;
  const bt30 = fmtBacktestHitWithSample(inst?.backtestHitRate30d, inst?.backtestHits30d, inst?.backtestTotal30d);
  const parts = [];

  if (conf?.hitRate != null && conf?.n != null) {
    const line = `${Math.round(conf.hitRate * 100)}% (${conf.hits ?? '?'}/${conf.n})`;
    parts.push(`posture 回测置信 ${line}`);
    pushCitation(citations, 'tradingGuidance.confidence', line, tg.dataSource);
  } else if (conf?.level) {
    parts.push(`posture 置信等级 ${conf.level} · 样本 n 暂无`);
    pushCitation(citations, 'tradingGuidance.confidence.level', conf.level, tg.dataSource);
    unknowns.push('confidence.n');
  }

  if (bt30?.formatted) {
    parts.push(`30d 方向回测 ${bt30.formatted}`);
    pushCitation(citations, 'backtestHitRate30d', bt30.formatted, 'commodity-outlook-backtest');
    if (bt30.n == null && bt30.hits != null) unknowns.push('backtest.n');
  } else {
    unknowns.push('backtestHitRate30d');
  }

  if (!parts.length) return '回测置信暂无 · 待校验 outlook backtest 缓存';
  return parts.join(' · ');
}

function answerNoTradeQuestion(context, citations, unknowns) {
  const nt = context.noTradeDay;
  if (!nt) {
    unknowns.push('noTradeDay');
    return 'no-trade 评估暂无 · 待校验 daily brief / global risk';
  }
  pushCitation(citations, 'noTradeDay.noTradeDay', nt.noTradeDay, nt.dataSource || 'no-trade-day');
  if (nt.topLine) pushCitation(citations, 'noTradeDay.topLine', nt.topLine, nt.dataSource || 'no-trade-day');
  const reasonText = (nt.reasons || []).slice(0, 4).map((r) => r.text).join(' · ');
  if (nt.noTradeDay) {
    return `${nt.topLine || '今日系统建议：不新开仓（follow 模式）'}${reasonText ? ` · 原因：${reasonText}` : ''}`;
  }
  return `今日非 no-trade day · 可 scout 但仍受 posture/派发区/组合门禁约束${reasonText ? ` · 观测：${reasonText}` : ''}`;
}

function answerOpponentQuestion(context, citations, unknowns) {
  const opp = context.instrument?.integratedSpec?.opponentStatus;
  if (!opp?.label && opp?.noChase == null) {
    unknowns.push('opponentStatus');
    return '对手盘状态暂无 · OI/ capitulation 待校验';
  }
  pushCitation(citations, 'opponentStatus.label', opp.label, opp.dataSource || 'opponent-capitulation');
  const parts = [opp.label || '—'];
  if (opp.motto) parts.push(opp.motto);
  if (opp.noChase) parts.push('noChase · 不宜追价');
  if (opp.opponentCapitulated) parts.push('对手将竭');
  if (opp.oiTrend) parts.push(`OI ${opp.oiTrend}`);
  return `对手盘：${parts.join(' · ')}`;
}

function answerPlaybookQuestion(context, citations, unknowns) {
  const pb = context.instrument?.integratedSpec?.playbook;
  if (!pb?.id) {
    unknowns.push('playbook');
    return 'playbook 暂无 · policy-playbook 未匹配或样本不足';
  }
  pushCitation(citations, 'playbook.id', pb.id, 'playbooks.json');
  pushCitation(citations, 'playbook.stage', pb.stage, 'playbooks.json');
  const parts = [`${pb.id} · stage ${pb.stage || '—'}`];
  if (pb.narrativeZh) parts.push(pb.narrativeZh);
  if (pb.confidence) parts.push(`置信 ${pb.confidence}`);
  if (pb.n != null) {
    parts.push(`n=${pb.n}`);
    pushCitation(citations, 'playbook.n', pb.n, 'playbooks.json');
  } else if (pb.lowSample) {
    parts.push('低样本 seed');
    unknowns.push('playbook.n');
  }
  return `Playbook 阶段：${parts.join(' · ')}`;
}

function answerCoreTacticalQuestion(context, citations, unknowns) {
  const ct = context.coreTactical;
  if (!ct) {
    unknowns.push('coreTactical');
    return '三槽快钱/核心分类暂无 · 请保存持仓并刷新 Daily Brief';
  }
  pushCitation(citations, 'coreTactical.tacticalCount', ct.tacticalCount, ct.dataSource || 'core-tactical-slots');
  pushCitation(citations, 'coreTactical.coreCount', ct.coreCount, ct.dataSource || 'core-tactical-slots');
  const sym = normalizeCommodityId(context.instrument?.id);
  const slotRow = (ct.slots || []).find((s) => s.symbol && normalizeCommodityId(s.symbol) === sym);
  if (slotRow?.symbol) {
    pushCitation(citations, 'coreTactical.slot', `${slotRow.slot}:${slotRow.slotLabel}`, ct.dataSource);
  }
  const over = (ct.warnings || []).filter((w) => /快钱|tactical|O2|核心/.test(w));
  if (over.length) {
    pushCitation(citations, 'coreTactical.warnings', over.join(';'), ct.dataSource);
    return `三槽纪律告警：${over.join(' · ')} · 当前 core=${ct.coreCount} tactical=${ct.tacticalCount}`;
  }
  const instLine = slotRow?.symbol
    ? `${context.instrument?.name || sym} 占槽${slotRow.slot}（${slotRow.slotLabel}·${slotRow.posture || '暂无'}）`
    : `${context.instrument?.name || sym || '本品种'} 未在三槽持仓`;
  return `${instLine} · core=${ct.coreCount} tactical=${ct.tacticalCount} · 快钱未超标`;
}

function answerLongEntryQuestion(context, citations, unknowns) {
  const lt = context.instrument?.longTermGuidance;
  const tg = context.instrument?.tradingGuidance;
  if (!lt?.pilot) {
    unknowns.push('longTermGuidance');
    return '长线指导待校验，无法判断开仓适宜性';
  }
  const readiness = lt.entry?.readiness;
  const label = READINESS_LABELS[readiness] || readiness || '暂无';
  pushCitation(citations, 'longTermGuidance.entry.readiness', readiness, lt.dataSource);
  pushCitation(citations, 'tradingGuidance.posture', tg?.posture, tg?.dataSource);

  if (readiness === 'ready') {
    return `长线入场 readiness 为「就绪」。posture=${tg?.posture || ''}${lt.entry?.reason || ''} 建议结合止损 ${lt.stop?.hardStop ?? '待校验'} 与最短持有 ${lt.hold?.minHoldDays ?? '—'} 天。`;
  }
  if (readiness === 'approaching') {
    return `接近就绪但未完全满足${lt.entry?.reason || ''}。宜等待条件满足或缩小试仓。`;
  }
  if (readiness === 'missed') {
    return `入场窗口已错过（${lt.entry?.reason || ''}）。不宜追价开仓。`;
  }
  return `当前未就绪（${label}）：${lt.entry?.reason || '条件未满'}。posture=${tg?.posture || ''}。`;
}

function answerQuestion(question, context = {}) {
  const citations = [];
  const unknowns = [];
  const matched = matchQuestionPattern(question);

  let answer;
  let confidence = 'high';

  if (!matched || matched.type === 'unknown') {
    confidence = 'low';
    unknowns.push('questionPattern');
    answer = '暂未识别该问题模式。可点选预设 chips：posture · 回测置信 · no-trade · 派发区 · 对手盘 · playbook 等';
  } else {
    switch (matched.type) {
      case 'retailTrap':
        answer = answerRetailTrapQuestion(context, citations, unknowns);
        break;
      case 'painMemory':
        answer = answerPainMemoryQuestion(context, citations, unknowns);
        break;
      case 'backtest':
        answer = answerBacktestQuestion(context, citations, unknowns);
        break;
      case 'noTrade':
        answer = answerNoTradeQuestion(context, citations, unknowns);
        break;
      case 'opponent':
        answer = answerOpponentQuestion(context, citations, unknowns);
        break;
      case 'playbook':
        answer = answerPlaybookQuestion(context, citations, unknowns);
        break;
      case 'coreTactical':
        answer = answerCoreTacticalQuestion(context, citations, unknowns);
        break;
      case 'posture':
        answer = answerPostureQuestion(context, citations, unknowns);
        break;
      case 'entry':
        answer = answerEntryQuestion(context, citations, unknowns);
        break;
      case 'stop':
        answer = answerStopQuestion(context, citations, unknowns);
        break;
      case 'globalRisk':
        answer = answerGlobalRiskQuestion(context, citations, unknowns);
        break;
      case 'theses':
        answer = answerThesesQuestion(context, citations, unknowns);
        break;
      case 'longEntry':
        answer = answerLongEntryQuestion(context, citations, unknowns);
        break;
      default:
        confidence = 'low';
        answer = '问题类型待校验';
    }
  }

  if (unknowns.length) confidence = confidence === 'high' ? 'medium' : 'low';

  return {
    answer,
    citations,
    confidence,
    unknowns,
    dataSource: 'fancheng-ai-fusion',
    method: 'structured-synthesis',
    asOf: nowIso(),
  };
}

async function callLlmApi(systemPrompt, userPayload) {
  if (!isLlmConfigured()) return null;
  const {
    composeBoundedSystemPrompt,
    gateLlmText,
  } = require('./intel-llm-boundary');
  const url = process.env.FANCHENG_LLM_API_URL;
  const key = process.env.FANCHENG_LLM_API_KEY;
  const bounded = composeBoundedSystemPrompt('narrative_polish', systemPrompt);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.FANCHENG_LLM_MODEL || 'default',
      messages: [
        { role: 'system', content: bounded.systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(Number(process.env.FANCHENG_LLM_TIMEOUT_MS) || 30000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const text =
    data?.choices?.[0]?.message?.content ||
    data?.content ||
    data?.text ||
    null;
  if (!text) throw new Error('LLM empty response');
  const gated = gateLlmText(String(text).trim(), userPayload);
  if (!gated.used) {
    const err = new Error(`LLM boundary blocked: ${(gated.boundary?.reasons || []).join(',')}`);
    err.boundary = gated.boundary;
    throw err;
  }
  return gated.text;
}

const LLM_SYSTEM_PROMPT =
  '你是梵澄金融结构化研判助手。只根据提供的 JSON 结构化数据回答，禁止编造价格、止损或 posture。缺失字段必须说「暂无」或「待校验」。回答简洁、客观、可 falsify';

async function summarizeMacroWithLlm(macroBrief, context = {}) {
  if (!macroBrief?.summary || !isLlmConfigured()) return macroBrief;
  const structuredContext = {
    task: 'macro-narrative',
    instruction: '用2-4句中文概括宏观环境与 posture 含义；只根据 JSON 数据，缺失说「暂无」',
    macroBrief: {
      summary: macroBrief.summary,
      keyPoints: (macroBrief.keyPoints || []).map((kp) => kp.text || kp),
      risks: (macroBrief.risks || []).map((r) => r.text || r),
      actionAdvice: macroBrief.actionAdvice,
    },
    globalRisk: context.globalRisk,
    activeTheses: context.activeTheses,
  };
  try {
    const llmText = await callLlmApi(LLM_SYSTEM_PROMPT, structuredContext);
    if (!llmText) return macroBrief;
    return {
      ...macroBrief,
      summary: llmText,
      llmNarrative: llmText,
      ruleBasedSummary: macroBrief.summary,
      method: 'llm-augmented',
      asOf: nowIso(),
    };
  } catch {
    return macroBrief;
  }
}

async function answerQuestionWithLlm(question, context = {}) {
  const ruleResult = answerQuestion(question, context);
  if (!isLlmConfigured()) return ruleResult;

  const structuredContext = {
    instrument: {
      id: context.instrument?.id,
      name: context.instrument?.name,
      tradingGuidance: context.instrument?.tradingGuidance,
      longTermGuidance: context.instrument?.longTermGuidance,
      macroSynthesis: context.instrument?.macroSynthesis,
      integratedSpec: context.instrument?.integratedSpec,
      backtestHitRate30d: context.instrument?.backtestHitRate30d,
      backtestHits30d: context.instrument?.backtestHits30d,
      backtestTotal30d: context.instrument?.backtestTotal30d,
    },
    globalRisk: context.globalRisk,
    activeTheses: context.activeTheses,
    noTradeDay: context.noTradeDay,
    coreTactical: context.coreTactical,
    ruleBasedAnswer: ruleResult.answer,
    ruleCitations: ruleResult.citations,
  };

  try {
    const llmText = await callLlmApi(LLM_SYSTEM_PROMPT, { question, context: structuredContext });
    if (!llmText) return ruleResult;
    return {
      answer: llmText,
      citations: ruleResult.citations,
      confidence: ruleResult.confidence,
      unknowns: ruleResult.unknowns,
      dataSource: 'fancheng-ai-fusion',
      method: 'llm-augmented',
      asOf: nowIso(),
    };
  } catch {
    return ruleResult;
  }
}

const SLOT_LLM_SYSTEM_PROMPT =
  `${LLM_SYSTEM_PROMPT} 三槽解读任务：不得改变或建议变更 posture，仅解释现有持仓与空槽；命中率须保留样本 n；研究池未持仓品种须说明为何不碰。`;

const DAILY_BRIEF_LLM_SYSTEM_PROMPT =
  `${LLM_SYSTEM_PROMPT} 晨间简报三答任务：你是姜总长线顾问。根据 JSON 写 3-5 段连贯晨间简报，覆盖「发生了什么 / 怎么了 / 为什么」，顾问口吻、可 falsify。禁止编造价格、posture 或命中率；缺失写「暂无」；回测须保留 (hits/n) 格式；不得引入 JSON 外的新数值。`;

function buildDailyBriefCitations(payload = {}, citations = []) {
  pushCitation(citations, 'threeAnswers.happened', payload.threeAnswers?.happened, 'daily-brief-synthesis');
  pushCitation(citations, 'threeAnswers.soWhat', payload.threeAnswers?.soWhat, 'daily-brief-synthesis');
  pushCitation(citations, 'threeAnswers.why', payload.threeAnswers?.why, 'daily-brief-synthesis');
  pushCitation(citations, 'backtestSummaryLine', payload.backtestSummaryLine, 'commodity-outlook-backtest');
  pushCitation(citations, 'factorLine', payload.factorLine, 'retail-hf-strategy');
  pushCitation(citations, 'followAdvice', payload.followAdvice, 'retail-hf-strategy');
  pushCitation(citations, 'counterThesis.summary', payload.counterThesis?.summary, 'fancheng-ai-fusion');
  if (payload.masterClock?.summaryThreeLines?.length) {
    pushCitation(
      citations,
      'masterClock.summaryThreeLines',
      payload.masterClock.summaryThreeLines.join(' | '),
      'macro-master-clock'
    );
  }
  if (payload.noTradeDay?.noTradeDay) {
    pushCitation(
      citations,
      'noTradeDay.topLine',
      payload.noTradeDay.topLine || payload.noTradeDay.suggestion,
      'no-trade-day'
    );
  }
  for (const t of (payload.top5 || []).slice(0, 3)) {
    pushCitation(
      citations,
      `top5.${t.rank}`,
      `${t.name} score=${t.priorityScore ?? '—'} R${t.regime} ${t.posture}`,
      'multi-dimensional-scoring'
    );
  }
  return citations;
}

async function summarizeDailyBriefWithLlm(payload) {
  if (!payload?.threeAnswers || !isLlmConfigured()) return null;

  const citations = buildDailyBriefCitations(payload, []);

  const structuredContext = {
    task: 'daily-brief-three-answers-narrative',
    instruction:
      '用 3-5 段中文晨间简报，连贯覆盖「发生了什么」「怎么了」「为什么」。顾问口吻。只根据 JSON，缺失写「暂无」。回测须保留 (hits/n)。',
    payload,
    ruleBasedThreeAnswers: payload.threeAnswers,
  };

  try {
    const llmText = await callLlmApi(DAILY_BRIEF_LLM_SYSTEM_PROMPT, structuredContext);
    if (!llmText) return null;
    return {
      llmNarrative: llmText,
      method: 'llm-augmented',
      citations,
      dataSource: 'fancheng-ai-fusion',
      asOf: nowIso(),
    };
  } catch {
    return null;
  }
}

function describeHeldSlot(slot) {
  const parts = [`槽${slot.slot} ${slot.name}（${slot.slotLabel || '—'}·posture ${slot.posture}）`];
  if (slot.regime) parts.push(`R${slot.regime}${slot.regimeLabel ? ` ${slot.regimeLabel}` : ''}`);
  if (slot.playbook?.id) parts.push(`${slot.playbook.id}${slot.playbook.stage ? `·${slot.playbook.stage}` : ''}`);
  if (slot.backtestHitRate30d?.formatted) parts.push(`回测30d ${slot.backtestHitRate30d.formatted}`);
  else parts.push('回测30d 暂无');
  if (slot.opponent?.label) parts.push(`对手盘 ${slot.opponent.label}`);
  if (slot.trap?.highTrap) parts.push(`零售陷阱 ${(slot.trap.badge || slot.trap.score) ?? '—'}`);
  if (slot.whySelected?.top5Rank) parts.push(`研究池 Top${slot.whySelected.top5Rank}`);
  if (slot.holdWarn) parts.push(slot.holdWarn);
  return parts.join(' · ');
}

function describeNotHeldSuggestion(sug, emptySlots, portfolioGate) {
  if (sug.notHeldReason === 'already-held') return null;
  const name = sug.name || sug.symbol;
  if (sug.notHeldReason === 'no-trade-day') {
    return `${name} 在 Top${sug.rank || '—'} 但今日 no-trade · 不新开`;
  }
  if (sug.notHeldReason && String(sug.notHeldReason).startsWith('posture-')) {
    return `${name} posture ${sug.posture} · 非 scout 放行`;
  }
  if (portfolioGate?.capNewScout) {
    return `${name} 研究池优先但门禁 ${portfolioGate.capReason || '收紧'} · 暂不碰`;
  }
  if (emptySlots?.slotsFree > 0 && sug.posture !== '试仓' && sug.posture !== '持有') {
    return `${name} score ${sug.priorityScore ?? '—'} 但 posture ${sug.posture} · 观望`;
  }
  return `${name} Top${sug.rank || '—'} · R${sug.regime || '—'} · 未入槽（纪律优先现有持仓）`;
}

function buildSlotDecisionBriefRule(context = {}) {
  const citations = [];
  const sentences = [];

  const clockLine =
    context.masterClock?.summaryThreeLines?.slice(0, 2).join(' · ') ||
    (context.globalRisk?.tier
      ? `全球 ${context.globalRisk.tier} · regime ${context.globalRisk.regime || 'normal'}`
      : null);
  if (clockLine) {
    sentences.push(`宏观环境：${clockLine}。`);
    pushCitation(citations, 'masterClock', clockLine, 'macro-master-clock');
  }

  const gate = context.portfolioGate || {};
  const filled = (context.slots || []).filter((s) => !s.empty);
  const empty = (context.slots || []).filter((s) => s.empty);

  if (filled.length) {
    const heldDesc = filled.map(describeHeldSlot).join('；');
    sentences.push(`当前 ${filled.length}/${gate.maxPositions || 3} 槽已用：${heldDesc}。`);
    pushCitation(
      citations,
      'coreTactical.slots',
      filled.map((s) => s.instrumentId).join(','),
      'core-tactical-slots'
    );
  } else {
    sentences.push('当前三槽空仓 · 仅研究池与门禁约束可开仓。');
    pushCitation(citations, 'portfolioGate.slotsUsed', 0, 'portfolio-gate');
  }

  if (empty.length) {
    const noTrade = context.emptySlots?.noTradeDay?.noTradeDay;
    if (noTrade) {
      sentences.push(
        `余 ${empty.length} 空槽但 ${context.emptySlots.noTradeDay.topLine || '今日 no-trade day · 系统建议不新开仓'}。`
      );
      pushCitation(citations, 'noTradeDay', true, 'no-trade-day');
    } else if (gate.capNewScout) {
      sentences.push(`余 ${empty.length} 空槽未 scout：${gate.capReason || '组合门禁收紧'}。`);
      pushCitation(citations, 'portfolioGate.capReason', gate.capReason, 'portfolio-gate');
    } else {
      const sugLine = (context.emptySlots?.suggestions || [])
        .slice(0, 3)
        .map((s) => `${s.name || s.symbol}（R${s.regime || '—'}·score ${s.priorityScore ?? '—'}·${s.posture || '暂无'}）`)
        .join('、');
      sentences.push(`余 ${empty.length} 空槽可 scout：${sugLine || '研究池待校验'}。`);
      pushCitation(citations, 'emptySlots.suggestions', sugLine, 'daily-brief-synthesis');
    }
  }

  const notHeldLines = (context.emptySlots?.suggestions || [])
    .map((s) => describeNotHeldSuggestion(s, context.emptySlots, gate))
    .filter(Boolean)
    .slice(0, 2);
  if (notHeldLines.length) {
    sentences.push(`未入槽品种：${notHeldLines.join('；')}。`);
    pushCitation(citations, 'researchPool.notHeld', notHeldLines.join(';'), 'research-pool');
  }

  if (context.followAdvice) {
    sentences.push(`机构跟随：${context.followAdvice}。`);
    pushCitation(citations, 'followAdvice', context.followAdvice, 'retail-hf-strategy');
  }

  if (context.coreTactical?.warnings?.length) {
    sentences.push(`槽型纪律：${context.coreTactical.warnings.join(' · ')}。`);
    pushCitation(citations, 'coreTactical.warnings', context.coreTactical.warnings.join(';'), 'core-tactical-slots');
  }

  const narrative =
    sentences.slice(0, 6).join('') ||
    '三槽解读待校验 · 请保存持仓并刷新 Daily Brief。';

  return {
    narrative,
    citations,
    method: 'structured-synthesis',
    dataSource: 'fancheng-ai-fusion',
    asOf: nowIso(),
  };
}

async function explainPortfolioSlotsWithLlm(context = {}) {
  const ruleResult = buildSlotDecisionBriefRule(context);
  if (!isLlmConfigured()) {
    return { ...ruleResult, ruleBasedNarrative: ruleResult.narrative };
  }

  const structuredContext = {
    task: 'slot-decision-narrative',
    instruction:
      '用4-6句中文解释三槽为何持有/为何空置/为何不碰研究池其他品种。只根据 JSON，禁止编造价格或覆盖 posture。缺失说「暂无」。命中率须带 n。',
    context,
    ruleBasedNarrative: ruleResult.narrative,
  };

  try {
    const llmText = await callLlmApi(SLOT_LLM_SYSTEM_PROMPT, structuredContext);
    if (!llmText) return { ...ruleResult, ruleBasedNarrative: ruleResult.narrative };
    return {
      narrative: llmText,
      citations: ruleResult.citations,
      method: 'llm-augmented',
      ruleBasedNarrative: ruleResult.narrative,
      dataSource: 'fancheng-ai-fusion',
      asOf: nowIso(),
    };
  } catch {
    return { ...ruleResult, ruleBasedNarrative: ruleResult.narrative };
  }
}

async function buildSlotDecisionBrief(outlookPayload = {}, holdings = [], brief = {}) {
  const { buildSlotDecisionContext } = require('./core-tactical-slots');
  const context = buildSlotDecisionContext(outlookPayload, holdings, brief);
  return explainPortfolioSlotsWithLlm(context);
}

function attachInstrumentAiFusion(inst, globalRisk, macroContext = {}) {
  try {
    const instrumentBrief = buildInstrumentBrief(inst, { globalRisk, ...macroContext });
    return {
      instrumentBrief,
      counterThesis: instrumentBrief.counterThesis,
      asOf: instrumentBrief.asOf,
    };
  } catch {
    return null;
  }
}

module.exports = {
  FUSION_VERSION,
  PRESET_CHIPS,
  getHubPresetChips,
  getDetailPresetChips,
  getDetailPresetChipsByGroup,
  extractMacroHydrateSnippets,
  buildInstrumentBrief,
  buildMacroBrief,
  buildCounterThesis,
  answerQuestion,
  answerQuestionWithLlm,
  summarizeMacroWithLlm,
  summarizeDailyBriefWithLlm,
  isLlmConfigured,
  attachInstrumentAiFusion,
  matchQuestionPattern,
  buildSlotDecisionBriefRule,
  explainPortfolioSlotsWithLlm,
  buildSlotDecisionBrief,
  callLlmApi,
};
