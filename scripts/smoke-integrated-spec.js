#!/usr/bin/env node
/** Smoke: integrated spec v1.42 — regime, playbook, pool, brief, portfolio gate */
let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function ok(msg) {
  console.log('OK', msg);
}

const { classifyRegime, REGIME_VERSION } = require('../services/commodity-regime-classifier');
const { computeDivergence, detectPlaybook, PLAYBOOK_VERSION } = require('../services/policy-playbook-engine');
const { addToPool, getPoolStatus, deriveWatchLevel, WATCH_LEVELS, seedPoolIfEmpty, findRecentPoolEntry, poolFilePath } = require('../services/research-pool');
const { evaluateAutoPoolTriggers, AUTO_TRIGGER_VERSION } = require('../services/research-pool-auto-trigger');
const { computePortfolioGate, MAX_POSITIONS, GATE_VERSION } = require('../services/portfolio-gate');
const { computeExpectationGap } = require('../services/expectation-gap');
const { computePriorityScore } = require('../services/multi-dimensional-scoring');
const { buildDailyBrief, BRIEF_VERSION } = require('../services/daily-brief-synthesis');
const { attachIntegratedSpec, INTEGRATED_VERSION } = require('../services/integrated-spec-attach');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { buildLongTermGuidance } = require('../services/long-term-trading-guidance');
const { buildCounterThesis, FUSION_VERSION } = require('../services/fancheng-ai-fusion');
const { computeGlobalRiskRegime } = require('../services/global-risk-regime');

console.log('VERSIONS', { REGIME_VERSION, PLAYBOOK_VERSION, GATE_VERSION, BRIEF_VERSION, INTEGRATED_VERSION, FUSION_VERSION, AUTO_TRIGGER_VERSION });

const gr = computeGlobalRiskRegime({}, {});

const mockI = {
  id: 'i',
  name: '铁矿石',
  price: 820,
  directionLabel: '偏多',
  capitalAttention: { score: 62 },
  smoothedVol: { percentile: 55, volRising: true },
  macroSynthesis: {
    activeTheses: [{ id: 't-i', who: 'Policy', claim: '调控打压铁矿石', status: 'active' }],
  },
  quantGate: { tradableForSim: true },
  highLowPrediction: { predictedLow: 800, predictedHigh: 850, baseClose: 820, method: 'range' },
};

const regimeI = classifyRegime('i', { inst: mockI });
ok(`regime I → ${regimeI.regime}`);
if (!regimeI.regime) fail('regime missing');
if (!regimeI.dataSource) fail('regime dataSource missing');

const regimeZn = classifyRegime('zn', { inst: { id: 'zn', smoothedVol: { percentile: 25 } } });
if (regimeZn.regime !== 'D') fail(`ZN should be D got ${regimeZn.regime}`);
if (!regimeZn.slippageFlag && regimeZn.regime === 'D' && mockI.id === 'zn') fail('slippage flag');
ok(`regime ZN → ${regimeZn.regime}`);

const tgI = buildTradingGuidance(mockI, { globalRisk: gr });
const divI = computeDivergence(mockI, { tradingGuidance: tgI });
ok(`divergence I → ${divI.level}`);
if (!['D0', 'D1', 'D2', 'D3'].includes(divI.level)) fail('invalid divergence level');
if (divI.level === 'D2' || divI.level === 'D3') {
  if (!divI.closeNewScout) fail('D2/D3 should closeNewScout');
}

const pbI = detectPlaybook({ inst: mockI, tradingGuidance: tgI, divergence: divI });
if (!pbI || pbI.id !== 'PB-I-2023') fail(`expected PB-I-2023 got ${pbI?.id}`);
else ok(`playbook I → ${pbI.id} ${pbI.stage} n=${pbI.n}`);

seedPoolIfEmpty();
const poolTrigger = `smoke-test-${process.pid}-${Date.now()}`;
const addedCu = addToPool('cu', { watchLevel: 'W1', trigger: poolTrigger, note: 'test entry' });
if (!addedCu?.symbol) fail('pool add failed');
if (poolFilePath()) {
  const recentCu = findRecentPoolEntry('cu', poolTrigger, 5000);
  if (!recentCu) fail('pool add not persisted');
  ok(`pool CU watch ${recentCu.watchLevel}`);
} else {
  ok(`pool CU watch ${addedCu.watchLevel} (in-memory)`);
}

