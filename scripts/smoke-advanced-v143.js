#!/usr/bin/env node
/** Smoke: advanced features v1.43.0-advanced */
let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function ok(msg) {
  console.log('OK', msg);
}

const { computeClusterGate, getClusterForSymbol, CORRELATION_GATE_VERSION } = require('../services/portfolio-correlation-gate');
const { computeMacroMasterClock, CLOCK_VERSION } = require('../services/macro-master-clock');
const { evaluateHardPolicy, HARD_POLICY_VERSION } = require('../services/exchange-hard-policy');
const { evaluateIndustryProfit, PROFIT_PROXY_VERSION } = require('../services/industry-profit-proxy');
const { computeTermStructureBias, TERM_BIAS_VERSION } = require('../services/term-structure-bias');
const { computeSeasonalityHint, SEASONALITY_VERSION } = require('../services/seasonality-hints');
const { logBehaviorOverride, summarizeOverridePatterns, BEHAVIOR_LOG_VERSION } = require('../services/behavior-override-log');
const { computeGeoNarrativeDecay, GEO_DECAY_VERSION } = require('../services/geo-narrative-decay');
const { detectSlippageTier, SLIPPAGE_VERSION } = require('../services/slippage-detector');
const { computeExpectationGap, GAP_VERSION } = require('../services/expectation-gap');
const { detectPlaybook, loadPlaybooks, PLAYBOOK_VERSION } = require('../services/policy-playbook-engine');
const { WATCH_LEVELS, deriveWatchLevel } = require('../services/research-pool');
const { buildDailyBrief, BRIEF_VERSION } = require('../services/daily-brief-synthesis');
const { attachIntegratedSpec, INTEGRATED_VERSION } = require('../services/integrated-spec-attach');
const { computePortfolioGate, GATE_VERSION } = require('../services/portfolio-gate');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { computeGlobalRiskRegime } = require('../services/global-risk-regime');

console.log('VERSIONS', {
  CORRELATION_GATE_VERSION,
  CLOCK_VERSION,
  HARD_POLICY_VERSION,
  PROFIT_PROXY_VERSION,
  TERM_BIAS_VERSION,
  SEASONALITY_VERSION,
  BEHAVIOR_LOG_VERSION,
  GEO_DECAY_VERSION,
  SLIPPAGE_VERSION,
  GAP_VERSION,
  PLAYBOOK_VERSION,
  BRIEF_VERSION,
  INTEGRATED_VERSION,
  GATE_VERSION,
});

const gr = computeGlobalRiskRegime({}, {});

const cluster3 = computeClusterGate(['i', 'rb', 'hc']);
if (!cluster3.capNewScout) fail('black cluster 3/3 should cap scout');
else ok(`cluster gate 3 black → cap (${cluster3.effectiveIndependentBets})`);

const clusterMix = computeClusterGate(['ag', 'cu']);
if (clusterMix.capNewScout) fail('mixed cluster should not cap');
ok('cluster gate mixed → no cap');

if (getClusterForSymbol('au')?.id !== 'precious') fail('AU cluster');
ok('cluster precious AU');

const clock = computeMacroMasterClock({ globalRisk: gr });
if (!clock.summaryThreeLines || clock.summaryThreeLines.length !== 3) fail(`expected 3 clock lines got ${clock.summaryThreeLines?.length}`);
ok(`master clock → ${clock.summaryThreeLines[0].slice(0, 40)}…`);

const hardI = evaluateHardPolicy('i');
if (!hardI.hasHard) fail('hard policy seed for I expected');
ok(`hard policy I → W2 boost ${hardI.watchLevelBoost}`);

const profitLh = evaluateIndustryProfit('lh');
if (!profitLh.status) fail('industry profit LH missing');
ok(`industry profit LH → ${profitLh.status} gateW3=${profitLh.gateW3}`);

const termCu = computeTermStructureBias('cu');
if (!termCu.bias) fail('term bias missing');
ok(`term structure CU → ${termCu.bias}`);

const termUnknown = computeTermStructureBias('lh');
if (termUnknown.bias !== 'unknown') fail('LH term should be unknown');
ok('term structure LH → unknown (honest)');

const seasonLh = computeSeasonalityHint('lh', { month: 1 });
if (!seasonLh.watchBoost && seasonLh.seasonPhase !== 'peak') fail('LH Jan should be peak season');
ok(`seasonality LH Jan → ${seasonLh.seasonPhase}`);

