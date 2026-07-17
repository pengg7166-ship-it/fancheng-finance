/**

 * Integrated spec v1.43 'attach regime/playbook/W/D/scoring + advanced gates

 */

const { classifyRegime } = require('./commodity-regime-classifier');

const { computeDivergence, detectPlaybookWithOverlays } = require('./policy-playbook-engine');

const { deriveWatchLevel, getPoolStatus, seedPoolIfEmpty } = require('./research-pool');

const { computeExpectationGap } = require('./expectation-gap');

const { computePriorityScore } = require('./multi-dimensional-scoring');

const { applyPortfolioGateToPosture, applyClusterGateFromPortfolio } = require('./portfolio-gate');

const { detectSlippageTier } = require('./slippage-detector');

const { computeTermStructureBias } = require('./term-structure-bias');

const { computeSeasonalityHint } = require('./seasonality-hints');

const { computeGeoNarrativeDecay } = require('./geo-narrative-decay');

const { evaluateIndustryProfit } = require('./industry-profit-proxy');

const { evaluateHardPolicy } = require('./exchange-hard-policy');

const outlookTradingGuidance = require('./outlook-trading-guidance');



const { runPlaybookDecisionTree } = require('./playbook-decision-tree');
const { buildPreMortem } = require('./pre-mortem-gate');
const { buildRetailHfForInstrument, buildFactorExposure } = require('./retail-hf-strategy');
const { computeEventDecayForInstrument } = require('./event-decay');
const { buildCarryRollHint } = require('./term-structure-bias');
const { computeRetailTrapScore } = require('./retail-trap-score');
const { matchPainEntries, buildPainFusionLine } = require('./pain-memory-playbook');

const INTEGRATED_VERSION = 'v1.47.0-retail-discipline';

const PHASE_COLD_WEEKS_DOWNGRADE = 3;

const O2_MAX_HOLD_DAYS = 5;



function nowIso() {

  return new Date().toISOString();

}



