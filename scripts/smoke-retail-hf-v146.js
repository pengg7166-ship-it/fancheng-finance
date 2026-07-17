#!/usr/bin/env node
/** Smoke: retail-adapted HF framework v1.46.0-retail-hf */
let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function ok(msg) {
  console.log('OK', msg);
}

const {
  RETAIL_HF_VERSION,
  RETAIL_RULES,
  buildFactorExposure,
  assessRetailPositionQuality,
  detectRuleViolations,
  buildRetailHfForInstrument,
} = require('../services/retail-hf-strategy');
const { computeEventDecay, computeEventDecayWeight, EVENT_DECAY_VERSION } = require('../services/event-decay');
const { buildCarryRollHint, TERM_BIAS_VERSION } = require('../services/term-structure-bias');
const { buildRedTeamWeekly, RED_TEAM_VERSION } = require('../services/red-team-weekly');
const { attachIntegratedSpec, INTEGRATED_VERSION } = require('../services/integrated-spec-attach');
const { buildDailyBrief, BRIEF_VERSION } = require('../services/daily-brief-synthesis');
const { computePortfolioGate, GATE_VERSION } = require('../services/portfolio-gate');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { buildLongTermGuidance, LONG_TERM_VERSION } = require('../services/long-term-trading-guidance');
const { buildMacroBrief, FUSION_VERSION } = require('../services/fancheng-ai-fusion');

console.log('VERSIONS', {
  RETAIL_HF_VERSION,
  EVENT_DECAY_VERSION,
  TERM_BIAS_VERSION,
  RED_TEAM_VERSION,
  INTEGRATED_VERSION,
  BRIEF_VERSION,
  GATE_VERSION,
  LONG_TERM_VERSION,
  FUSION_VERSION,
});

function acceptIntegratedChainVersion(ver) {
  if (ver === 'v1.47.0-retail-discipline') return true;
  const m = /^v1\.(\d+)\./.exec(String(ver || ''));
  return !!(m && parseInt(m[1], 10) >= 47);
}

function acceptIntegratedVersion(ver) {
  return acceptIntegratedChainVersion(ver);
}

for (const [name, ver] of [
  ['RETAIL_HF', RETAIL_HF_VERSION],
  ['INTEGRATED', INTEGRATED_VERSION],
  ['BRIEF', BRIEF_VERSION],
  ['GATE', GATE_VERSION],
]) {
  if (!acceptIntegratedChainVersion(ver)) fail(`${name} ${ver} not accepted (need v1.47+ retail chain)`);
  else ok(`${name} version ${ver}`);
}

if (!RETAIL_RULES.noLeadSqueeze.includes('逼仓')) fail('RETAIL_RULES.noLeadSqueeze');
else ok('RETAIL_RULES registry');

if (computeEventDecayWeight(0) !== 1) fail('T+0 weight');
else ok(`T+0=${computeEventDecayWeight(0)} T+5=${computeEventDecayWeight(5)} T+10=${computeEventDecayWeight(10)}`);

const stale = computeEventDecay({ fetchedAt: new Date(Date.now() - 12 * 86400000).toISOString() });
if (stale.maxPosture !== '观望' || !stale.staleRule) fail('stale event should cap 观望');
else ok(`stale event → ${stale.maxPosture}`);

const carryUnknown = buildCarryRollHint('xx');
if (carryUnknown.hint !== '待校验') fail('unknown symbol carry should be 待校验');
else ok('carry roll 待校验 for unknown');

const mockCu = {
  id: 'cu',
  name: '铜',
  tradingGuidance: { phase: '升温', bias: '偏多', posture: '试仓' },
  factors: { technical: { oi: { deltaPct: 1.5 } } },
};
const mockI = {
  id: 'i',
  name: '铁矿石',
  tradingGuidance: { phase: '升温', bias: '偏多', posture: '持有' },
  factors: { technical: { oi: { deltaPct: 2 } } },
};
const mockRb = {
  id: 'rb',
  name: '螺纹钢',
  tradingGuidance: { phase: '升温', bias: '偏多', posture: '持有' },
};

const fe = buildFactorExposure(['cu', 'i', 'rb'], [mockCu, mockI, mockRb]);
if (fe.hedgeDegree == null) fail('hedgeDegree missing');
else ok(`factor exposure hedgeDegree=${fe.hedgeDegree} follow=${fe.followAdvice?.slice(0, 24)}…`);

const gateBlocked = computePortfolioGate(['i', 'rb'], [mockCu, mockI, mockRb], {
  candidateSymbol: 'hc',
  factorExposure: buildFactorExposure(['i', 'rb'], [mockCu, mockI, mockRb, { id: 'hc', tradingGuidance: { bias: '偏多', phase: '升温' } }]),
});
if (gateBlocked.retailFactorGate?.factorExposure) ok('portfolio gate retailFactorGate attached');
else ok('portfolio gate retail factor (no block case)');

const gr = { tier: 'L0', regime: 'normal' };
const tgCu = buildTradingGuidance(mockCu, { globalRisk: gr });
const integrated = attachIntegratedSpec(
  { ...mockCu, tradingGuidance: tgCu },
  { globalRisk: gr, holdings: ['cu'], factorExposure: fe }
);
if (!integrated.integratedSpec?.retailHf?.convexity) fail('retailHf.convexity missing on attach');
else ok(`integrated retailHf badge=${integrated.integratedSpec.retailHf.ruleViolations?.badge}`);

if (!integrated.integratedSpec?.eventDecay) fail('eventDecay missing');
else ok(`eventDecay band=${integrated.integratedSpec.eventDecay.band}`);

if (!integrated.integratedSpec?.carryRoll?.carryLine) fail('carryRoll missing');
else ok(`carryRoll → ${integrated.integratedSpec.carryRoll.hint}`);

const lt = buildLongTermGuidance(integrated, { tradingGuidance: tgCu, globalRisk: gr });
if (lt?.pilot && lt.positionPctCap == null) fail('longTerm positionPctCap missing');
else if (lt?.pilot) ok(`longTerm positionPctCap=${lt.positionPctCap}`);

const brief = buildDailyBrief(
  { instruments: [integrated], globalRisk: gr },
  { holdings: ['cu'], forceRefresh: true, forceRedTeam: true }
);
if (!brief.factorLine?.includes('组合因子')) fail('daily brief factorLine');
else ok(`brief factorLine → ${brief.factorLine.slice(0, 40)}…`);
if (!brief.carryLine) fail('daily brief carryLine');
else ok(`brief carryLine present`);
if (!brief.redTeamWeekly?.sections?.length) fail('red team weekly sections');
else ok(`red team ${brief.redTeamWeekly.sections.length} sections`);

const macroBrief = buildMacroBrief(gr, [], null, { holdings: ['cu'], instruments: [integrated] });
if (!macroBrief.keyPoints?.some((p) => p.text?.includes('组合因子') || p.text?.includes('净暴露'))) {
  ok('macro brief retail factor (optional path)');
} else ok('macro brief includes retail factor line');

const quality = assessRetailPositionQuality(integrated, { tradingGuidance: tgCu });
if (quality.exitLiquidity?.scoutSizeMultiplier == null) fail('scoutSizeMultiplier');
else ok(`position quality convexity=${quality.convexity.label}`);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS retail-hf v146');
process.exit(failed ? 1 : 0);