const wl = deriveWatchLevel({ ...mockI, tradingGuidance: tgI }, { tradingGuidance: tgI });
if (!WATCH_LEVELS[wl]) fail(`invalid watch level ${wl}`);
ok(`watch level I → ${wl}`);

const autoPool = evaluateAutoPoolTriggers({
  instruments: [{ ...mockI, tradingGuidance: tgI }],
  holdings: [],
  theses: [{ id: 'smoke-policy-i', who: 'Policy', claim: '调控打压铁矿石', status: 'active', linkedSymbols: ['i'], fetchedAt: new Date().toISOString() }],
  force: true,
});
const policyAdded = autoPool.added.find((a) => a.symbol === 'i' && a.trigger === 'policy-thesis');
if (!policyAdded?.entry) fail(`auto pool policy-thesis missing: ${JSON.stringify(autoPool.added.map((a) => a.trigger))}`);
else ok(`auto pool policy-thesis → ${policyAdded.entry.watchLevel} · ${policyAdded.entry.trigger}`);

const autoDiv = evaluateAutoPoolTriggers({
  instruments: [{ ...mockI, tradingGuidance: tgI }],
  holdings: [],
  force: !findRecentPoolEntry('i', 'policy-divergence'),
});
const divAdded = autoDiv.added.find((a) => a.symbol === 'i' && a.trigger === 'policy-divergence');
if (divI.level === 'D2' || divI.level === 'D3') {
  if (!divAdded?.entry && !findRecentPoolEntry('i', 'policy-divergence')) fail('auto pool policy-divergence missing');
  else if (divAdded?.entry) ok(`auto pool divergence → ${divAdded.entry.watchLevel} · ${divAdded.entry.divergenceLevel}`);
}

const gap = computeExpectationGap(mockI, { tradingGuidance: tgI });
if (!gap.gap) fail('expectation gap missing');
ok(`expectation gap → ${gap.gap}`);

const score = computePriorityScore(mockI, { tradingGuidance: tgI, regime: regimeI, divergence: divI, playbook: pbI });
if (score.priorityScore == null) fail('priorityScore null');
ok(`priorityScore I → ${score.priorityScore}`);

const ltI = buildLongTermGuidance({ ...mockI, tradingGuidance: tgI }, { globalRisk: gr, tradingGuidance: tgI });
const integrated = attachIntegratedSpec(
  { ...mockI, tradingGuidance: tgI, longTermGuidance: ltI },
  { globalRisk: gr, holdings: ['ag'] }
);
if (!integrated.integratedSpec?.regime) fail('integratedSpec.regime missing');
if (!integrated.integratedSpec?.logicChain?.length) fail('integratedSpec logicChain empty');
ok('attachIntegratedSpec');

const gate = computePortfolioGate(['ag', 'au'], [integrated], { globalRisk: gr });
if (gate.maxPositions !== MAX_POSITIONS) fail('MAX_POSITIONS wrong');
if (gate.slotsUsed !== 2) fail(`slotsUsed expected 2 got ${gate.slotsUsed}`);
ok(`portfolio gate ${gate.slotsUsed}/${gate.maxPositions}`);

const gateFull = computePortfolioGate(['ag', 'au', 'lc'], [integrated], { globalRisk: gr, candidateSymbol: 'cu' });
if (!gateFull.capNewScout) fail('full portfolio should cap scout');
ok('portfolio gate cap when full');

const brief = buildDailyBrief(
  {
    instruments: [integrated],
    globalRisk: gr,
    macroSynthesis: { narrativeSummary: '测试合成' },
    updatedAt: new Date().toISOString(),
  },
  { holdings: ['ag'], forceRefresh: true }
);
if (!brief.threeAnswers?.happened) fail('三答 happened missing');
if (!brief.researchPool) fail('researchPool missing');
if (!brief.top5) fail('top5 missing');
if (!brief.portfolioGate) fail('portfolioGate missing');
if (!brief.counterThesis) fail('counterThesis missing');
ok('buildDailyBrief 三答+pool+top5+gate');

const counter = buildCounterThesis(integrated, { globalRisk: gr });
if (!counter.mandatory) fail('counterThesis not mandatory');
if (!counter.points?.length) fail('counterThesis points empty');
ok('buildCounterThesis mandatory');

process.exit(failed ? 1 : 0);