function buildIntegratedSpec(inst, context = {}) {

  seedPoolIfEmpty();

  const tg = context.tradingGuidance || inst.tradingGuidance;

  const regime = classifyRegime(inst.id, { inst, ...context });

  const slippage = detectSlippageTier(inst, context);

  const divergence = computeDivergence(inst, { ...context, tradingGuidance: tg });

  const hardPolicy = evaluateHardPolicy(inst.id, { newsPool: context.newsPool || context.policyNews });

  const expectationGap = computeExpectationGap(inst, { tradingGuidance: tg, activeTheses: context.activeTheses });

  const playbookBundle = detectPlaybookWithOverlays({
    inst,
    tradingGuidance: tg,
    divergence,
    slippage,
    hardPolicy,
    expectationGap,
    globalRisk: context.globalRisk,
    ...context,
  });

  const playbook = playbookBundle.primary || playbookBundle.historical;

  const opponentStatus = playbookBundle.opponentStatus;

  const squeezeStage = playbookBundle.squeezeStage;

  const liqCrisis = playbookBundle.liqCrisis;

  const termStructure = computeTermStructureBias(inst.id, context);

  const seasonality = computeSeasonalityHint(inst.id, context);

  const geoDecay = computeGeoNarrativeDecay(inst, context);

  const industryProfit = evaluateIndustryProfit(inst.id, context);

  const playbookDecisionTree = runPlaybookDecisionTree(inst, {
    tradingGuidance: tg,
    divergence,
    expectationGap,
    hardPolicy,
    opponentStatus,
    squeezeStage,
    liqCrisis,
    globalRisk: context.globalRisk,
    activeTheses: context.activeTheses,
    ...context,
  });

  const scoring = computePriorityScore(inst, {

    tradingGuidance: tg,

    regime,

    divergence,

    playbook,

    expectationGap,

    slippage,

    seasonality,

  });

  const watchLevel = deriveWatchLevel(

    { ...inst, integratedSpec: { expectationGap } },

    { tradingGuidance: inst.tradingGuidance || tg, longTermGuidance: inst.longTermGuidance, expectationGap }

  );

  const poolStatus = getPoolStatus(inst.id);



  const logicChain = [

    ...(scoring.playbook?.logicChain || []),

    {

      layer: 'Regime',

      conclusion: regime.regime,

      evidence: regime.reasons?.join(' · ') || regime.label,

      dataSource: regime.dataSource,

      asOf: regime.asOf,

    },

    {

      layer: 'Watch',

      conclusion: watchLevel,

      evidence: poolStatus.inPool ? `pool · ${poolStatus.note || poolStatus.trigger || ''}` : 'derived',

      dataSource: 'research-pool',

      asOf: nowIso(),

    },

    {

      layer: 'Divergence',

      conclusion: divergence.level,

      evidence: divergence.evidence?.join(' · ') || divergence.label,

      dataSource: divergence.dataSource,

      asOf: divergence.asOf,

    },

  ];



  if (slippage?.flag) {

    logicChain.push({

      layer: 'Slippage',

      conclusion: slippage.tier,

      evidence: slippage.flag,

      dataSource: slippage.dataSource,

      asOf: slippage.asOf,

    });

  }

  if (expectationGap?.pricedInDegree?.degree) {

    logicChain.push({

      layer: 'PricedIn',

      conclusion: expectationGap.pricedInDegree.degree,

      evidence: `score=${expectationGap.pricedInDegree.score ?? '—'}`,

      dataSource: 'expectation-gap',

      asOf: expectationGap.asOf,

    });

  }

  if (hardPolicy?.hasHard) {

    logicChain.push({

      layer: 'HardPolicy',

      conclusion: 'W2-boost',

      evidence: hardPolicy.note || '交易所硬性政',

      dataSource: hardPolicy.dataSource,

      asOf: hardPolicy.asOf,

    });

  }

  if (opponentStatus?.label) {

    logicChain.push({

      layer: 'Opponent',

      conclusion: opponentStatus.opponentSide || opponentStatus.status,

      evidence: (opponentStatus.evidence || []).slice(0, 2).join(' · ') || opponentStatus.label,

      dataSource: opponentStatus.dataSource,

      asOf: opponentStatus.asOf,

    });

  }

  if (squeezeStage?.stage) {

    logicChain.push({

      layer: 'Squeeze',

      conclusion: squeezeStage.stage,

      evidence: (squeezeStage.evidence || []).join(' · '),

      dataSource: squeezeStage.dataSource,

      asOf: squeezeStage.asOf,

    });

  }

  if (liqCrisis?.active) {

    logicChain.push({

      layer: 'LiqCrisis',

      conclusion: liqCrisis.stage,

      evidence: (liqCrisis.evidence || []).join(' · '),

      dataSource: liqCrisis.dataSource,

      asOf: liqCrisis.asOf,

    });

  }

  const eventDecay = computeEventDecayForInstrument(inst, { poolStatus, hardPolicy, geoDecay: geoDecay });
  const carryRoll = buildCarryRollHint(inst.id, context);
  const retailTrap = computeRetailTrapScore(inst, {
    integratedSpec: { regime, divergence, playbook, expectationGap, slippage, hardPolicy, opponentStatus, squeezeStage, liqCrisis, geoDecay },
    tradingGuidance: tg,
  });
  const painMatches = matchPainEntries({ ...inst, integratedSpec: { regime, divergence, playbook, expectationGap, retailTrap } });
  const painFusionLine = buildPainFusionLine(painMatches);
  const preMortem = buildPreMortem(inst, {
    integratedSpec: { regime, divergence, playbook, expectationGap, slippage, hardPolicy, opponentStatus, squeezeStage, liqCrisis, retailTrap },
    tradingGuidance: tg,
    globalRisk: context.globalRisk,
    squeezeStage,
    opponentStatus,
    retailTrap,
    ...context,
  });
  const retailHf = buildRetailHfForInstrument(inst, {
    integratedSpec: { regime, divergence, playbook, expectationGap, slippage, hardPolicy, opponentStatus, squeezeStage, liqCrisis, poolStatus },
    tradingGuidance: tg,
    globalRisk: context.globalRisk,
    factorExposure: context.factorExposure,
    eventDecayBadge: eventDecay.badge,
  });

  if (eventDecay.badge) {
    logicChain.push({
      layer: 'EventDecay',
      conclusion: eventDecay.badge,
      evidence: (eventDecay.evidence || []).slice(0, 2).join(' · '),
      dataSource: eventDecay.dataSource,
      asOf: eventDecay.asOf,
    });
  }

  if (retailHf.ruleViolations?.count) {
    logicChain.push({
      layer: 'RetailHF',
      conclusion: '规则偏离',
      evidence: retailHf.ruleViolations.violations.map((v) => v.rule).join(' · '),
      dataSource: 'retail-hf-strategy',
      asOf: retailHf.asOf,
    });
  }

  if (retailTrap.logicChain?.length) {
    logicChain.push(...retailTrap.logicChain);
  }

  if (painMatches.length) {
    logicChain.push({
      layer: 'PainMemory',
      conclusion: painMatches[0].id,
      evidence: painFusionLine || painMatches[0].lesson,
      dataSource: 'pain-memory-playbook',
      asOf: nowIso(),
    });
  }



  return {

    version: INTEGRATED_VERSION,

    regime,

    slippage,

    divergence,

    playbook,

    expectationGap,

    termStructure,

    seasonality,

    geoDecay,

    industryProfit,

    hardPolicy,

    opponentStatus,

    squeezeStage,

    liqCrisis,

    universalPlaybooks: playbookBundle.universal || [],

    playbookDecisionTree,

    preMortem,

    eventDecay,

    carryRoll,

    retailHf,

    retailTrap,

    painMemory: {
      matches: painMatches,
      fusionLine: painFusionLine,
      dataSource: 'pain-memory-playbook',
      version: require('./pain-memory-playbook').PAIN_VERSION,
    },

    primaryPlaybookBadge: playbookDecisionTree.badge,

    priorityScore: scoring.priorityScore,

    regimeTags: scoring.regimeTags,

    dimensions: scoring.dimensions,

    playbookMatch: scoring.playbookMatch,

    watchLevel,

    watchLabel: require('./research-pool').WATCH_LEVELS[watchLevel]?.label || watchLevel,

    poolStatus,

    eventDrivenUnverified: watchLevel === 'W2',

    overshootBounce: watchLevel === 'O2',

    o2ExitRules: watchLevel === 'O2' ? { maxHoldDays: O2_MAX_HOLD_DAYS, ceiling: 'below-prior-high', mandatory: '不恋' } : null,

    logicChain,

    dataSource: 'integrated-spec-attach',

    method: 'regime+playbook+W+D+score+retail-hf+trap+pain-v147',

    asOf: nowIso(),

  };

}



