#!/usr/bin/env node
/** Smoke: weight honesty + KPI/interrupt n audit (v2.87) */
process.chdir(require('path').join(__dirname, '..'));
if (!process.env.FANCHENG_DATA_DRIVE) process.env.FANCHENG_DATA_DRIVE = 'F';

const dailyClose = require('../services/daily-close-sync');
dailyClose.initDiskCache();
const disk = require('../services/disk-cache');
if (!disk.getRoot()) disk.init('F:/FanchengFinance/data');

let fails = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    fails += 1;
  } else console.log('OK', msg);
}

const { SCENARIO_VERSION, buildScenarioLattice } = require('../services/intel-scenario-lattice');
const { CHOICE_VERSION, buildChoiceSet, weightFor } = require('../services/intel-choice-set');
const { KPI_VERSION, computeKpis, parseHitDisplay } = require('../services/intel-kpi');
const { resolvePushTier } = require('../services/intel-push-tier');
const { computeInterruptScore } = require('../services/intel-surprise');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.87'), ORCHESTRATOR_VERSION);
assert(SCENARIO_VERSION.includes('weight-honesty'), SCENARIO_VERSION);
assert(CHOICE_VERSION.includes('weight-honesty'), CHOICE_VERSION);
assert(KPI_VERSION.includes('kpi-n-panels'), KPI_VERSION);

// uncalibrated lattice: all weights null, bands 暂无
const lattice = buildScenarioLattice(
  { id: 'cu', name: '沪铜', factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '去库' } } } },
  { claimId: 'c1', side: 'bull', statement: '测试', stateKey: 'no-such-key-zzzz', n: 5, triggers: [] },
  { state: 'partial', actionHint: '观察' },
  { aggregate: { level: 'green', daysLeft: 10 }, display: '充裕' }
);
assert(lattice.weightsCalibrated === false, 'not calibrated');
assert(lattice.weights === null, 'weights null');
for (const s of lattice.scenarios.filter((x) => x.id !== 'exogenous')) {
  assert(s.weight === null, `${s.id} weight null`);
  assert(/暂无/.test(s.probabilityBand), `${s.id} band ${s.probabilityBand}`);
}
assert(lattice.actionSet.primary.weight === null, 'action weight null');
assert(lattice.heuristicRaw && lattice.heuristicRaw.note, 'heuristic audit only');

const wf = weightFor(lattice, 'base');
assert(wf.weight === null && wf.band === '暂无', 'choice weightFor');

const choice = buildChoiceSet(
  { id: 'cu' },
  { claimId: 'c1', side: 'bull', confidence: '弱结构', status: 'active', triggers: [{ type: 'falsify', condition: '合证翻' }] },
  { state: 'partial' },
  { display: '充裕' },
  lattice,
  null
);
assert(choice.options.every((o) => o.weight == null), 'choice weights null');
assert(choice.nDisplay != null && choice.nDisplay !== '', `nDisplay ${choice.nDisplay}`);
assert(choice.weightsCalibrated === false, 'choice not calibrated');

// interrupt n gate
const lowN = computeInterruptScore({ composite: 0.9, n: 10, nDisplay: '10' }, { score: 0.9, reasons: [] }, { score: 1 });
assert(lowN.tier !== 'interrupt', `tier ${lowN.tier}`);
assert(/n=10/.test(lowN.reason || ''), lowN.reason);

const push = resolvePushTier(
  { id: 'cu' },
  { evidenceAgainst: [{ summary: 'x' }] },
  { composite: 0.9, n: 10, nDisplay: '10' },
  { score: 0.9, reasons: ['可行动'] },
  { interrupt: { pass: true } },
  { state: 'mispriced' }
);
assert(push.surpriseNDisplay === '10', push.surpriseNDisplay);
assert(push.interruptReason || push.reasons.some((r) => /n=/.test(r)), JSON.stringify(push.reasons));

const bare = parseHitDisplay('55%');
assert(bare.deferred && bare.display === '暂无', 'bare % rejected');
const okHit = parseHitDisplay('48.6% (168/346)');
assert(!okHit.deferred && okHit.total === 346, okHit.display);

const kpis = computeKpis(
  [
    {
      id: 'a',
      intelCenter: {
        primaryClaim: { status: 'active', evidenceAgainst: [{}], triggers: [{}], n: 30 },
        gates: { top5: { pass: true } },
        surprise: { n: 40 },
        processReadiness: { processReady: true },
      },
    },
    {
      id: 'b',
      intelCenter: {
        primaryClaim: { status: 'watch', evidenceAgainst: [], triggers: [], n: null },
        surprise: { n: 5 },
      },
    },
  ],
  {
    dailyDiff: { available: true, quietDay: false, materialChanges: 2 },
    processScorecard: { outcome: { directionHit: '50% (10/20)', processCorrect: '60% (12/20)' } },
  }
);
assert(kpis.panels.length >= 4, `panels ${kpis.panels.length}`);
assert(kpis.directionHit.deferred === false, 'dir live with n');
assert(kpis.directionHit.total === 20, kpis.directionHit.archiveDisplay);
assert(/反对 1\/2/.test(kpis.display), kpis.display);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.87'), pack.version);
assert(pack.kpis?.panels?.length >= 1, 'pack kpi panels');
const withIc = require('../services/intel-orchestrator').applyIntelCenterToInstruments(
  [{ id: 'cu', name: '沪铜', changePct: 0.5 }],
  { asOf: '2026-07-17', persist: false }
);
const lat = withIc[0]?.intelCenter?.scenarioLattice;
if (lat && !lat.weightsCalibrated) {
  assert(lat.scenarios.every((s) => s.id === 'exogenous' || s.weight == null), 'live lattice honesty');
}
assert(pack.faceViews?.research?.kpis?.panels || pack.kpis.panels, 'face kpi');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-y weight-honesty-kpi-n');
process.exit(fails ? 1 : 0);
