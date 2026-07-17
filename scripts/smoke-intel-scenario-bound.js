#!/usr/bin/env node
/** Smoke: evidence-bound scenario lattice (vision §35/53 / v2.89.12) */
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

const {
  SCENARIO_VERSION,
  buildScenarioLattice,
  bindScenarioContent,
  buildScenarioLatticeBoard,
} = require('../services/intel-scenario-lattice');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(SCENARIO_VERSION.includes('evidence-bound') || SCENARIO_VERSION.includes('2.89.12'), SCENARIO_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.12') || ORCHESTRATOR_VERSION.includes('scenario-bound'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.12'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'scenario_evidence_bound'), 'lesson');

const claim = {
  claimId: 'claim-rb-structural',
  side: 'bull',
  statement: '螺纹合证去库将支撑偏多；若翻转为累库则证伪',
  otherwiseFalsify: '若合证翻转为累库+增仓则证伪',
  n: 40,
  nDisplay: '40',
  stateKey: 'test|destock_oi_up|bull',
  atomic: {
    predicate: 'regime_supports_bull',
    observable: { value: '去库+增仓', dataSource: 'stockFlowJoint', nDisplay: '40' },
    otherwiseFalsify: '若合证翻转为累库+增仓则证伪',
  },
  evidenceFor: [{ summary: '合证去库', dataSource: 'stockFlowJoint', n: 40, nDisplay: '40' }],
  evidenceAgainst: [{ summary: '基差走弱', dataSource: 'basis', n: 30, nDisplay: '30' }],
  triggers: [
    { type: 'falsify', condition: '合证翻转', dataSource: 'stock-flow' },
    { type: 'upgrade', condition: '合证强化', dataSource: 'stock-flow' },
  ],
  confidence: '弱结构',
};

const inst = {
  id: 'rb',
  name: '螺纹',
  sector: 'ferrous',
  factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '去库+增仓' } } },
  dualNarrative: { regime: 'split', display: '内外分裂', nDisplay: '暂无' },
  intelCenter: {
    narrative: { phase: 'fatigue', nDisplay: '8' },
    pricingState: { state: 'priced-in', display: '已定价' },
  },
};

const falsifyBound = bindScenarioContent('falsify', inst, claim, { state: 'mispriced' }, { display: '时钟黄' });
assert(falsifyBound.scripted === false, 'falsify bound');
assert(falsifyBound.evidenceBindings.length >= 1, 'falsify bindings');
assert(/证伪/.test(falsifyBound.trigger || ''), falsifyBound.trigger);

const upsideEmpty = bindScenarioContent(
  'upside',
  { id: 'xx', name: '空' },
  { side: 'bull', evidenceFor: [], triggers: [] },
  { state: 'unknown' },
  null
);
assert(upsideEmpty.scripted === true, 'upside scripted');

const lattice = buildScenarioLattice(inst, claim, { state: 'priced-in', display: '已定价' }, {
  display: '时钟',
  aggregate: { level: 'yellow' },
});
assert(lattice.trueEvidenceBound === true, 'trueEvidenceBound');
assert(lattice.method.includes('anti-script'), lattice.method);
assert(lattice.boundCount >= 2, `bound ${lattice.boundCount}`);
const falsifyScen = lattice.scenarios.find((s) => s.id === 'falsify');
assert(falsifyScen && !falsifyScen.scripted, 'falsify scen');
assert((falsifyScen.evidenceBindings || []).length >= 1, 'falsify scen bind');
const rangeScen = lattice.scenarios.find((s) => s.id === 'range');
assert(rangeScen && !rangeScen.scripted, 'range bound via priced-in/split/fatigue');
assert(rangeScen.affectedDisplay, rangeScen.affectedDisplay);

// scripted scenario must not carry numeric weight even if we force calibrated path
const scriptedUpside = lattice.scenarios.find((s) => s.id === 'upside');
if (scriptedUpside?.scripted) {
  assert(scriptedUpside.weight == null, 'scripted no weight');
  assert(/暂无/.test(scriptedUpside.probabilityBand), scriptedUpside.probabilityBand);
}

const board = buildScenarioLatticeBoard(
  [
    { id: 'rb', name: '螺纹', intelCenter: { scenarioLattice: lattice } },
    {
      id: 'yy',
      name: '弱',
      intelCenter: {
        scenarioLattice: {
          weightsCalibrated: false,
          scriptedCount: 3,
          boundCount: 0,
          display: '场景格 未校准',
          nDisplay: '暂无',
        },
      },
    },
  ],
  '2026-07-16'
);
assert(/场景板/.test(board.display), board.display);
assert(board.counts.scriptedHeavy >= 1, board.counts);

const sample = [
  { id: 'rb', name: '螺纹', direction: 'bullish', changePct: 1, sector: 'ferrous' },
  { id: 'sc', name: '原油', direction: 'bearish', changePct: -2, sector: 'energy' },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.89.12') || pack.version.includes('scenario-bound'), pack.version);
assert(pack.scenarioLatticeBoard?.display, pack.scenarioLatticeBoard?.display);
const liveLat = withIntel.find((i) => i.intelCenter?.scenarioLattice)?.intelCenter?.scenarioLattice;
assert(liveLat?.method?.includes('evidence-bound') || liveLat?.trueEvidenceBound, liveLat?.method);
assert(pack.faceViews?.research?.scenarioLatticeBoard, 'face scen board');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · scenario-bound §35'));
process.exit(fails ? 1 : 0);
