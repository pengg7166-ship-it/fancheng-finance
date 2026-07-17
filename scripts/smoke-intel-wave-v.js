#!/usr/bin/env node
/** Smoke: daily-diff OS + quiet/brake board (v2.84) */
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
  DIFF_VERSION,
  diffSnapshots,
  slimInstrument,
  materialChangeCount,
} = require('../services/intel-daily-diff');
const {
  QUIET_BRAKE_VERSION,
  buildQuietBrakeBoard,
  enrichQuestionQueueWithQuietBrake,
} = require('../services/intel-quiet-brake-board');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
  enforceConfidenceBrake,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.84'), ORCHESTRATOR_VERSION);
assert(DIFF_VERSION.includes('daily-diff-os'), DIFF_VERSION);
assert(QUIET_BRAKE_VERSION.includes('quiet-brake'), QUIET_BRAKE_VERSION);

const prev = {
  date: '2026-07-16',
  instruments: [
    slimInstrument({
      id: 'cu',
      name: '沪铜',
      direction: 'bull',
      directionLabel: '偏多',
      intelCenter: {
        primaryClaim: {
          claimId: 'c1',
          status: 'active',
          confidence: '弱结构',
          issueId: 'iss1',
        },
        playbook: { activeId: 'pb-a', stage: 'early' },
        pricingState: { state: 'fair' },
        redTeam: { forceDowngrade: false },
        surprise: { composite: 0.1 },
        memo: { unknownMap: { gaps: [] } },
      },
      intelligenceKernel: { stateKey: 'k1' },
    }),
  ],
};
const curr = {
  date: '2026-07-17',
  instruments: [
    slimInstrument({
      id: 'cu',
      name: '沪铜',
      direction: 'bull',
      directionLabel: '偏多',
      intelCenter: {
        primaryClaim: {
          claimId: 'c2',
          status: 'active',
          confidence: '弱结构',
          issueId: 'iss1',
          redTeamIngested: 1,
          confidenceBrakeForced: true,
        },
        playbook: { activeId: 'pb-b', stage: 'mid' },
        pricingState: { state: 'mispriced' },
        redTeam: { forceDowngrade: true },
        confidenceBrakeForced: true,
        surprise: { composite: 0.2 },
        memo: {
          unknownMap: {
            gaps: [{ severity: 'critical', label: '合证滞后', blocksPublish: true }],
          },
        },
      },
      intelligenceKernel: { stateKey: 'k2' },
    }),
  ],
};

const d = diffSnapshots(prev, curr);
assert(d.available, 'diff available');
assert(d.changes.claimSwaps.length >= 1, 'claimSwaps');
assert(d.changes.playbookTransitions.length >= 1, 'playbook');
assert(d.changes.pricingFlips.length >= 1, 'pricing');
assert(d.changes.regimeFlips.length >= 1, 'regime');
assert(d.changes.redTeamIngests.length >= 1, 'redteam');
assert(d.changes.brakeForced.length >= 1, 'brake');
assert(d.changes.newGaps.length >= 1, 'newGaps');
assert(d.quietDay === false, 'not quiet when material');
assert(materialChangeCount(d.changes) >= 5, `material ${d.materialChanges}`);

const noPrev = {
  version: DIFF_VERSION,
  available: false,
  quietDay: false,
  reason: 'no_prev_snapshot',
  materialChanges: null,
  changes: {},
};
const qbNo = buildQuietBrakeBoard({
  dailyDiff: noPrev,
  confidenceBrake: { active: false, strongCount: 3, cap: 12, downgraded: [] },
  interrupts: [],
  asOf: '2026-07-17',
  persist: false,
});
assert(qbNo.quietDay === false, 'no false quiet without snapshot');
assert(/待校验|不可判定/.test(qbNo.display + qbNo.quietReason), qbNo.display);

const qbYes = buildQuietBrakeBoard({
  dailyDiff: {
    available: true,
    quietDay: true,
    materialChanges: 0,
    changes: { surpriseTop: [] },
    quietReason: '无物质变化',
    summary: '今日无显著结构变化',
  },
  confidenceBrake: {
    active: true,
    strongCount: 20,
    strongAfter: 12,
    cap: 12,
    downgraded: [{ id: 'rb', name: '螺纹' }],
    note: '刹车',
  },
  interrupts: [],
  asOf: '2026-07-17',
  persist: false,
});
assert(qbYes.quietDay === true, 'quiet eligible');
assert(qbYes.brake.active === true, 'brake active');
assert(qbYes.brake.downgraded.length >= 1, 'brake list');
const q = enrichQuestionQueueWithQuietBrake({ all: [], version: 'v' }, qbYes);
assert((q.quietBrakeInjected || 0) >= 1, `injected ${q.quietBrakeInjected}`);

const strongish = Array.from({ length: 15 }, (_, i) => ({
  id: `i${i}`,
  name: `V${i}`,
  intelCenter: {
    beliefLevel: '强结构',
    primaryClaim: { confidence: '强结构', claimId: `c${i}` },
    pushTier: { score: 100 - i },
    gates: { top5: { pass: true } },
  },
}));
const br = enforceConfidenceBrake(strongish, 12);
assert(br.active === true, 'brake eng');
assert(br.downgraded.length === 3, `downgraded ${br.downgraded.length}`);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.84'), pack.version);
assert(pack.dailyDiff?.version?.includes('daily-diff-os'), pack.dailyDiff?.version || 'no diff');
assert(pack.quietBrakeBoard?.version?.includes('quiet-brake'), pack.quietBrakeBoard?.version || 'no qb');
assert(typeof pack.dailyDiff.summary === 'string', pack.dailyDiff.summary);
assert(typeof pack.quietBrakeBoard.display === 'string', pack.quietBrakeBoard.display);
assert(pack.faceViews?.decision?.quietBrakeBoard || pack.faceViews?.decision?.dailyDiff, 'decision face');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-v diff-quiet-brake');
process.exit(fails ? 1 : 0);
