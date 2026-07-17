#!/usr/bin/env node
/** Smoke: sharp atomic claim OS (vision §46 / v2.89.11) */
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
  CLAIM_VERSION,
  buildClaimsFromInstrument,
  buildAtomicCore,
  buildClaimTree,
  buildClaimSharpnessBoard,
  assessStatementSharpness,
  SOFT_TEMPLATE_RE,
} = require('../services/intel-claim-library');
const { ORCHESTRATOR_VERSION, applyIntelCenterToInstruments, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(CLAIM_VERSION.includes('sharp') || CLAIM_VERSION.includes('2.89.11'), CLAIM_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.11') || ORCHESTRATOR_VERSION.includes('sharp-claim'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.11'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'sharp_claim'), 'lesson');

const rb = {
  id: 'rb',
  name: '螺纹',
  sector: 'ferrous',
  direction: 'bullish',
  changePct: 1.2,
  factors: {
    inventory: {
      stockFlowJoint: { available: true, structureBias: 'bull', primaryRegime: 'destock', primaryLabel: '去库+增仓', sampleN: 40 },
    },
  },
};
const claims = buildClaimsFromInstrument(rb, '2026-07-16');
const structural = claims.find((c) => c.horizon === 'structural');
assert(structural, 'structural');
assert(structural.atomic?.predicate === 'regime_supports_bull', structural.atomic?.predicate);
assert(structural.otherwiseFalsify && /证伪/.test(structural.otherwiseFalsify), structural.otherwiseFalsify);
assert(structural.epochId && structural.epochId.startsWith('E-'), structural.epochId);
assert(structural.sharp === true, `sharp ${structural.sharp}`);
assert(structural.falsifiable === true, 'falsifiable');
assert(/合证「去库\+增仓」/.test(structural.statement), structural.statement);
assert(!SOFT_TEMPLATE_RE.test(structural.statement), 'not soft template');
assert(structural.sectorParentIssueId === 'issue-sector-ferrous-structural', structural.sectorParentIssueId);
assert(structural.method.includes('atomic'), structural.method);

const tree = buildClaimTree(claims);
assert(/命题树/.test(tree.display), tree.display);
assert(tree.method.includes('atomic-epoch'), tree.method);

// soft / insufficient
const softInst = { id: 'xx', name: '未知', direction: 'bullish', changePct: 0.1 };
const softClaims = buildClaimsFromInstrument(softInst, '2026-07-16');
const softS = softClaims.find((c) => c.horizon === 'structural');
assert(softS.sharpness === 'soft' || softS.atomic?.softTemplate, softS.sharpness);
assert(softS.status === 'watch' || softS.status === 'draft', softS.status);
assert(softS.otherwiseFalsify, softS.otherwiseFalsify);

const softAssess = assessStatementSharpness('螺纹结构研判偏多关注验证', {
  softTemplate: true,
  sharpness: 'soft',
  predicate: 'x',
});
assert(softAssess.sharp === false && softAssess.softTemplate === true, softAssess);

// epoch bump when side flips
const bear = {
  ...rb,
  direction: 'bearish',
  intelCenter: { primaryClaim: { ...structural, horizon: 'structural' } },
};
const flipped = buildClaimsFromInstrument(bear, '2026-07-17').find((c) => c.horizon === 'structural');
assert(flipped.epochBumped === true, `bumped ${flipped.epochId} vs ${structural.epochId}`);
assert(flipped.previousEpochId === structural.epochId, flipped.previousEpochId);

const board = buildClaimSharpnessBoard(
  [
    { id: 'rb', name: '螺纹', intelCenter: { primaryClaim: structural } },
    { id: 'xx', name: '未知', intelCenter: { primaryClaim: softS } },
  ],
  '2026-07-16'
);
assert(board.counts.sharp >= 1, board.counts);
assert(board.counts.soft >= 1, board.counts);
assert(/命题锐度/.test(board.display), board.display);

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
assert(pack.version.includes('2.89.11') || pack.version.includes('sharp-claim'), pack.version);
assert(pack.claimSharpnessBoard?.display, pack.claimSharpnessBoard?.display);
assert(withIntel[0].intelCenter?.primaryClaim?.atomic?.predicate || withIntel[0].intelCenter?.primaryClaim?.epochId, 'live atomic/epoch');
assert(pack.faceViews?.research?.claimSharpnessBoard, 'face sharp');

const atomic = buildAtomicCore(rb, 'structural', 'bull');
assert(atomic.falsifyIf?.length >= 1, 'falsifyIf');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · sharp-claim §46'));
process.exit(fails ? 1 : 0);
