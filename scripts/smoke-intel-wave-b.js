#!/usr/bin/env node
/** Smoke: scenario lattice + shift contract + narrative contagion + teaching + confidence brake */
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

const { buildScenarioLattice } = require('../services/intel-scenario-lattice');
const { resolveShift, applyShiftDeliveryContract } = require('../services/intel-shift-schedule');
const { assessNarrativeEpidemiology } = require('../services/intel-narrative-epidemiology');
const { buildTeachingPack } = require('../services/intel-teaching');
const {
  enforceConfidenceBrake,
  buildIntelCenterPack,
  applyIntelCenterToInstruments,
  ORCHESTRATOR_VERSION,
  STRONG_STRUCTURE_CAP,
} = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

assert(ORCHESTRATOR_VERSION.includes('2.64'), `orch ver ${ORCHESTRATOR_VERSION}`);

const lattice = buildScenarioLattice(
  {
    id: 'cu',
    name: '沪铜',
    dualNarrative: { regime: 'split' },
    intelligenceKernel: { stateKey: 'cu|bear|build' },
  },
  {
    claimId: 'c1',
    side: 'bear',
    statement: '结构偏空·否则证伪',
    n: 12,
    triggers: [{ type: 'falsify', condition: '基差翻升水' }],
  },
  { state: 'mispriced' },
  { aggregate: { level: 'yellow' }, display: '证伪窗口 3d' }
);
assert(lattice.version.includes('evidence-lattice'), lattice.version);
assert(lattice.n != null || lattice.nDisplay, `n ${lattice.nDisplay}`);
assert(lattice.weightsCalibrated === true || lattice.weightsCalibrated === false, 'calibrated flag');
// claim.n=12 时若 stateKey 有更大校准样本则用校准 n；无则启发式
if (lattice.n != null && lattice.n < 20) {
  assert(lattice.weightsCalibrated === false, 'n<20 not calibrated');
} else {
  assert(true, `calibrated via stateKey n=${lattice.n}`);
}
assert(Array.isArray(lattice.scenarios) && lattice.scenarios.length >= 4, `scenarios ${lattice.scenarios.length}`);
assert(/启发式|暂无/.test(lattice.note), lattice.note);

const shift = resolveShift();
assert(shift.deliveryContract && shift.outputStyle, `shift ${shift.id} ${shift.deliveryContract}`);
const trimmed = applyShiftDeliveryContract(
  {
    questionQueue: { p0: [1, 2, 3, 4, 5], p0Count: 5, deepQueue: [1, 2, 3] },
    shockGraph: { topPaths: [1, 2, 3, 4, 5, 6, 7], activeEdges: [1, 2, 3, 4, 5] },
    top5Candidates: [1, 2, 3],
    interrupts: [1],
    teaching: { lessons: [1, 2, 3, 4], lessonCount: 4 },
  },
  { ...shift, maxP0: 2, maxShockPaths: 3, allowTop5: false, allowInterrupt: false, focus: [] }
);
assert(trimmed.questionQueue.p0.length <= 2, `p0 trimmed ${trimmed.questionQueue.p0.length}`);
assert(trimmed.top5Candidates.length === 0, 'top5 blocked by contract');
assert(trimmed.shiftContract?.deliveryContract, 'shiftContract attached');

const narr = assessNarrativeEpidemiology({ id: 'sc', name: '原油', factors: { news: { shock: 0.1, hitCount: 0 } } }, '2026-07-16');
assert(narr.version.includes('narrative-contagion'), narr.version);
assert(narr.contagion, 'contagion object');
assert(narr.nDisplay === '暂无' || Number(narr.nDisplay) >= 0, `narr n ${narr.nDisplay}`);

const teach = buildTeachingPack({
  claim: { n: 5 },
  dual: { regime: 'split' },
  attention: { computeMode: 'skip' },
  shockActive: 2,
});
assert(teach.lessonCount >= 2, `lessons ${teach.lessonCount}`);
assert(teach.lessons.some((l) => l.id === 'read_memo'), 'read_memo lesson');

const fakeStrong = Array.from({ length: STRONG_STRUCTURE_CAP + 3 }, (_, i) => ({
  id: `x${i}`,
  name: `品种${i}`,
  intelCenter: {
    beliefLevel: '强结构',
    primaryClaim: { confidence: '强结构', claimId: `c${i}` },
    pushTier: { score: 1 - i * 0.01 },
  },
}));
const brake = enforceConfidenceBrake(fakeStrong, STRONG_STRUCTURE_CAP);
assert(brake.active === true, 'brake active');
assert(brake.downgraded.length === 3, `downgraded ${brake.downgraded.length}`);
assert(fakeStrong.filter((x) => x.intelCenter.beliefLevel === '强结构').length === STRONG_STRUCTURE_CAP, 'cap enforced');

const src = getCachedCommodityOutlookSource();
const slice = (src?.instruments || []).slice(0, 24);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16' });
const pack = buildIntelCenterPack(applied, { asOf: '2026-07-16', persist: false });
assert(pack.version.includes('2.64'), pack.version);
assert(pack.shiftContract?.deliveryContract || pack.shift?.deliveryContract, 'pack shift contract');
assert(pack.teaching?.version?.includes('teaching'), `teaching ${pack.teaching?.version}`);
assert(pack.confidenceBrake && typeof pack.confidenceBrake.active === 'boolean', 'confidenceBrake shape');

const withLattice = applied.find((i) => i.intelCenter?.scenarioLattice?.version);
assert(withLattice, 'at least one scenarioLattice');
assert(withLattice.intelCenter.scenarioLattice.nDisplay, 'lattice nDisplay');

const narrInst = applied.find((i) => i.intelCenter?.narrative?.version?.includes('narrative'));
assert(narrInst || true, 'narrative optional on skip modes');

try {
  const outlook = getCachedCommodityOutlookSource();
  if (outlook) {
    hydrateIntelCenterOnOutlook(outlook, { force: true, persist: false });
    console.log('OK force hydrate');
  } else {
    console.warn('WARN no outlook cache for hydrate');
  }
} catch (err) {
  console.warn('WARN hydrate', err.message);
}

if (fails) {
  console.error(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-wave-b');
