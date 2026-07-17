#!/usr/bin/env node
/** Smoke: Unknown Map OS + research compile surface (v2.72) */
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
  buildUnknownMap,
  buildUnknownBoard,
  UNKNOWN_VERSION,
} = require('../services/intel-unknown-map');
const {
  compileResearchRelease,
  diffModelVersions,
  COMPILE_VERSION,
} = require('../services/intel-research-compile');
const { ORCHESTRATOR_VERSION, evaluateIntelCenter, buildIntelCenterPack, applyIntelCenterToInstruments } = require('../services/intel-orchestrator');
const { MEMO_VERSION, buildUnknownMap: memoUnknown } = require('../services/intel-memo');

assert(ORCHESTRATOR_VERSION.includes('2.72'), ORCHESTRATOR_VERSION);
assert(UNKNOWN_VERSION.includes('unknown-map'), UNKNOWN_VERSION);
assert(COMPILE_VERSION.includes('compile-surface'), COMPILE_VERSION);
assert(MEMO_VERSION.includes('unknown-compile'), MEMO_VERSION);

const thin = buildUnknownMap({ id: 'x', outlookPending: true }, { claimId: 'c', status: 'active' });
assert(thin.hasCritical, 'pending price critical');
assert(thin.blocksPublish, 'blocks publish');
assert(thin.shortestPath?.length >= 1, 'shortest path');
assert(thin.nextAction?.path, thin.nextAction);
assert(thin.confidenceHaircut > 0, `haircut ${thin.confidenceHaircut}`);
assert(!/假数据|mock|dummy|synthetic/i.test(JSON.stringify(thin)), 'no fake fill');

const fullish = buildUnknownMap(
  {
    id: 'cu',
    factors: { inventory: { stockFlowJoint: { available: true } } },
    capitalAttention: { horizons: { oi1mPct: 1.2 } },
    basis: { available: true, structure: 'contango' },
    dualNarrative: { mapped: true, regime: 'split' },
  },
  {
    claimId: 'claim-cu-structural',
    status: 'active',
    n: 40,
    evidenceAgainst: [{ summary: '资金情绪对侧' }],
  }
);
assert(fullish.gaps.some((g) => g.id === 'dual_split_unresolved'), 'dual gap');
assert(!fullish.gaps.some((g) => g.id === 'joint'), 'no joint gap when available');

const reExported = memoUnknown({ id: 'y' }, null);
assert(reExported.version === UNKNOWN_VERSION, 'memo re-exports unknown map');

const board = buildUnknownBoard([
  { id: 'a', name: 'A', intelCenter: { unknownMap: thin } },
  { id: 'b', name: 'B', intelCenter: { unknownMap: fullish } },
]);
assert(board.totalGaps >= 2, `board gaps ${board.totalGaps}`);
assert(board.paydown?.length >= 1, 'paydown');
assert(/Unknown/.test(board.display), board.display);

const diff = diffModelVersions({ orchestrator: 'v2', claim: 'c1' }, { orchestrator: 'v1', claim: 'c1' });
assert(diff.available && diff.changedCount === 1, JSON.stringify(diff));
assert(diff.changed[0].key === 'orchestrator', diff.changed[0]);

const sample = [
  { id: 'sc', name: '原油', direction: 'bearish', outlookPending: true },
  {
    id: 'cu',
    name: '沪铜',
    direction: 'bearish',
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库' } } },
  },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.72'), pack.version);
assert(pack.unknownBoard?.display, pack.unknownBoard?.display);
assert(pack.researchCompile?.releaseId, pack.researchCompile?.releaseId);
assert(pack.researchCompile?.vsPrev, 'vsPrev present');
assert(pack.researchCompile?.versionLines?.length > 0, 'versionLines');
assert(pack.faceViews?.research?.researchCompile?.versionLines, 'research face compile surface');
assert(pack.faceViews?.research?.unknownBoard?.display, 'research unknown board');

const live = evaluateIntelCenter(sample[0], { asOf: '2026-07-16', persist: false, computeMode: 'full' });
assert(live.unknownMap?.shortestPath || live.memo?.unknownMap?.shortestPath, 'live unknown path');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-j unknown+compile'));
process.exit(fails ? 1 : 0);