function applyIntegratedPostureAdjustments(inst, context = {}) {

  const tg = inst.tradingGuidance;

  if (!tg) return inst;



  const spec = inst.integratedSpec || buildIntegratedSpec(inst, context);

  const logicChain = [...(tg.logicChain || [])];

  let posture = tg.posture;



  if (spec.divergence?.closeNewScout && posture === '试仓') {

    const held = (context.portfolioGate?.holdings || []).includes(String(inst.id).toLowerCase());

    if (!held) {

      logicChain.push({

        layer: 'DivergenceGate',

        conclusion: '观望',

        evidence: `${spec.divergence.level} · 关闭'scout`,

        dataSource: 'policy-playbook-engine',

        asOf: nowIso(),

      });

      posture = '观望';

    }

  }



  if (spec.watchLevel === 'W2' && posture === '试仓' && !spec.poolStatus?.scoutAllowed) {

    logicChain.push({

      layer: 'WatchW2',

      conclusion: posture,

      evidence: 'W2 允许 tiny scout · event-driven unverified 标记',

      dataSource: 'research-pool',

      asOf: nowIso(),

    });

  }



  if (spec.watchLevel === 'O2') {

    if (posture === '加仓' || posture === '持有') {

      logicChain.push({

        layer: 'O2Bounce',

        conclusion: '试仓',

        evidence: 'O2 二次反弹·快钱 · micro scout only · 不恋',

        dataSource: 'integrated-spec-attach',

        asOf: nowIso(),

      });

      posture = '试仓';

    } else if (posture === '试仓') {

      logicChain.push({

        layer: 'O2Bounce',

        conclusion: posture,

        evidence: `O2 micro scout · max ${O2_MAX_HOLD_DAYS}d · ceiling=前高`,

        dataSource: 'integrated-spec-attach',

        asOf: nowIso(),

      });

    }

  }



  if (context.portfolioGate) {

    posture = applyPortfolioGateToPosture(posture, inst.id, context.portfolioGate, logicChain);

    posture = applyClusterGateFromPortfolio(posture, inst.id, context.portfolioGate, logicChain);

  }



  if (context.macroMasterClock?.postureCap && ['试仓', '加仓'].includes(posture)) {

    const cap = context.macroMasterClock.postureCap;

    posture = outlookTradingGuidance.minPosture?.(posture, cap) ?? (cap === '观望' ? '观望' : posture);

    logicChain.push({

      layer: 'MasterClock',

      conclusion: posture,

      evidence: `宏观时钟冲突 · cap=${cap}`,

      dataSource: 'macro-master-clock',

      asOf: context.macroMasterClock.asOf || nowIso(),

    });

  }



  const tier = context.globalRisk?.tier || context.globalRisk?.liquidityShockTier;

  if ((tier === 'L2' || tier === 'L3') && ['试仓', '加仓'].includes(posture)) {

    const cap = outlookTradingGuidance.resolvePostureCap?.(inst.id, context.globalRisk);

    if (cap?.cap) {

      posture = outlookTradingGuidance.minPosture(posture, cap.cap);

    }

  }



  if (spec.regime?.regime === 'D' || spec.slippage?.tier === 'severe') {

    if (['试仓', '加仓'].includes(posture)) {

      logicChain.push({

        layer: 'SlippageGate',

        conclusion: '试仓',

        evidence: spec.slippage?.flag || 'Regime D · scout cap',

        dataSource: 'slippage-detector',

        asOf: spec.slippage?.asOf || nowIso(),

      });

      if (posture === '加仓') posture = '试仓';

    }

  }



  if (spec.slippage?.postureCap && ['试仓', '加仓'].includes(posture)) {

    posture = outlookTradingGuidance.minPosture?.(posture, spec.slippage.postureCap) ?? posture;

  }



  if (spec.industryProfit?.gateW3 && spec.watchLevel === 'W3' && posture === '试仓') {

    logicChain.push({

      layer: 'IndustryProfit',

      conclusion: '观望',

      evidence: spec.industryProfit.evidence?.join(' · ') || '利润待校',

      dataSource: 'industry-profit-proxy',

      asOf: spec.industryProfit.asOf,

    });

    posture = '观望';

  }



  if (spec.seasonality?.inverseCap && ['试仓', '加仓'].includes(posture)) {

    logicChain.push({

      layer: 'Seasonality',

      conclusion: '观望',

      evidence: spec.seasonality.evidence?.join(' · ') || '逆季 cap',

      dataSource: 'seasonality-hints',

      asOf: spec.seasonality.asOf,

    });

    posture = '观望';

  }



  if (spec.expectationGap?.gap === 'overshoot' && ['持有', '加仓', '试仓'].includes(posture) && spec.watchLevel !== 'O2') {

    if (!spec.opponentStatus?.blockReduceLongOnHighPrice) {

      logicChain.push({

        layer: 'Overshoot',

        conclusion: '减仓',

        evidence: spec.expectationGap.evidence?.join(' · ') || 'narrative overshoot',

        dataSource: 'expectation-gap',

        asOf: nowIso(),

      });

      if (postureRank(posture) > postureRank('减仓')) posture = '减仓';

    } else {

      logicChain.push({

        layer: 'OpponentGate',

        conclusion: posture,

        evidence: '空头未死 · 勿仅因价高减多',

        dataSource: 'opponent-capitulation',

        asOf: spec.opponentStatus?.asOf || nowIso(),

      });

    }

  }



  if (spec.opponentStatus?.noChase && ['加仓', '试仓'].includes(posture)) {

    logicChain.push({

      layer: 'OpponentGate',

      conclusion: '观望',

      evidence: spec.opponentStatus.label || '对手盘已竭 · 不追',

      dataSource: 'opponent-capitulation',

      asOf: spec.opponentStatus.asOf || nowIso(),

    });

    posture = outlookTradingGuidance.minPosture?.(posture, spec.opponentStatus.postureCap || '观望') ?? '观望';

  } else if (spec.opponentStatus?.postureCap && ['加仓', '试仓', '持有'].includes(posture)) {

    posture = outlookTradingGuidance.minPosture?.(posture, spec.opponentStatus.postureCap) ?? posture;

    logicChain.push({

      layer: 'OpponentGate',

      conclusion: posture,

      evidence: spec.opponentStatus.label || '对手盘 posture cap',

      dataSource: 'opponent-capitulation',

      asOf: spec.opponentStatus.asOf || nowIso(),

    });

  }



  if (spec.squeezeStage?.closeNewScout && ['试仓', '加仓'].includes(posture)) {

    const held = (context.portfolioGate?.holdings || []).includes(String(inst.id).toLowerCase());

    if (!held) {

      logicChain.push({

        layer: 'SqueezeGate',

        conclusion: '观望',

        evidence: `PB-SQUEEZE ${spec.squeezeStage.stage} · 禁新 scout · 滑点`,

        dataSource: 'policy-playbook-engine',

        asOf: spec.squeezeStage.asOf || nowIso(),

      });

      posture = '观望';

    }

  }



  if (spec.liqCrisis?.active && ['试仓', '加仓', '持有'].includes(posture)) {

    logicChain.push({

      layer: 'LiqCrisisGate',

      conclusion: '禁止',

      evidence: `PB-LIQ-CRISIS ${spec.liqCrisis.stage} · L3 覆盖`,

      dataSource: 'global-liquidity-risk',

      asOf: spec.liqCrisis.asOf || nowIso(),

    });

    posture = '禁止';

  }

  if (spec.retailTrap?.highTrap && ['试仓', '加仓'].includes(posture)) {
    logicChain.push({
      layer: 'RetailTrap',
      conclusion: '观望',
      evidence: spec.retailTrap.badge || `trap=${spec.retailTrap.score}`,
      dataSource: 'retail-trap-score',
      asOf: spec.retailTrap.asOf || nowIso(),
    });
    posture = '观望';
  } else if (spec.retailTrap?.highTrap && posture === '持有') {
    logicChain.push({
      layer: 'RetailTrap',
      conclusion: '减仓',
      evidence: '派发区·勿追 · 持有者减',
      dataSource: 'retail-trap-score',
      asOf: spec.retailTrap.asOf || nowIso(),
    });
    if (postureRank(posture) > postureRank('减仓')) posture = '减仓';
  }

  try {
    const { applyReentryCooldownToPosture } = require('./re-entry-cooldown');
    posture = applyReentryCooldownToPosture(posture, inst.id, { inst, integratedSpec: spec, ...context }, logicChain);
  } catch {
    // non-fatal
  }



  return {

    ...inst,

    integratedSpec: spec,

    tradingGuidance: {

      ...tg,

      posture,

      integratedWatchLevel: spec.watchLevel,

      integratedDivergence: spec.divergence?.level,

      integratedPlaybook: spec.playbook?.id || null,

      integratedRegime: spec.regime?.regime,

      logicChain,

    },

  };

}



