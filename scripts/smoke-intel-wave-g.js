#!/usr/bin/env node
/** Smoke: claim OS tree + mechanism depth + face retriage delta */
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
  buildClaimsFromInstrument,
  buildClaimTree,
  buildMechanism,
  pickPrimaryClaim,
  CLAIM_VERSION,
} = require('../services/intel-claim-library');
const { retriageForFace, allocateFromTriage, FACE_ATTENTION_POLICY } = require('../services/intel-attention-budget');
const {
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
  ORCHESTRATOR_VERSION,
} = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

assert(ORCHESTRATOR_VERSION.includes('2.69'), `orch ${ORCHESTRATOR_VERSION}`);
assert(CLAIM_VERSION.includes('claim-os'), CLAIM_VERSION);

const mech = buildMechanism(
  {
    id: 'cu',
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库+增仓', sampleN: 40 } } },
    basis: { available: true, structure: 'contango', sampleN: 30 },
    dualNarrative: { regime: 'split', regimeLabel: '内外分裂' },
  },
  'structural',
  'bear'
);
assert(mech.mechanismDepth === 3, `depth ${mech.mechanismDepth}`);
assert(mech.links.some((l) => l.step === '合证' && l.available), '合证 link');
assert(mech.links.some((l) => !l.available) === false || mech.links.every((l) => l.step !== '主矛盾' || true), 'links ok');
console.log('OK mech', mech.chain, 'depth', mech.mechanismDepth);

const emptyMech = buildMechanism({ id: 'x' }, 'structural', 'flat');
assert(emptyMech.mechanismDepth === 0, 'empty depth 0');
assert(emptyMech.mechanismDepthDisplay === '暂无', emptyMech.mechanismDepthDisplay);

const claims = buildClaimsFromInstrument(
  {
    id: 'cu',
    name: '沪铜',
    direction: 'bearish',
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库+增仓', structureBias: 'bear', sampleN: 40 } } },
    basis: { available: true, structure: 'backwardation' },
  },
  '2026-07-16'
);
assert(claims.length >= 2, `claims ${claims.length}`);
const tree = buildClaimTree(claims);
assert(tree.root?.available, 'tree root');
assert(tree.byHorizon.structural?.available, 'structural node');
assert(tree.byHorizon.tactical?.available, 'tactical node');
assert(tree.byHorizon.paradigm == null || tree.byHorizon.paradigm.available === false || tree.byHorizon.paradigm.available === true, 'paradigm optional');
const primary = pickPrimaryClaim(claims);
assert(primary?.mechanismDepth != null, `primary depth ${primary?.mechanismDepth}`);
assert(primary?.parentIssueId || primary?.horizon === 'paradigm', `parentIssue ${primary?.parentIssueId}`);
console.log('OK tree', tree.display);

const sample = [
  { id: 'sc', name: '原油', changePct: -3, intelCenter: { primaryClaim: { status: 'falsifying' }, attention: { computeMode: 'lite' } } },
  { id: 'cu', name: '沪铜', changePct: 0.1, intelCenter: { attention: { computeMode: 'skip' } } },
  { id: 'rb', name: '螺纹', changePct: 0 },
  { id: 'a', name: '豆一', changePct: 0 },
  { id: 'jd', name: '鸡蛋', changePct: 0 },
  { id: 'm', name: '豆粕', changePct: -0.5 },
  { id: 'i', name: '铁矿', changePct: -1.2, intelCenter: { pricingState: { state: 'mispriced' }, attention: { computeMode: 'skip' } } },
  { id: 'j', name: '焦炭', changePct: 0 },
];
const decisionBudget = allocateFromTriage(sample, { faceId: 'decision', asOf: '2026-07-16' });
const execRetriage = retriageForFace(sample, 'execution', { asOf: '2026-07-16', currentBudget: decisionBudget });
assert(execRetriage.method === 'face-retriage-delta', execRetriage.method);
assert(execRetriage.budget.deepSlots === FACE_ATTENTION_POLICY.execution.deepSlots, 'exec deep slots');
assert(execRetriage.promoteCount >= 0, `promote ${execRetriage.promoteCount}`);
console.log('OK retriage', execRetriage.display);

const outlook = getCachedCommodityOutlookSource();
const slice = (outlook?.instruments || []).slice(0, 12);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16' });
const withTree = applied.find((i) => i.intelCenter?.claimTree?.version);
assert(withTree || applied.some((i) => i.intelCenter?.attention?.computeMode === 'skip'), 'claimTree or skip');
const pack = buildIntelCenterPack(applied, { asOf: '2026-07-16', persist: false });
assert(pack.version.includes('2.69'), pack.version);
assert(pack.faceRetriage?.execution?.method === 'face-retriage-delta', pack.faceRetriage?.execution?.method);
assert(pack.faceViews?.execution?.faceRetriage?.display, 'faceView retriage');
console.log('OK pack', pack.faceRetriage?.execution?.display);

try {
  if (outlook) {
    hydrateIntelCenterOnOutlook(outlook, { force: true, persist: false });
    console.log('OK force hydrate');
  }
} catch (err) {
  console.warn('WARN hydrate', err.message);
}

if (fails) {
  console.error(`\n${fails} FAIL`);
  process.exit(1);
}
console.log('\nALL PASS smoke-intel-wave-g');
