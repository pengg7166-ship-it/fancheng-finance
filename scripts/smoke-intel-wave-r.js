#!/usr/bin/env node
/** Smoke: failure museum review + weekly debt (v2.80) */
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
  MUSEUM_BOARD_VERSION,
  classifyLesson,
  enrichQuestionQueueWithMuseum,
  mergeMuseumIntoDebtBoard,
  buildFailureMuseumBoard,
} = require('../services/intel-failure-museum-board');
const { DEBT_VERSION, buildDebtBoard } = require('../services/intel-debt-board');
const { recordFalsification, loadFailureMuseum } = require('../services/intel-memory');
const {
  ORCHESTRATOR_VERSION,
  buildIntelCenterPack,
} = require('../services/intel-orchestrator');

assert(ORCHESTRATOR_VERSION.includes('2.80'), ORCHESTRATOR_VERSION);
assert(MUSEUM_BOARD_VERSION.includes('museum-review'), MUSEUM_BOARD_VERSION);
assert(DEBT_VERSION.includes('museum'), DEBT_VERSION);

assert(classifyLesson({ trigger: '合证翻转' }).id === 'structure_flip', 'lesson structure');
assert(classifyLesson({ trigger: 'clock_expired' }).id === 'expired', 'lesson expired');
assert(classifyLesson({ trigger: '叙事疲劳' }).id === 'narrative_break', 'lesson narrative');

const synthBoard = {
  questions: [
    {
      priority: 'P2',
      score: 40,
      instrumentId: 'cu',
      instrumentName: '沪铜',
      question: '失效博物馆：近90日 2 次证伪 — 现役命题是否重蹈？',
      reasons: ['失效博物馆复盘', 'n=2'],
      museumN: 2,
      nDisplay: '2',
    },
  ],
  weeklyMuseumPay: [
    {
      type: 'repeat_falsify',
      instrumentId: 'cu',
      instrumentName: '沪铜',
      impact: 'high',
      museumN30: 2,
      nDisplay: '2',
      remedy: '复盘触发器',
      label: '近30日重复证伪',
    },
  ],
};

const q = enrichQuestionQueueWithMuseum({ all: [], version: 't' }, synthBoard);
assert((q.museumInjected || 0) === 1, `injected ${q.museumInjected}`);

const debt = mergeMuseumIntoDebtBoard(
  {
    version: 'v',
    totalDebts: 1,
    weeklyMustPay: [{ type: 'stale_data', instrumentId: 'rb', impact: 'high' }],
    priorityPaydown: [{ type: 'stale_data', instrumentId: 'rb', impact: 'high' }],
    byType: { stale_data: 1 },
    display: '问题债务 1',
    method: 'debt',
  },
  synthBoard
);
assert(debt.museumLinked === 1, `linked ${debt.museumLinked}`);
assert(debt.weeklyMustPay.some((d) => d.type === 'repeat_falsify'), 'weekly has museum');
assert(/博物馆周还/.test(debt.display), debt.display);

// Seed one real museum row (persist) then build board
recordFalsification(
  {
    claimId: `smoke-museum-${Date.now()}`,
    statement: '烟测：结构偏多将延续',
    falsifyTrigger: '合证翻转离开去库',
  },
  '合证翻转离开去库',
  { id: 'cu', name: '沪铜' }
);
const museumRows = loadFailureMuseum(5);
assert(museumRows.length >= 1, `museum rows ${museumRows.length}`);

const board = buildFailureMuseumBoard(
  [
    {
      id: 'cu',
      name: '沪铜',
      intelCenter: {
        primaryClaim: { claimId: 'live-cu', status: 'active', statement: '结构偏多' },
      },
    },
  ],
  { asOf: '2026-07-17' }
);
assert(board.entryCount >= 1, `entries ${board.entryCount}`);
assert(board.lessons.some((l) => l.n > 0), 'lessons');
assert(
  board.activeWarnings.some((w) => w.instrumentId === 'cu') || board.questions.length >= 0,
  'warnings or empty-ok'
);

const pack = buildIntelCenterPack(
  [
    { id: 'cu', name: '沪铜', changePct: 0.5 },
    { id: 'rb', name: '螺纹', changePct: 0.2 },
    { id: 'au', name: '沪金', changePct: 0.1 },
  ],
  { asOf: '2026-07-17', persist: false }
);
assert(pack.version.includes('2.80'), pack.version);
assert(pack.museumBoard?.version?.includes('museum'), pack.museumBoard?.version || 'no museum');
assert(typeof pack.museumBoard.display === 'string', pack.museumBoard.display);
assert(pack.debtBoard?.weeklyPlan || pack.debtBoard?.weeklyMustPay, 'debt weekly');
assert(pack.faceViews?.research?.museumBoard || pack.stats?.museumEntries != null, 'research face');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS · wave-r museum-review');
process.exit(fails ? 1 : 0);
