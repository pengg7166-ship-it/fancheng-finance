#!/usr/bin/env node
/** Smoke: opponent/squeeze/liquidity playbooks v1.45.0-opponent-playbooks */
let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function ok(msg) {
  console.log('OK', msg);
}

const {
  evaluateOpponentCapitulation,
  extractOiDeltaPct,
  OPPONENT_VERSION,
  MOTTO,
} = require('../services/opponent-capitulation');
const {
  detectSqueeze,
  detectLiqCrisis,
  detectUniversalPlaybooks,
  loadPlaybooks,
  PLAYBOOK_VERSION,
} = require('../services/policy-playbook-engine');
const { runPlaybookDecisionTree, TREE_VERSION } = require('../services/playbook-decision-tree');
const { attachIntegratedSpec, INTEGRATED_VERSION } = require('../services/integrated-spec-attach');
const { buildPreMortem, PRE_MORTEM_VERSION } = require('../services/pre-mortem-gate');
const { buildDailyBrief, BRIEF_VERSION } = require('../services/daily-brief-synthesis');
const { computePortfolioGate, GATE_VERSION } = require('../services/portfolio-gate');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');

console.log('VERSIONS', {
  OPPONENT_VERSION,
  PLAYBOOK_VERSION,
  TREE_VERSION,
  INTEGRATED_VERSION,
  PRE_MORTEM_VERSION,
  BRIEF_VERSION,
  GATE_VERSION,
});

function acceptIntegratedChainVersion(ver) {
  if (ver === 'v1.47.0-retail-discipline') return true;
  const m = /^v1\.(\d+)\./.exec(String(ver || ''));
  return !!(m && parseInt(m[1], 10) >= 47);
}

function acceptIntegratedVersion(ver) {
  return acceptIntegratedChainVersion(ver);
}

if (!acceptIntegratedVersion(INTEGRATED_VERSION)) fail(`INTEGRATED_VERSION ${INTEGRATED_VERSION}`);
else ok(`integrated version ${INTEGRATED_VERSION}`);

const pbs = loadPlaybooks();
for (const id of ['PB-OPP-001', 'PB-SQUEEZE', 'PB-LIQ-CRISIS']) {
  if (!pbs.find((p) => p.id === id)) fail(`playbook ${id} missing`);
  else ok(`playbook ${id} in playbooks.json`);
}

if (!MOTTO.includes('空头不死')) fail('motto missing');
else ok(`motto → ${MOTTO.slice(0, 20)}…`);

const mockINoOi = {
  id: 'i',
  name: '铁矿石',
  tradingGuidance: { phase: '升温', bias: '偏多', posture: '持有' },
};
const oppPending = evaluateOpponentCapitulation(mockINoOi, {});
if (oppPending.status !== '待校验' || oppPending.sideNotDead !== null) fail('missing OI should be 待校验');
else ok('I missing OI → 待校验 (no fake sideNotDead)');

const mockI = {
  id: 'i',
  name: '铁矿石',
  changePct: 1.2,
  factors: { technical: { oi: { deltaPct: 2.5 } } },
  tradingGuidance: { phase: '升温', bias: '偏多', posture: '持有' },
  capitalAttention: { score: 62 },
};
const oppI = evaluateOpponentCapitulation(mockI, {
  divergence: { level: 'D2', policyIntent: 'bearish' },
});
if (oppI.opponentSide !== 'shortNotDead') fail(`I D2 expected shortNotDead got ${oppI.opponentSide}`);
else ok(`I opponent → ${oppI.label} · blockReduce=${oppI.blockReduceLongOnHighPrice}`);

const mockAg = {
  id: 'ag',
  name: '白银',
  changePct: 0.8,
  factors: { technical: { oi: { deltaPct: 1.8 } } },
  tradingGuidance: { phase: '升温', bias: '偏多', posture: '试仓' },
  capitalAttention: { score: 58 },
};
const oppAg = evaluateOpponentCapitulation(mockAg, {});
if (oppAg.opponentSide !== 'shortNotDead') fail(`AG expected shortNotDead got ${oppAg.opponentSide}`);
else ok(`AG opponent → ${oppAg.label} · OI=${extractOiDeltaPct(mockAg)}%`);

const mockAgCap = {
  ...mockAg,
  changePct: 0.5,
  factors: { technical: { oi: { deltaPct: -2.1 } } },
  tradingGuidance: { phase: '退潮', bias: '偏多', posture: '减仓' },
};
const oppAgCap = evaluateOpponentCapitulation(mockAgCap, {});
if (oppAgCap.opponentSide !== 'shortCapitulated') fail(`AG cap expected shortCapitulated got ${oppAgCap.opponentSide}`);
else ok(`AG capitulated → ${oppAgCap.label} · noChase=${oppAgCap.noChase}`);

