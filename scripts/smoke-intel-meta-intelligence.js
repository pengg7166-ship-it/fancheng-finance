#!/usr/bin/env node
/** Smoke: meta-intelligence self-audit blind spots (vision §30 / v2.89.5) */
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
  META_VERSION,
  buildMetaIntelligenceBoard,
  enrichQuestionQueueWithMeta,
} = require('../services/intel-meta-intelligence');
const { ORCHESTRATOR_VERSION, buildIntelCenterPack } = require('../services/intel-orchestrator');
const { TEACH_VERSION, LESSONS } = require('../services/intel-teaching');

assert(META_VERSION.includes('meta'), META_VERSION);
assert(ORCHESTRATOR_VERSION.includes('2.89.5') || ORCHESTRATOR_VERSION.includes('meta'), ORCHESTRATOR_VERSION);
assert(TEACH_VERSION.includes('2.89.5'), TEACH_VERSION);
assert(LESSONS.some((l) => l.id === 'meta_intelligence'), 'lesson');

const clearBoard = buildMetaIntelligenceBoard([], { asOf: '2026-07-17' });
assert(clearBoard.severity === 'clear', clearBoard.severity);
assert(/暂无/.test(clearBoard.display), clearBoard.display);
assert(clearBoard.counts.total === 0, 'empty spots');

const instruments = [
  {
    id: 'rb',
    name: '螺纹',
    calendarStaleness: { lagDays: 5 },
    factors: { inventory: { stockFlowJoint: { available: false } } },
    capitalAttention: { jointWithInventory: '暂无' },
    intelCenter: {
      beliefLevel: '强结构',
      primaryClaim: {
        status: 'active',
        confidence: '强结构',
        evidenceAgainst: [],
        n: null,
        nDisplay: '暂无',
      },
      gates: { top5: { pass: false } },
      retrieval: { available: false, display: '检索 · 暂无先例', nDisplay: '暂无' },
      memo: {
        available: true,
        unknownMap: { criticalGaps: [{ label: '缺基差' }] },
        retrieval: { available: false },
      },
    },
  },
  {
    id: 'cu',
    name: '铜',
    factors: { inventory: { stockFlowJoint: { available: true } } },
    intelCenter: {
      beliefLevel: '弱结构',
      primaryClaim: {
        status: 'active',
        confidence: '弱结构',
        evidenceAgainst: [{ summary: '外盘分歧' }],
        n: 40,
        nDisplay: '40',
      },
      gates: { top5: { pass: true } },
      retrieval: { available: true, nDisplay: '2' },
    },
  },
];

const board = buildMetaIntelligenceBoard(instruments, {
  asOf: '2026-07-17',
  debtBoard: { byType: { joint_gap: 1, stale_data: 1 } },
  mechanismBoard: { counts: { honestyDenied: 2, liveActive: 0, pendingInsufficientN: 5 } },
  evidenceAuditBoard: { counts: { critical: 1, high: 0 } },
  processLearning: { sampleN: 8 },
  quietBrakeBoard: { falseQuietRisk: true },
  museumBoard: { counts: { entries: 0 }, entries: [] },
  attentionBudget: { deepCount: 40, trueRationing: false },
});

assert(board.available === true, 'available');
assert(board.severity === 'critical' || board.severity === 'high', board.severity);
assert(board.counts.total > 0, `total=${board.counts.total}`);
assert(board.spots.some((s) => s.id === 'coverage_stale'), 'stale spot');
assert(board.spots.some((s) => s.id === 'evidence_no_oppose'), 'no oppose');
assert(board.spots.some((s) => s.id === 'evidence_no_n'), 'no n');
assert(board.spots.some((s) => s.id === 'mechanism_honesty'), 'honesty');
assert(board.spots.some((s) => s.id === 'false_quiet'), 'false quiet');
assert(board.spots.some((s) => s.id === 'confidence_gate_conflict'), 'gate conflict');
assert(board.spots.every((s) => s.nDisplay && s.nDisplay !== ''), 'nDisplay');
assert(!board.spots.some((s) => /假造|mock|dummy/i.test(s.label)), 'no fake labels');

const q = enrichQuestionQueueWithMeta(
  { all: [], version: 'q' },
  board
);
assert((q.all || []).length > 0, 'queue enriched');
assert(q.all.some((x) => x.priorityLabel === '元智能'), 'meta label');

const pack = buildIntelCenterPack(instruments, { asOf: '2026-07-17', persist: false });
assert(pack.metaIntelligence?.display, pack.metaIntelligence?.display || 'missing');
assert(pack.stats?.metaBlindSpots != null, 'stats meta');
assert(pack.statsDisplay?.metaBlind, pack.statsDisplay?.metaBlind);

if (fails) {
  console.error(`\n${fails} FAIL(s)`);
  process.exit(1);
}
console.log('\nPASS smoke-intel-meta-intelligence');
