#!/usr/bin/env node
/** Smoke: discipline features v1.44.0-discipline */
let failed = 0;
function fail(msg) {
  console.error('FAIL', msg);
  failed += 1;
}
function ok(msg) {
  console.log('OK', msg);
}

const { buildPreMortem, PRE_MORTEM_VERSION, buildSignalId } = require('../services/pre-mortem-gate');
const { hasAck, saveAck, ACK_STORE_VERSION } = require('../services/pre-mortem-ack-store');
const { runMarginStress, STRESS_VERSION } = require('../services/margin-stress-test');
const { getHolidayGapRisk, GAP_CAL_VERSION } = require('../services/holiday-gap-calendar');
const { runPlaybookDecisionTree, TREE_VERSION } = require('../services/playbook-decision-tree');
const { runThesisRetirement, filterActiveThesesForDisplay, RETIREMENT_VERSION } = require('../services/thesis-retirement');
const { attachIntegratedSpec, INTEGRATED_VERSION } = require('../services/integrated-spec-attach');
const { buildDailyBrief, BRIEF_VERSION } = require('../services/daily-brief-synthesis');
const { buildTradingGuidance } = require('../services/outlook-trading-guidance');
const { computeGlobalRiskRegime } = require('../services/global-risk-regime');
const { computeDivergence } = require('../services/policy-playbook-engine');

console.log('VERSIONS', {
  PRE_MORTEM_VERSION,
  ACK_STORE_VERSION,
  STRESS_VERSION,
  GAP_CAL_VERSION,
  TREE_VERSION,
  RETIREMENT_VERSION,
  INTEGRATED_VERSION,
  BRIEF_VERSION,
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

const mockAg = {
  id: 'ag',
  name: '白银',
  price: 8200,
  directionLabel: '偏多',
  capitalAttention: { score: 58 },
  tradingGuidance: { pilot: true, posture: '试仓', phase: '升温', bias: '偏多', dataSource: 'outlook-trading-guidance' },
  integratedSpec: {
    regime: { regime: 'A', label: '叙事', dataSource: 'commodity-regime-classifier' },
    divergence: { level: 'D1', label: '轻度', evidence: ['phase=升温'], dataSource: 'policy-playbook-engine' },
    playbook: null,
    expectationGap: { gap: 'aligned', pricedInDegree: { degree: 'medium', score: 55 } },
  },
};

const pmAg = buildPreMortem(mockAg, { globalRisk: { tier: 'L1', regime: 'normal' } });
if (!pmAg.failurePaths || pmAg.failurePaths.length !== 3) fail(`pre-mortem AG paths ${pmAg.failurePaths?.length}`);
else ok(`pre-mortem AG → ${pmAg.failurePaths.map((p) => p.title).join(' | ')}`);
if (!pmAg.mustAcknowledge) fail('pre-mortem mustAcknowledge');
if (!pmAg.signalId) fail('pre-mortem signalId missing');

const sig = buildSignalId('ag', '试仓', '2026-07-02');
saveAck({ signalId: sig, symbol: 'ag', posture: '试仓' });
if (!hasAck(sig)) fail('pre-mortem ack not persisted');
else ok('pre-mortem ack store');

const stress = runMarginStress(['i', 'rb'], 2);
if (!stress.perSymbol.length) fail('margin stress empty');
const verified = stress.perSymbol.filter((r) => r.status === 'verified');
if (verified.length) {
  ok(`margin stress i+rb → ${verified.length} verified · portfolio ${stress.portfolio.level}`);
} else {
  ok(`margin stress i+rb → 待校验 (honest) · ${stress.perSymbol.map((r) => r.status).join(',')}`);
}
if (stress.perSymbol.some((r) => r.status === '待校验' && r.currentMarginYuan != null && r.reason == null)) {
  fail('待校验 row should not have fake margin');
}

const gap = getHolidayGapRisk('2026-01-20');
if (!gap.briefLine) fail('holiday gap briefLine missing');
ok(`holiday gap → ${gap.briefLine.slice(0, 50)}…`);

const mockLh = {
  id: 'lh',
  name: '生猪',
  tradingGuidance: { pilot: true, phase: '退潮', bias: '偏空', posture: '观望', dataSource: 'outlook-trading-guidance' },
  macroSynthesis: { activeTheses: [{ claim: '去产能预期', status: 'active' }] },
};
const divLh = computeDivergence(mockLh, { tradingGuidance: mockLh.tradingGuidance });
const treeLh = runPlaybookDecisionTree(mockLh, { tradingGuidance: mockLh.tradingGuidance, divergence: divLh });
if (treeLh.primaryPlaybook !== 'PB-LH-2024') fail(`LH tree expected PB-LH-2024 got ${treeLh.primaryPlaybook}`);
else ok(`decision tree LH → ${treeLh.badge} conf=${treeLh.confidence}`);

const retirement = runThesisRetirement({ dryRun: true });
ok(`thesis retirement dry-run changed=${retirement.changed}`);

const gr = computeGlobalRiskRegime({}, {});
const mockI = {
  id: 'i',
  name: '铁矿石',
  price: 820,
  capitalAttention: { score: 62 },
  macroSynthesis: { activeTheses: [{ claim: '调控打压', status: 'active' }] },
  quantGate: { tradableForSim: true },
};
const tgI = buildTradingGuidance(mockI, { globalRisk: gr });
const attached = attachIntegratedSpec({ ...mockI, tradingGuidance: tgI }, { globalRisk: gr });
if (!attached.integratedSpec?.playbookDecisionTree) fail('integrated missing decision tree');
if (!attached.integratedSpec?.preMortem?.failurePaths?.length) fail('integrated missing preMortem');
ok(`integrated I → ${attached.integratedSpec.primaryPlaybookBadge || '—'}`);

const brief = buildDailyBrief(
  { instruments: [attached], globalRisk: gr, updatedAt: new Date().toISOString() },
  { holdings: ['i', 'rb'], forceRefresh: true }
);
if (!brief.holidayGap) fail('brief missing holidayGap');
if (!brief.marginStress) fail('brief missing marginStress');
ok(`daily brief v144 → holiday + margin stress`);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS discipline-v144');
process.exit(failed ? 1 : 0);
