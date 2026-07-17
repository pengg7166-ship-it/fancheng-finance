#!/usr/bin/env node
/** Smoke: horizon conflict OS (v2.76) */
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
  HORIZON_VERSION,
  resolveHorizonCoordination,
  buildHorizonConflictBoard,
  enrichQuestionQueueWithHorizon,
} = require('../services/intel-horizon-coordination');
const { buildChoiceSet, CHOICE_VERSION } = require('../services/intel-choice-set');
const {
  ORCHESTRATOR_VERSION,
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.76'), ORCHESTRATOR_VERSION);
assert(HORIZON_VERSION.includes('horizon-conflict'), HORIZON_VERSION);
assert(CHOICE_VERSION.includes('horizon'), CHOICE_VERSION);

const claims = [
  {
    claimId: 'claim-cu-tactical',
    horizon: 'tactical',
    side: 'bull',
    confidence: '弱结构',
    status: 'active',
    statement: '短线反弹',
    n: 20,
  },
  {
    claimId: 'claim-cu-structural',
    horizon: 'structural',
    side: 'bear',
    confidence: '弱结构',
    status: 'active',
    statement: '结构累库压制',
    n: 40,
  },
];

const hz = resolveHorizonCoordination(claims, { id: 'cu' });
assert(hz.hasConflict, 'has conflict');
assert(hz.preferChoiceC, 'prefer C');
assert(hz.severity === 'high', hz.severity);
assert(hz.conflicts[0].display.includes('vs'), hz.conflicts[0].display);
assert(hz.claimsByHorizon.tactical?.sideLabel === '偏多', 'tactical label');
assert(hz.claimsByHorizon.paradigm == null || hz.missing.some((m) => m.horizon === 'paradigm'), 'paradigm missing ok');

const cs = buildChoiceSet(
  { id: 'cu' },
  claims[1],
  { state: 'mispriced' },
  {},
  null,
  hz
);
assert(cs.primaryId === 'C', `choice C got ${cs.primaryId}`);
assert(cs.horizonConflict?.preferChoiceC, 'choice horizon flag');
assert(/尺度冲突/.test(cs.primary.why || cs.display), cs.display);

const board = buildHorizonConflictBoard([
  {
    id: 'cu',
    name: '沪铜',
    intelCenter: { horizonCoordination: hz },
  },
  {
    id: 'rb',
    name: '螺纹',
    intelCenter: {
      horizonCoordination: resolveHorizonCoordination(
        [{ claimId: 'c', horizon: 'structural', side: 'flat', status: 'active' }],
        { id: 'rb' }
      ),
    },
  },
]);
assert(board.counts.conflict >= 1, `conflict ${board.counts.conflict}`);
assert(board.questions.some((q) => /禁止合成/.test(q.question)), 'question');
assert(/尺度冲突板/.test(board.display), board.display);

const q = enrichQuestionQueueWithHorizon(
  { version: 't', all: [], deepQueue: [], p0: [], p0Count: 0 },
  board
);
assert(q.horizonInjected >= 1, `injected ${q.horizonInjected}`);

const sample = [
  { id: 'sc', name: '原油', direction: 'bearish', changePct: -1 },
  { id: 'cu', name: '沪铜', direction: 'bearish', changePct: -0.3 },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.76'), pack.version);
assert(pack.horizonConflictBoard?.display, pack.horizonConflictBoard?.display);
assert(pack.faceViews?.research?.horizonConflictBoard, 'research face hz');
assert(pack.dailyDiff, 'dailyDiff');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-n horizon-conflict'));
process.exit(fails ? 1 : 0);