function postureRank(p) {

  return outlookTradingGuidance.postureRank?.(p) ?? 1;

}



function applyPhaseTimeStopDowngrade(inst, context = {}) {

  const lt = inst.longTermGuidance;

  const tg = inst.tradingGuidance;

  if (!lt?.pilot || !tg) return inst;



  const phase = tg.phase;

  const posture = tg.posture;

  if (!['持有', '试仓', '加仓'].includes(posture) || phase !== '冷淡') return inst;



  const weeksCold = context.weeksInColdPhase ?? PHASE_COLD_WEEKS_DOWNGRADE;

  const logicChain = [...(lt.logicChain || []), ...(lt.stop?.logicChain || [])];

  logicChain.push({

    layer: 'TimeStop',

    conclusion: 'downgrade',

    evidence: `phase=冷淡 持续 '{weeksCold} '· 建议降档`,

    dataSource: 'long-term-trading-guidance:time-stop',

    asOf: nowIso(),

  });



  return {

    ...inst,

    longTermGuidance: {

      ...lt,

      entry: {

        ...lt.entry,

        readiness: lt.entry?.readiness === 'ready' ? 'approaching' : lt.entry?.readiness,

        reason: `time-stop · phase 冷淡 ${weeksCold}w`,

      },

      timeStop: { weeksCold, triggered: true, dataSource: 'integrated-spec', asOf: nowIso() },

      logicChain,

    },

    tradingGuidance: {

      ...tg,

      posture: postureRank(tg.posture) > postureRank('观望') ? '观望' : tg.posture,

      logicChain: [

        ...(tg.logicChain || []),

        {

          layer: 'TimeStop',

          conclusion: '观望',

          evidence: `长线 time-stop · phase 冷淡`,

          dataSource: 'integrated-spec-attach',

          asOf: nowIso(),

        },

      ],

    },

  };

}



