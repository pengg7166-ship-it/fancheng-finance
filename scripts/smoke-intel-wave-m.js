#!/usr/bin/env node
/** Smoke: narrative contagion board + evidence freshness (v2.75) */
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
  NARRATIVE_VERSION,
  buildNarrativeContagionBoard,
  enrichQuestionQueueWithNarrative,
} = require('../services/intel-narrative-epidemiology');
const {
  EVIDENCE_FRESH_VERSION,
  assessEvidenceFreshness,
  buildEvidenceFreshnessBoard,
  applyFreshnessToInterruptGate,
} = require('../services/intel-evidence-freshness');
const {
  ORCHESTRATOR_VERSION,
  applyIntelCenterToInstruments,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.75'), ORCHESTRATOR_VERSION);
assert(NARRATIVE_VERSION.includes('contagion'), NARRATIVE_VERSION);
assert(EVIDENCE_FRESH_VERSION.includes('freshness'), EVIDENCE_FRESH_VERSION);

const instruments = [
  {
    id: 'cu',
    name: '沪铜',
    sector: 'base',
    intelCenter: {
      narrative: {
        phase: 'spreading',
        label: '扩散',
        narrativeAhead: true,
        alert: '故事加速但合证未跟',
        n: 8,
        nDisplay: '8',
        dominantTheme: { id: 'destock', count: 3 },
        display: '扩散 · 叙事超前于结构 · n=8',
        contagion: { velocityDisplay: '+150%' },
        scoreDisplay: '0.75',
        dataSource: 'news-tagged.csv',
      },
    },
  },
  {
    id: 'al',
    name: '沪铝',
    sector: 'base',
    intelCenter: {
      narrative: {
        phase: 'peak',
        label: '高峰',
        narrativeAhead: false,
        n: 5,
        nDisplay: '5',
        dominantTheme: { id: 'destock', count: 2 },
        display: '高峰 · n=5',
        contagion: { velocityDisplay: '+40%' },
        scoreDisplay: '0.40',
        dataSource: 'news-tagged.csv',
      },
    },
  },
  {
    id: 'rb',
    name: '螺纹',
    sector: 'ferrous',
    intelCenter: {
      narrative: { phase: 'dormant', label: '无', n: null, nDisplay: '暂无' },
    },
  },
];

const board = buildNarrativeContagionBoard(instruments, '2026-07-16');
assert(board.counts.ahead >= 1, `ahead ${board.counts.ahead}`);
assert(board.clusters.some((c) => c.themeId === 'destock' && c.instrumentCount >= 2), 'destock cluster');
assert(board.questions.some((q) => /超前/.test(q.question)), 'ahead question');
assert(/叙事板/.test(board.display), board.display);
assert(!board.rows.some((r) => r.phase === 'spreading' && r.n == null), 'no spreading without n');

const q = enrichQuestionQueueWithNarrative(
  { version: 't', all: [], deepQueue: [], p0: [], p0Count: 0 },
  board
);
assert(q.narrativeInjected >= 1, `injected ${q.narrativeInjected}`);

const staleInst = {
  id: 'sc',
  name: '原油',
  calendarStaleness: { lagDays: 5 },
  intelCenter: {
    primaryClaim: {
      evidenceFor: [
        {
          evidenceType: 'warehouse_joint',
          summary: '合证',
          freshness: { lagDays: 5, label: '严重滞后' },
          dataSource: 'joint',
        },
      ],
      evidenceAgainst: [],
    },
  },
};
const fresh = assessEvidenceFreshness(staleInst, '2026-07-16');
assert(fresh.blocksInterrupt, fresh.display);
assert(fresh.severe.length >= 1, 'severe');

const gates = applyFreshnessToInterruptGate(
  { intelCenter: { evidenceFreshness: fresh } },
  { interrupt: { pass: true, blockedReasons: [] } }
);
assert(gates.interrupt.pass === false, 'gate blocked');
assert(gates.interrupt.freshnessBlocked, 'freshnessBlocked');

const freshBoard = buildEvidenceFreshnessBoard(
  [{ ...staleInst, intelCenter: { ...staleInst.intelCenter, evidenceFreshness: fresh } }],
  '2026-07-16'
);
assert(freshBoard.blockingCount >= 1, `blocking ${freshBoard.blockingCount}`);

const sample = [
  { id: 'sc', name: '原油', direction: 'bearish', changePct: -1 },
  { id: 'cu', name: '沪铜', direction: 'bearish', changePct: -0.4 },
];
const withIntel = applyIntelCenterToInstruments(sample, { asOf: '2026-07-16', persist: false });
const pack = buildIntelCenterPack(withIntel, {
  asOf: '2026-07-16',
  persist: false,
  attentionFromApply: withIntel._attentionBudget,
});
assert(pack.version.includes('2.75'), pack.version);
assert(pack.narrativeContagion?.display, pack.narrativeContagion?.display);
assert(pack.evidenceFreshnessBoard?.display, pack.evidenceFreshnessBoard?.display);
assert(pack.faceViews?.research?.narrativeContagion, 'research narrative');
assert(pack.dailyDiff, 'dailyDiff kept');

console.log('\n' + (fails ? `FAILS=${fails}` : 'ALL PASS · wave-m narrative+fresh'));
process.exit(fails ? 1 : 0);