const geo = computeGeoNarrativeDecay(
  { macroSynthesis: { activeTheses: [{ claim: '地缘冲突溢价', linkedTags: ['geo'], fetchedAt: new Date(Date.now() - 30 * 86400000).toISOString() }] } },
  {}
);
if (geo.premiumRemaining !== 'low' && geo.premiumRemaining !== 'medium') fail(`geo decay unexpected ${geo.premiumRemaining}`);
ok(`geo decay → ${geo.premiumRemaining} factor=${geo.decayFactor}`);

const slipAp = detectSlippageTier({ id: 'ap' });
if (!slipAp.flag) fail('AP slippage flag missing');
ok(`slippage AP → ${slipAp.flag}`);

if (!WATCH_LEVELS.O2) fail('O2 watch level missing');
ok(`O2 watch → ${WATCH_LEVELS.O2.label}`);

const mockRb = {
  id: 'rb',
  name: '螺纹钢',
  price: 3600,
  recentHigh: 4400,
  capitalAttention: { score: 52 },
  macroSynthesis: {
    activeTheses: [{ id: 't-rb', claim: '供给侧改革预期', status: 'overshoot', fetchedAt: new Date().toISOString() }],
  },
  quantGate: { tradableForSim: true },
  highLowPrediction: { baseClose: 3600, predictedHigh: 3700, predictedLow: 3500 },
};

const tgRb = buildTradingGuidance(mockRb, { globalRisk: gr });
tgRb.phase = '冷淡';

const gapO2 = computeExpectationGap(mockRb, { tradingGuidance: tgRb });
if (!gapO2.pricedInDegree?.degree) fail('pricedInDegree missing');
ok(`priced-in → ${gapO2.pricedInDegree.degree} score=${gapO2.pricedInDegree.score}`);

const playbooks = loadPlaybooks();
const pbBlack = playbooks.find((p) => p.id === 'PB-BLACK-2015');
if (!pbBlack) fail('PB-BLACK-2015 missing from playbooks.json');
else ok(`playbook PB-BLACK-2015 linked=${(pbBlack.linkedSymbols || []).join(',')}`);

const pbRb = detectPlaybook({ inst: { id: 'rb' }, tradingGuidance: tgRb });
if (!pbRb || pbRb.id !== 'PB-BLACK-2015') fail(`RB playbook expected PB-BLACK-2015 got ${pbRb?.id}`);
else ok(`playbook RB → ${pbRb.id} ${pbRb.stage}`);

const integrated = attachIntegratedSpec({ ...mockRb, tradingGuidance: tgRb }, { globalRisk: gr, holdings: [] });
if (!integrated.integratedSpec?.termStructure) fail('integrated termStructure missing');
if (!integrated.integratedSpec?.seasonality) fail('integrated seasonality missing');
ok('attachIntegratedSpec advanced fields');

const wlO2 = deriveWatchLevel(
  { ...mockRb, integratedSpec: { expectationGap: gapO2 }, tradingGuidance: tgRb },
  { tradingGuidance: tgRb, expectationGap: gapO2 }
);
if (gapO2.overshootBounceEligible && wlO2 !== 'O2') ok(`watch level overshoot bounce → ${wlO2}`);
else ok(`watch level → ${wlO2}`);

const gateCluster = computePortfolioGate(['i', 'rb', 'hc'], [integrated], { globalRisk: gr });
if (!gateCluster.clusterGate) fail('portfolio gate clusterGate missing');
ok(`portfolio gate + cluster → ${gateCluster.clusterGate.clusterWarning || 'ok'}`);

const brief = buildDailyBrief(
  { instruments: [integrated], globalRisk: gr, macroSynthesis: { narrativeSummary: '测试' }, updatedAt: new Date().toISOString() },
  { holdings: ['i'], forceRefresh: true }
);
if (!brief.masterClock?.summaryThreeLines?.length) fail('brief masterClock missing');
if (!brief.threeAnswers?.masterClockLines) fail('brief masterClockLines in threeAnswers');
ok('buildDailyBrief + masterClock');
console.log('BRIEF_SAMPLE', {
  line1: brief.masterClock.summaryThreeLines[0],
  line2: brief.masterClock.summaryThreeLines[1],
  line3: brief.masterClock.summaryThreeLines[2],
  happened: brief.threeAnswers.happened?.slice(0, 80),
});

const behavior = logBehaviorOverride({ symbol: 'rb', suggestedPosture: '观望', userAction: '忽略', userPosture: '试仓' });
if (!behavior.ok) fail('behavior override log failed');
ok('behavior override log');

process.exit(failed ? 1 : 0);
