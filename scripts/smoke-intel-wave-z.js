#!/usr/bin/env node
/** Smoke: mechanism taxonomy + falseQuietRisk + header dens (v2.88) */
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
  MECHANISM_BOARD_VERSION,
  STATUS,
  classifyPending,
  buildMechanismBoard,
} = require('../services/intel-mechanism-board');
const {
  QUIET_BRAKE_VERSION,
  buildQuietBrakeBoard,
} = require('../services/intel-quiet-brake-board');
const { TEACH_VERSION, LESSONS, buildTeachingPack } = require('../services/intel-teaching');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.88'), ORCHESTRATOR_VERSION);
assert(MECHANISM_BOARD_VERSION.includes('taxonomy'), MECHANISM_BOARD_VERSION);
assert(QUIET_BRAKE_VERSION.includes('false-risk'), QUIET_BRAKE_VERSION);
assert(TEACH_VERSION.includes('2.88'), TEACH_VERSION);

// taxonomy: empirics → dormant, not "no empirics"
assert(classifyPending({ n: 40, corr: 0.55, reason: '源冲击不足' }) === STATUS.empiricalReady, 'dormant');
assert(classifyPending({ n: 8, corr: null, reason: '样本不足' }) === STATUS.pendingInsufficientN, 'insuff');

const board = buildMechanismBoard(
  {
    activeEdges: [
      { from: 'sc', to: 'fu', mechanism: 'cost', n: 40, corr: 0.6, activation: 0.4, nDisplay: '40' },
    ],
    pendingEdges: [
      { from: 'cu', to: 'al', mechanism: 'substitute', n: 50, corr: 0.4, reason: '源冲击不足', nDisplay: '50' },
      { from: 'rb', to: 'hc', mechanism: 'arbitrage', n: 5, corr: null, reason: 'n不足', nDisplay: '5' },
    ],
  },
  []
);
assert(board.counts.liveActive === 1, `live ${board.counts.liveActive}`);
assert(board.counts.empiricalReady === 1, `ready ${board.counts.empiricalReady}`);
assert(board.counts.pendingInsufficientN === 1, `insuff ${board.counts.pendingInsufficientN}`);
assert(/活1/.test(board.display) && /实证休眠1/.test(board.display) && /n不足1/.test(board.display), board.display);
assert(board.counts.live === 1 && board.counts.pending === 2, 'compat live/pending');

// false quiet: dailyDiff quiet + interrupt → risk, quietDay stays false (eligible)
const qbRisk = buildQuietBrakeBoard({
  dailyDiff: {
    available: true,
    quietDay: true,
    materialChanges: 0,
    changes: { surpriseTop: [] },
    quietReason: '物质变更=0',
    summary: '静默',
  },
  confidenceBrake: { active: false, strongCount: 1, cap: 5, downgraded: [] },
  interrupts: [{ id: 'cu', name: '沪铜' }],
  asOf: '2026-07-17',
  persist: false,
});
assert(qbRisk.falseQuietRisk === true, 'falseQuietRisk');
assert(qbRisk.quietDay === false && qbRisk.quietEligible === false, 'not quiet eligible');
assert(/假静默风险/.test(qbRisk.display), qbRisk.display);
assert((qbRisk.questions || []).some((q) => /假静默/.test(q.question)), 'P2 false quiet q');

const qbTrue = buildQuietBrakeBoard({
  dailyDiff: {
    available: true,
    quietDay: true,
    materialChanges: 0,
    changes: { surpriseTop: [] },
  },
  confidenceBrake: { active: false, strongCount: 0, cap: 5, downgraded: [] },
  interrupts: [],
  asOf: '2026-07-17',
  persist: false,
});
assert(qbTrue.quietDay === true && qbTrue.falseQuietRisk === false, 'true quiet');

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.8 },
    { id: 'au', name: '沪金', changePct: 0.2 },
    { id: 'rb', name: '螺纹', changePct: 0.1 },
    { id: 'sc', name: '原油', changePct: -0.3 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.88'), pack.version);
assert(pack.statsDisplay && /\d+\/\d+/.test(pack.statsDisplay.deepAttention || ''), pack.statsDisplay?.deepAttention);
assert(pack.statsDisplay.mechanismLine && /活/.test(pack.statsDisplay.mechanismLine), pack.statsDisplay.mechanismLine);
assert(typeof pack.stats.mechanismLiveActive === 'number', 'stats liveActive');
assert(typeof pack.stats.mechanismEmpiricalReady === 'number', 'stats empiricalReady');
assert(typeof pack.stats.mechanismPendingInsufficientN === 'number', 'stats insuffN');
assert(pack.mechanismBoard?.version?.includes('taxonomy'), pack.mechanismBoard?.version);
assert(pack.faceViews?.research?.mechanismBoard?.liveActive != null || pack.mechanismBoard?.liveActive, 'face mech');
assert(
  pack.faceViews?.decision?.quietBrakeBoard?.falseQuietRisk === false ||
    typeof pack.faceViews?.decision?.quietBrakeBoard?.falseQuietRisk === 'boolean',
  'face qb falseQuietRisk field'
);
assert(
  (pack.teaching?.lessons || []).some((l) =>
    ['header_denominators', 'mechanism_board', 'false_quiet_risk'].includes(l.id)
  ) ||
    (pack.teaching?.truncatedByShift &&
      LESSONS.some((l) => l.id === 'header_denominators') &&
      pack.statsDisplay?.mechanismLine),
  `teach ${JSON.stringify(pack.teaching?.lessons?.map((l) => l.id))} trunc=${pack.teaching?.truncatedByShift}`
);

const teachFull = buildTeachingPack({
  stats: pack.stats,
  statsDisplay: pack.statsDisplay,
  mechanismBoard: pack.mechanismBoard,
  quietBrakeBoard: pack.quietBrakeBoard,
});
assert(
  teachFull.lessons.some((l) => l.id === 'header_denominators') &&
    teachFull.lessons.some((l) => l.id === 'mechanism_board'),
  `teachFull ${teachFull.lessons.map((l) => l.id).join(',')}`
);

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-z mech-taxonomy-quiet-header-n');
process.exit(fails ? 1 : 0);