function attachIntegratedSpec(inst, context = {}) {

  if (!inst?.id) return inst;

  let out = { ...inst };

  out.integratedSpec = buildIntegratedSpec(out, context);

  if (out.tradingGuidance?.pilot !== false && out.tradingGuidance) {

    out = applyIntegratedPostureAdjustments(out, context);

  } else if (!out.tradingGuidance || out.tradingGuidance.pilot === false) {

    out.integratedSpec = buildIntegratedSpec(out, context);

  }

  if (outlookTradingGuidance.isPilotSymbol(out.id) && out.longTermGuidance?.pilot) {

    out = applyPhaseTimeStopDowngrade(out, context);

  }

  return out;

}



function attachIntegratedSpecBatch(instruments, context = {}) {

  const { computePortfolioGate } = require('./portfolio-gate');

  let macroMasterClock = context.macroMasterClock;

  if (!macroMasterClock) {

    try {

      const { computeMacroMasterClock } = require('./macro-master-clock');

      macroMasterClock = computeMacroMasterClock(context);

    } catch {

      macroMasterClock = null;

    }

  }

  const gate = context.portfolioGate || computePortfolioGate(context.holdings || [], instruments, {
    globalRisk: context.globalRisk,
    liqCrisis: context.globalRisk?.tier === 'L3',
    masterClock: macroMasterClock,
  });

  const factorExposure = buildFactorExposure(context.holdings || [], instruments, { masterClock: macroMasterClock });

  const batchContext = { ...context, portfolioGate: gate, macroMasterClock, factorExposure };

  const patched = instruments.map((inst) => attachIntegratedSpec(inst, batchContext));

  try {

    const { evaluateAutoPoolTriggers } = require('./research-pool-auto-trigger');

    evaluateAutoPoolTriggers({

      instruments: patched,

      holdings: context.holdings || [],

      policyNews: context.policyNews,

      newsPool: context.newsPool,

    });

  } catch (err) {

    console.warn('[integrated-spec-attach] auto pool trigger skipped:', err?.message || err);

  }

  return patched;

}



module.exports = {

  INTEGRATED_VERSION,

  PHASE_COLD_WEEKS_DOWNGRADE,

  O2_MAX_HOLD_DAYS,

  buildIntegratedSpec,

  attachIntegratedSpec,

  attachIntegratedSpecBatch,

  applyIntegratedPostureAdjustments,

  applyPhaseTimeStopDowngrade,

};

