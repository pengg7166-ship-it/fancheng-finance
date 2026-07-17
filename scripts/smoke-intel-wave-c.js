#!/usr/bin/env node
/** Smoke: playbook switch + issue board + face contracts */
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

const { resolvePlaybookContext, applyPlaybookToClaim } = require('../services/intel-playbook-switcher');
const {
  makeStableIssueId,
  normalizeIssueId,
  buildIssueBoard,
  attachIssueIdsToClaim,
} = require('../services/intel-issue-board');
const { applyFaceDeliveryContract, FACE_CONTRACTS } = require('../services/intel-face-contracts');
const { makeIssueId, buildClaimsFromInstrument, pickPrimaryClaim } = require('../services/intel-claim-library');
const {
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
  ORCHESTRATOR_VERSION,
} = require('../services/intel-orchestrator');
const { getCachedCommodityOutlookSource, hydrateIntelCenterOnOutlook } = require('../services/commodity-outlook-engine');

assert(ORCHESTRATOR_VERSION.includes('2.65'), `orch ${ORCHESTRATOR_VERSION}`);

const pb = resolvePlaybookContext({
  id: 'rb',
  name: '螺纹',
  tradingGuidance: { phase: '升温', bias: '偏多' },
  intelligenceKernel: { stateKey: 'rb|bull|build' },
});
assert(pb.version.includes('playbook-switch'), pb.version);
assert(pb.activeId || pb.display.includes('暂无'), `pb ${pb.display}`);
console.log('OK playbook', pb.display);

const claim = applyPlaybookToClaim(
  { claimId: 'claim-rb-structural', statement: 'test', side: 'bull' },
  pb
);
assert(!pb.activeId || claim.playbookId === pb.activeId, `claim pb ${claim.playbookId}`);

const stable = makeStableIssueId('cu', 'structural');
assert(stable === 'issue-cu-structural', stable);
assert(normalizeIssueId('issue-cu-structural-20260716') === 'issue-cu-structural', 'normalize day suffix');
assert(makeIssueId('cu', 'structural', '2026-07-16') === 'issue-cu-structural', `makeIssueId ${makeIssueId('cu', 'structural', '2026-07-16')}`);

const withSnap = attachIssueIdsToClaim(
  { claimId: 'claim-cu-structural', horizon: 'structural', statement: 'x' },
  { id: 'cu' },
  '2026-07-16'
);
assert(withSnap.issueId === 'issue-cu-structural', withSnap.issueId);
assert(withSnap.issueSnapshotId?.includes('20260716'), withSnap.issueSnapshotId);

const faceDec = applyFaceDeliveryContract(
  {
    questionQueue: { p0: [1, 2, 3, 4], p0Count: 4, deepQueue: [1, 2, 3] },
    shockGraph: { topPaths: [1, 2, 3, 4, 5, 6], activeEdges: [] },
    interrupts: [1, 2, 3],
    teaching: { lessons: [1, 2, 3], lessonCount: 3 },
    issueBoard: { issues: [1, 2, 3, 4, 5, 6, 7], open: [], falsifying: [] },
    playbookBoard: { display: 'pb' },
    debtBoard: { display: 'debt', totalDebts: 1 },
  },
  'decision'
);
assert(faceDec.faceContract.id === 'decision', 'face decision');
assert(faceDec.questionQueue.p0.length <= FACE_CONTRACTS.decision.maxP0, 'p0 face trim');
assert(faceDec.playbookBoard == null, 'decision hides playbook board');

const faceRes = applyFaceDeliveryContract(
  {
    questionQueue: { p0: [1], p0Count: 1 },
    shockGraph: { topPaths: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    interrupts: [],
    teaching: { lessons: [1, 2], lessonCount: 2 },
    issueBoard: { issues: Array.from({ length: 20 }, (_, i) => i), open: [], falsifying: [] },
    playbookBoard: { display: 'pb' },
    debtBoard: { display: 'debt', weeklyMustPay: [1] },
  },
  'research'
);
assert(faceRes.playbookBoard?.display === 'pb', 'research shows playbook');
assert(faceRes.issueBoard.issues.length <= FACE_CONTRACTS.research.maxIssues, 'issues trimmed');

const claims = buildClaimsFromInstrument(
  {
    id: 'cu',
    name: '沪铜',
    direction: 'bearish',
    factors: { inventory: { stockFlowJoint: { available: true, primaryLabel: '累库+增仓', structureBias: 'bear' } } },
  },
  '2026-07-16'
);
const primary = pickPrimaryClaim(claims);
assert(primary?.issueId === 'issue-cu-structural' || primary?.issueId?.startsWith('issue-cu-'), primary?.issueId);
assert(!/-\d{8}$/.test(primary.issueId), 'issueId stable no day');

const src = getCachedCommodityOutlookSource();
const slice = (src?.instruments || []).slice(0, 20);
const applied = applyIntelCenterToInstruments(slice, { persist: false, asOf: '2026-07-16' });
const withPb = applied.find((i) => i.intelCenter?.playbook?.version);
assert(withPb || applied.some((i) => i.intelCenter?.attention?.computeMode === 'skip'), 'playbook or skip ok');

const pack = buildIntelCenterPack(applied, { asOf: '2026-07-16', persist: false });
assert(pack.version.includes('2.65'), pack.version);
assert(pack.faceViews?.decision?.faceContract?.id === 'decision', 'faceViews decision');
assert(pack.faceViews?.research?.faceContract?.id === 'research', 'faceViews research');
assert(pack.faceViews?.execution?.faceContract?.id === 'execution', 'faceViews execution');
assert(pack.issueBoard?.version?.includes('issue-board'), pack.issueBoard?.version);
assert(pack.playbookBoard?.version?.includes('playbook'), pack.playbookBoard?.version);
console.log('OK pack', pack.issueBoard?.display, pack.playbookBoard?.display);

const board = buildIssueBoard(applied, { limit: 20 });
assert(board.total >= 0, `board total ${board.total}`);

try {
  const outlook = getCachedCommodityOutlookSource();
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
console.log('\nALL PASS smoke-intel-wave-c');
