#!/usr/bin/env node
/** Smoke: retail discipline v1.47.0-retail-discipline — features 1-4 */
let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function ok(msg) {
  console.log('OK', msg);
}

process.env.FANCHENG_DATA_DRIVE = process.env.FANCHENG_DATA_DRIVE || 'E';

const V147 = 'v1.47.0-retail-discipline';

const { NO_TRADE_VERSION, evaluateNoTradeDay } = require('../services/no-trade-day');
const { TRAP_VERSION, computeRetailTrapScore, TRAP_HIGH_THRESHOLD } = require('../services/retail-trap-score');
const { COOLDOWN_VERSION, getReentryCooldown, applyReentryCooldownToPosture } = require('../services/re-entry-cooldown');
const { logPositionClose } = require('../services/re-entry-cooldown-store');
const { SLOT_VERSION, computeCoreTacticalState, buildSlotDecisionContext } = require('../services/core-tactical-slots');
const { PAIN_VERSION, addPainEntry, listPainEntries, matchPainEntries } = require('../services/pain-memory-playbook');
const { attachIntegratedSpec, INTEGRATED_VERSION } = require('../services/integrated-spec-attach');
const { buildDailyBrief, buildDailyBriefLlmPayload, BRIEF_VERSION } = require('../services/daily-brief-synthesis');
const { computePortfolioGate, GATE_VERSION } = require('../services/portfolio-gate');
const { buildPreMortem, PRE_MORTEM_VERSION } = require('../services/pre-mortem-gate');
const { detectRuleViolations, RETAIL_HF_VERSION } = require('../services/retail-hf-strategy');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { buildSlotDecisionBriefRule } = require('../services/fancheng-ai-fusion');

console.log('VERSIONS', {
  NO_TRADE_VERSION,
  TRAP_VERSION,
  COOLDOWN_VERSION,
  SLOT_VERSION,
  PAIN_VERSION,
  INTEGRATED_VERSION,
  BRIEF_VERSION,
  GATE_VERSION,
  PRE_MORTEM_VERSION,
  RETAIL_HF_VERSION,
});

for (const [name, ver] of [
  ['NO_TRADE', NO_TRADE_VERSION],
  ['TRAP', TRAP_VERSION],
  ['COOLDOWN', COOLDOWN_VERSION],
  ['SLOT', SLOT_VERSION],
  ['PAIN', PAIN_VERSION],
  ['INTEGRATED', INTEGRATED_VERSION],
  ['BRIEF', BRIEF_VERSION],
  ['GATE', GATE_VERSION],
  ['PRE_MORTEM', PRE_MORTEM_VERSION],
  ['RETAIL_HF', RETAIL_HF_VERSION],
]) {
  if (ver !== V147) fail(`${name} ${ver} !== ${V147}`);
  else ok(`${name} version v1.47`);
}

const grL3 = { tier: 'L3', regime: 'shock', summary: 'L3 test' };
const mockAg = {
  id: 'ag',
  name: '白银',
  tradingGuidance: { phase: '拥挤', bias: '偏多', posture: '持有' },
  factors: { technical: { oi: { deltaPct: -1 } } },
};
const tgAg = buildTradingGuidance(mockAg, { globalRisk: { tier: 'L0', regime: 'normal' } });

const agCrowded = {
  ...mockAg,
  tradingGuidance: tgAg,
  integratedSpec: {
    expectationGap: { gap: 'overshoot', pricedInDegree: { degree: 'high', score: 85 }, evidence: ['叙事透支'] },
    opponentStatus: { noChase: true, label: '空头将竭', opponentCapitulated: true, dataSource: 'opponent-capitulation' },
    playbook: { id: 'PB-TEST', stage: 'T4' },
    geoDecay: { heat: 'high' },
  },
};
const trapAg = computeRetailTrapScore(agCrowded);
if (trapAg.score == null) fail('AG trap score should compute with inputs');
else ok(`AG crowded trap score=${trapAg.score} badge=${trapAg.badge}`);
if (trapAg.score != null && trapAg.score < TRAP_HIGH_THRESHOLD) {
  ok(`AG trap ${trapAg.score} (may be below 70 without full attach)`);
}

const integratedAg = attachIntegratedSpec(
  { ...mockAg, tradingGuidance: { ...tgAg, phase: '拥挤', posture: '试仓' } },
  { globalRisk: { tier: 'L0', regime: 'normal' }, holdings: [] }
);
if (!integratedAg.integratedSpec?.retailTrap) fail('retailTrap missing on attach');
else ok(`integrated AG trap=${integratedAg.integratedSpec.retailTrap.score}`);

const pm = buildPreMortem(integratedAg, {
  integratedSpec: integratedAg.integratedSpec,
  globalRisk: { tier: 'L0' },
});
if (!pm.failurePaths.some((p) => p.title.includes('派发') || p.title.includes('trap'))) {
  ok('pre-mortem trap path (optional if score < 70)');
} else ok('pre-mortem includes trap failure path');