const mockSqueeze = {
  id: 'ap',
  name: '苹果',
  factors: { technical: { oi: { deltaPct: 4.2 } } },
  capitalAttention: { score: 72 },
  tradingGuidance: { phase: '拥挤', bias: '偏多', posture: '试仓' },
};
const sq = detectSqueeze(mockSqueeze, {
  expectationGap: { gap: 'overshoot' },
});
if (!sq?.stage) fail('squeeze detection empty for AP crowded');
else ok(`AP squeeze → PB-SQUEEZE ${sq.stage} closeScout=${sq.closeNewScout}`);

const liq = detectLiqCrisis({ globalRisk: { tier: 'L3', regime: 'shock', summary: 'test L3' } });
if (!liq.active || liq.effectiveBetsCap !== 1) fail('L3 liq crisis not detected');
else ok(`L3 crisis → ${liq.stage} · effectiveBets≤${liq.effectiveBetsCap}`);

const treeL3 = runPlaybookDecisionTree(mockI, { globalRisk: { tier: 'L3', regime: 'shock' } });
if (treeL3.q0 !== 'L3-liquidity-crisis' || treeL3.primaryPlaybook !== 'PB-LIQ-CRISIS') {
  fail(`Q0 L3 tree expected PB-LIQ-CRISIS got ${treeL3.primaryPlaybook}`);
} else ok(`Q0 L3 → ${treeL3.badge}`);

const treeI = runPlaybookDecisionTree(mockI, {
  divergence: { level: 'D2', policyIntent: 'bearish' },
  globalRisk: { tier: 'L1' },
});
if (!treeI.overlayPlaybooks?.includes('PB-OPP-001')) fail('I tree missing PB-OPP-001 overlay');
else ok(`I tree overlay → ${treeI.overlayPlaybooks.join('+')}`);

const tgI = buildTradingGuidance(mockI, { globalRisk: { tier: 'L1' } }) || mockI.tradingGuidance;
const integratedI = attachIntegratedSpec(
  { ...mockI, tradingGuidance: tgI, macroSynthesis: { activeTheses: [{ claim: '限产', who: '政策' }] } },
  { globalRisk: { tier: 'L1' }, divergence: { level: 'D2', policyIntent: 'bearish' } },
);
if (!integratedI.integratedSpec?.opponentStatus) fail('integrated missing opponentStatus');
if (integratedI.integratedSpec.opponentStatus.opponentSide !== 'shortNotDead') {
  fail(`integrated I expected shortNotDead got ${integratedI.integratedSpec.opponentStatus.opponentSide}`);
} else {
  ok(`integrated I → ${integratedI.integratedSpec.opponentStatus.label} squeeze=${integratedI.integratedSpec.squeezeStage?.stage || '—'}`);
}

const pmSqueeze = buildPreMortem(
  { id: 'ap', tradingGuidance: { posture: '试仓', phase: '拥挤' } },
  {
    integratedSpec: { squeezeStage: { id: 'PB-SQUEEZE', stage: 'T2', evidence: ['滑点'] } },
    squeezeStage: { id: 'PB-SQUEEZE', stage: 'T2', evidence: ['滑点'] },
  },
);
const squeezePath = pmSqueeze.failurePaths.find((p) => /挤仓止损/.test(p.title));
if (!squeezePath) fail('pre-mortem missing squeeze stop failure path');
else ok(`pre-mortem squeeze → ${squeezePath.title}`);

const gateL3 = computePortfolioGate(['i'], [], { globalRisk: { tier: 'L3' }, liqCrisis: true });
if (!gateL3.capNewScout || gateL3.l3EffectiveBetsCap !== 1) fail('L3 portfolio gate should cap effective bets');
else ok(`L3 gate capNewScout=${gateL3.capNewScout} l3Cap=${gateL3.l3EffectiveBetsCap}`);

const brief = buildDailyBrief(
  {
    instruments: [integratedI, { id: 'ag', name: '白银', integratedSpec: { opponentStatus: oppAg }, tradingGuidance: mockAg.tradingGuidance }],
    globalRisk: { tier: 'L1' },
  },
  { forceRefresh: true },
);
if (!brief.threeAnswers?.opponentStatusLine) fail('brief missing opponentStatusLine');
if (!/空头未死/.test(brief.threeAnswers.opponentStatusLine)) fail('brief opponent line should mention 空头未死');
else ok(`brief opponent line → ${brief.threeAnswers.opponentStatusLine.slice(0, 80)}…`);

const universal = detectUniversalPlaybooks(mockI, {
  tradingGuidance: mockI.tradingGuidance,
  divergence: { level: 'D2' },
  opponentStatus: oppI,
});
if (!universal.some((m) => m.id === 'PB-OPP-001')) fail('universal playbooks missing PB-OPP-001');
else ok(`universal matches → ${universal.map((m) => m.id).join(',')}`);

process.exit(failed ? 1 : 0);