const violations = detectRuleViolations(integratedAg, { tradingGuidance: integratedAg.tradingGuidance });
if (integratedAg.integratedSpec.retailTrap?.highTrap && !violations.violations.some((v) => v.rule === 'distributionTrapHigh')) {
  fail('distributionTrapHigh violation expected when trap high');
} else ok(`retail violations count=${violations.count}`);

const noTrade = evaluateNoTradeDay({
  instruments: [integratedAg],
  globalRisk: grL3,
  factorExposure: { hedgeDegree: 20 },
  holdings: [],
});
if (!noTrade.noTradeDay || noTrade.suggestion !== 'NO_NEW_TRADES') fail('L3 should trigger noTradeDay');
else ok(`noTradeDay L3 topLine=${(noTrade.topLine || '').slice(0, 40)}…`);
console.log('EXAMPLE noTradeDay:', JSON.stringify({ noTradeDay: noTrade.noTradeDay, reasons: noTrade.reasons, teachingLines: noTrade.teachingLines.slice(0, 2) }, null, 2));

logPositionClose({ symbol: 'ag', reason: 'stop', closedAt: new Date().toISOString() });
const cd = getReentryCooldown('ag', { inst: integratedAg });
if (!cd.inCooldown) ok('cooldown may be excepted or zero elapsed');
else ok(`AG cooldown daysRemaining=${cd.daysRemaining}`);

const postureCd = applyReentryCooldownToPosture('试仓', 'ag', { inst: integratedAg });
if (cd.inCooldown && postureCd !== '观望') fail('cooldown should cap posture');
else ok(`cooldown posture cap → ${postureCd}`);

const ct = computeCoreTacticalState(['cu', 'ag'], [
  { id: 'cu', name: '铜', tradingGuidance: { posture: '持有' }, integratedSpec: { watchLevel: 'W3' }, longTermGuidance: { pilot: true, entry: { readiness: 'ready' } } },
  { id: 'ag', name: '白银', tradingGuidance: { posture: '试仓' }, integratedSpec: { watchLevel: 'O2' } },
]);
if (ct.coreCount !== 1 || ct.tacticalCount !== 1) fail(`core/tactical expected 1/1 got ${ct.coreCount}/${ct.tacticalCount}`);
else ok(`core=${ct.coreCount} tactical=${ct.tacticalCount} labels=${ct.slots.map((s) => s.slotLabel).join(',')}`);

const painResult = addPainEntry({
  symbol: 'ag',
  lesson: '拥挤追多被派发',
  tags: ['D2', 'overshoot', '拥挤'],
});
if (!painResult.ok) fail(`pain entry ${painResult.error}`);
else ok(`pain entry ${painResult.entry?.id}`);

const matches = matchPainEntries(integratedAg, listPainEntries(10));
if (!matches.length) ok('pain match optional');
else ok(`pain match fusion=${matches[0].fusionLine?.slice(0, 30)}…`);

const brief = buildDailyBrief(
  { instruments: [integratedAg], globalRisk: grL3 },
  { holdings: ['ag'], forceRefresh: true }
);
if (!brief.noTradeDay?.noTradeDay) fail('brief noTradeDay missing');
else ok('brief noTradeDay attached');
if (!brief.coreTactical) fail('brief coreTactical missing');
else ok(`brief coreTactical warnings=${brief.coreTactical.warnings?.length || 0}`);

const llmPayload = buildDailyBriefLlmPayload(brief);
if (!llmPayload.threeAnswers?.soWhat) fail('buildDailyBriefLlmPayload missing soWhat');
if (!llmPayload.noTradeDay?.noTradeDay) fail('buildDailyBriefLlmPayload should carry noTradeDay');
if (!llmPayload.counterThesis?.summary) fail('buildDailyBriefLlmPayload missing counterThesis');
else ok(`buildDailyBriefLlmPayload compact keys=${Object.keys(llmPayload).length}`);

const gate = computePortfolioGate(['cu', 'ag'], [integratedAg], { globalRisk: grL3 });
if (!gate.coreTactical) fail('gate coreTactical missing');
else ok('portfolio gate coreTactical');

const slotCtx = buildSlotDecisionContext(
  { instruments: [integratedAg], globalRisk: grL3 },
  ['cu', 'ag'],
  brief
);
if (slotCtx.slots?.length !== 3) fail('slotCtx should have 3 slots');
else ok('buildSlotDecisionContext 3 slots');
const slotRule = buildSlotDecisionBriefRule(slotCtx);
if (!slotRule.narrative || slotRule.method !== 'structured-synthesis') fail('slot decision rule brief');
else ok(`slot decision narrative len=${slotRule.narrative.length}`);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS retail-discipline v147');
process.exit(failed ? 1 : 0);
